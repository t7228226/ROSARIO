import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { fixture, source, VERSION } from "./helpers/gasFixture.mjs";

test("whole write, authorization, revision and flush share one real script lock", () => {
  const f = fixture(); const token = f.login().sessionToken;
  f.events.length = 0;
  const result = f.write(token, "updatePerson", { id: "P1001", note: "new note" });
  assert.equal(result.ok, true); assert.equal(result.revision, 1);
  assert.equal(f.people.rows[1][4], "new note");
  assert.equal(f.events.filter(e => e.kind === "lock").length, 1);
  assert.equal(f.events.at(-2).kind, "flush"); assert.equal(f.events.at(-1).kind, "release");
  assert.equal(f.locked(), false);
});

test("version guard blocks old clients before a mutation", () => {
  const f = fixture(); const token = f.login().sessionToken;
  const result = f.write(token, "updatePerson", { id: "P1001", note: "blocked" }, { appVersion: "2026-08-11-011" });
  assert.equal(result.ok, false); assert.equal(f.people.rows[1][4], "");
  const version = f.post("version", {});
  assert.equal(version.appVersion, VERSION); assert.equal(version.minWriteVersion, VERSION);
});

test("password reset revokes existing sessions and permits only the new password", () => {
  const f = fixture(); const worker = f.login().sessionToken;
  const admin = f.login("root", "synthetic-admin-password").sessionToken;
  assert.equal(f.write(admin, "updatePerson", { id: "P1001", password: "synthetic-new-password" }).ok, true);
  assert.equal(f.post("session", { sessionDurationMs: 3600000 }, { sessionToken: worker }).ok, false);
  assert.equal(f.login().ok, false);
  assert.equal(f.login("worker", "synthetic-new-password").ok, true);
});

test("revocation committed before renewal obtains its lock cannot resurrect a session", () => {
  const f = fixture(); const token = f.login().sessionToken;
  const key = f.context.sessionPropertyKey_(token);
  f.beforeAcquire(() => f.properties.delete(key));
  const result = f.post("session", { sessionDurationMs: 3600000 }, { sessionToken: token });
  assert.equal(result.ok, false); assert.equal(f.properties.has(key), false);
});

test("password reset before login obtains its lock rejects the old password", () => {
  const f = fixture();
  f.beforeAcquire(() => { f.accounts.rows[1][2] = "synthetic-new-password"; });
  assert.equal(f.login().ok, false);
  assert.equal([...f.properties.keys()].some(key => key.startsWith("ROSARIO_SESSION_")), false);
});

test("manual password changes invalidate credential-bound sessions without scanning session records", () => {
  const f = fixture(); const token = f.login().sessionToken;
  f.accounts.rows[1][2] = "synthetic-manual-password";
  assert.equal(f.post("session", {}, { sessionToken: token }).code, "AUTH_REVOKED");
});

test("old deployment sessions without a credential version fail closed", () => {
  const f = fixture(); const token = f.login().sessionToken; const key = f.context.sessionPropertyKey_(token);
  const record = JSON.parse(f.properties.get(key)); delete record.credentialVersion;
  f.properties.set(key, JSON.stringify(record));
  assert.equal(f.post("session", {}, { sessionToken: token }).code, "AUTH_REVOKED");
});

test("a disabled or reassigned account cannot reuse a session through matching employee ID alone", () => {
  for (const mutate of [f => { f.accounts.rows[1][4] = "停用"; }, f => { f.accounts.rows[1][1] = "replacement-account"; }]) {
    const f = fixture(); const token = f.login().sessionToken; mutate(f);
    assert.equal(f.post("session", {}, { sessionToken: token }).code, "AUTH_REVOKED");
  }
});

test("role revocation is re-read after waiting for the write lock", () => {
  const f = fixture(); const token = f.login().sessionToken;
  f.beforeAcquire(() => { f.accounts.rows[1][3] = "技術員"; });
  assert.equal(f.write(token, "updatePerson", { id: "P1001", note: "blocked" }).code, "FORBIDDEN");
  assert.equal(f.people.rows[1][4], "");
});

test("failed login cooldown is account-normalized, enforced and short-lived", () => {
  const f = fixture();
  for (let index = 0; index < 4; index++) assert.equal(f.login(" WORKER ", "wrong").ok, false);
  const blocked = f.login("worker", "wrong");
  assert.equal(blocked.code, "LOGIN_THROTTLED"); assert.equal(blocked.retryAfterSeconds, 60);
  assert.equal(f.login().code, "LOGIN_THROTTLED");
  assert.equal(f.login("root", "synthetic-admin-password").ok, true);
  f.advance(60001); assert.equal(f.login().ok, true);
  assert.equal([...f.properties.keys()].some(key => key.startsWith("ROSARIO_LOGIN_")), false);
});

test("unknown accounts are throttled, successful login clears the failure window", () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) f.login("not-an-account", "wrong");
  assert.equal(f.login("NOT-AN-ACCOUNT", "wrong").code, "LOGIN_THROTTLED");
  f.login("worker", "wrong"); assert.equal(f.login().ok, true);
  for (let i = 0; i < 4; i++) assert.equal(f.login("worker", "wrong").code, undefined);
});

test("bootstrap separates analysis projections from scoped management records", () => {
  const f = fixture(); const token = f.login().sessionToken;
  const bootstrap = f.post("bootstrap", {}, { sessionToken: token });
  assert.equal(bootstrap.revision, 0);
  assert.deepEqual(bootstrap.stationRules.map(r => r.team), ["TEAM_A", "TEAM_B"]);
  assert.equal(bootstrap.stationRules[1].minRequired, 2);
  assert.equal(bootstrap.stationRules.some(r => "note" in r || r.id.startsWith("INTERNAL")), false);
  assert.deepEqual(bootstrap.managementStationRules.map(r => r.team), ["TEAM_A"]);
  assert.equal(bootstrap.managementStationRules[0].note, "management-A");
  assert.deepEqual(bootstrap.viewableRuleTeams, ["TEAM_A"]); assert.deepEqual(bootstrap.editableRuleTeams, ["TEAM_A"]);
});

test("no analysis or management permission yields no rule data", () => {
  const f = fixture({ role: "技術員", permissions: [] }); const token = f.login().sessionToken;
  const result = f.post("bootstrap", {}, { sessionToken: token });
  assert.deepEqual(result.stationRules, []); assert.deepEqual(result.managementStationRules, []);
});

test("role permission alone cannot bypass director qualification, a personal allow can", () => {
  const blocked = fixture({ role: "技術員" }); const token = blocked.login().sessionToken;
  assert.equal(blocked.write(token, "updateStationRule", { team: "TEAM_A", stationId: "ST01", minRequired: 3 }).code, "FORBIDDEN");
  const granted = fixture({ role: "技術員", exceptions: [{ permissionId: "PERM_011", effect: "allow" }, { permissionId: "PERM_012", effect: "allow" }] });
  const allowedToken = granted.login().sessionToken;
  assert.equal(granted.write(allowedToken, "updateStationRule", { team: "TEAM_A", stationId: "ST01", minRequired: 3 }).ok, true);
  assert.equal(granted.write(allowedToken, "updateStationRule", { team: "TEAM_B", stationId: "ST01", minRequired: 3 }).code, "FORBIDDEN");
  assert.deepEqual(granted.post("bootstrap", {}, { sessionToken: allowedToken }).editableRuleTeams, ["TEAM_A"]);
});

test("personal deny wins over allow and invalid exception effects fail closed", () => {
  for (const exceptions of [
    [{ permissionId: "PERM_012", effect: "deny" }, { permissionId: "PERM_012", effect: "allow" }],
    [{ permissionId: "PERM_012", effect: "unexpected" }],
  ]) {
    const f = fixture({ exceptions }); const token = f.login().sessionToken;
    assert.equal(f.write(token, "updateStationRule", { team: "TEAM_A", stationId: "ST01", minRequired: 3 }).code, "FORBIDDEN");
  }
});

test("personnel director role and configured director roles are recognized", () => {
  for (const options of [{ role: "技術員", personRole: "主任" }, { role: "技術員", personRole: "代理主任" }, { role: "站長" }]) {
    const f = fixture(options);
    if (options.role === "站長") vm.runInContext("SETTINGS.RULE_DIRECTOR_ROLES.push('站長')", f.context);
    const token = f.login().sessionToken;
    assert.equal(f.write(token, "updateStationRule", { team: "TEAM_A", stationId: "ST01", minRequired: 3 }).ok, true);
  }
});

test("an explicit rule editor can use a separately granted read permission but never a read deny", () => {
  const f = fixture({ role: "技術員", exceptions: [{ permissionId: "PERM_012", effect: "allow" }] });
  const token = f.login().sessionToken;
  assert.equal(f.post("bootstrap", {}, { sessionToken: token }).managementStationRules.length, 1);
  f.exceptionSheet.rows.push(["P1001", "PERM_011", "deny", "啟用"]);
  const result = f.post("bootstrap", {}, { sessionToken: token });
  assert.deepEqual(result.viewableRuleTeams, []); assert.deepEqual(result.managementStationRules, []);
});

test("super admin can read management rules and write across teams", () => {
  const f = fixture(); const token = f.login("root", "synthetic-admin-password").sessionToken;
  assert.equal(f.post("bootstrap", {}, { sessionToken: token }).managementStationRules.length, 2);
  assert.equal(f.write(token, "updateStationRule", { team: "TEAM_A", stationId: "ST01", minRequired: 4 }).ok, true);
});

test("draft reads default to own team and cannot be expanded through payload", () => {
  const f = fixture(); const token = f.login().sessionToken;
  const result = f.post("loadScheduleDrafts", { includeDetails: true }, { sessionToken: token });
  assert.deepEqual(result.drafts.map(d => d.id), ["D_A"]); assert.deepEqual(result.details.map(d => d.draftId), ["D_A"]);
  assert.equal(result.revision, 0);
  assert.equal(f.post("loadScheduleDrafts", { team: "TEAM_B", includeDetails: true }, { sessionToken: token }).code, "FORBIDDEN");
  const admin = f.login("root", "synthetic-admin-password").sessionToken;
  assert.equal(f.post("loadScheduleDrafts", { includeDetails: true }, { sessionToken: admin }).drafts.length, 2);
});

test("draft writes reject other-team IDs and derive creator from the session", () => {
  const f = fixture(); const token = f.login().sessionToken;
  assert.equal(f.write(token, "saveScheduleDraft", { draft: { id: "D_B", team: "TEAM_A", name: "hijack" } }).code, "FORBIDDEN");
  assert.equal(f.write(token, "saveScheduleDraft", { draft: { id: "D_NEW", team: "TEAM_B", name: "wrong team" } }).code, "FORBIDDEN");
  const result = f.write(token, "saveScheduleDraft", { draft: { id: "D_NEW", team: "TEAM_A", name: "new", createdBy: "ROOT" }, assignments: [] });
  assert.equal(result.ok, true); assert.equal(f.drafts.rows.at(-1)[6], "P1001");
});

test("literal strings are protected in single, bulk and append paths without changing numbers or dates", () => {
  const f = fixture(); const target = f.sheets.get("03_資格明細");
  const strings = ["=1+1", "+SUM(A1)", "-1+1", "@SUM(A1)", " \t=1+1", "\uFEFF=1+1"];
  f.context.withDocumentWriteLock_(() => {
    strings.forEach(value => f.context.setLiteralValue_(target.getRange(2, 1), value));
    f.context.setLiteralValues_(target.getRange(3, 1, 1, 3), [["=1+1", 5, false]]);
    f.context.appendLiteralRow_(target, ["=1+1", new Date(0), -5]);
  });
  const rawSets = f.events.filter(e => e.kind === "set").slice(0, strings.length);
  rawSets.forEach((event, index) => assert.equal(event.data[0][0], "'" + strings[index]));
  assert.equal(target.rows[2][0], "=1+1"); assert.equal(target.rows[2][1], 5); assert.equal(target.rows[2][2], false);
  assert.equal(target.rows.at(-1)[2], -5); assert.ok(target.rows.at(-1)[1] instanceof Date);
});

test("update, create/matrix, draft header/details and qualification writes protect formulas end to end", () => {
  const f = fixture(); const token = f.login().sessionToken;
  assert.equal(f.write(token, "updatePerson", { id: "P1001", note: "=1+1" }).ok, true);
  assert.equal(f.people.rows[1][4], "=1+1");
  const created = f.write(token, "createPerson", { id: "P2002", name: "=1+1", shift: "TEAM_A", note: "=1+1" });
  assert.equal(created.ok, true, created.message);
  assert.equal(f.write(token, "saveScheduleDraft", { draft: { id: "D_NEW", team: "TEAM_A", name: "=1+1", note: "=1+1" }, assignments: [{ stationId: "ST01", employeeId: "P1001", note: "=1+1" }] }).ok, true);
  assert.equal(f.write(token, "upsertQualification", { employeeId: "P1001", stationId: "ST01", status: "=1+1" }).ok, true);
  for (const event of f.events.filter(e => e.kind === "set" || e.kind === "append")) {
    const values = event.kind === "set" ? event.data.flat() : event.data;
    assert.equal(values.some(v => typeof v === "string" && /^[\s\u0000-\u001f]*[=+\-@]/.test(v)), false);
  }
});

test("only literal-write helpers call native value writers", () => {
  const beforeHelpers = source.slice(0, source.indexOf("function setLiteralValue_("));
  assert.doesNotMatch(beforeHelpers, /\.setValues?\(|\.appendRow\(/);
});

test("canonical action/payload binding ignores key order, rejects changed action and content", () => {
  const f = fixture(); const token = f.login().sessionToken; const id = "OP_binding_00000001";
  const body = { sessionToken: token, operationId: id };
  assert.equal(f.post("updatePerson", { id: "P1001", note: "first", expectedRevision: 0 }, body).ok, true);
  assert.equal(f.post("updatePerson", { expectedRevision: 0, note: "first", id: "P1001" }, body).replayed, true);
  assert.equal(f.post("updatePerson", { expectedRevision: 0, note: "changed", id: "P1001" }, body).code, "OPERATION_CONFLICT");
  assert.equal(f.post("createPerson", { id: "P1001", note: "first", expectedRevision: 0 }, body).code, "OPERATION_CONFLICT");
  assert.equal(f.people.rows[1][4], "first"); assert.equal(f.context.getDataRevision_(), 1);
});

test("fresh records survive capacity pressure and processing records survive TTL", () => {
  const f = fixture(); const token = f.login().sessionToken;
  const id = "OP_retention_00000001";
  const body = { sessionToken: token, operationId: id };
  const payload = { id: "P1001", note: "once", expectedRevision: 0 };
  assert.equal(f.post("updatePerson", payload, body).ok, true);
  for (let index = 0; index < 159; index++) f.properties.set(`ROSARIO_OP_OP_fill_${index}`, JSON.stringify({ status: "processing", updatedAt: Date.now() - 10 * 86400000 }));
  assert.equal(f.write(token, "updatePerson", { id: "P1001", note: "must not run" }).code, "OPERATION_CAPACITY");
  assert.equal(f.post("updatePerson", payload, body).replayed, true);
  assert.equal(f.people.rows[1][4], "once");
  f.context.withScriptLock_(() => f.context.pruneOperationRecords_({ getProperties: () => Object.fromEntries(f.properties), getProperty: key => f.properties.get(key), deleteProperty: key => f.properties.delete(key) }));
  assert.equal([...f.properties.keys()].filter(k => k.startsWith("ROSARIO_OP_")).length, 160);
});

test("only expired terminal operations are pruned", () => {
  const f = fixture();
  f.properties.set("ROSARIO_OP_OP_expired", JSON.stringify({ status: "success", updatedAt: Date.UTC(2026, 9, 20) }));
  f.properties.set("ROSARIO_OP_OP_invalid", "corrupt");
  f.context.withScriptLock_(() => f.context.pruneOperationRecords_({ getProperties: () => Object.fromEntries(f.properties), getProperty: key => f.properties.get(key), deleteProperty: key => f.properties.delete(key) }));
  assert.equal(f.properties.has("ROSARIO_OP_OP_expired"), false); assert.equal(f.properties.has("ROSARIO_OP_OP_invalid"), true);
});

test("corrupt operation records fail closed instead of rerunning a mutation", () => {
  for (const raw of ["corrupt", "null", "[]", "{}", '{"status":"unexpected"}']) {
    const f = fixture(); const token = f.login().sessionToken;
    f.properties.set("ROSARIO_OP_OP_corrupt_00000001", raw);
    assert.equal(f.write(token, "updatePerson", { id: "P1001", note: "blocked" }, { operationId: "OP_corrupt_00000001" }).code, "OPERATION_RECORD_INVALID");
    assert.equal(f.people.rows[1][4], "");
  }
});

test("write preconditions require numeric revisions and operation IDs", () => {
  const f = fixture(); const token = f.login().sessionToken;
  assert.equal(f.post("updatePerson", { id: "P1001", expectedRevision: 0 }, { sessionToken: token }).code, "OPERATION_REQUIRED");
  assert.equal(f.post("updatePerson", { id: "P1001" }, { sessionToken: token, operationId: "OP_missing_rev_00000001" }).code, "REVISION_REQUIRED");
  for (const expectedRevision of ["0", null, -1, 1.5]) {
    const r = f.write(token, "updatePerson", { id: "P1001" }, { expectedRevision });
    assert.equal(r.code, "REVISION_REQUIRED");
  }
});

test("stale clients conflict without changing data, retries replay before revision comparison", () => {
  const f = fixture(); const token = f.login().sessionToken;
  const initial = f.post("bootstrap", {}, { sessionToken: token }).revision;
  const body = { sessionToken: token, operationId: "OP_revision_00000001" };
  const payload = { id: "P1001", note: "first", expectedRevision: initial };
  assert.equal(f.post("updatePerson", payload, body).revision, 1);
  const conflict = f.post("updatePerson", { id: "P1001", note: "stale", expectedRevision: initial }, { sessionToken: token, operationId: "OP_revision_00000002" });
  assert.equal(conflict.code, "REVISION_CONFLICT"); assert.equal(conflict.revision, 1);
  const replay = f.post("updatePerson", payload, body);
  assert.equal(replay.replayed, true); assert.equal(replay.revision, 1);
  assert.equal(f.people.rows[1][4], "first");
  assert.equal(f.post("permissionConfig", {}, { sessionToken: token }).revision, 1);
});

test("a failed or partially applied write still advances revision and releases the lock", () => {
  const f = fixture(); const token = f.login().sessionToken; f.people.failNextWrite = true;
  const failed = f.write(token, "updatePerson", { id: "P1001", note: "fail" });
  assert.equal(failed.ok, false); assert.equal(failed.revision, 1); assert.equal(f.locked(), false);
  assert.equal(f.post("bootstrap", {}, { sessionToken: token }).revision, 1);
  assert.equal(f.write(token, "updatePerson", { id: "P1001", note: "retry with fresh snapshot" }).ok, true);
});

test("manual Sheet edits invalidate an observed revision before a write", () => {
  const f = fixture(); const token = f.login().sessionToken;
  const observed = f.post("bootstrap", {}, { sessionToken: token }).revision;
  f.people.rows[1][4] = "manual change";
  const result = f.post("updatePerson", { id: "P1001", note: "stale overwrite", expectedRevision: observed }, { sessionToken: token, operationId: "OP_manual_edit_00000001" });
  assert.equal(result.code, "REVISION_CONFLICT"); assert.equal(result.revision, 1);
  assert.equal(f.people.rows[1][4], "manual change");
  const fresh = f.post("bootstrap", {}, { sessionToken: token });
  assert.equal(fresh.revision, 1); assert.equal(fresh.people[0].note, "manual change");
  assert.equal(f.write(token, "updatePerson", { id: "P1001", note: "confirmed edit" }).revision, 2);
});

test("formula-only and Date-only changes are included in content versions", () => {
  for (const change of [
    f => { f.rules.formulas.set("2,4", "=1+0"); },
    f => { f.rules.rows[1][5] = new Date(Date.UTC(2026, 9, 24)); },
  ]) {
    const f = fixture(); const token = f.login().sessionToken;
    f.rules.rows[1][5] = new Date(Date.UTC(2026, 9, 23));
    assert.equal(f.post("bootstrap", {}, { sessionToken: token }).revision, 0);
    change(f);
    assert.equal(f.post("bootstrap", {}, { sessionToken: token }).revision, 1);
    assert.equal(f.post("bootstrap", {}, { sessionToken: token }).revision, 1);
  }
});

test("edits during snapshot reading never label stale data with a newer revision", () => {
  const f = fixture(); const token = f.login().sessionToken;
  const build = f.context.buildBootstrap_;
  f.context.buildBootstrap_ = () => {
    const result = build(); f.people.rows[1][4] = "changed during read"; return result;
  };
  const result = f.post("bootstrap", {}, { sessionToken: token });
  assert.equal(result.code, "REVISION_CONFLICT"); assert.equal(result.revision, 1);
  assert.equal("people" in result, false);
  f.context.buildBootstrap_ = build;
  assert.equal(f.post("bootstrap", {}, { sessionToken: token }).revision, 1);
});

test("unauthenticated reads never fingerprint sheets or create revision state", () => {
  const f = fixture();
  f.faults.duringFingerprint = () => { throw new Error("must not read sheets"); };
  for (const action of ["bootstrap", "permissionConfig", "loadScheduleDrafts"]) assert.equal(f.post(action).code, "AUTH_REQUIRED");
  assert.equal(f.properties.size, 0);
});

test("body expectedRevision takes precedence over the payload fallback", () => {
  const f = fixture(); const token = f.login().sessionToken;
  assert.equal(f.post("updatePerson", { id: "P1001", expectedRevision: 0 }, { sessionToken: token, operationId: "OP_rev_body_00000001", expectedRevision: 1 }).code, "REVISION_CONFLICT");
  assert.equal(f.post("updatePerson", { id: "P1001", expectedRevision: 99 }, { sessionToken: token, operationId: "OP_rev_body_00000002", expectedRevision: 0 }).revision, 1);
});

test("reservation quota failure is graceful and runs no mutation", () => {
  const f = fixture(); const token = f.login().sessionToken; f.faults.beforeDataWrite = true;
  const result = f.write(token, "updatePerson", { id: "P1001", note: "blocked" });
  assert.equal(result.code, "OPERATION_CAPACITY"); assert.equal(f.people.rows[1][4], "");
  assert.equal(f.context.getDataRevision_(), 0); assert.equal(f.locked(), false);
});

test("flush and completion persistence failures stay unknown and never rerun writes", () => {
  for (const fault of ["flush", "finishOperation"]) {
    const f = fixture(); const token = f.login().sessionToken; f.faults[fault] = true;
    const body = { sessionToken: token, operationId: "OP_uncertain_00000001" };
    const payload = { id: "P1001", note: "once", expectedRevision: 0 };
    const result = f.post("updatePerson", payload, body);
    assert.equal(result.code, "WRITE_OUTCOME_UNKNOWN"); assert.equal(result.revision, 1);
    assert.equal(f.people.rows[1][4], "once"); assert.equal(f.locked(), false);
    f.faults[fault] = false;
    assert.equal(f.post("updatePerson", payload, body).code, "WRITE_OUTCOME_UNKNOWN");
    assert.equal(f.context.getDataRevision_(), 1);
    assert.equal(f.events.filter(e => e.kind === "set" && e.name === "01_人員主表").length, 1);
  }
});

test("throttle capacity is checked before password verification and cannot be used to bypass cooldown", () => {
  const f = fixture();
  vm.runInContext("SETTINGS.LOGIN_MAX_RECORDS = 2", f.context);
  f.login("unknown-1", "wrong"); f.login("unknown-2", "wrong");
  let verified = 0;
  const verify = f.context.verifyPassword_;
  f.context.verifyPassword_ = (...args) => { verified++; return verify(...args); };
  assert.equal(f.login().code, "LOGIN_THROTTLED"); assert.equal(verified, 0);
  f.advance(5 * 60000 + 1); assert.equal(f.login().ok, true);
});

test("operation receipts are owner-scoped, admin-only for all, and never expose payloads or digests", () => {
  const f = fixture(); const worker = f.login().sessionToken; const root = f.login("root", "synthetic-admin-password").sessionToken;
  assert.equal(f.write(worker, "updatePerson", { id: "P1001", note: "private note" }).ok, true);
  assert.equal(f.write(root, "updatePerson", { id: "ROOT", note: "root note" }).ok, true);
  const own = f.post("listOperations", {}, { sessionToken: worker });
  assert.equal(own.operations.length, 1); assert.equal(own.operations[0].ownerId, "P1001");
  assert.doesNotMatch(JSON.stringify(own), /private note|requestDigest|sessionToken|password|person/);
  assert.equal(f.post("listOperations", { all: true }, { sessionToken: worker }).code, "FORBIDDEN");
  assert.equal(f.post("listOperations", { all: true }, { sessionToken: root }).operations.length, 2);
  const snapshot = f.post("bootstrap", {}, { sessionToken: worker });
  assert.equal(snapshot.capabilities.operationReceipts, true); assert.equal(snapshot.recentOperations.length, 1);
});

test("partial create with failed rollback remains unknown and cannot append twice", () => {
  const f = fixture(); const token = f.login().sessionToken;
  f.sheets.get("03_站點矩陣").failNextWrite = true;
  f.people.deleteRow = () => { throw new Error("synthetic rollback failure"); };
  const body = { sessionToken: token, operationId: "OP_partial_00000001" };
  const payload = { id: "NEW", name: "Synthetic new", shift: "TEAM_A", expectedRevision: 0 };
  assert.equal(f.post("createPerson", payload, body).code, "WRITE_OUTCOME_UNKNOWN");
  assert.equal(f.people.rows.filter(row => row[0] === "NEW").length, 1);
  assert.equal(f.post("createPerson", payload, body).code, "WRITE_OUTCOME_UNKNOWN");
  assert.equal(f.people.rows.filter(row => row[0] === "NEW").length, 1);
  assert.equal(f.post("operationStatus", { operationId: body.operationId }, { sessionToken: token }).status, "unknown");
});

test("stale processing receipts are not reported as running forever or pruned as safe failures", () => {
  const f = fixture(); const token = f.login().sessionToken;
  f.properties.set("ROSARIO_OP_OP_stale_00000001", JSON.stringify({ action: "updatePerson", ownerId: "P1001", status: "processing", createdAt: Date.now() - 100000000000, updatedAt: 1 }));
  f.advance(25 * 3600000);
  const result = f.post("listOperations", {}, { sessionToken: f.login().sessionToken });
  assert.equal(result.operations[0].status, "unknown");
  assert.ok(f.properties.has("ROSARIO_OP_OP_stale_00000001"));
});

test("request-local table caching avoids repeated reads but invalidates after writes and between requests", () => {
  const f = fixture();
  f.context.withScriptLock_(() => {
    vm.runInContext("requestSheetCache_ = Object.create(null)", f.context);
    const before = f.stats.reads;
    const first = f.context.getSheetObjects_("01_人員主表");
    first[0]["姓名"] = "caller-only edit";
    assert.equal(f.context.getSheetObjects_("01_人員主表")[0]["姓名"], "Synthetic worker");
    assert.equal(f.stats.reads - before, 1);
    f.context.setLiteralValue_(f.people.getRange(2, 2), "changed");
    assert.equal(f.context.getSheetObjects_("01_人員主表")[0]["姓名"], "changed");
  });
  const token = f.login().sessionToken;
  assert.equal(f.post("listOperations", {}, { sessionToken: token }).ok, true);
  f.accounts.rows[1][4] = "停用";
  assert.match(f.post("listOperations", {}, { sessionToken: token }).code, /^AUTH_/);
});

test("batched personnel updates preserve matrix qualification cells and synchronize identity", () => {
  const f = fixture(); const token = f.login().sessionToken;
  assert.equal(f.write(token, "updatePerson", { id: "P1001", name: "Updated", shift: "TEAM_A", role: "技術員", note: "note" }).ok, true);
  const matrix = f.sheets.get("03_站點矩陣");
  assert.equal(matrix.rows[1][1], "Updated"); assert.equal(matrix.rows[1][5], "合格");
  assert.equal(f.events.filter(e => e.kind === "set" && e.name === "01_人員主表").length, 1);
});

test("storage pressure refuses new work before data mutation without dropping existing receipts", () => {
  const f = fixture(); const token = f.login().sessionToken;
  f.properties.set("SYNTHETIC_LARGE_METADATA", "x".repeat(90000));
  assert.equal(f.write(token, "updatePerson", { id: "P1001", note: "not written" }).code, "OPERATION_CAPACITY");
  assert.equal(f.people.rows[1][4], "");
});

test("only an administrator can acknowledge an unknown receipt without claiming success or replaying it", () => {
  const f = fixture(); const token = f.login().sessionToken;
  const id = "OP_review_00000001";
  f.properties.set(`ROSARIO_OP_${id}`, JSON.stringify({ action: "updatePerson", ownerId: "P1001", status: "unknown", createdAt: 1, updatedAt: 1, requestDigest: "synthetic" }));
  assert.equal(f.write(token, "acknowledgeOperation", { targetOperationId: id, confirmedReview: true }).code, "FORBIDDEN");
  const root = f.login("root", "synthetic-admin-password").sessionToken;
  assert.equal(f.write(root, "acknowledgeOperation", { targetOperationId: id }).code, "REVIEW_REQUIRED");
  assert.equal(f.write(root, "acknowledgeOperation", { targetOperationId: id, confirmedReview: true }).ok, true);
  const status = f.post("operationStatus", { operationId: id }, { sessionToken: token });
  assert.equal(status.status, "reviewed"); assert.equal(status.result, undefined);
  const record = JSON.parse(f.properties.get(`ROSARIO_OP_${id}`));
  assert.equal(f.context.operationRecordResponse_(id, record).code, "OPERATION_REVIEWED");
});

test("the deployed protocol rejects old frontends before any personnel mutation", () => {
  const f = fixture(); const token = f.login().sessionToken;
  const result = f.write(token, "updatePerson", { id: "P1001", note: "not allowed" }, { appVersion: "2026-08-11-011" });
  assert.equal(result.ok, false); assert.equal(f.people.rows[1][4], "");
});
