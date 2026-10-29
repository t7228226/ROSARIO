import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/gasClient.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(respond, { fastTimers = false } = {}) {
  const requests = [], events = [], timeouts = [], storage = new Map(), exports = {};
  const context = vm.createContext({
    exports, require(name) {
      if (name.includes("environment")) return { appEnvironment: { writesEnabled: true, version: "test", gasEndpoint: "https://synthetic.invalid" } };
      if (name.includes("writeActions")) return { FRONT_WRITE_ACTIONS: new Set(["updatePerson"]) };
      throw new Error(`Unexpected import ${name}`);
    },
    window: { setTimeout: (callback, ms) => { timeouts.push(ms); return setTimeout(callback, fastTimers ? 0 : ms); }, clearTimeout, dispatchEvent: (event) => events.push(event), sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) } },
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body); requests.push(body);
      let result = await respond(body);
      if (body.action === "bootstrap" && !(result instanceof Response) && result.ok) result = { serverVersion: "test", ...result };
      if (result instanceof Response) return result;
      if (body.operationId && result.ok && !result.pending) result = { ...result, operationId: body.operationId, operationStatus: "success" };
      return new Response(JSON.stringify(result), { status: 200 });
    },
    AbortController, DOMException, crypto, CustomEvent, Response, TextEncoder, Uint8Array, Error, TypeError, setTimeout, clearTimeout,
  });
  vm.runInContext(code, context);
  return { client: exports, requests, events, timeouts };
}
test("writes carry bootstrap revision and advance only after a confirmed success", async () => {
  const f = fixture((body) => body.action === "bootstrap" ? { ok: true, revision: 7, people: [] } : { ok: true, revision: body.payload.expectedRevision + 1 });
  f.client.setGasSessionToken("synthetic");
  await f.client.fetchGasBootstrapData();
  await f.client.postGasAction("updatePerson", { id: "X" });
  await f.client.postGasAction("updatePerson", { id: "Y" });
  assert.deepEqual(f.requests.slice(1).map((body) => body.payload.expectedRevision), [7, 8]);
});

test("edits can retain the revision captured before a confirmation dialog", async () => {
  let revision = 7;
  const f = fixture((body) => body.action === "bootstrap" ? { ok: true, revision } : { ok: true, revision: body.payload.expectedRevision + 1 });
  await f.client.fetchGasBootstrapData();
  const captured = f.client.getObservedDataRevision();
  revision = 9;
  await f.client.fetchGasBootstrapData();
  await f.client.postGasAction("updatePerson", { id: "X", note: "changed field only" }, { expectedRevision: captured });
  assert.equal(f.requests.at(-1).payload.expectedRevision, 7);
  assert.equal("name" in f.requests.at(-1).payload, false);
});

test("a frontend cannot write through an older or unidentified GAS contract", async () => {
  for (const serverVersion of ["", "old-version"]) {
    const f = fixture(() => ({ ok: true, revision: 7, serverVersion }));
    await f.client.fetchGasBootstrapData();
    await assert.rejects(f.client.postGasAction("updatePerson", { id: "X" }), /前後端版本不一致/);
    assert.equal(f.requests.length, 1);
  }
});
test("revision conflicts are surfaced without a blind retry or adopting a stale edit", async () => {
  const f = fixture((body) => body.action === "bootstrap" ? { ok: true, revision: 1, people: [] } : { ok: false, code: "REVISION_CONFLICT", revision: 2, message: "synthetic conflict" });
  await f.client.fetchGasBootstrapData();
  await assert.rejects(f.client.postGasAction("updatePerson", { id: "X" }), /synthetic conflict/);
  assert.equal(f.requests.length, 2);
  assert.ok(f.events.some((event) => event.type === "rosario:data-conflict"));
});
test("missing revision and changed sessions cannot write using an old snapshot", async () => {
  const f = fixture(() => ({ ok: true, revision: 3, people: [] }));
  f.client.setGasSessionToken("first");
  await f.client.fetchGasBootstrapData();
  f.client.setGasSessionToken("second");
  await assert.rejects(f.client.postGasAction("updatePerson", { id: "X" }), /資料版本/);
  assert.equal(f.requests.length, 1);
});
test("uncertain writes retain their original operation and revision across a reload", async () => {
  let revision = 1, writes = 0;
  const f = fixture((body) => {
    if (body.action === "bootstrap") return { ok: true, revision, people: [] };
    writes++;
    if (writes === 1) { revision = 2; return { ok: false, code: "WRITE_OUTCOME_UNKNOWN", revision, message: "uncertain" }; }
    return { ok: true, revision: 2 };
  });
  await f.client.fetchGasBootstrapData();
  await assert.rejects(f.client.postGasAction("updatePerson", { id: "X" }), /uncertain/);
  await f.client.fetchGasBootstrapData();
  await f.client.postGasAction("updatePerson", { id: "X" });
  const requests = f.requests.filter((body) => body.action === "updatePerson");
  assert.equal(requests[0].operationId, requests[1].operationId);
  assert.deepEqual(requests.map((body) => body.payload.expectedRevision), [1, 1]);
  assert.ok(f.events.some((event) => event.type === "rosario:write-uncertain"));
});

test("simultaneous identical submissions share one operation after fingerprinting", async () => {
  const f = fixture(body => body.action === "bootstrap" ? { ok: true, revision: 1 } : { ok: true, revision: 2 });
  await f.client.fetchGasBootstrapData();
  await Promise.all([f.client.postGasAction("updatePerson", { id: "X" }), f.client.postGasAction("updatePerson", { id: "X" })]);
  assert.equal(f.requests.filter(body => body.action === "updatePerson").length, 1);
  assert.equal(f.events.filter(event => event.type === "rosario:write-progress" && event.detail.status === "success").length, 1);
});

test("a late bootstrap cannot replace another session's revision", async () => {
  let complete;
  const f = fixture(() => new Promise(resolve => { complete = resolve; }));
  f.client.setGasSessionToken("first");
  const pending = f.client.fetchGasBootstrapData();
  f.client.setGasSessionToken("second");
  complete({ ok: true, revision: 999 });
  await assert.rejects(pending, /登入狀態已變更/);
  await assert.rejects(f.client.postGasAction("updatePerson", { id: "X" }), /資料版本/);
});

test("a disconnected completed write is verified by receipt without executing again", async () => {
  let writes = 0, operation;
  const f = fixture(body => {
    if (body.action === "bootstrap") return { ok: true, revision: 1 };
    if (body.action === "operationStatus") return { ok: true, found: true, operationId: operation, status: "success", result: { ok: true, revision: 2 } };
    writes++; operation = body.operationId; throw new TypeError("synthetic response loss");
  }, { fastTimers: true });
  await f.client.fetchGasBootstrapData();
  assert.equal((await f.client.postGasAction("updatePerson", { id: "X" })).revision, 2);
  assert.equal(writes, 1);
});

test("an unknown server receipt stops automatic retries and remains visible", async () => {
  const f = fixture(body => {
    if (body.action === "bootstrap") return { ok: true, revision: 1 };
    if (body.action === "operationStatus") return { ok: true, found: true, status: "unknown" };
    throw new TypeError("synthetic disconnection");
  }, { fastTimers: true });
  await f.client.fetchGasBootstrapData();
  await assert.rejects(f.client.postGasAction("updatePerson", { id: "X" }), /待確認/);
  assert.equal(f.requests.filter(body => body.action === "updatePerson").length, 1);
  assert.ok(f.events.some(event => event.type === "rosario:write-progress" && event.detail.status === "unknown"));
});

test("HTML service errors are never treated as a successful zero-data snapshot", async () => {
  const f = fixture(() => new Response("<html>upstream error</html>", { status: 503 }), { fastTimers: true });
  await assert.rejects(f.client.fetchGasBootstrapData(), /有效內容/);
  assert.equal(f.requests.length, 2);
});

test("receipt responses validate required fields before rendering", async () => {
  const f = fixture(() => ({ ok: true, operations: [{ operationId: "bad", createdAt: "not a date" }] }));
  await assert.rejects(f.client.fetchGasOperations(), /不完整/);
});

const inlineLogin = (sessionToken = "synthetic", bootstrap = {}) => ({
  ok: true, sessionToken,
  bootstrap: { ok: true, serverVersion: "test", revision: 7, people: [], stations: [], qualifications: [], ...bootstrap },
});

test("startup bootstrap requests omit operation history", async () => {
  const f = fixture(() => ({ ok: true, revision: 7 }));
  await f.client.fetchGasBootstrapData();
  assert.equal(f.requests[0].payload.includeOperations, false);
});

test("inline login bootstrap primes writes without another bootstrap request", async () => {
  const f = fixture(() => ({ ok: true, revision: 8 }));
  const login = inlineLogin();
  f.client.setGasSessionToken(login.sessionToken);
  assert.equal(f.client.adoptLoginBootstrap(login, login.sessionToken), login.bootstrap);
  assert.equal(f.client.getObservedDataRevision(), 7);
  await f.client.postGasAction("updatePerson", { id: "X" });
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].action, "updatePerson");
  assert.equal(f.requests[0].payload.expectedRevision, 7);
  assert.equal(f.requests[0].sessionToken, login.sessionToken);
});

test("invalid inline bootstrap cannot initialize a writable snapshot", async () => {
  const malformed = [
    undefined, null, [], {}, { ok: false }, { ok: true },
    inlineLogin("other"), inlineLogin("synthetic", { ok: false }),
    ...[undefined, null, "", "old-version", 123].map(serverVersion => inlineLogin("synthetic", { serverVersion })),
    ...[undefined, null, "7", -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(revision => inlineLogin("synthetic", { revision })),
    ...["people", "stations", "qualifications", "stationRules", "managementStationRules"].flatMap(key =>
      [null, {}, "bad", [null], [[]], [7]].map(value => inlineLogin("synthetic", { [key]: value }))),
  ];
  for (const result of malformed) {
    const f = fixture(() => { throw new Error("must not request"); });
    f.client.setGasSessionToken("synthetic");
    assert.equal(f.client.adoptLoginBootstrap(result, "synthetic"), undefined);
    assert.equal(f.client.getObservedDataRevision(), undefined);
    await assert.rejects(f.client.postGasAction("updatePerson", { id: "X" }), /資料版本/);
    assert.equal(f.requests.length, 0);
  }
});

test("inline bootstrap is bound to the active session and never restores a cleared session", async () => {
  const f = fixture(() => { throw new Error("must not request"); });
  const first = inlineLogin("first"), second = inlineLogin("second", { revision: 9 });
  assert.equal(f.client.adoptLoginBootstrap(first, "first"), undefined);
  f.client.setGasSessionToken("first");
  assert.ok(f.client.adoptLoginBootstrap(first, "first"));
  f.client.setGasSessionToken("second");
  assert.equal(f.client.adoptLoginBootstrap(first, "first"), undefined);
  assert.equal(f.client.adoptLoginBootstrap(first, "second"), undefined);
  assert.equal(f.client.getObservedDataRevision(), undefined);
  assert.ok(f.client.adoptLoginBootstrap(second, "second"));
  assert.equal(f.client.adoptLoginBootstrap(first, "first"), undefined);
  assert.equal(f.client.getObservedDataRevision(), 9);
  f.client.clearGasSessionToken();
  assert.equal(f.client.adoptLoginBootstrap(second, "second"), undefined);
  assert.equal(f.client.adoptLoginBootstrap(inlineLogin(""), ""), undefined);
  await assert.rejects(f.client.postGasAction("updatePerson", { id: "X" }), /資料版本/);
});

test("login and restore allow bootstrap-sized timeouts only when explicitly requested", async () => {
  for (const action of ["login", "session"]) {
    for (const includeBootstrap of [undefined, false, true]) {
      const f = fixture(() => inlineLogin("restored"));
      f.client.setGasSessionToken("restored");
      const result = await f.client.postGasAction(action, { includeBootstrap });
      assert.deepEqual(f.timeouts, [includeBootstrap === true ? 60_000 : 20_000]);
      assert.equal(f.requests[0].payload.includeBootstrap, includeBootstrap);
      assert.equal(f.requests[0].sessionToken, "restored");
      if (includeBootstrap === true) assert.ok(f.client.adoptLoginBootstrap(result, "restored"));
    }
  }
});

test("a delayed restore bootstrap cannot prime writes for a different active session", async () => {
  let complete;
  const f = fixture(() => new Promise(resolve => { complete = resolve; }));
  f.client.setGasSessionToken("first");
  const pending = f.client.postGasAction("session", { includeBootstrap: true });
  f.client.setGasSessionToken("second");
  complete(inlineLogin("first"));
  await assert.rejects(pending, error => error.code === "SESSION_CHANGED");
  assert.equal(f.client.getObservedDataRevision(), undefined);
  assert.equal(f.client.adoptLoginBootstrap(inlineLogin("first"), "second"), undefined);
  await assert.rejects(f.client.postGasAction("updatePerson", { id: "X" }), /資料版本/);
  assert.equal(f.requests.length, 1);
});
