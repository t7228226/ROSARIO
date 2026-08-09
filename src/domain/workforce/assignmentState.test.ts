import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StationRule } from "../../types";
import {
  appendUniqueAssignment,
  findAssignedStation,
  findDuplicateIds,
  getAssignmentSummary,
} from "./assignmentState";

const rules: StationRule[] = [
  { id: "R1", team: "翊展班", stationId: "S1", minRequired: 2 },
  { id: "R2", team: "翊展班", stationId: "S2", minRequired: 1 },
];

describe("assignmentState", () => {
  it("拒絕把同一人加入第二個站點", () => {
    const current = { S1: ["P001"], S2: [] };
    const next = appendUniqueAssignment(current, "S2", "P001");
    assert.equal(next, current);
    assert.equal(findAssignedStation(next, "P001"), "S1");
    assert.deepEqual(findDuplicateIds(next), []);
  });

  it("摘要分開呈現需求、唯一指派、重複與缺口", () => {
    const summary = getAssignmentSummary({ S1: ["P001", "P002"], S2: [] }, rules);
    assert.deepEqual(summary, {
      required: 3,
      assigned: 2,
      uniqueAssigned: 2,
      duplicates: 0,
      shortage: 1,
    });
  });

  it("能偵測既有資料中的跨站重複", () => {
    assert.deepEqual(findDuplicateIds({ S1: ["P001"], S2: ["P001"] }), ["P001"]);
  });
});
