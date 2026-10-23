import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Person, Qualification, StationRule } from "../../types";
import { buildSmartAssignments } from "../../lib/selectors";
import * as manualPlan from "./manualPlan";
import type { ManualPlanInput } from "./manualPlan";

const team = "翊展班" as const;
const person = (id: string, role = "技術員", shift: string = team): Person => ({
  id, name: id, shift, role, nationality: "本籍", employmentStatus: "在職",
  bDay1: shift === team ? "夜B" : "夜A",
});
const qualification = (employeeId: string, stationId: string, status: Qualification["status"] = "合格"): Qualification => ({ employeeId, stationId, status });
const rule = (stationId: string, minRequired = 1): StationRule => ({ id: stationId, team, stationId, minRequired, enabled: true });
const plan = (input: Partial<ManualPlanInput> = {}) => {
  assert.equal(typeof manualPlan.buildManualPlan, "function");
  return manualPlan.buildManualPlan({ team, day: "當班", rules: [rule("A"), rule("B")], people: [], qualifications: [], ...input });
};

describe("buildManualPlan", () => {
  it("uses a qualified fixed station leader at A and sends the flexible worker to B", () => {
    const result = plan({ people: [person("L", "站長"), person("X")],
      qualifications: [qualification("L", "A"), qualification("X", "A"), qualification("X", "B")], officerStations: { L: "A" } });
    assert.deepEqual(result.assignments, { A: [], B: ["X"] });
    assert.deepEqual(result.validOfficerStations, { L: "A" });
    assert.equal(result.shortage, 0);
    assert.deepEqual(result.violations, []);
    assert.equal(Object.values(result.assignments).flat().includes("L"), false);
  });

  it("excludes actual extra-duty people even when their work name is blank", () => {
    const result = plan({ rules: [rule("A")], people: [person("RESERVED"), person("FREE")],
      qualifications: [qualification("RESERVED", "A"), qualification("FREE", "A")],
      extraWorks: [{ id: "EXTRA", workName: "", personIds: ["RESERVED", "RESERVED", "UNKNOWN", "OFF-SHIFT"] }] });
    assert.deepEqual(result.assignments.A, ["FREE"]);
    assert.deepEqual(result.reservedExtraIds, ["RESERVED"]);
    assert.equal(result.shortage, 0);
  });

  it("does not invent a reserve from a named extra duty without assigned people", () => {
    const result = plan({ rules: [rule("A")], people: [person("Q")], qualifications: [qualification("Q", "A")],
      extraWorks: [{ id: "EXTRA", workName: "盤點", personIds: [] }] });
    assert.deepEqual(result.assignments.A, ["Q"]);
    assert.deepEqual(result.reservedExtraIds, []);
  });

  it("does not let an unqualified or blocked leader lock cover demand", () => {
    for (const status of ["訓練中", "不可排", ""] as const) {
      const result = plan({ rules: [rule("A")], people: [person("L", "站長"), person("Q")],
        qualifications: [qualification("L", "A", status), qualification("Q", "A")], officerStations: { L: "A" } });
      assert.deepEqual(result.validOfficerStations, {});
      assert.deepEqual(result.assignments.A, ["Q"]);
      assert.equal(result.violations[0].code, status === "不可排" ? "BLOCKED_QUALIFICATION" : "QUALIFICATION_REQUIRED");
    }
    const missing = plan({ rules: [rule("A")], people: [person("L", "站長")], officerStations: { L: "A" } });
    assert.equal(missing.shortage, 1);
  });

  it("rejects inactive, off-shift and unknown-station locks", () => {
    const result = plan({ rules: [rule("A")], people: [
      { ...person("INACTIVE", "站長"), employmentStatus: "離職" },
      person("OFF-SHIFT", "站長", "俊志班"), person("MISSING-STATION", "站長"),
    ], qualifications: [qualification("INACTIVE", "A"), qualification("OFF-SHIFT", "A"), qualification("MISSING-STATION", "A")],
    officerStations: { INACTIVE: "A", "OFF-SHIFT": "A", "MISSING-STATION": "NO-RULE" } });
    assert.deepEqual(result.validOfficerStations, {});
    assert.equal(result.shortage, 1);
    assert.deepEqual(result.violations.map((item) => item.code).sort(), ["OUTSIDE_ATTENDANCE", "OUTSIDE_ATTENDANCE", "UNKNOWN_STATION"]);
  });

  it("never uses supervisory officers or an unset station leader as automatic labor", () => {
    const people = [person("FOREMAN", "領班"), person("GROUP", "組長"), person("DIRECTOR", "主任"), person("UNSET", "站長")];
    const result = plan({ rules: [rule("A")], people, qualifications: people.map((person) => qualification(person.id, "A")),
      officerStations: { FOREMAN: "A", UNSET: "" } });
    assert.deepEqual(result.assignments.A, []);
    assert.deepEqual(result.validOfficerStations, {});
    assert.equal(result.shortage, 1);
    assert.equal(result.violations[0].code, "INVALID_OFFICER_ASSIGNMENT");
  });

  it("does not count a fixed leader twice when also reserved for an extra duty", () => {
    const result = plan({ rules: [rule("A")], people: [person("L", "站長")], qualifications: [qualification("L", "A")],
      officerStations: { L: "A" }, extraWorks: [{ id: "EXTRA", workName: "X", personIds: ["L"] }] });
    assert.deepEqual(result.validOfficerStations, {});
    assert.deepEqual(result.assignments.A, []);
    assert.equal(result.shortage, 1);
    assert.equal(result.violations[0].code, "DUPLICATE_ASSIGNMENT");
  });

  it("preserves support-first and own-shift-first modes for residual demand", () => {
    const input = { day: "第一天" as const, rules: [rule("A")],
      people: [person("OWN"), person("SUPPORT", "技術員", "俊志班")],
      qualifications: [qualification("OWN", "A"), qualification("SUPPORT", "A")], options: { randomize: true } };
    assert.deepEqual(plan({ ...input, mode: "支援優先" }).assignments.A, ["SUPPORT"]);
    assert.deepEqual(plan({ ...input, mode: "當班優先" }).assignments.A, ["OWN"]);
  });

  it("deducts leader placements from maxAssignable without exceeding total capacity", () => {
    const result = plan({ rules: [{ ...rule("A"), maxAssignable: 2 }],
      people: [person("L", "站長"), person("X"), person("Y")],
      qualifications: [qualification("L", "A"), qualification("X", "A"), qualification("Y", "A")], officerStations: { L: "A" } });
    assert.equal(result.assignments.A.length, 1);
    assert.equal(result.assignments.A.length + Object.keys(result.validOfficerStations).length, 2);
    assert.equal(result.shortage, 0);
  });

  it("does not create overflow capacity when the original rule did not enable it", () => {
    const result = plan({ rules: [rule("A")], people: [person("L", "站長"), person("X")],
      qualifications: [qualification("L", "A"), qualification("X", "A")], officerStations: { L: "A" }, options: { randomize: true } });
    assert.deepEqual(result.assignments.A, []);
    assert.equal(result.shortage, 0);
  });

  it("matches existing deterministic planning when no locks or reservations are present", () => {
    const input: ManualPlanInput = { team, day: "當班", rules: [{ ...rule("A"), maxAssignable: 3 }, rule("B")],
      people: [person("X"), person("Y"), person("Z")],
      qualifications: [qualification("X", "A"), qualification("X", "B"), qualification("Y", "A"), qualification("Z", "A")],
      mode: "資格優先", options: { useMinRequired: true, randomize: false } };
    const original = buildSmartAssignments(input.team, input.day, input.rules, input.people, input.qualifications, input.mode, input.options);
    const snapshot = structuredClone(input);
    assert.deepEqual(plan(input).assignments, Object.fromEntries(original.map((row) => [row.stationId, row.assigned.map((person) => person.id)])));
    assert.deepEqual(input, snapshot);
  });
});
