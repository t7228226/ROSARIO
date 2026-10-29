import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { fixture } from "./helpers/gasFixture.mjs";

const countProperties = (f, prefix) => [...f.properties.keys()].filter(key => key.startsWith(prefix)).length;

function fillKnownFailures(f, count = 240) {
  for (let i = 0; i < count; i++) {
    const id = `SYNTH_${String(i).padStart(4, "0")}`;
    const account = `known-${i}`;
    f.accounts.rows.push([id, account, "synthetic-known-password", "技術員", "啟用"]);
    f.people.rows.push([id, `Synthetic person ${i}`, "TEAM_A", "技術員", ""]);
    const result = f.login(account, "synthetic-wrong-password");
    assert.equal(result.ok, false);
    assert.equal(result.code, undefined);
  }
  assert.equal(countProperties(f, "ROSARIO_LOGIN_"), count);
}

test("password changes release all eight revoked sessions before the per-account capacity check", () => {
  const f = fixture();
  const root = f.login("root", "synthetic-admin-password").sessionToken;
  const tokens = Array.from({ length: 8 }, () => f.login().sessionToken);
  assert.ok(tokens.every(Boolean));
  assert.equal(f.login().code, "SESSION_ACCOUNT_CAPACITY");
  f.accounts.rows[1][2] = "synthetic-replacement-password";
  const replacement = f.login("worker", "synthetic-replacement-password");
  assert.equal(replacement.ok, true, replacement.message);
  assert.equal(countProperties(f, "ROSARIO_SESSION_"), 2);
  for (const token of tokens) {
    assert.equal(f.properties.has(f.context.sessionPropertyKey_(token)), false);
    assert.equal(f.post("session", {}, { sessionToken: token }).ok, false);
  }
  assert.equal(f.post("session", {}, { sessionToken: root }).ok, true);
  assert.equal(f.post("session", {}, { sessionToken: replacement.sessionToken }).ok, true);
});

test("session cleanup frees global capacity but never evicts another valid session", () => {
  const f = fixture(); vm.runInContext("SETTINGS.SESSION_MAX_RECORDS = 2", f.context);
  const root = f.login("root", "synthetic-admin-password").sessionToken;
  const old = f.login().sessionToken;
  f.accounts.rows[1][2] = "synthetic-global-replacement";
  const result = f.login("worker", "synthetic-global-replacement");
  assert.equal(result.ok, true, result.message);
  assert.equal(countProperties(f, "ROSARIO_SESSION_"), 2);
  assert.equal(f.properties.has(f.context.sessionPropertyKey_(old)), false);
  assert.equal(f.post("session", {}, { sessionToken: root }).ok, true);
});

test("different accounts for the same employee retain their own valid credential-bound sessions", () => {
  const f = fixture();
  const original = f.login().sessionToken;
  f.accounts.rows.push(["P1001", "worker-alt", "synthetic-alt-password", "主任", "啟用"]);
  const alternate = f.login("worker-alt", "synthetic-alt-password").sessionToken;
  assert.ok(alternate);
  f.accounts.rows[1][2] = "synthetic-new-primary-password";
  assert.equal(f.login("worker", "synthetic-new-primary-password").ok, true);
  assert.equal(f.properties.has(f.context.sessionPropertyKey_(original)), false);
  assert.equal(f.post("session", {}, { sessionToken: alternate }).ok, true);
  assert.equal(countProperties(f, "ROSARIO_SESSION_"), 2);
});

test("a cleanup account-read failure does not revoke otherwise valid sessions", () => {
  const f = fixture(); const token = f.login().sessionToken;
  const lookup = f.context.findCurrentAccount_;
  f.context.findCurrentAccount_ = () => { throw new Error("synthetic temporary account read failure"); };
  const result = f.login();
  assert.equal(result.ok, false);
  assert.ok(f.properties.has(f.context.sessionPropertyKey_(token)));
  assert.equal(countProperties(f, "ROSARIO_SESSION_"), 1);
  f.context.findCurrentAccount_ = lookup;
  assert.equal(f.post("session", {}, { sessionToken: token }).ok, true);
});

test("240 known failure records cannot block an untouched correct login or erase existing cooldowns", () => {
  const f = fixture(); fillKnownFailures(f);
  const stored = [...f.properties.entries()].filter(([key]) => key.startsWith("ROSARIO_LOGIN_"));
  const result = f.login();
  assert.equal(result.ok, true, result.message);
  assert.deepEqual([...f.properties.entries()].filter(([key]) => key.startsWith("ROSARIO_LOGIN_")), stored);
  assert.equal(f.login("root", "synthetic-admin-password").ok, true);
});

test("known accounts retain normalized per-account cooldown even after the shared count reaches 240", () => {
  const f = fixture(); fillKnownFailures(f);
  for (let i = 0; i < 4; i++) assert.equal(f.login(" WORKER ", "synthetic-wrong-password").code, undefined);
  const blocked = f.login("worker", "synthetic-wrong-password");
  assert.equal(blocked.code, "LOGIN_THROTTLED"); assert.equal(blocked.retryAfterSeconds, 60);
  assert.equal(countProperties(f, "ROSARIO_LOGIN_"), 241);
  const verify = f.context.verifyPassword_; let calls = 0;
  f.context.verifyPassword_ = (...args) => { calls++; return verify(...args); };
  assert.equal(f.login().code, "LOGIN_THROTTLED"); assert.equal(calls, 0);
  assert.equal(f.login("root", "synthetic-admin-password").ok, true);
  f.advance(60001); assert.equal(f.login().ok, true);
});

test("unknown names cannot create overflow records when known-account throttle storage is full", () => {
  const f = fixture(); fillKnownFailures(f);
  for (let i = 0; i < 20; i++) assert.equal(f.login(`unknown-overflow-${i}`, "synthetic-wrong-password").code, "LOGIN_THROTTLED");
  assert.equal(countProperties(f, "ROSARIO_LOGIN_"), 240);
  assert.equal(f.login().ok, true);
});
