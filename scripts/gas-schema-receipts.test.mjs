import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers/gasFixture.mjs";

test("editable personnel values cannot select a different authorization header", () => {
  const f = fixture({ role: "技術員", personRole: "技術員", permissions: ["PERM_014", "PERM_012"] });
  f.people.rows = [
    ["工號", "姓名", "班別", "職務", "國籍", "(A)第一天", "(A)第二天", "(B)第一天", "(B)第二天", "在職狀態", "備註"],
    ["P1001", "Synthetic worker", "TEAM_A", "技術員", "", "", "", "", "", "在職", ""],
    ["ROOT", "Synthetic admin", "TEAM_B", "主任", "", "", "", "", "", "在職", ""],
  ];
  const token = f.login().sessionToken;
  assert.ok(token);
  const rule = { team: "TEAM_B", stationId: "ST01", minRequired: 3 };
  assert.equal(f.write(token, "updateStationRule", rule).code, "FORBIDDEN");
  assert.equal(f.write(token, "updatePerson", { id: "ROOT", name: "P1001", nationality: "TEAM_B", aDay2: "主任" }).ok, true);
  assert.equal(f.write(token, "updatePerson", {
    id: "P1001", name: "工號", nationality: "班別", aDay1: "姓名", aDay2: "職務",
    bDay1: "國籍", bDay2: "在職狀態", employmentStatus: "權限ID", note: "角色",
  }).ok, true);
  assert.equal(f.write(token, "updateStationRule", rule).code, "FORBIDDEN");
  assert.equal(f.people.rows[1][2], "TEAM_A");
  assert.equal(f.people.rows[1][3], "技術員");
});

test("schema accepts leading blanks but rejects duplicate named columns", () => {
  const f = fixture();
  f.people.rows.unshift([]);
  const token = f.login().sessionToken;
  assert.ok(token);
  assert.equal(f.post("bootstrap", {}, { sessionToken: token }).people.length, 2);
  f.people.rows[1].push("班別");
  assert.equal(f.post("bootstrap", {}, { sessionToken: token }).code, "SHEET_SCHEMA_INVALID");
});

test("oversized write requests never reserve receipts or mutate business rows", () => {
  const f = fixture(); const token = f.login().sessionToken;
  const before = JSON.stringify(f.people.rows);
  for (let i = 0; i < 160; i++) {
    const result = f.write(token, "updatePerson", { id: "P1001", unused: "x".repeat(45001) });
    assert.equal(result.code, "PAYLOAD_TOO_LARGE");
    f.advance(61000);
  }
  assert.equal(JSON.stringify(f.people.rows), before);
  assert.equal([...f.properties.keys()].filter(key => key.startsWith("ROSARIO_OP_")).length, 0);
  assert.equal(f.sheets.has("13_操作收據"), false);
  assert.equal(f.write(token, "updatePerson", { id: "P1001", note: "normal" }).ok, true);
});

test("profile and rule receipts never echo unknown or authentication fields", () => {
  const f = fixture(); const token = f.login("root", "synthetic-admin-password").sessionToken;
  const profile = f.write(token, "updatePerson", { id: "P1001", name: "Confirmed", unused: "not-stored", password: "synthetic-replacement-only" });
  assert.equal(profile.ok, true);
  assert.deepEqual(profile.person, { id: "P1001", name: "Confirmed" });
  const rule = f.write(token, "updateStationRule", { team: "TEAM_B", stationId: "ST01", minRequired: 2, unused: "not-stored" });
  assert.equal(rule.ok, true);
  assert.equal("unused" in rule.stationRule, false);
  assert.equal(f.sheets.get("13_操作收據").rows.some(row => String(row[1]).includes("not-stored")), false);
});

test("UTF-8 limits reject wide text before mutation and allow larger draft row batches", () => {
  const f = fixture(); const token = f.login().sessionToken;
  assert.equal(f.write(token, "updatePerson", { id: "P1001", note: "字".repeat(2100) }).code, "PAYLOAD_TOO_LARGE");
  assert.doesNotThrow(() => f.context.validateWritePayloadSize_("saveScheduleDraft", { assignments: Array.from({ length: 180 }, (_, i) => ({ employeeId: `P${i}`, stationId: "ST01", order: i })) }));
  assert.equal(f.write(token, "updatePerson", { id: "P1001", note: "字".repeat(1000) }).ok, true);
  const receipt = f.sheets.get("13_操作收據").rows[1][1];
  assert.ok(Buffer.byteLength(receipt, "utf8") < 9000);
});

test("admin review can recover a full unresolved operation pool without clearing unknown writes", () => {
  const f = fixture(); const token = f.login("root", "synthetic-admin-password").sessionToken;
  for (let i = 0; i < 160; i++) {
    f.properties.set(`ROSARIO_OP_OP_unknown_${String(i).padStart(8, "0")}`, JSON.stringify({
      action: "updatePerson", ownerId: "P1001", status: "unknown", createdAt: Date.now(), updatedAt: Date.now(),
    }));
  }
  assert.equal(f.write(token, "updatePerson", { id: "P1001", note: "blocked" }).code, "OPERATION_CAPACITY");
  const targetOperationId = "OP_unknown_00000000";
  assert.equal(f.write(token, "acknowledgeOperation", { targetOperationId, confirmedReview: true }).ok, true);
  assert.equal(f.post("operationStatus", { operationId: targetOperationId }, { sessionToken: token }).code, "FORBIDDEN");
  const reviewed = f.post("listOperations", { all: true }, { sessionToken: token }).operations.find(item => item.operationId === targetOperationId);
  assert.equal(reviewed.status, "reviewed");
  assert.equal(f.write(token, "updatePerson", { id: "P1001", note: "recovered" }).ok, true);
  assert.equal([...f.properties.keys()].filter(key => key.startsWith("ROSARIO_OP_")).length, 159);
});
