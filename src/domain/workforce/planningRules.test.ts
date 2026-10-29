import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppBootstrap, Person, Qualification, StationRule } from "../../types";
import { analyzeStationCoverage, buildSmartAssignments, solveCoverageMatching } from "../../lib/selectors";
import { evaluateWorkforceScenario } from "./engine";
import { buildManualPlan } from "./manualPlan";
import { analyzeCoverageResilience } from "./resilience";
import { resolvePlanningRules, type PlanningRule } from "./planningRules";

const team = "翊展班" as const;
const person = (id: string, role = "技術員", shift: string = team): Person => ({
  id, name: id, role, shift, nationality: "本籍", employmentStatus: "在職", bDay1: shift === team ? "夜B" : "夜A",
});
const rule = (stationId: string, minRequired = 1): StationRule => ({ id: stationId, stationId, team, minRequired, enabled: true });
const qualified = (employeeId: string, stationId: string, status: Qualification["status"] = "合格"): Qualification => ({ employeeId, stationId, status });
const plan = (employeeId: string, mode: PlanningRule["mode"], ...stationIds: string[]): PlanningRule => ({ employeeId, mode, stationIds });
const snapshot = (people: Person[], qualifications: Qualification[], stationRules = [rule("A"), rule("B")]): AppBootstrap => ({
  people, qualifications, stationRules, stations: stationRules.map((item) => ({ id: item.stationId, name: item.stationId, normalMin: item.minRequired, reliefMinPerBatch: 1 })),
});
const evaluate = (data: AppBootstrap, planningRules: PlanningRule[], unavailableIds: string[] = []) =>
  evaluateWorkforceScenario(data, { team, mode: "當班", planningRules, unavailableIds });

describe("resolvePlanningRules", () => {
  it("warns and skips stale, absent, off-shift, unqualified and blocked fixed rules without mutating inputs", () => {
    const data = snapshot([person("absent"), person("off", "技術員", "俊志班"), person("trainee"), person("blocked"), person("stale"), person("multi")], [
      qualified("absent", "A"), qualified("trainee", "A", "訓練中"), qualified("blocked", "A"), qualified("blocked", "A", "不可排"),
    ]);
    const input = { ...data, team, mode: "當班" as const, unavailableIds: ["absent"], planningRules: [
      plan("unknown", "fixed", "A"), plan("absent", "fixed", "A"), plan("off", "fixed", "A"),
      plan("trainee", "fixed", "A"), plan("blocked", "fixed", "A"), plan("stale", "fixed", "removed"), plan("multi", "fixed", "A", "B"),
    ] };
    const original = structuredClone(input);
    const result = resolvePlanningRules(input);
    assert.equal(result.fixedAssignments.size, 0);
    assert.deepEqual(result.validRules, []);
    assert.deepEqual(result.warnings.map((item) => item.code), ["UNKNOWN_PERSON", "ABSENT_RULE", "OUTSIDE_ATTENDANCE", "QUALIFICATION_REQUIRED", "BLOCKED_QUALIFICATION", "UNKNOWN_STATION", "INVALID_RULE"]);
    assert.deepEqual(input, original);
  });

  it("keeps unqualified allowed targets for future training, and stale-only allowed lists cannot become unrestricted", () => {
    const data = snapshot([person("P")], [qualified("P", "A")]);
    const allowed = resolvePlanningRules({ ...data, team, planningRules: [plan("P", "allowed", "B", "removed")] });
    assert.deepEqual(allowed.validRules, [plan("P", "allowed", "B")]);
    assert.deepEqual(allowed.warnings.map((item) => item.code), ["UNKNOWN_STATION", "QUALIFICATION_REQUIRED"]);
    const result = evaluate(data, [plan("P", "allowed", "removed")]);
    assert.equal(result.analysis.assigned, 0);
    assert.equal(result.analysis.shortage, 2);
    assert.ok(result.planningWarnings.some((item) => item.code === "UNKNOWN_STATION"));
    assert.equal(result.analysis.trainingSuggestions.some((item) => item.employeeId === "P"), false);
  });

  it("normalizes duplicate stations, reports duplicate employees, and gives reserved duty precedence over overrides", () => {
    const data = snapshot([person("P"), person("R")], [qualified("P", "A"), qualified("R", "A")]);
    const result = resolvePlanningRules({ ...data, team, planningRules: [plan("P", "fixed", " A ", "A"), plan("P", "preferred", "B"), plan("R", "fixed", "A")],
      reservedEmployeeIds: ["R"], overrideEmployeeIds: ["R"] });
    assert.deepEqual(result.validRules, [plan("P", "fixed", "A")]);
    assert.deepEqual([...result.fixedAssignments], [["P", "A"]]);
    assert.deepEqual(result.warnings.map((item) => item.code), ["DUPLICATE_RULE", "RESERVED_DUTY"]);
  });
});

describe("planning rules in matching and scenarios", () => {
  const data = snapshot([person("flex"), person("onlyA"), person("officer", "領班")], [
    qualified("flex", "A"), qualified("flex", "B"), qualified("onlyA", "A"), qualified("officer", "B"),
  ]);

  it("fixed regular workers reveal the flex trap and a fixed officer is explicit emergency support", () => {
    const fixed = evaluate(data, [plan("flex", "fixed", "A")]);
    assert.equal(fixed.analysis.shortage, 1);
    assert.deepEqual(fixed.assignments.A, ["flex"]);
    const emergency = evaluate(data, [plan("flex", "fixed", "A"), plan("officer", "fixed", "B")]);
    assert.equal(emergency.analysis.shortage, 0);
    assert.equal(emergency.reasons.find((item) => item.employeeId === "officer")?.source, "officer");
    assert.equal(new Set(Object.values(emergency.assignments).flat()).size, 2);
  });

  it("manual, officer and training assignments override same-person presets without turning a fixed rule into training", () => {
    const manual = evaluateWorkforceScenario(data, { team, mode: "當班", planningRules: [plan("flex", "allowed", "A")],
      assignments: [{ employeeId: "flex", stationId: "B", source: "manual" }] });
    assert.deepEqual(manual.assignments.B, ["flex"]);
    assert.equal(manual.analysis.shortage, 0);
    assert.equal(manual.planningWarnings[0]?.code, "RULE_OVERRIDDEN");
    const officer = evaluateWorkforceScenario(data, { team, mode: "當班", planningRules: [plan("officer", "fixed", "A")],
      assignments: [{ employeeId: "officer", stationId: "B", source: "officer" }] });
    assert.equal(officer.reasons.find((item) => item.employeeId === "officer")?.source, "officer");
    const traineeData = snapshot([person("T")], [qualified("T", "A", "訓練中")], [rule("A")]);
    assert.equal(evaluate(traineeData, [plan("T", "fixed", "A")]).analysis.shortage, 1);
    const trained = evaluateWorkforceScenario(traineeData, { team, mode: "當班", planningRules: [plan("T", "fixed", "B")],
      assignments: [{ employeeId: "T", stationId: "A", source: "training" }] });
    assert.equal(trained.analysis.shortage, 0);
    assert.equal(trained.reasons[0].source, "training");
    assert.equal(traineeData.qualifications[0].status, "訓練中");
  });

  it("inactive fixed warnings alone do not mark coverage invalid, but invalid explicit assignments still do", () => {
    const absent = evaluate(data, [plan("onlyA", "fixed", "A"), plan("removed", "fixed", "A")], ["onlyA"]);
    assert.equal(absent.analysis.shortage, 1);
    const full = evaluate(data, [plan("removed", "fixed", "A"), plan("officer", "fixed", "removed")]);
    assert.equal(full.analysis.fullyCovered, true);
    assert.deepEqual(full.violations, []);
    const invalid = evaluateWorkforceScenario(data, { team, mode: "當班", planningRules: [plan("onlyA", "fixed", "A")],
      assignments: [{ employeeId: "onlyA", stationId: "B", source: "manual" }] });
    assert.equal(invalid.analysis.fullyCovered, false);
    assert.equal(invalid.violations[0].code, "QUALIFICATION_REQUIRED");
  });

  it("preferred station order is soft, never displaces required coverage, and first-day support priority stays absolute", () => {
    const flexible = snapshot([person("F")], [qualified("F", "A"), qualified("F", "B")]);
    assert.deepEqual(evaluate(flexible, [plan("F", "preferred", "B")]).assignments.B, ["F"]);
    flexible.people.push(person("B")); flexible.qualifications.push(qualified("B", "B"));
    assert.equal(evaluate(flexible, [plan("F", "preferred", "B")]).analysis.shortage, 0);
    assert.deepEqual(evaluate(flexible, [plan("F", "preferred", "B")]).assignments.A, ["F"]);
    const first = snapshot([person("OWN"), person("SUP", "技術員", "俊志班")], [qualified("OWN", "A"), qualified("SUP", "A")], [rule("A")]);
    const result = evaluateWorkforceScenario(first, { team, mode: "第一天", planningRules: [plan("OWN", "preferred", "A")] });
    assert.deepEqual(result.assignments.A, ["SUP"]);
  });

  it("all analysis counterfactuals retain allowed edges and fixed locks", () => {
    const result = analyzeStationCoverage(team, "當班", data.stationRules!, data.people, data.qualifications, new Set(), new Map(), {
      excludeOfficersFromCoverage: true, planningRules: [plan("flex", "fixed", "A"), plan("officer", "allowed", "A"), plan("onlyA", "allowed", "A")],
    });
    assert.equal(result.shortage, 1);
    assert.equal(result.officerSuggestions.length, 0);
    assert.equal(result.trainingSuggestions.some((item) => item.stationId === "B"), false);
    assert.equal(result.criticalPeople.some((item) => item.employeeId === "onlyA"), false);
    const overflow = buildSmartAssignments(team, "當班", [{ ...rule("A"), maxAssignable: 3 }],
      [person("P")], [qualified("P", "A")], "當班優先", { planningRules: [plan("P", "allowed")] });
    assert.deepEqual(overflow[0].assigned, []);
  });
});

// Independent exhaustive assignment enumeration: maximize filled slots, then support usage.
function oracle(edges: string[][], plans: PlanningRule[], support: Set<string>, unavailable: Set<string>) {
  let best = [0, 0];
  function visit(index: number, occupied: Set<string>, preferred: number) {
    if (index === edges.length) {
      if (occupied.size > best[0] || (occupied.size === best[0] && preferred > best[1])) best = [occupied.size, preferred];
      return;
    }
    const id = `P${index}`;
    if (unavailable.has(id)) { visit(index + 1, occupied, preferred); return; }
    const restriction = plans.find((item) => item.employeeId === id);
    const choices = edges[index].filter((stationId) => !restriction || restriction.mode === "preferred" || restriction.stationIds.includes(stationId));
    if (restriction?.mode !== "fixed") visit(index + 1, occupied, preferred);
    for (const stationId of choices) {
      if (occupied.has(stationId)) continue;
      occupied.add(stationId); visit(index + 1, occupied, preferred + Number(support.has(id))); occupied.delete(stationId);
    }
  }
  visit(0, new Set(), 0);
  return best;
}

it("matches an exhaustive oracle with hard edges, fixed rules, preferences, absences and support-first admission", () => {
  const people = [person("P0"), person("P1"), person("P2")];
  const rules = [rule("A"), rule("B"), rule("C")];
  const support = new Set(["P0", "P2"]);
  for (let graph = 0; graph < 512; graph++) {
    const edges = people.map((_, index) => rules.filter((_, station) => graph & (1 << (index * 3 + station))).map((item) => item.stationId));
    const qualifications = edges.flatMap((stations, index) => stations.map((stationId) => qualified(`P${index}`, stationId)));
    for (const allowed of [["A", "B"], ["C"], []]) {
      const plans = [plan("P0", "allowed", ...allowed), plan("P1", "preferred", "C", "B")];
      if (edges[2].length && graph % 2) plans.push(plan("P2", "fixed", edges[2][0]));
      const unavailable = new Set(graph % 3 === 0 ? ["P1"] : []);
      const result = solveCoverageMatching(rules, people, qualifications, "第一天", unavailable, "支援優先", new Set(["P1"]), support, new Map(), false, plans);
      const ids = [...result.assignedByStation.values()].flat();
      assert.deepEqual([ids.length, ids.filter((id) => support.has(id)).length], oracle(edges, plans, support, unavailable), `graph=${graph} allowed=${allowed}`);
      assert.equal(ids.length, new Set(ids).size);
    }
  }
});

describe("shared planning rules in manual and resilience", () => {
  it("manual integrates regular/leader fixed rules but preserves supervisory duty instead of importing analysis emergency support", () => {
    const data = snapshot([person("R"), person("L", "站長"), person("O", "領班"), person("T")], [
      qualified("R", "A"), qualified("R", "B"), qualified("L", "B"), qualified("O", "C"), qualified("T", "A", "訓練中"),
    ], [rule("A"), rule("B"), rule("C")]);
    const result = buildManualPlan({ team, day: "當班", rules: data.stationRules!, people: data.people, qualifications: data.qualifications,
      planningRules: [plan("R", "fixed", "A"), plan("L", "fixed", "B"), plan("O", "fixed", "C")] });
    assert.deepEqual(result.assignments, { A: ["R"], B: [], C: [] });
    assert.deepEqual(result.validOfficerStations, { L: "B" });
    assert.equal(result.shortage, 1);
    assert.ok(result.planningWarnings.some((item) => item.employeeId === "O" && item.code === "SUPERVISORY_DUTY"));
    const ids = [...Object.values(result.assignments).flat(), ...Object.keys(result.validOfficerStations)];
    assert.equal(ids.length, new Set(ids).size);
    assert.equal(ids.includes("T"), false);
    const evaluated = evaluate(data, [plan("R", "fixed", "A"), plan("L", "fixed", "B"), plan("O", "fixed", "C")]);
    assert.equal(evaluated.analysis.shortage, 0, "Analysis alone may explicitly activate fixed emergency officers");
  });

  it("manual station leaders override presets, and extra duties override both with clear conflicts", () => {
    const data = snapshot([person("L", "站長"), person("R")], [qualified("L", "A"), qualified("L", "B"), qualified("R", "A"), qualified("R", "B")]);
    const input = { team, day: "當班" as const, rules: data.stationRules!, people: data.people, qualifications: data.qualifications,
      officerStations: { L: "A" }, planningRules: [plan("L", "fixed", "B"), plan("R", "fixed", "B")] };
    const overridden = buildManualPlan(input);
    assert.deepEqual(overridden.validOfficerStations, { L: "A" });
    assert.deepEqual(overridden.assignments.B, ["R"]);
    assert.ok(overridden.planningWarnings.some((item) => item.employeeId === "L" && item.code === "RULE_OVERRIDDEN"));
    const reserved = buildManualPlan({ ...input, extraWorks: [{ id: "duty", workName: "", personIds: ["L", "R"] }] });
    assert.deepEqual(reserved.validOfficerStations, {});
    assert.deepEqual(Object.values(reserved.assignments).flat(), []);
    assert.equal(reserved.violations[0].code, "DUPLICATE_ASSIGNMENT");
    assert.equal(reserved.planningWarnings.filter((item) => item.code === "RESERVED_DUTY").length, 2);
  });

  it("manual residual overflow respects regular fixed capacity and never uses training qualifications", () => {
    const data = snapshot([person("F"), person("Q"), person("T")], [qualified("F", "A"), qualified("Q", "A"), qualified("T", "A", "訓練中")], [{ ...rule("A"), maxAssignable: 2 }]);
    const result = buildManualPlan({ team, day: "當班", rules: data.stationRules!, people: data.people, qualifications: data.qualifications, planningRules: [plan("F", "fixed", "A")] });
    assert.deepEqual(result.assignments.A, ["F", "Q"]);
    assert.equal(result.shortage, 0);
  });

  it("resilience baseline and all one/two-person absence rates agree with scenario evaluation", () => {
    const data = snapshot([person("F"), person("A"), person("B"), person("O", "領班")], [
      qualified("F", "A"), qualified("F", "B"), qualified("A", "A"), qualified("B", "B"), qualified("O", "B"),
    ]);
    const planningRules = [plan("F", "allowed", "A"), plan("A", "preferred", "A"), plan("O", "fixed", "B")];
    const baseline = evaluate(data, planningRules);
    const result = analyzeCoverageResilience({ ...data, stationRules: data.stationRules!, team, mode: "當班", maxAbsences: 2, planningRules });
    assert.equal(result.baselineShortage, baseline.analysis.shortage);
    for (const count of [1, 2]) {
      const absences = data.people.flatMap((p, i) => count === 1 ? [[p.id]] : data.people.slice(i + 1).map((next) => [p.id, next.id]));
      const expected = absences.map((unavailable) => evaluate(data, planningRules, unavailable).analysis.shortage);
      const level = result.levels.find((item) => item.absenceCount === count)!;
      assert.equal(level.fullyCoveredScenarios, expected.filter((shortage) => shortage === 0).length);
      assert.equal(level.baselineMaintainedScenarios, expected.filter((shortage) => shortage <= baseline.analysis.shortage).length);
    }
    const absentFixed = analyzeCoverageResilience({ ...data, stationRules: data.stationRules!, team, mode: "當班", maxAbsences: 1, planningRules, unavailableIds: ["O"] });
    assert.equal(absentFixed.violations.length, 0);
    assert.ok(absentFixed.planningWarnings.some((item) => item.code === "ABSENT_RULE"));
  });

  it("neither analysis nor resilience suggests training outside allowed targets", () => {
    const data = snapshot([person("Q"), person("T")], [qualified("Q", "A"), qualified("T", "B", "訓練中")]);
    const planningRules = [plan("T", "allowed", "A"), plan("Q", "allowed", "A")];
    const analysis = evaluate(data, planningRules);
    const resilience = analyzeCoverageResilience({ ...data, stationRules: data.stationRules!, team, mode: "當班", maxAbsences: 1, planningRules });
    assert.equal(analysis.analysis.trainingSuggestions.some((item) => item.stationId === "B"), false);
    assert.equal(resilience.trainingSuggestions.some((item) => item.stationId === "B"), false);
    const permitted = analyzeCoverageResilience({ ...data, stationRules: data.stationRules!, team, mode: "當班", maxAbsences: 1,
      planningRules: [plan("T", "allowed", "B")] });
    assert.ok(permitted.trainingSuggestions.some((item) => item.employeeId === "T" && item.stationId === "B" && item.baselineShortageReduced === 1));
  });
});
