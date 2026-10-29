import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fixture } from "./helpers/gasFixture.mjs";

const VERSION = JSON.parse(readFileSync(new URL("../release.json", import.meta.url), "utf8")).version;
const login = (f, extra = {}) => f.post("login", {
  account: "worker", password: "synthetic-old-password", includeBootstrap: true, ...extra,
});
const bootstrap = (f, token, payload = {}) => f.post("bootstrap", payload, { sessionToken: token });

test("opt-in login returns a revision-checked bootstrap without passwords or account metadata", () => {
  const f = fixture();
  const result = login(f);
  assert.equal(result.ok, true, result.message);
  assert.ok(result.sessionToken);
  assert.equal(result.bootstrap.ok, true);
  assert.equal(result.bootstrap.serverVersion, VERSION);
  assert.equal(result.bootstrap.revision, 0);
  assert.equal(result.bootstrap.people.length, 2);
  assert.equal(result.bootstrap.stations.length, 1);
  assert.equal(result.bootstrap.qualifications.length, 1);
  assert.deepEqual(result.bootstrap.managementStationRules.map(rule => rule.team), ["TEAM_A"]);
  for (const person of result.bootstrap.people) {
    for (const key of ["password", "loginPassword", "accountPassword", "登入密碼", "account", "accountEnabled", "accountStatus", "__rowNumber"]) {
      assert.equal(key in person, false, key);
    }
    if (person.id !== "P1001") assert.equal("systemPermission" in person, false);
  }
  assert.doesNotMatch(JSON.stringify(result), /synthetic-old-password|rosario-v1\$/);
  assert.equal("recentOperations" in result.bootstrap, false);
  assert.equal(vm.runInContext("requestSheetCache_", f.context), null);
  assert.equal([...f.properties.values()].some(value => value.includes('"people":')), false);
  assert.deepEqual(bootstrap(f, result.sessionToken, { includeOperations: false }), result.bootstrap);
});

test("legacy login stays lightweight and default bootstrap still includes operation receipts", () => {
  const f = fixture();
  f.context.dataFingerprint_ = () => { throw new Error("legacy login must not fingerprint"); };
  for (const includeBootstrap of [undefined, false, "true"]) {
    const result = login(f, { includeBootstrap });
    assert.equal(result.ok, true);
    assert.equal("bootstrap" in result, false);
  }
  const standard = fixture();
  const token = standard.login().sessionToken;
  const result = bootstrap(standard, token);
  assert.equal(result.ok, true);
  assert.deepEqual(result.recentOperations, []);
  assert.deepEqual(bootstrap(standard, token, { includeOperations: true }).recentOperations, []);
});

test("startup avoids operation listing, ledger reads and pruning without disabling explicit operation reads", () => {
  const f = fixture();
  const list = f.context.listOperations_, prune = f.context.pruneOperationRecords_, ledger = f.context.operationLedgerRows_;
  const calls = { list: 0, prune: 0, ledger: 0 };
  f.context.listOperations_ = (...args) => { calls.list++; return list(...args); };
  f.context.pruneOperationRecords_ = (...args) => { calls.prune++; return prune(...args); };
  f.context.operationLedgerRows_ = (...args) => { calls.ledger++; return ledger(...args); };
  const result = login(f);
  assert.equal(result.ok, true, result.message);
  assert.equal(bootstrap(f, result.sessionToken, { includeOperations: false }).ok, true);
  assert.deepEqual(calls, { list: 0, prune: 0, ledger: 0 });
  assert.equal(f.post("listOperations", {}, { sessionToken: result.sessionToken }).ok, true);
  assert.ok(calls.list > 0 && calls.prune > 0 && calls.ledger > 0);
});

test("inline startup is authorized before fingerprint reads and failed startup does not leak a session", () => {
  const f = fixture({ permissions: [] });
  f.context.dataFingerprint_ = () => { throw new Error("forbidden fingerprint"); };
  const denied = login(f);
  assert.equal(denied.code, "FORBIDDEN");
  assert.equal("bootstrap" in denied, false);
  assert.equal([...f.properties.keys()].some(key => key.startsWith("ROSARIO_SESSION_")), false);
  assert.equal(login(f, { password: "synthetic-wrong-password" }).ok, false);
  assert.equal(bootstrap(f, "", { includeOperations: false }).code, "AUTH_REQUIRED");
});

test("inline bootstrap revalidates the newly issued session before reading business data", () => {
  const f = fixture();
  const create = f.context.createSession_;
  f.context.createSession_ = (...args) => {
    const session = create(...args);
    f.accounts.rows[1][4] = "停用";
    return session;
  };
  const result = login(f);
  assert.equal(result.code, "AUTH_REVOKED");
  assert.equal("bootstrap" in result, false);
});

test("inline bootstrap does not reuse login data read before the fingerprint boundary", () => {
  const f = fixture();
  const fingerprint = f.context.dataFingerprint_;
  let calls = 0;
  f.context.dataFingerprint_ = () => {
    if (++calls === 1) f.people.rows[1][1] = "Synthetic edited before snapshot";
    return fingerprint();
  };
  const result = login(f);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.bootstrap.people[0].name, "Synthetic edited before snapshot");
  assert.equal(calls, 2, "both fingerprint reads must remain fresh");
});

test("manual edits during inline bootstrap reject the entire inconsistent snapshot", () => {
  const f = fixture();
  const build = f.context.buildBootstrapForSession_;
  f.context.buildBootstrapForSession_ = (...args) => {
    const result = build(...args);
    f.people.rows[1][4] = "synthetic concurrent edit";
    return result;
  };
  const result = login(f);
  assert.equal(result.code, "REVISION_CONFLICT");
  assert.equal(result.revision, 1);
  assert.equal("bootstrap" in result, false);
  assert.equal([...f.properties.keys()].some(key => key.startsWith("ROSARIO_SESSION_")), false);
});

test("a manual edit after inline startup still conflicts with the adopted write revision", () => {
  const f = fixture();
  const result = login(f);
  assert.equal(result.ok, true, result.message);
  f.people.rows[1][4] = "synthetic manual edit after login";
  const write = f.post("updatePerson", { id: "P1001", note: "stale overwrite", expectedRevision: result.bootstrap.revision }, {
    appVersion: VERSION, sessionToken: result.sessionToken, operationId: "OP_startup_conflict_00000001",
  });
  assert.equal(write.code, "REVISION_CONFLICT");
  assert.equal(f.people.rows[1][4], "synthetic manual edit after login");
  const fresh = bootstrap(f, result.sessionToken, { includeOperations: false });
  assert.equal(fresh.revision, result.bootstrap.revision + 1);
  assert.equal(fresh.people[0].note, "synthetic manual edit after login");
});

test("startup release keeps the write floor aligned with the release manifest", () => {
  const f = fixture();
  assert.equal(vm.runInContext("SETTINGS.APP_VERSION", f.context), VERSION);
  assert.equal(vm.runInContext("SETTINGS.MIN_WRITE_VERSION", f.context), VERSION);
});

test("session restore can return the same fresh startup snapshot without creating another session", () => {
  const f = fixture();
  const token = f.login().sessionToken;
  const count = () => [...f.properties.keys()].filter(key => key.startsWith("ROSARIO_SESSION_")).length;
  const before = count();
  f.people.rows[1][1] = "Synthetic restored person";
  f.context.listOperations_ = () => { throw new Error("restore must omit operations"); };
  const result = f.post("session", { includeBootstrap: true, sessionDurationMs: 2 * 3600000 }, { sessionToken: token });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.sessionToken, token);
  assert.equal(result.sessionExpiresAt, f.context.Date.now() + 2 * 3600000);
  assert.equal(result.bootstrap.serverVersion, VERSION);
  assert.equal(result.bootstrap.people[0].name, "Synthetic restored person");
  assert.equal("recentOperations" in result.bootstrap, false);
  assert.equal(count(), before);
  const legacy = f.post("session", {}, { sessionToken: token });
  assert.equal(legacy.ok, true);
  assert.equal("sessionToken" in legacy, false);
  assert.equal("bootstrap" in legacy, false);
});

test("restored snapshots retain authorization, fresh fingerprint boundaries and conflict detection", () => {
  const f = fixture();
  const token = f.login().sessionToken;
  const fingerprint = f.context.dataFingerprint_;
  let calls = 0;
  f.context.dataFingerprint_ = () => {
    if (++calls === 1) f.people.rows[1][1] = "Synthetic edit before restore snapshot";
    return fingerprint();
  };
  const result = f.post("session", { includeBootstrap: true }, { sessionToken: token });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.bootstrap.people[0].name, "Synthetic edit before restore snapshot");
  assert.equal(calls, 2);
  const build = f.context.buildBootstrapForSession_;
  f.context.buildBootstrapForSession_ = (...args) => {
    const snapshot = build(...args);
    f.people.rows[1][4] = "synthetic edit during restore";
    return snapshot;
  };
  const conflict = f.post("session", { includeBootstrap: true }, { sessionToken: token });
  assert.equal(conflict.code, "REVISION_CONFLICT");
  assert.equal("bootstrap" in conflict, false);
  assert.equal(f.post("session", {}, { sessionToken: token }).ok, true, "a read conflict must not remove an existing session");
  assert.equal(f.post("session", { includeBootstrap: true }).code, "AUTH_REQUIRED");
  const denied = fixture({ permissions: [] });
  const deniedToken = denied.login().sessionToken;
  denied.context.dataFingerprint_ = () => { throw new Error("forbidden fingerprint"); };
  assert.equal(denied.post("session", { includeBootstrap: true }, { sessionToken: deniedToken }).code, "FORBIDDEN");
  f.accounts.rows[1][4] = "停用";
  assert.equal(f.post("session", { includeBootstrap: true }, { sessionToken: token }).code, "AUTH_REVOKED");
});
