import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeStationCoverage, buildSmartAssignments, solveCoverageMatching } from "../../lib/selectors";
import type { Person, Qualification, StationRule } from "../../types";

const team = "翊展班";
const person = (id: string, role = "技術員"): Person => ({
  id, name: id, role, shift: team, nationality: "本籍", employmentStatus: "在職",
});
const qualification = (employeeId: string, stationId: string, status: Qualification["status"] = "合格"): Qualification => ({
  employeeId, stationId, status,
});
const rule = (stationId: string): StationRule => ({ id: stationId, team, stationId, minRequired: 1, enabled: true });

describe("coverage correctness regressions", () => {
  it("does not offset an empty station with another station's forced overfill", () => {
    const result = analyzeStationCoverage(team, "當班", [rule("A"), rule("B")],
      [person("X"), person("Y")], [qualification("X", "A"), qualification("Y", "A")],
      new Set(), new Map([["X", "A"], ["Y", "A"]]));
    assert.equal(result.assigned, 2);
    assert.equal(result.shortage, 1);
    assert.equal(result.fullyCovered, false);
  });

  it("rejects unqualified, blocked, absent, outside-pool and unknown-station locks", () => {
    const people = [person("UNQUALIFIED"), person("BLOCKED"), person("ABSENT"), person("UNKNOWN-STATION")];
    const qualifications = [qualification("BLOCKED", "A", "不可排"), qualification("ABSENT", "A"), qualification("UNKNOWN-STATION", "A")];
    const result = solveCoverageMatching([rule("A")], people, qualifications, "當班",
      new Set(["ABSENT"]), "資格優先", new Set(), new Set(),
      new Map([["UNQUALIFIED", "A"], ["BLOCKED", "A"], ["ABSENT", "A"], ["OUTSIDER", "A"], ["UNKNOWN-STATION", "MISSING"]]));
    assert.deepEqual([...result.assignedByStation.values()].flat(), ["UNKNOWN-STATION"]);
    assert.deepEqual(result.violations.map((item) => item.code).sort(), [
      "ABSENT_ASSIGNMENT", "BLOCKED_QUALIFICATION", "OUTSIDE_ATTENDANCE", "QUALIFICATION_REQUIRED", "UNKNOWN_STATION",
    ]);
  });

  it("never accepts a conflicting blocked qualification or a duplicate person record", () => {
    const result = solveCoverageMatching([rule("A"), rule("B")],
      [person("X"), person("X")], [qualification("X", "A"), qualification("X", "A", "不可排"), qualification("X", "B")], "當班");
    assert.deepEqual(result.assignedByStation.get("A") || [], []);
    assert.deepEqual(result.assignedByStation.get("B"), ["X"]);
  });

  it("also excludes conflicting blocked qualifications from overflow assignments", () => {
    const result = buildSmartAssignments(team, "當班", [{ ...rule("A"), maxAssignable: 2 }],
      [person("Q"), person("BLOCKED")], [qualification("Q", "A"), qualification("BLOCKED", "A"), qualification("BLOCKED", "A", "不可排")]);
    assert.deepEqual(result[0].assigned.map((person) => person.id), ["Q"]);
  });

  it("retains other people's locks during critical-absence analysis", () => {
    const result = analyzeStationCoverage(team, "當班", [rule("A"), rule("B")],
      [person("X"), person("Y"), person("Z")],
      [qualification("X", "A"), qualification("X", "B"), qualification("Y", "B"), qualification("Z", "A")],
      new Set(), new Map([["X", "A"]]));
    assert.equal(result.criticalPeople.find((item) => item.employeeId === "Y")?.shortage, 1);
  });

  it("reports only new or worsened station gaps as critical-person impact", () => {
    const result = analyzeStationCoverage(team, "當班", [rule("EXISTING"), rule("NEW")],
      [person("Q")], [qualification("Q", "NEW")]);
    assert.equal(result.shortage, 1);
    assert.deepEqual(result.criticalPeople[0]?.affectedStationIds, ["NEW"]);
    assert.equal(result.criticalPeople[0]?.addedShortage, 1);
  });

  it("does not promise training benefits by moving an existing locked worker", () => {
    const result = analyzeStationCoverage(team, "當班", [rule("A"), rule("B")],
      [person("X"), person("Y"), person("T")],
      [qualification("X", "A"), qualification("X", "B"), qualification("Y", "A"), qualification("T", "B", "不可排")],
      new Set(), new Map([["X", "A"]]));
    const suggestion = result.trainingSuggestions.find((item) => item.employeeId === "T");
    assert.notEqual(suggestion?.priority, "補缺口");
    assert.ok(!suggestion?.reason.includes("缺口可少"));
    assert.ok(!result.trainingSuggestions.some((item) => item.employeeId === "X"));
  });

  it("keeps one worker per station and support priority against an independent exhaustive oracle", () => {
    const people = ["O1", "O2", "S1", "S2"].map((id) => person(id));
    const rules = ["A", "B", "C"].map(rule);
    for (let mask = 0; mask < 1 << 12; mask += 1) {
      const qualifications: Qualification[] = [];
      people.forEach((worker, personIndex) => rules.forEach((station, stationIndex) => {
        if (mask & (1 << (personIndex * 3 + stationIndex))) qualifications.push(qualification(worker.id, station.stationId));
      }));
      let best = [0, 0];
      function enumerate(index: number, used: string[]) {
        if (index === rules.length) {
          const score = [used.length, used.filter((id) => id.startsWith("S")).length];
          if (score[0] > best[0] || (score[0] === best[0] && score[1] > best[1])) best = score;
          return;
        }
        enumerate(index + 1, used);
        qualifications.filter((item) => item.stationId === rules[index].stationId && !used.includes(item.employeeId))
          .forEach((item) => enumerate(index + 1, [...used, item.employeeId]));
      }
      enumerate(0, []);
      const result = solveCoverageMatching(rules, people, qualifications, "當班", new Set(), "支援優先",
        new Set(["O1", "O2"]), new Set(["S1", "S2"]));
      const assigned = [...result.assignedByStation.values()].flat();
      assert.equal(new Set(assigned).size, assigned.length, `duplicate at mask ${mask}`);
      assert.deepEqual([assigned.length, assigned.filter((id) => id.startsWith("S")).length], best, `mask ${mask}`);
    }
  });
});
