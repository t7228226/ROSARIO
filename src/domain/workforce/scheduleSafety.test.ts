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
      rules: rules.map((rule) => ({ ...rule, trainingCanFill: true })),
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

  it("separates physical placements, formal qualifications and permitted trainees", () => {
    const result = auditScheduleSafety({
      rules: [{ stationId: "A", minRequired: 2, trainingCanFill: true }],
      assignments: { A: ["Q", "T"] }, attendanceIds: ["Q", "T"],
      qualifications: [{ employeeId: "Q", stationId: "A", status: "合格" }, { employeeId: "T", stationId: "A", status: "訓練中" }],
    });
    assert.equal(result.canPreview, true);
    assert.deepEqual(result.stationChecks[0], { stationId: "A", required: 2, assigned: 2, qualified: 1, training: 1, eligibleTraining: 1, covered: 2, shortage: 0 });
    assert.equal(result.requiresAcknowledgement, true);
  });

  it("blocks training from satisfying a rule that does not allow it", () => {
    const result = auditScheduleSafety({
      rules: [{ stationId: "A", minRequired: 1, trainingCanFill: false }], assignments: { A: ["T"] },
      qualifications: [{ employeeId: "T", stationId: "A", status: "訓練中" }], attendanceIds: ["T"],
    });
    assert.equal(result.canPreview, false);
    assert.equal(result.stationChecks[0].qualified, 0);
    assert.equal(result.stationChecks[0].training, 1);
    assert.equal(result.stationChecks[0].covered, 0);
    assert.equal(result.totalShortage, 1);
  });

  it("checks station-leader qualifications and detects trainees without caller labels", () => {
    const result = auditScheduleSafety({
      rules, assignments: { A: ["T"] }, officerStations: { L: "B" }, attendanceIds: ["T", "L"],
      qualifications: [{ employeeId: "T", stationId: "A", status: "訓練中" }, { employeeId: "L", stationId: "B", status: "不可排" }],
    });
    assert.equal(result.canPreview, false);
    assert.equal(result.totalShortage, 2);
    assert.equal(result.trainingAssignments.length, 1);
    assert.ok(result.invalidAssignments.some((item) => item.employeeId === "L" && item.code === "BLOCKED_QUALIFICATION"));
  });

  it("does not count unavailable, out-of-attendance or inactive people even in extra duties", () => {
    const result = auditScheduleSafety({
      rules, assignments: { A: ["ABSENT"], B: ["OUTSIDER"] }, attendanceIds: ["ABSENT", "INACTIVE"],
      unavailableIds: ["ABSENT"], extraWorks: [{ id: "X", workName: "X", personIds: ["INACTIVE"] }],
      qualifications: [{ employeeId: "ABSENT", stationId: "A", status: "合格" }, { employeeId: "OUTSIDER", stationId: "B", status: "合格" }],
      people: [
        { id: "ABSENT", role: "技術員", employmentStatus: "在職" },
        { id: "OUTSIDER", role: "技術員", employmentStatus: "在職" },
        { id: "INACTIVE", role: "技術員", employmentStatus: "離職" },
      ],
    });
    assert.equal(result.totalShortage, 2);
    assert.equal(result.invalidAssignments.length, 3);
    assert.equal(result.canPreview, false);
    assert.deepEqual(result.unassignedIds, []);
  });

  it("treats explicit empty qualification and attendance lists as authoritative", () => {
    const result = auditScheduleSafety({ rules: [rules[0]], assignments: { A: ["Q"] }, qualifications: [], attendanceIds: [] });
    assert.equal(result.canPreview, false);
    assert.equal(result.stationChecks[0].covered, 0);
    assert.equal(result.qualificationVerified, true);
    assert.equal(result.attendanceVerified, true);
  });

  it("requires acknowledgement for known support officers without a separate caller label", () => {
    const result = auditScheduleSafety({ rules: [rules[0]], assignments: {}, officerStations: { O: "A" },
      attendanceIds: ["O"], qualifications: [{ employeeId: "O", stationId: "A", status: "合格" }],
      people: [{ id: "O", role: "領班", employmentStatus: "在職" }] });
    assert.equal(result.canPreview, true);
    assert.equal(result.requiresAcknowledgement, true);
    assert.deepEqual(result.officerAssignments, [{ employeeId: "O", stationId: "A" }]);
  });
});
