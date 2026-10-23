import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitAlternatingRotationGroups, splitBalancedRotationRows } from "./rotationGroups";
import * as rotation from "./rotationGroups";
import type { ScheduleSafetyInput } from "./scheduleSafety";

describe("splitAlternatingRotationGroups", () => {
  it("依原順序交錯分配到 A、B 組", () => {
    const result = splitAlternatingRotationGroups(["甲", "乙", "丙", "丁", "戊"]);

    assert.deepEqual(result.groupA, ["甲", "丙", "戊"]);
    assert.deepEqual(result.groupB, ["乙", "丁"]);
  });

  it("空名單會產生兩個空組別", () => {
    assert.deepEqual(splitAlternatingRotationGroups([]), { groupA: [], groupB: [] });
  });

  it("每位人員只會出現在其中一組", () => {
    const people = ["A", "B", "C", "D", "E", "F"];
    const result = splitAlternatingRotationGroups(people);

    assert.deepEqual([...result.groupA, ...result.groupB].sort(), [...people].sort());
    assert.equal(new Set([...result.groupA, ...result.groupB]).size, people.length);
  });

  it("可指定由 B 組開始交錯", () => {
    const result = splitAlternatingRotationGroups(["甲", "乙", "丙"], "B");

    assert.deepEqual(result.groupA, ["乙"]);
    assert.deepEqual(result.groupB, ["甲", "丙"]);
  });
});

describe("auditRotationCoverage", () => {
  const rules = ["A", "B"].map((stationId) => ({ stationId, minRequired: 1, reliefMinPerBatch: 1 }));
  const qualifications = ["A", "B"].flatMap((stationId) => [1, 2].map((index) => ({
    employeeId: `${stationId}${index}`, stationId, status: "合格" as const,
  })));
  const audit = (input: ScheduleSafetyInput) => {
    assert.equal(typeof rotation.auditRotationCoverage, "function");
    return rotation.auditRotationCoverage(input);
  };

  it("does not claim relief coverage from full-attendance minimum coverage", () => {
    const result = audit({ rules, assignments: { A: ["A1"], B: ["B1"] }, qualifications, attendanceIds: ["A1", "B1"] });
    assert.equal(result.canRotate, false);
    assert.equal(result.requiredPerGroup, 2);
    assert.equal(result.totalShortage, 2);
    assert.deepEqual(result.rows, [
      { stationId: "A", groupA: ["A1"], groupB: [] },
      { stationId: "B", groupA: [], groupB: ["B1"] },
    ]);
  });

  it("checks each group against relief demand, not minRequired", () => {
    const result = audit({ rules: rules.map((rule) => ({ ...rule, minRequired: 4 })),
      assignments: { A: ["A1", "A2"], B: ["B1", "B2"] }, qualifications, attendanceIds: ["A1", "A2", "B1", "B2"] });
    assert.equal(result.canRotate, true);
    assert.equal(result.groupA.totalShortage, 0);
    assert.equal(result.groupB.totalShortage, 0);
    assert.equal(result.groupA.requiredStationSlots, 2);
  });

  it("does not reshuffle a trainee into a different group to hide missing qualifications", () => {
    const input = { rules: [rules[0]], assignments: { A: ["T", "A1"] }, attendanceIds: ["T", "A1"],
      qualifications: [...qualifications, { employeeId: "T", stationId: "A", status: "訓練中" as const }] };
    const denied = audit(input);
    assert.equal(denied.canRotate, false);
    assert.deepEqual(denied.rows[0].groupA, ["T"]);
    assert.equal(denied.groupA.stationChecks[0].qualified, 0);
    const allowed = audit({ ...input, rules: [{ ...rules[0], trainingCanFill: true }] });
    assert.equal(allowed.canRotate, true);
    assert.equal(allowed.groupA.stationChecks[0].eligibleTraining, 1);
    assert.equal(allowed.groupA.requiresAcknowledgement, true);
  });

  it("rejects a person placed in different groups or absent from the attendance proof", () => {
    const duplicate = audit({ rules, assignments: { A: ["A1"], B: ["A1"] }, qualifications, attendanceIds: ["A1"] });
    assert.equal(duplicate.canRotate, false);
    assert.ok(duplicate.blockingIssues.some((issue) => issue.includes("重複")));
    const absent = audit({ rules: [rules[0]], assignments: { A: ["A1", "A2"] }, qualifications,
      attendanceIds: ["A1", "A2"], unavailableIds: ["A2"] });
    assert.equal(absent.canRotate, false);
    assert.equal(absent.groupB.totalShortage, 1);
  });

  it("requires authoritative attendance, qualifications and configured relief demand", () => {
    const input = { rules: [rules[0]], assignments: { A: ["A1", "A2"] }, qualifications, attendanceIds: ["A1", "A2"] };
    assert.equal(audit({ ...input, qualifications: undefined }).canRotate, false);
    assert.equal(audit({ ...input, attendanceIds: undefined }).canRotate, false);
    assert.equal(audit({ ...input, rules: [{ stationId: "A", minRequired: 1 }] }).canRotate, false);
  });

  it("audits the exact preview order including extra work without moving people", () => {
    const input = {
      rules, assignments: { A: ["A1", "A2"], B: ["B1", "B2"] }, qualifications,
      attendanceIds: ["A1", "A2", "B1", "B2", "EXTRA"],
      extraWorks: [{ id: "EXTRA-WORK", workName: "X", personIds: ["EXTRA"] }],
      rows: [
        { stationId: "EXTRA-WORK", people: [{ employeeId: "EXTRA", name: "same" }] },
        { stationId: "B", people: [{ employeeId: "B2", name: "same" }, { employeeId: "B1", name: "same" }] },
        { stationId: "A", people: [{ employeeId: "A2", name: "same" }, { employeeId: "A1", name: "same" }] },
      ],
    };
    const result = rotation.auditRotationCoverage(input);
    assert.equal(result.canRotate, true);
    const expected = splitBalancedRotationRows(input.rows.map((row) => row.people.map((person) => person.employeeId)));
    assert.deepEqual(result.rows, input.rows.map((row, index) => ({ stationId: row.stationId, ...expected[index] })));
    assert.equal(new Set(result.rows.flatMap((row) => [...row.groupA, ...row.groupB])).size, 5);
    const missingPreviewPerson = rotation.auditRotationCoverage({ ...input, rows: input.rows.slice(1) });
    assert.equal(missingPreviewPerson.canRotate, false);
    assert.ok(missingPreviewPerson.blockingIssues.some((issue) => issue.includes("不一致")));
  });

  it("requires formal qualification for station leaders and explicit support for other officers", () => {
    const input = {
      rules: [rules[0]], assignments: { A: ["A1"] }, officerStations: { L: "A" },
      qualifications: [...qualifications, { employeeId: "L", stationId: "A", status: "合格" as const }],
      attendanceIds: ["A1", "L"], people: [
        { id: "A1", role: "技術員", employmentStatus: "在職" }, { id: "L", role: "站長", employmentStatus: "在職" },
      ],
    };
    assert.equal(audit(input).canRotate, true);
    assert.equal(audit({ ...input, qualifications }).canRotate, false);
    const unapprovedOfficer = audit({ ...input, assignments: { A: ["A1", "L"] }, officerStations: {},
      people: input.people.map((person) => person.id === "L" ? { ...person, role: "領班" } : person) });
    assert.equal(unapprovedOfficer.canRotate, false);
  });
});

describe("splitBalancedRotationRows", () => {
  it("多站點含奇數人時會平衡全班 A、B 總人數", () => {
    const rows = [
      ["甲", "乙", "丙", "丁"],
      ["戊"],
      ["己", "庚", "辛"],
      ["壬"],
    ];
    const result = splitBalancedRotationRows(rows);
    const groupA = result.flatMap((groups) => groups.groupA);
    const groupB = result.flatMap((groups) => groups.groupB);

    assert.ok(Math.abs(groupA.length - groupB.length) <= 1);
    assert.deepEqual([...groupA, ...groupB].sort(), rows.flat().sort());
    assert.equal(new Set([...groupA, ...groupB]).size, rows.flat().length);
  });
});
