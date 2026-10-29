import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { fixture, source, VERSION } from "./helpers/gasFixture.mjs";

const boot = (f, token) => f.post("bootstrap", {}, { sessionToken: token });
const receiptCount = f => [...f.properties.keys()].filter(k => k.startsWith("ROSARIO_OP_")).length;
const mutationCount = f => f.events.filter(e => ["set", "append", "delete"].includes(e.kind)).length;

test("release version is read from release.json and matches both backend guards", () => {
  const f = fixture();
  assert.equal(f.post("version").appVersion, VERSION);
  assert.equal(f.post("version").minWriteVersion, VERSION);
  assert.equal(boot(f, f.login().sessionToken).serverVersion, VERSION);
});

test("feature readers and editors receive only their bootstrap data dependencies", () => {
  for (let i = 1; i <= 16; i++) {
    const permission = `PERM_${String(i).padStart(3, "0")}`;
    const f = fixture({ permissions: [permission] }); const token = f.login().sessionToken;
    const result = boot(f, token);
    if ([15, 16].includes(i)) {
      assert.equal(result.code, "FORBIDDEN", permission);
      assert.equal("people" in result, false); assert.equal("qualifications" in result, false);
      continue;
    }
    assert.equal(result.ok, true, permission);
    if ([11, 12].includes(i)) assert.deepEqual(result.people.map(p => p.id), ["P1001"]);
    else assert.equal(result.people.length, 2, permission);
    if ([11, 12, 14].includes(i)) assert.deepEqual(result.qualifications, []);
    else assert.equal(result.qualifications.length, 1, permission);
    if (i === 14) assert.deepEqual(result.stations, []);
  }
});

test("person-query permission alone loads personnel and canonical qualifications", () => {
  const f = fixture({ role: "技術員", permissions: ["PERM_002"] });
  const result = boot(f, f.login().sessionToken);
  assert.equal(result.ok, true); assert.equal(result.people.length, 2); assert.equal(result.stations.length, 1);
  assert.deepEqual(result.qualifications.map(q => [q.employeeId, q.stationId, q.status]), [["P1001", "ST01", "合格"]]);
  assert.equal(result.serverVersion, VERSION);
});

test("HR notes and departure dates are projected by effective feature needs without breaking analysis", () => {
  for (const permission of ["PERM_001", "PERM_002", "PERM_005", "PERM_006", "PERM_007", "PERM_009", "PERM_010", "PERM_011", "PERM_013", "PERM_014"]) {
    const f = fixture({ permissions: [permission] });
    f.people.rows[0].push("離職日");
    f.people.rows[1].push("2026-11-01"); f.people.rows[2].push("2026-11-02");
    f.people.rows[1][4] = "synthetic private worker note"; f.people.rows[2][4] = "synthetic private admin note";
    const token = f.login().sessionToken; const result = boot(f, token);
    assert.equal(result.ok, true, permission);
    const detailed = ["PERM_002", "PERM_013", "PERM_014"].includes(permission);
    const dates = detailed || permission === "PERM_006";
    for (const person of result.people) {
      assert.equal("note" in person, detailed, permission);
      assert.equal("departureDate" in person, dates, permission);
    }
    if (permission === "PERM_006") {
      assert.equal(result.people.length, 2); assert.equal(result.qualifications.length, 1);
      assert.equal(result.people[0].departureDate, "2026-11-01"); assert.equal(result.stationRules.length, 2);
    }
    const root = f.login("root", "synthetic-admin-password").sessionToken;
    const admin = boot(f, root);
    assert.equal(admin.people[0].note, "synthetic private worker note");
    assert.equal(admin.people[0].departureDate, "2026-11-01");
  }
});

test("permission-admin grants alone cannot expose data and profile denies cannot leak HR fields", () => {
  const f = fixture({ role: "技術員", permissions: ["PERM_015", "PERM_016"] });
  assert.equal(boot(f, f.login().sessionToken).code, "FORBIDDEN");
  const denied = fixture({ permissions: ["PERM_001", "PERM_002", "PERM_006"], exceptions: [
    { permissionId: "PERM_002", effect: "deny" }, { permissionId: "PERM_006", effect: "deny" },
  ] });
  denied.people.rows[0].push("離職日"); denied.people.rows[1].push("2026-11-01"); denied.people.rows[2].push("");
  const result = boot(denied, denied.login().sessionToken);
  assert.equal(result.ok, true);
  assert.equal(result.people.some(p => "note" in p || "departureDate" in p), false);
});

test("personal deny and disabled permission items cannot grant bootstrap access", () => {
  for (const disable of [false, true]) {
    const f = fixture({ permissions: ["PERM_005"], exceptions: disable ? [] : [{ permissionId: "PERM_005", effect: "deny" }] });
    if (disable) f.sheets.get("08_權限項目").rows.find(r => r[0] === "PERM_005")[1] = "停用";
    const token = f.login().sessionToken;
    assert.equal(boot(f, token).code, "FORBIDDEN");
    assert.equal(f.post("permissionConfig", {}, { sessionToken: token }).ok, true);
  }
});

test("unchanged full personnel payloads work but actual authority changes are admin-only", () => {
  const f = fixture({ role: "技術員" }); const token = f.login().sessionToken;
  assert.equal(f.write(token, "updatePerson", { id: "P1001", shift: "TEAM_A", role: "技術員", note: "normal" }).ok, true);
  const before = mutationCount(f);
  for (const payload of [{ id: "P1001", role: "主任" }, { id: "P1001", shift: "TEAM_B" }, { id: "ROOT", shift: "TEAM_A" }]) {
    assert.equal(f.write(token, "updatePerson", payload).code, "FORBIDDEN");
  }
  assert.equal(mutationCount(f), before);
  assert.equal(f.write(token, "updateStationRule", { team: "TEAM_A", stationId: "ST01", minRequired: 1 }).code, "FORBIDDEN");
  assert.equal(f.post("loadScheduleDrafts", { team: "TEAM_B", includeDetails: true }, { sessionToken: token }).code, "FORBIDDEN");
  const root = f.login("root", "synthetic-admin-password").sessionToken;
  boot(f, root);
  assert.equal(f.write(root, "updatePerson", { id: "P1001", shift: "TEAM_B", role: "主任" }).ok, true);
  assert.equal(f.write(token, "updateStationRule", { team: "TEAM_B", stationId: "ST01", minRequired: 1 }).ok, true);
  assert.equal(f.post("loadScheduleDrafts", { includeDetails: true }, { sessionToken: token }).drafts[0].id, "D_B");
});

test("per-account session limits preserve multiple devices and other accounts", () => {
  const f = fixture(); vm.runInContext("SETTINGS.SESSION_MAX_PER_ACCOUNT = 3", f.context);
  const tokens = Array.from({ length: 3 }, () => f.login().sessionToken);
  assert.ok(tokens.every(Boolean));
  assert.equal(f.login(" WORKER ", "synthetic-old-password").code, "SESSION_ACCOUNT_CAPACITY");
  assert.equal(f.login("root", "synthetic-admin-password").ok, true);
  for (const token of tokens) assert.equal(f.post("session", {}, { sessionToken: token }).ok, true);
  f.post("logout", {}, { sessionToken: tokens[0] });
  assert.equal(f.login().ok, true);
  f.advance(13 * 3600000); assert.equal(f.login().ok, true);
});

test("invalid or stale new revisions consume no receipts; existing requests replay first", () => {
  const f = fixture(); const token = f.login().sessionToken;
  const body = { sessionToken: token, operationId: "OP_replay_preflight_00000001" };
  const payload = { id: "P1001", note: "once", expectedRevision: 0 };
  assert.equal(f.post("updatePerson", payload, body).ok, true);
  const before = mutationCount(f);
  for (let i = 0; i < 170; i++) {
    if (i > 0 && i % 20 === 0) f.advance(60001);
    const result = f.post("updatePerson", { id: "P1001", expectedRevision: i % 2 ? "1" : 0 }, {
      sessionToken: token, operationId: `OP_rejected_revision_${String(i).padStart(8, "0")}`,
    });
    assert.equal(result.code, i % 2 ? "REVISION_REQUIRED" : "REVISION_CONFLICT");
  }
  assert.equal(receiptCount(f), 0); assert.equal(mutationCount(f), before);
  assert.equal(f.post("updatePerson", payload, body).replayed, true);
  assert.equal(f.post("updatePerson", { ...payload, expectedRevision: 1 }, body).code, "OPERATION_CONFLICT");
});

test("durable terminal receipts support more than 160 writes without growing properties", () => {
  const f = fixture(); const token = f.login().sessionToken;
  const root = f.login("root", "synthetic-admin-password").sessionToken;
  const firstBody = { sessionToken: token, operationId: "OP_ledger_first_00000001" };
  const firstPayload = { id: "P1001", note: "first", expectedRevision: 0 };
  assert.equal(f.post("updatePerson", firstPayload, firstBody).ok, true);
  for (let i = 0; i < 170; i++) {
    if (i > 0 && i % 20 === 0) f.advance(60001);
    assert.equal(f.write(token, "updatePerson", { id: "P1001", note: `synthetic ${i}` }).ok, true);
  }
  assert.equal(receiptCount(f), 0);
  assert.equal(f.sheets.get("13_操作收據").rows.length, 172);
  const before = mutationCount(f);
  assert.equal(f.post("updatePerson", firstPayload, firstBody).replayed, true);
  assert.equal(mutationCount(f), before);
  assert.equal(f.post("operationStatus", { operationId: firstBody.operationId }, { sessionToken: token }).result.revision, 1);
  assert.equal(f.post("operationStatus", { operationId: firstBody.operationId }, { sessionToken: root }).code, "FORBIDDEN");
  const listed = f.post("listOperations", {}, { sessionToken: token });
  assert.equal(listed.operations.length, 171);
  assert.doesNotMatch(JSON.stringify(listed), /requestDigest|synthetic 169|sessionToken/);
  const reads = f.stats.reads;
  f.post("listOperations", {}, { sessionToken: token });
  assert.ok(f.stats.reads - reads < 12, "ledger listing must not read a sheet once per receipt");
  assert.equal(boot(f, token).revision, 171);
});

test("terminal ledger retention is at least 24h and expiry never drops unknown receipts", () => {
  const f = fixture(); const token = f.login().sessionToken;
  const body = { sessionToken: token, operationId: "OP_retained_ledger_00000001" };
  const payload = { id: "P1001", note: "retained", expectedRevision: 0 };
  f.post("updatePerson", payload, body);
  f.properties.set("ROSARIO_OP_OP_unknown_retained_00000001", JSON.stringify({ status: "unknown", ownerId: "P1001", updatedAt: 1 }));
  f.advance(24 * 3600000 - 1);
  const fresh = f.login().sessionToken;
  assert.equal(f.post("updatePerson", payload, { ...body, sessionToken: fresh }).replayed, true);
  f.advance(2);
  assert.equal(f.post("listOperations", {}, { sessionToken: fresh }).operations.some(r => r.operationId === body.operationId), false);
  assert.ok(f.properties.has("ROSARIO_OP_OP_unknown_retained_00000001"));
});

test("legacy terminal property receipts migrate safely to the durable ledger", () => {
  const f = fixture(); const token = f.login().sessionToken;
  f.properties.set("ROSARIO_OP_OP_legacy_terminal_00000001", JSON.stringify({ status: "success", action: "updatePerson", ownerId: "P1001", updatedAt: f.context.Date.now(), result: { ok: true } }));
  assert.equal(f.post("listOperations", {}, { sessionToken: token }).operations.length, 1);
  assert.equal(receiptCount(f), 0);
  assert.equal(f.sheets.get("13_操作收據").rows.length, 2);
});

test("ledger write, flush and cleanup failures keep a reservation and cannot repeat a mutation", () => {
  for (const fault of ["ledgerWrite", "ledgerFlush", "ledgerDelete", "ledgerReadback"]) {
    const f = fixture(); const token = f.login().sessionToken;
    const body = { sessionToken: token, operationId: "OP_ledger_failure_00000001" };
    const payload = { id: "P1001", note: "once", expectedRevision: 0 };
    f.faults[fault] = true;
    assert.equal(f.post("updatePerson", payload, body).code, "WRITE_OUTCOME_UNKNOWN", fault);
    f.faults[fault] = false;
    assert.equal(f.post("updatePerson", payload, body).code, "WRITE_OUTCOME_UNKNOWN", fault);
    assert.equal(f.events.filter(e => e.kind === "set" && e.name === "01_人員主表").length, 1);
    assert.ok(f.properties.has(`ROSARIO_OP_${body.operationId}`));
  }
});

test("corrupt or duplicate ledger entries fail closed without applying a write", () => {
  for (const corrupt of [true, false]) {
    const f = fixture(); const token = f.login().sessionToken;
    f.write(token, "updatePerson", { id: "P1001", note: "once" });
    const ledger = f.sheets.get("13_操作收據");
    if (corrupt) ledger.rows[1][1] = "not JSON";
    else ledger.rows.push([...ledger.rows[1]]);
    assert.equal(f.write(token, "updatePerson", { id: "P1001", note: "never" }).code, "OPERATION_RECORD_INVALID");
    assert.equal(f.people.rows[1][4], "once");
  }
});

test("all demand fields reject invalid values before receipt reservation or any cell write", () => {
  for (const field of ["minRequired", "reliefMinPerBatch", "backupTarget", "maxAssignable"]) {
    for (const value of [-1, 0.5, 1001, 1e12, "Infinity", "not-a-number", true, [], {}]) {
      const f = fixture(); const token = f.login().sessionToken; const before = mutationCount(f);
      assert.equal(f.write(token, "updateStationRule", { team: "TEAM_A", stationId: "ST01", [field]: value }).code, "DEMAND_INVALID", `${field}:${JSON.stringify(value)}`);
      assert.equal(mutationCount(f), before); assert.equal(receiptCount(f), 0);
    }
  }
});

test("demand bounds preserve numeric strings, 0, null and optional blank defaults", () => {
  const f = fixture(); const token = f.login().sessionToken;
  for (const value of [0, "0", 1000, "1000", null, "", " "]) {
    assert.equal(f.write(token, "updateStationRule", { team: "TEAM_A", stationId: "ST01", minRequired: value }).ok, true);
    assert.equal(f.rules.rows[1][3], value == null || String(value).trim() === "" ? "" : Number(value));
  }
  f.rules.rows[1][3] = 1001;
  assert.equal(boot(f, token).code, "DEMAND_INVALID");
  const hr = fixture({ permissions: ["PERM_014"] }); const hrToken = hr.login().sessionToken;
  hr.rules.rows[1][3] = 1001;
  hr.sheets.get("02_站點主表").rows[0].push("正班最低人數");
  hr.sheets.get("02_站點主表").rows[1].push(1001);
  assert.equal(boot(hr, hrToken).ok, true);
});

test("draft assignments and legacy details preserve order and round trip without silently clearing", () => {
  const f = fixture(); const token = f.login().sessionToken;
  const items = [{ id: "second", stationId: "ST01", employeeId: "P1001", note: "later" }, { id: "first", stationId: "ST01", personId: "ROOT", type: "站點" }];
  assert.equal(f.write(token, "saveScheduleDraft", { draft: { id: "D_A", team: "TEAM_A" }, details: items }).ok, true);
  let loaded = f.post("loadScheduleDrafts", { includeDetails: true }, { sessionToken: token }).details;
  assert.deepEqual(loaded.map(d => [d.id, d.employeeId, d.order]), [["second", "P1001", 1], ["first", "ROOT", 2]]);
  assert.equal(f.write(token, "saveScheduleDraft", { draft: { id: "D_A", team: "TEAM_A" }, assignments: loaded }).ok, true);
  loaded = f.post("loadScheduleDrafts", { includeDetails: true }, { sessionToken: token }).details;
  assert.deepEqual(loaded.map(d => d.id), ["second", "first"]);
  const before = JSON.stringify(f.drafts.rows);
  for (const malformed of [{}, { assignments: null }, { details: {} }, { assignments: [null] }, { assignments: [{}] }, { assignments: items, details: [] }, { assignments: [{ stationId: 1, employeeId: "P1001" }] }]) {
    assert.equal(f.write(token, "saveScheduleDraft", { draft: { id: "D_A", team: "TEAM_A" }, ...malformed }).code, "DRAFT_INVALID");
    assert.equal(JSON.stringify(f.drafts.rows), before);
  }
  assert.equal(f.write(token, "saveScheduleDraft", { draft: { id: "D_A", team: "TEAM_A" }, assignments: [] }).ok, true);
  assert.deepEqual(f.post("loadScheduleDrafts", { includeDetails: true }, { sessionToken: token }).details, []);
});

test("canonical matrix projection preserves leading zeros, mentor raw labels and explicit blanks", () => {
  const f = fixture(); const token = f.login().sessionToken;
  f.people.rows.push(["00532", "Synthetic zero ID", "TEAM_A", "技術員", "說明及可留白是合法備註"]);
  const matrix = f.sheets.get("03_站點矩陣");
  matrix.rows.unshift([]);
  matrix.rows[2][5] = "";
  matrix.rows.push(["00532", "Synthetic zero ID", "TEAM_A", "技術員", "", "導師"]);
  const details = f.sheets.get("03_資格明細");
  details.rows.push(["532", "ST01", "合格"]);
  const before = JSON.stringify([matrix.rows, details.rows]); const events = mutationCount(f);
  vm.runInContext("SETTINGS.AUTO_SYNC_QUALIFICATIONS_FROM_MATRIX_ON_BOOTSTRAP = true", f.context);
  const result = boot(f, token);
  assert.equal(result.ok, true);
  assert.deepEqual(result.qualifications.map(q => [q.employeeId, q.status, q.rawStatus, q.canLead]), [["00532", "合格", "導師", true]]);
  assert.equal(result.qualificationSource.headerRow, 2);
  assert.equal(result.qualificationSource.conflictCount, 1);
  assert.equal(result.qualificationSource.orphanDetailCount, 1);
  assert.equal(JSON.stringify([matrix.rows, details.rows]), before); assert.equal(mutationCount(f), events);
});

test("only an absent matrix permits detail fallback; malformed and duplicate matrix structures fail closed", () => {
  const absent = fixture(); const absentToken = absent.login().sessionToken;
  absent.sheets.delete("03_站點矩陣");
  const fallback = boot(absent, absentToken);
  assert.equal(fallback.qualifications.length, 1);
  assert.equal(fallback.qualificationSource.code, "MATRIX_ABSENT_DETAIL_FALLBACK");
  for (const change of [m => { m.rows = [[]]; }, m => { m.rows[0][5] = "missing station"; }, m => { m.rows.push([...m.rows[1]]); }, m => { m.rows[0].push("ST01"); }, m => { m.rows[0].push("工號"); }]) {
    const f = fixture(); const token = f.login().sessionToken; change(f.sheets.get("03_站點矩陣"));
    const result = boot(f, token); assert.equal(result.code, "MATRIX_INVALID"); assert.equal("qualifications" in result, false);
  }
});

test("qualification mutations update the canonical matrix and never report a failed synchronization as success", () => {
  const f = fixture(); const token = f.login().sessionToken;
  f.sheets.get("03_資格明細").rows.splice(1);
  assert.equal(f.write(token, "deleteQualification", { employeeId: "P1001", stationId: "ST01" }).ok, true);
  assert.deepEqual(boot(f, token).qualifications, []);
  assert.equal(f.write(token, "upsertQualification", { employeeId: "P1001", stationId: "ST01", status: "導師" }).ok, true);
  assert.equal(boot(f, token).qualifications[0].rawStatus, "導師");
  f.sheets.get("03_站點矩陣").failNextWrite = true;
  assert.equal(f.write(token, "upsertQualification", { employeeId: "P1001", stationId: "ST01", status: "不可排" }).code, "WRITE_OUTCOME_UNKNOWN");
});

test("header/help identities are excluded before date or demand parsing, not by row notes", () => {
  const f = fixture();
  f.people.rows[0].push("離職日"); f.people.rows[1].push("2026-10-31"); f.people.rows[2].push("");
  f.people.rows.splice(1, 0, ["唯一主鍵，不可重覆", "說明", "班別", "職務", "", "可留白"]);
  f.people.rows[2][4] = "唯一主鍵，不可重覆／可留白 是合法備註";
  const stations = f.sheets.get("02_站點主表");
  stations.rows[0].push("正班最低人數"); stations.rows[1].push(1);
  stations.rows.splice(1, 0, ["唯一主鍵，不可重覆", "站點說明", "填寫人數"]);
  const token = f.login().sessionToken;
  assert.ok(token); const result = boot(f, token);
  assert.equal(result.ok, true, result.message); assert.equal(result.people.length, 2); assert.equal(result.stations.length, 1);
  assert.equal(result.people[0].departureDate, "2026-10-31");
  assert.match(result.people[0].note, /合法備註/);
});

test("departure dates use GAS time zone and never change employment or account status", () => {
  const f = fixture({ timeZone: "Asia/Taipei" });
  f.people.rows[0].push("離職日", "在職狀態");
  f.people.rows[1].push(new Date("2026-10-28T16:30:00Z"), "在職"); f.people.rows[2].push("", "留停");
  const token = f.login().sessionToken;
  let result = boot(f, token);
  assert.equal(result.people[0].departureDate, "2026-10-29"); assert.equal(result.people[0].employmentStatus, "在職");
  assert.equal(f.write(token, "updatePerson", { id: "P1001", departureDate: "2026-11-30" }).ok, true);
  result = boot(f, token); assert.equal(result.people[0].departureDate, "2026-11-30");
  assert.equal(result.people[0].employmentStatus, "在職"); assert.equal(f.accounts.rows[1][4], "啟用");
  assert.equal(f.write(token, "updatePerson", { id: "P1001", departureDate: "2026-02-30" }).code, "DATE_INVALID");
  assert.equal(f.write(token, "updatePerson", { id: "P1001", departureDate: null }).person.departureDate, "");
  assert.equal(f.write(token, "createPerson", { id: "00532", name: "Synthetic new", shift: "TEAM_A", departureDate: "2027-01-01" }).ok, true);
  assert.equal(boot(f, token).people.find(p => p.id === "00532").departureDate, "2027-01-01");
  const absent = fixture(); const absentToken = absent.login().sessionToken;
  assert.equal(absent.write(absentToken, "updatePerson", { id: "P1001", note: "normal", departureDate: "2027-01-01" }).ok, true);
  assert.equal("departureDate" in boot(absent, absentToken).people[0], false);
});

test("numeric ID cells preserve display-format leading zeros without changing numeric demand cells", () => {
  const f = fixture(); const token = f.login().sessionToken;
  f.people.rows.push([532, "Synthetic formatted ID", "TEAM_A", "技術員", ""]);
  const range = f.people.getDataRange.bind(f.people);
  f.people.getDataRange = () => {
    const result = range();
    result.getDisplayValues = () => f.people.rows.map((row, index) => row.map((v, column) => index === 3 && column === 0 ? "00532" : String(v)));
    return result;
  };
  const people = boot(f, token).people;
  assert.ok(people.some(p => p.id === "00532")); assert.equal(people.some(p => p.id === "532"), false);
});

test("a fresh VM can replay a ledger receipt with no property receipt present", () => {
  const f = fixture(); const token = f.login().sessionToken;
  const body = { sessionToken: token, operationId: "OP_new_vm_ledger_00000001" };
  const payload = { id: "P1001", note: "once", expectedRevision: 0 };
  assert.equal(f.post("updatePerson", payload, body).ok, true); assert.equal(receiptCount(f), 0);
  const context = vm.createContext({ ...f.context }); vm.runInContext(source, context);
  context.getSystemSettings_ = () => ({});
  const result = JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ action: "updatePerson", payload, appVersion: VERSION, ...body }) } }));
  assert.equal(result.replayed, true); assert.equal(result.revision, 1);
});

test("display-only identity changes advance revision and changes during snapshots reject stale data", () => {
  const f = fixture(); const token = f.login().sessionToken;
  f.people.rows.push([532, "Synthetic formatted ID", "TEAM_A", "技術員", ""]);
  let shown = "00532";
  const range = f.people.getDataRange.bind(f.people);
  f.people.getDataRange = () => {
    const result = range();
    result.getDisplayValues = () => f.people.rows.map((row, index) => row.map((v, column) => index === 3 && column === 0 ? shown : String(v)));
    return result;
  };
  assert.equal(boot(f, token).revision, 0);
  shown = "000532";
  assert.equal(boot(f, token).revision, 1);
  const build = f.context.buildBootstrap_;
  f.context.buildBootstrap_ = (...args) => { const result = build(...args); shown = "00532"; return result; };
  const conflict = boot(f, token);
  assert.equal(conflict.code, "REVISION_CONFLICT"); assert.equal(conflict.revision, 2); assert.equal("people" in conflict, false);
});

test("root draft validation rejects malformed headers and mismatched aliases before reserving receipts", () => {
  const f = fixture(); const token = f.login("root", "synthetic-admin-password").sessionToken;
  const before = mutationCount(f);
  for (const draft of [null, [], false, 42, { team: "" }, { team: 7 }]) {
    assert.equal(f.write(token, "saveScheduleDraft", { draft, assignments: [] }).code, "DRAFT_INVALID");
  }
  for (const item of [{ stationId: "ST01", employeeId: "P1001", personId: "ROOT" }, { stationId: "ST01", employeeId: "P1001", order: 0 }]) {
    assert.equal(f.write(token, "saveScheduleDraft", { draft: { team: "TEAM_A" }, assignments: [item] }).code, "DRAFT_INVALID");
  }
  assert.equal(receiptCount(f), 0); assert.equal(mutationCount(f), before);
});

test("new and existing rule demand aliases and station relief fallback obey the same bounds", () => {
  const f = fixture(); const token = f.login().sessionToken;
  f.rules.rows[0].push("輪休需求", "備援目標", "可排滿人數");
  const stations = f.sheets.get("02_站點主表"); stations.rows[0].push("輪休最低人數");
  for (const value of [1000, 0, null]) {
    assert.equal(f.write(token, "updateStationRule", { team: "TEAM_A", stationId: "ST01", reliefMinPerBatch: value, backupTarget: value, maxAssignable: value }).ok, true);
    const expected = value === null ? "" : value;
    assert.deepEqual(f.rules.rows[1].slice(5), [expected, expected, expected]);
    assert.equal(stations.rows[1][2], expected);
  }
  const root = f.login("root", "synthetic-admin-password").sessionToken; boot(f, root);
  assert.equal(f.write(root, "updateStationRule", { team: "TEAM_NEW", stationId: "ST01", minRequired: 1000, backupTarget: 0, maxAssignable: null }).ok, true);
  assert.equal(f.rules.rows.at(-1)[3], 1000);
});

test("new-operation limits count malformed requests across sessions but never throttle receipts or status", () => {
  const f = fixture(); vm.runInContext("SETTINGS.NEW_OPERATION_LIMIT = 3", f.context);
  const first = f.login().sessionToken; const second = f.login().sessionToken;
  const body = { sessionToken: first, operationId: "OP_rate_replay_00000001" };
  const payload = { id: "P1001", note: "once", expectedRevision: 0 };
  assert.equal(f.post("updatePerson", payload, body).ok, true);
  assert.equal(f.post("updatePerson", { id: "P1001", expectedRevision: 0 }, { sessionToken: second, operationId: "OP_rate_bad_revision_00000001" }).code, "REVISION_CONFLICT");
  assert.equal(f.write(second, "saveScheduleDraft", { draft: { team: "TEAM_A" }, assignments: null }).code, "DRAFT_INVALID");
  const before = mutationCount(f); const revision = f.context.getDataRevision_();
  const blocked = f.write(first, "updatePerson", { id: "P1001", note: "blocked" });
  assert.equal(blocked.code, "WRITE_THROTTLED"); assert.equal(blocked.retryAfterSeconds, 60);
  assert.equal(mutationCount(f), before); assert.equal(f.context.getDataRevision_(), revision); assert.equal(receiptCount(f), 0);
  for (let i = 0; i < 5; i++) assert.equal(f.post("updatePerson", payload, { ...body, sessionToken: second }).replayed, true);
  assert.equal(f.post("updatePerson", { ...payload, note: "changed" }, body).code, "OPERATION_CONFLICT");
  assert.equal(f.post("operationStatus", { operationId: body.operationId }, { sessionToken: first }).status, "success");
  assert.equal(f.post("listOperations", {}, { sessionToken: first }).operations.length, 1);
  f.advance(60001);
  assert.equal(f.write(second, "updatePerson", { id: "P1001", note: "after cooldown" }).ok, true);
});

test("root bulk operations bypass the owner rate limit without clearing another owner's counter", () => {
  const f = fixture(); vm.runInContext("SETTINGS.NEW_OPERATION_LIMIT = 1", f.context);
  const worker = f.login().sessionToken; const root = f.login("root", "synthetic-admin-password").sessionToken;
  assert.equal(f.write(worker, "updatePerson", { id: "P1001", note: "worker" }).ok, true);
  const counters = [...f.properties.entries()].filter(([k]) => k.startsWith("ROSARIO_WRITE_RATE_"));
  for (let i = 0; i < 35; i++) assert.equal(f.write(root, "updatePerson", { id: "ROOT", note: `bulk ${i}` }).ok, true);
  assert.deepEqual([...f.properties.entries()].filter(([k]) => k.startsWith("ROSARIO_WRITE_RATE_")), counters);
  assert.equal(f.write(worker, "updatePerson", { id: "P1001", note: "blocked" }).code, "WRITE_THROTTLED");
});
