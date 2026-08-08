import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AppBootstrap,
  Person,
  Qualification,
  Station,
  StationRule,
} from "../../types";
import { getReliefRuleNeed, getRuleNeed } from "../../lib/selectors";
import { evaluateWorkforceScenario } from "./engine";

const team = "翊展班" as const;

function person(id: string, role = "技術員", shift = team): Person {
  return {
    id,
    name: id,
    shift,
    role,
    nationality: "本籍",
    employmentStatus: "在職",
  };
}

function firstDayPerson(id: string, shift: Person["shift"]): Person {
  return {
    ...person(id, "技術員", shift),
    bDay1: shift === team ? "夜B" : "夜A",
  };
}

function station(id: string): Station {
  return {
    id,
    name: id,
    normalMin: 1,
    reliefMinPerBatch: 1,
  };
}

function rule(stationId: string, minRequired = 1): StationRule {
  return {
    id: `${team}-當班-${stationId}`,
    team,
    dayKey: "當班",
    stationId,
    minRequired,
    enabled: true,
  };
}

function qualification(
  employeeId: string,
  stationId: string,
  status: Qualification["status"] = "合格"
): Qualification {
  return { employeeId, stationId, status };
}

function snapshot(
  people: Person[],
  qualifications: Qualification[],
  stationIds = ["A", "B"]
): AppBootstrap {
  return {
    people,
    stations: stationIds.map(station),
    qualifications,
    stationRules: stationIds.map((stationId) => rule(stationId)),
  };
}

describe("evaluateWorkforceScenario", () => {
  it("第一天與第二天只改變出勤人員，站點分析仍使用最低需求", () => {
    const stationRule: StationRule = {
      ...rule("A", 4),
      reliefMinPerBatch: 1,
    };

    assert.equal(getRuleNeed(stationRule, "當班"), 4);
    assert.equal(getRuleNeed(stationRule, "第一天"), 4);
    assert.equal(getRuleNeed(stationRule, "第二天"), 4);
    assert.equal(getReliefRuleNeed(stationRule), 1);
  });

  it("使用最大匹配保留彈性人員並完整覆蓋兩站", () => {
    const data = snapshot(
      [person("P-FLEX"), person("P-RARE")],
      [
        qualification("P-FLEX", "A"),
        qualification("P-FLEX", "B"),
        qualification("P-RARE", "A"),
      ]
    );

    const result = evaluateWorkforceScenario(data, { team, mode: "當班" });

    assert.equal(result.analysis.shortage, 0);
    assert.deepEqual(result.assignments.A, ["P-RARE"]);
    assert.deepEqual(result.assignments.B, ["P-FLEX"]);
  });

  it("第一天先配置支援人力，保留本班人力作為備援", () => {
    const data = snapshot(
      [firstDayPerson("P-OWN", team), firstDayPerson("P-SUPPORT", "俊志班")],
      [qualification("P-OWN", "A"), qualification("P-SUPPORT", "A")],
      ["A"]
    );

    const result = evaluateWorkforceScenario(data, { team, mode: "第一天" });

    assert.deepEqual(result.assignments.A, ["P-SUPPORT"]);
    assert.equal(result.analysis.supportAssigned, 1);
    assert.equal(result.analysis.ownAssigned, 0);
    assert.equal(result.analysis.ownUnassigned, 1);
    assert.deepEqual(result.unassignedIds, ["P-OWN"]);
  });

  it("支援人力缺勤後會重新排列並由本班人力補位", () => {
    const data = snapshot(
      [firstDayPerson("P-OWN", team), firstDayPerson("P-SUPPORT", "俊志班")],
      [qualification("P-OWN", "A"), qualification("P-SUPPORT", "A")],
      ["A"]
    );

    const result = evaluateWorkforceScenario(data, {
      team,
      mode: "第一天",
      unavailableIds: ["P-SUPPORT"],
    });

    assert.deepEqual(result.assignments.A, ["P-OWN"]);
    assert.equal(result.analysis.shortage, 0);
    assert.equal(result.analysis.ownAssigned, 1);
    assert.equal(result.analysis.supportAssigned, 0);
  });

  it("領班不列入基礎覆蓋，但會提供幹部支援建議", () => {
    const data = snapshot(
      [person("P-OFFICER", "領班")],
      [qualification("P-OFFICER", "A")],
      ["A"]
    );

    const result = evaluateWorkforceScenario(data, { team, mode: "當班" });

    assert.equal(result.analysis.shortage, 1);
    assert.equal(result.analysis.officerSuggestions.length, 1);
    assert.equal(result.analysis.officerSuggestions[0]?.employeeId, "P-OFFICER");
    assert.equal(result.analysis.officerSuggestions[0]?.stationId, "A");
  });

  it("站長會正常計入作業人力", () => {
    const data = snapshot(
      [person("P-LEADER", "站長")],
      [qualification("P-LEADER", "A")],
      ["A"]
    );

    const result = evaluateWorkforceScenario(data, { team, mode: "當班" });

    assert.equal(result.analysis.shortage, 0);
    assert.deepEqual(result.assignments.A, ["P-LEADER"]);
  });

  it("訓練中不會自動安排，但可由情境補訓手動補位", () => {
    const data = snapshot(
      [person("P-TRAINING")],
      [qualification("P-TRAINING", "A", "訓練中")],
      ["A"]
    );

    const before = evaluateWorkforceScenario(data, { team, mode: "當班" });
    const after = evaluateWorkforceScenario(data, {
      team,
      mode: "當班",
      assignments: [
        { employeeId: "P-TRAINING", stationId: "A", source: "training" },
      ],
    });

    assert.equal(before.analysis.shortage, 1);
    assert.equal(after.analysis.shortage, 0);
    assert.equal(after.reasons.length, 1);
    assert.equal(after.reasons[0]?.employeeId, "P-TRAINING");
    assert.equal(after.reasons[0]?.source, "training");
  });

  it("幹部必須由使用者明確指定後才可補位", () => {
    const data = snapshot(
      [person("P-OFFICER", "組長")],
      [qualification("P-OFFICER", "A")],
      ["A"]
    );

    const result = evaluateWorkforceScenario(data, {
      team,
      mode: "當班",
      assignments: [
        { employeeId: "P-OFFICER", stationId: "A", source: "officer" },
      ],
    });

    assert.equal(result.analysis.shortage, 0);
    assert.deepEqual(result.violations, []);
    assert.equal(result.reasons[0]?.source, "officer");
  });

  it("阻擋同一人被手動指定到兩個站點", () => {
    const data = snapshot(
      [person("P-ONE")],
      [qualification("P-ONE", "A"), qualification("P-ONE", "B")]
    );

    const result = evaluateWorkforceScenario(data, {
      team,
      mode: "當班",
      assignments: [
        { employeeId: "P-ONE", stationId: "A", source: "manual" },
        { employeeId: "P-ONE", stationId: "B", source: "manual" },
      ],
    });

    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0]?.code, "DUPLICATE_ASSIGNMENT");
    assert.deepEqual(Object.values(result.assignments).flat(), ["P-ONE"]);
  });

  it("缺勤人員不能同時被強制指派", () => {
    const data = snapshot(
      [person("P-ABSENT")],
      [qualification("P-ABSENT", "A")],
      ["A"]
    );

    const result = evaluateWorkforceScenario(data, {
      team,
      mode: "當班",
      unavailableIds: ["P-ABSENT"],
      assignments: [
        { employeeId: "P-ABSENT", stationId: "A", source: "manual" },
      ],
    });

    assert.equal(result.analysis.shortage, 1);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0]?.code, "ABSENT_ASSIGNMENT");
  });
});
