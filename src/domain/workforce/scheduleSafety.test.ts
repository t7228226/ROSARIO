import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditScheduleSafety } from "./scheduleSafety";

const rules = [
  { stationId: "A", minRequired: 1 },
  { stationId: "B", minRequired: 1 },
];

describe("auditScheduleSafety", () => {
  it("允許完整且不重複的站點配置進入預覽", () => {
    const result = auditScheduleSafety({
      rules,
      assignments: { A: ["P1"], B: ["P2"] },
      attendanceIds: ["P1", "P2", "P3"],
    });

    assert.equal(result.canPreview, true);
    assert.equal(result.totalShortage, 0);
    assert.deepEqual(result.unassignedIds, ["P3"]);
  });

  it("跨站點、幹部支援與臨時勤務共同檢查重複人員", () => {
    const result = auditScheduleSafety({
      rules,
      assignments: { A: ["P1"], B: ["P2"] },
      officerStations: { P1: "B" },
      extraWorks: [{ id: "X", workName: "盤點", personIds: ["P2"] }],
    });

    assert.equal(result.canPreview, false);
    assert.deepEqual(result.duplicatePeople.map((item) => item.employeeId).sort(), ["P1", "P2"]);
  });

  it("同一人重複出現在同站點仍視為重複，且覆蓋不可灌水", () => {
    const result = auditScheduleSafety({
      rules,
      assignments: { A: ["P1", "P1"], B: [] },
    });

    assert.equal(result.duplicatePeople.length, 1);
    assert.equal(result.stationChecks[0]?.assigned, 1);
    assert.equal(result.totalShortage, 1);
    assert.equal(result.canPreview, false);
  });

  it("訓練與幹部支援需要確認，但不會在站點完整時阻擋預覽", () => {
    const result = auditScheduleSafety({
      rules,
      assignments: { A: ["P1"] },
      officerStations: { O1: "B" },
      sensitiveSupportIds: ["O1"],
      trainingAssignments: [{ employeeId: "P1", stationId: "A" }],
      attendanceIds: ["P1", "O1"],
      reservedDutyIds: ["O1"],
    });

    assert.equal(result.canPreview, true);
    assert.equal(result.requiresAcknowledgement, true);
    assert.equal(result.trainingAssignments.length, 1);
    assert.equal(result.officerAssignments.length, 1);
  });
});
