import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Person, Qualification, StationRule } from "../../types";
import { analyzeCoverageResilience, countCombinations } from "./resilience";
import { evaluateWorkforceScenario } from "./engine";

const team = "翊展班" as const;

function person(id: string): Person {
  return {
    id,
    name: id,
    shift: team,
    role: "技術員",
    nationality: "本籍",
    employmentStatus: "在職",
  };
}

function firstDayPerson(id: string, shift: Person["shift"]): Person {
  return {
    ...person(id),
    shift,
    bDay1: shift === team ? "夜B" : "夜A",
  };
}

function rule(stationId: string): StationRule {
  return {
    id: `${team}-當班-${stationId}`,
    team,
    dayKey: "當班",
    stationId,
    minRequired: 1,
    enabled: true,
  };
}

function qualification(employeeId: string, stationId: string): Qualification {
  return { employeeId, stationId, status: "合格" };
}

describe("analyzeCoverageResilience", () => {
  it("自訂 1 人等同逐一測試所有單人缺勤", () => {
    const result = analyzeCoverageResilience({
      team,
      mode: "當班",
      people: [person("P-A"), person("P-B")],
      stationRules: [rule("A"), rule("B")],
      qualifications: [qualification("P-A", "A"), qualification("P-B", "B")],
      maxAbsences: 1,
    });

    assert.equal(result.levels[0]?.totalCombinations, 2);
    assert.equal(result.levels[0]?.testedCombinations, 2);
    assert.equal(result.levels[0]?.riskScenarios, 2);
    assert.equal(result.criticalCombinations.length, 2);
    assert.equal(result.criticalCombinations.every((item) => item.absenceCount === 1), true);
  });

  it("單人缺勤可吸收時，只標示真正的雙人關鍵組合", () => {
    const result = analyzeCoverageResilience({
      team,
      mode: "當班",
      people: [person("P-A"), person("P-B"), person("P-FLEX")],
      stationRules: [rule("A"), rule("B")],
      qualifications: [
        qualification("P-A", "A"),
        qualification("P-B", "B"),
        qualification("P-FLEX", "A"),
        qualification("P-FLEX", "B"),
      ],
      maxAbsences: 2,
    });

    assert.equal(result.levels[0]?.riskScenarios, 0);
    assert.equal(result.levels[1]?.riskScenarios, countCombinations(3, 2));
    assert.equal(result.criticalCombinations.every((item) => item.absenceCount === 2), true);
    assert.equal(result.stationRisks.every((item) => item.minAbsenceCount === 2), true);
  });

  it("補訓改善相同時，優先推薦目前合格站點較少的人", () => {
    const result = analyzeCoverageResilience({
      team,
      mode: "當班",
      people: [person("P-A"), person("P-B"), person("P-LOW"), person("P-HIGH")],
      stationRules: [rule("A"), rule("B")],
      qualifications: [
        qualification("P-A", "A"),
        qualification("P-B", "B"),
        qualification("P-HIGH", "OTHER"),
      ],
      maxAbsences: 1,
    });

    assert.equal(result.trainingSuggestions.length > 0, true);
    assert.equal(result.trainingSuggestions[0]?.employeeId, "P-LOW");
    assert.equal(result.trainingSuggestions[0]?.qualificationCount, 0);
    assert.equal(result.trainingSuggestions[0]?.priority, "預防補強");
  });

  it("全勤已有資格配置缺口時，先產生當前缺口補訓", () => {
    const result = analyzeCoverageResilience({
      team,
      mode: "當班",
      people: [person("P-LOW"), person("P-OTHER")],
      stationRules: [rule("A")],
      qualifications: [qualification("P-OTHER", "OTHER")],
      maxAbsences: 1,
    });

    assert.equal(result.baselineShortage, 1);
    assert.equal(result.trainingSuggestions[0]?.priority, "當前缺口");
    assert.equal(result.trainingSuggestions[0]?.baselineShortageReduced, 1);
  });

  it("第一天的預防補訓只推薦本班人力，不把支援人力當長期補強對象", () => {
    const result = analyzeCoverageResilience({
      team,
      mode: "第一天",
      people: [firstDayPerson("P-OWN", team), firstDayPerson("P-SUPPORT", "俊志班")],
      stationRules: [rule("A")],
      qualifications: [],
      maxAbsences: 1,
    });

    assert.equal(result.trainingSuggestions[0]?.employeeId, "P-OWN");
    assert.equal(result.trainingSuggestions.some((item) => item.employeeId === "P-SUPPORT"), false);
  });

  it("辨識多個站點共用同一小群人員的共享瓶頸", () => {
    const people = [person("P-1"), person("P-2"), person("P-3")];
    const result = analyzeCoverageResilience({
      team,
      mode: "當班",
      people,
      stationRules: [rule("A"), rule("B")],
      qualifications: people.flatMap((item) => [
        qualification(item.id, "A"),
        qualification(item.id, "B"),
      ]),
      maxAbsences: 1,
    });

    const shared = result.sharedBottlenecks.find((item) =>
      item.stationIds.length === 2 && item.stationIds.includes("A") && item.stationIds.includes("B")
    );
    assert.equal(shared?.requiredSlots, 2);
    assert.equal(shared?.qualifiedPeople, 3);
    assert.equal(shared?.reserveDepth, 1);
    assert.equal(shared?.severity, "低備援");
  });

  it("第一天支援優先配置後，顯示本班能否接手支援站點", () => {
    const result = analyzeCoverageResilience({
      team,
      mode: "第一天",
      people: [firstDayPerson("P-OWN", team), firstDayPerson("P-SUPPORT", "俊志班")],
      stationRules: [rule("A")],
      qualifications: [qualification("P-OWN", "A"), qualification("P-SUPPORT", "A")],
      maxAbsences: 1,
    });

    assert.equal(result.supportDependencies.length, 1);
    assert.equal(result.supportDependencies[0]?.supportAssigned, 1);
    assert.equal(result.supportDependencies[0]?.recoverableByOwn, 1);
    assert.equal(result.supportDependencies[0]?.addedShortageWithoutSupport, 0);
  });

  it("原始缺勤組合採抽樣時，補訓成效必須標示為估算", () => {
    const people = Array.from({ length: 25 }, (_, index) => person(`P-${String(index + 1).padStart(2, "0")}`));
    const result = analyzeCoverageResilience({
      team,
      mode: "當班",
      people,
      stationRules: [rule("A")],
      qualifications: people.slice(0, 3).map((item) => qualification(item.id, "A")),
      maxAbsences: 5,
    });

    assert.equal(result.exhaustive, false);
    assert.equal(result.trainingSuggestions.length > 0, true);
    assert.equal(result.trainingSuggestions.every((item) => item.estimated), true);
  });

  it("includes existing trainees as completion candidates but never blocked workers", () => {
    const result = analyzeCoverageResilience({
      team, mode: "當班", people: [person("Q"), person("T"), person("BLOCKED")], stationRules: [rule("A")],
      qualifications: [qualification("Q", "A"), { employeeId: "T", stationId: "A", status: "訓練中" }, { employeeId: "BLOCKED", stationId: "A", status: "不可排" }],
      maxAbsences: 1,
    });
    const completion = result.trainingSuggestions.find((item) => item.employeeId === "T");
    assert.ok(completion);
    assert.ok(Math.abs(completion.coverageRateBefore - 200 / 3) < 1e-10);
    assert.equal(completion.coverageRateAfter, 100);
    assert.equal(result.trainingSuggestions.some((item) => item.employeeId === "BLOCKED"), false);
  });

  it("includes candidate-absent cases in the common counterfactual denominator", () => {
    const result = analyzeCoverageResilience({
      team, mode: "當班", people: [person("Q"), person("T")], stationRules: [rule("A")],
      qualifications: [qualification("Q", "A")], maxAbsences: 2,
    });
    const suggestion = result.trainingSuggestions.find((item) => item.employeeId === "T");
    assert.ok(suggestion);
    assert.equal(suggestion.evaluatedScenarios, 3);
    assert.equal(suggestion.availableScenarios, 3);
    assert.ok(Math.abs(suggestion.coverageRateBefore - 100 / 3) < 1e-10);
    assert.ok(Math.abs(suggestion.coverageRateAfter - 200 / 3) < 1e-10);
    assert.equal(suggestion.estimated, false);
  });

  it("does not extrapolate candidate-present success to 100% in a capped training sample", () => {
    const people = Array.from({ length: 25 }, (_, index) => person(`P-${index}`));
    const result = analyzeCoverageResilience({ team, mode: "當班", people, stationRules: [rule("A")],
      qualifications: [qualification(people[0].id, "A")], maxAbsences: 4 });
    assert.equal(result.exhaustive, true);
    assert.equal(result.testedCombinations, 15_275);
    assert.ok(result.trainingSuggestions.length);
    for (const suggestion of result.trainingSuggestions) {
      assert.equal(suggestion.estimated, true);
      assert.equal(suggestion.evaluatedScenarios, 600);
      assert.equal(suggestion.availableScenarios, 15_275);
      assert.ok(suggestion.coverageRateAfter < 100);
      assert.ok(suggestion.coverageRateAfter >= suggestion.coverageRateBefore);
    }
  });

  it("preserves worker locks in baseline, absences and training counterfactuals", () => {
    const result = analyzeCoverageResilience({
      team, mode: "當班", people: [person("X"), person("Y"), person("T")], stationRules: [rule("A"), rule("B")],
      qualifications: [qualification("X", "A"), qualification("X", "B"), qualification("Y", "A"), { employeeId: "T", stationId: "B", status: "不可排" }],
      forcedAssignments: [{ employeeId: "X", stationId: "A" }], maxAbsences: 1,
    });
    assert.equal(result.baselineShortage, 1);
    assert.equal(result.trainingSuggestions.some((item) => item.employeeId === "T" && item.baselineShortageReduced > 0), false);
    assert.equal(result.trainingSuggestions.some((item) => item.employeeId === "X"), false);
  });

  it("counts improvement over an already-short baseline instead of freezing the after rate", () => {
    const result = analyzeCoverageResilience({ team, mode: "當班", people: [person("T"), person("OTHER")],
      stationRules: [rule("A")], qualifications: [], maxAbsences: 1 });
    const suggestion = result.trainingSuggestions.find((item) => item.employeeId === "T");
    assert.ok(suggestion);
    assert.equal(suggestion.coverageRateBefore, 0);
    assert.equal(suggestion.coverageRateAfter, 50);
  });

  it("uses the same locked training placement as the engine in all small absence cases", () => {
    const people = [person("A"), person("B"), person("FLEX"), person("T")];
    const qualifications = [qualification("A", "A"), qualification("B", "B"), qualification("FLEX", "A"), qualification("FLEX", "B")];
    const result = analyzeCoverageResilience({ team, mode: "當班", people, stationRules: [rule("A"), rule("B")], qualifications,
      forcedAssignments: [{ employeeId: "A", stationId: "A" }], maxAbsences: 2 });
    assert.ok(result.trainingSuggestions.length);
    for (const suggestion of result.trainingSuggestions) {
      let coveredBefore = 0;
      let coveredAfter = 0;
      let scenarios = 0;
      for (let mask = 1; mask < 1 << people.length; mask += 1) {
        const unavailableIds = people.filter((_, index) => mask & (1 << index)).map((person) => person.id);
        if (unavailableIds.length > 2) continue;
        const assignments = [{ employeeId: "A", stationId: "A", source: "manual" as const }].filter((item) => !unavailableIds.includes(item.employeeId));
        const snapshot = { people, qualifications, stationRules: [rule("A"), rule("B")], stations: [] };
        const before = evaluateWorkforceScenario(snapshot, { team, mode: "當班", unavailableIds, assignments });
        const after = evaluateWorkforceScenario(snapshot, { team, mode: "當班", unavailableIds, assignments: [
          ...assignments, ...(!unavailableIds.includes(suggestion.employeeId) ? [{ employeeId: suggestion.employeeId, stationId: suggestion.stationId, source: "training" as const }] : []),
        ] });
        if (before.analysis.shortage === 0) coveredBefore += 1;
        if (after.analysis.shortage === 0) coveredAfter += 1;
        scenarios += 1;
      }
      assert.equal(suggestion.evaluatedScenarios, scenarios);
      assert.equal(suggestion.coverageRateBefore, coveredBefore / scenarios * 100);
      assert.equal(suggestion.coverageRateAfter, coveredAfter / scenarios * 100);
    }
  });

  it("rejects duplicate lock entries instead of silently replacing their station", () => {
    const result = analyzeCoverageResilience({ team, mode: "當班", people: [person("X")], stationRules: [rule("A"), rule("B")],
      qualifications: [qualification("X", "A"), qualification("X", "B")], maxAbsences: 1,
      forcedAssignments: [{ employeeId: "X", stationId: "A" }, { employeeId: "X", stationId: "B" }] });
    assert.ok(result.violations.some((item) => item.code === "DUPLICATE_ASSIGNMENT"));
    assert.equal(result.baselineAssigned, 1);
  });
});
