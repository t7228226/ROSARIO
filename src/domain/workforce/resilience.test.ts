import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Person, Qualification, StationRule } from "../../types";
import { analyzeCoverageResilience, countCombinations } from "./resilience";

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
});
