import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeStationCoverage, buildSmartAssignments, getQualificationCountMap, solveCoverageMatching } from "../../lib/selectors";
import type { Person, Qualification, SmartScheduleMode, StationRule } from "../../types";

const team = "翊展班";
const person = (id: string, role = "技術員"): Person => ({
  id, name: id, role, shift: team, nationality: "本籍", employmentStatus: "在職",
});
const qualification = (employeeId: string, stationId: string, status: Qualification["status"] = "合格"): Qualification => ({
  employeeId, stationId, status,
});
const rule = (stationId: string): StationRule => ({ id: stationId, team, stationId, minRequired: 1, enabled: true });

function assertOptimalMatching(
  rules: StationRule[], people: Person[], qualifications: Qualification[], strategy: SmartScheduleMode,
  ownIds: Set<string>, supportIds: Set<string>, message: string,
  unavailableIds = new Set<string>(), forcedAssignments = new Map<string, string>(), randomize = false
) {
  const workers = [...new Map(people.map((worker) => [worker.id, worker])).values()]
    .filter((worker) => worker.employmentStatus === "在職" && !unavailableIds.has(worker.id));
  const eligible = (id: string, stationId: string) => {
    const statuses = qualifications.filter((item) => item.employeeId === id && item.stationId === stationId).map((item) => item.status);
    return statuses.includes("合格") && !statuses.includes("不可排");
  };
  const preferredIds = strategy === "支援優先" ? supportIds : strategy === "當班優先" ? ownIds : new Set<string>();
  const locked = new Map([...forcedAssignments].filter(([id, stationId]) =>
    workers.some((worker) => worker.id === id) && rules.some((station) => station.stationId === stationId) && eligible(id, stationId)));
  const loads = new Map(rules.map((station) => [station.stationId, [...locked.values()].filter((id) => id === station.stationId).length]));
  const freeWorkers = workers.filter((worker) => !locked.has(worker.id));
  let best = [-1, -1];
  function enumerate(index: number, assigned: number, preferred: number) {
    if (index === freeWorkers.length) {
      if (assigned > best[0] || (assigned === best[0] && preferred > best[1])) best = [assigned, preferred];
      return;
    }
    enumerate(index + 1, assigned, preferred);
    const id = freeWorkers[index].id;
    for (const station of rules) {
      const load = loads.get(station.stationId) || 0;
      if (load >= station.minRequired || !eligible(id, station.stationId)) continue;
      loads.set(station.stationId, load + 1);
      enumerate(index + 1, assigned + 1, preferred + Number(preferredIds.has(id)));
      loads.set(station.stationId, load);
    }
  }
  enumerate(0, locked.size, [...locked.keys()].filter((id) => preferredIds.has(id)).length);
  const result = solveCoverageMatching(rules, people, qualifications, "第一天", unavailableIds,
    strategy, ownIds, supportIds, forcedAssignments, randomize);
  const assigned = [...result.assignedByStation.values()].flat();
  assert.equal(new Set(assigned).size, assigned.length, `duplicate: ${message}`);
  assert.deepEqual([assigned.length, assigned.filter((id) => preferredIds.has(id)).length], best, message);
  for (const [stationId, ids] of result.assignedByStation) {
    const station = rules.find((item) => item.stationId === stationId)!;
    assert.ok(ids.length <= Math.max(station.minRequired, loads.get(stationId) || 0), `capacity: ${message}`);
    for (const id of ids) {
      assert.ok(workers.some((worker) => worker.id === id) && eligible(id, stationId), `eligibility: ${message}`);
      if (locked.has(id)) assert.equal(stationId, locked.get(id), `lock: ${message}`);
    }
  }
  for (const [id, stationId] of locked) assert.ok(result.assignedByStation.get(stationId)?.includes(id), `missing lock: ${message}`);
  return result;
}

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

  it("maximizes coverage then preferred usage on every four-worker/three-station graph including three support workers", () => {
    const people = ["O1", "S1", "S2", "S3"].map((id) => person(id));
    const rules = ["A", "B", "C"].map(rule);
    const ownIds = new Set(["O1"]);
    const supportIds = new Set(["S1", "S2", "S3"]);
    for (let mask = 0; mask < 1 << 12; mask += 1) {
      const qualifications = people.flatMap((worker, personIndex) => rules.flatMap((station, stationIndex) =>
        mask & (1 << (personIndex * 3 + stationIndex)) ? [qualification(worker.id, station.stationId)] : []));
      for (const strategy of ["支援優先", "當班優先", "資格優先"] as const) {
        assertOptimalMatching(rules, people, qualifications, strategy, ownIds, supportIds, `${strategy}, mask ${mask}`);
      }
      // Swapping the groups also checks three preferred own-shift workers.
      assertOptimalMatching(rules, people, qualifications, "當班優先", supportIds, ownIds, `three own, mask ${mask}`);
    }
  });

  it("matches the oracle across capacities, valid/invalid locks, absences and conflicting statuses", () => {
    const people = ["O1", "S1", "S2", "S3"].map((id) => person(id));
    const ownIds = new Set(["O1"]);
    const supportIds = new Set(["S1", "S2", "S3"]);
    const locks = [new Map<string, string>(), new Map([["O1", "A"]]), new Map([["S1", "B"]]),
      new Map([["S1", "A"], ["S2", "A"]]), new Map([["MISSING", "A"], ["S3", "UNKNOWN"]])];
    for (let mask = 0; mask < 1 << 8; mask += 1) {
      const qualifications = people.flatMap((worker, personIndex) => ["A", "B"].flatMap((stationId, stationIndex) =>
        mask & (1 << (personIndex * 2 + stationIndex)) ? [qualification(worker.id, stationId)] : []));
      qualifications.push(qualification("S1", "A", "訓練中"), qualification("S1", "A"),
        qualification("S2", "B", "不可排"), qualification("S2", "B"), qualification("O1", "B", ""));
      for (const capacity of [0, 1, 2]) {
        const rules = [{ ...rule("A"), minRequired: capacity }, rule("B")];
        for (const forcedAssignments of locks) {
          for (const strategy of ["支援優先", "當班優先"] as const) {
            assertOptimalMatching(rules, [...people, person("S1"), { ...person("LEFT"), employmentStatus: "離職" }],
              qualifications, strategy, ownIds, supportIds, `${strategy}, capacity ${capacity}, mask ${mask}`,
              new Set(mask % 2 ? ["S3"] : []), forcedAssignments, mask % 2 === 0);
          }
        }
      }
    }
  });

  it("uses all three support workers when local candidate sorting would retain an own worker", () => {
    const people = ["O1", "S1", "S2", "S3"].map((id) => person(id));
    const qualifications = [qualification("O1", "B"), qualification("O1", "C"), qualification("S1", "B"),
      qualification("S1", "C"), qualification("S2", "A"), qualification("S2", "B"), qualification("S3", "A")];
    assertOptimalMatching(["A", "B", "C"].map(rule), people, qualifications, "支援優先",
      new Set(["O1"]), new Set(["S1", "S2", "S3"]), "three support regression");
  });

  it("keeps blocked qualification precedence for forced assignments in either row order", () => {
    const people = [person("BLOCKED"), person("QUALIFIED"), { ...person("LEFT"), employmentStatus: "離職" }];
    const qualifications = [qualification("BLOCKED", "A"), qualification("BLOCKED", "A", "不可排"),
      qualification("QUALIFIED", "A", "訓練中"), qualification("QUALIFIED", "A"), qualification("LEFT", "A")];
    for (const rows of [qualifications, [...qualifications].reverse()]) {
      const result = solveCoverageMatching([rule("A")], people, rows, "當班", new Set(), "支援優先",
        new Set(["QUALIFIED"]), new Set(["BLOCKED"]), new Map([["BLOCKED", "A"], ["LEFT", "A"]]));
      assert.deepEqual(result.assignedByStation.get("A"), ["QUALIFIED"]);
      assert.deepEqual(result.qualifiedByStation.get("A"), ["QUALIFIED"]);
      assert.deepEqual(result.violations.map((item) => item.code), ["BLOCKED_QUALIFICATION", "OUTSIDE_ATTENDANCE"]);
    }
  });

  it("keeps deterministic ID ties and only randomizes ties after strategy and flexibility", (t) => {
    const people = ["O1", "S1", "S2", "S3"].map((id) => person(id));
    const qualifications = people.map((worker) => qualification(worker.id, "A"));
    qualifications.push(qualification("S3", "B"));
    const rules = [rule("A"), { ...rule("B"), minRequired: 0 }];
    let ranks = [0, 0.8, 0.2, 0.1];
    t.mock.method(Math, "random", () => ranks.shift() ?? 0);
    const solve = (randomize: boolean) => solveCoverageMatching(rules, people, qualifications, "第一天", new Set(),
      "支援優先", new Set(["O1"]), new Set(["S1", "S2", "S3"]), new Map(), randomize);
    assert.deepEqual(solve(false).assignedByStation.get("A"), ["S1"]);
    ranks = [0, 0.8, 0.2, 0.1];
    assert.deepEqual(solve(true).assignedByStation.get("A"), ["S2"]);
    ranks = [0, 0.1, 0.8, 0.01];
    assert.deepEqual(solve(true).assignedByStation.get("A"), ["S1"]);
  });

  it("retains stable order for equal random ranks and qualification-mode secondary preferences", (t) => {
    t.mock.method(Math, "random", () => 0.5);
    const people = [person("S2"), person("S1"), person("O1"), person("OTHER")];
    const qualifications = people.map((worker) => qualification(worker.id, "A"));
    const solve = (supportIds: Set<string>, randomize: boolean) => solveCoverageMatching([rule("A")], people,
      qualifications, "第一天", new Set(), "資格優先", new Set(["O1"]), supportIds, new Map(), randomize);
    assert.deepEqual(solve(new Set(["S1", "S2"]), true).assignedByStation.get("A"), ["S2"]);
    assert.deepEqual(solve(new Set(["S1", "S2"]), false).assignedByStation.get("A"), ["S1"]);
    assert.deepEqual(solve(new Set(), true).assignedByStation.get("A"), ["O1"]);
    qualifications.push(qualification("S1", "B"), qualification("S2", "B"));
    const result = solveCoverageMatching([rule("A"), { ...rule("B"), minRequired: 0 }], people, qualifications,
      "第一天", new Set(), "資格優先", new Set(["O1"]), new Set(["S1", "S2"]), new Map(), true);
    assert.deepEqual(result.assignedByStation.get("A"), ["O1"]);
  });

  it("does not mutate matching inputs", () => {
    const rules = [rule("A"), rule("B")];
    const people = [person("O1"), person("S1"), person("S2")];
    const qualifications = people.flatMap((worker) => rules.map((station) => qualification(worker.id, station.stationId)));
    const ownIds = new Set(["O1"]);
    const supportIds = new Set(["S1", "S2"]);
    const unavailableIds = new Set(["S2"]);
    const forcedAssignments = new Map([["O1", "A"]]);
    const inputs = { rules, people, qualifications, ownIds, supportIds, unavailableIds, forcedAssignments };
    const snapshot = structuredClone(inputs);
    assertOptimalMatching(rules, people, qualifications, "支援優先", ownIds, supportIds, "immutable inputs", unavailableIds, forcedAssignments);
    assert.deepEqual(inputs, snapshot);
  });

  it("bounds matching allocation for enormous demand while retaining the arithmetic shortage", () => {
    const demand = 2 ** 40;
    const rules = Array.from({ length: 16 }, (_, index) => ({ ...rule(`S${index}`), minRequired: demand }));
    const people = ["P1", "P2", "P3"].map((id) => person(id));
    const qualifications = people.flatMap((worker) => rules.map((station) => qualification(worker.id, station.stationId)));
    qualifications.push(qualification("P2", "S0", "不可排"));
    const result = analyzeStationCoverage(team, "當班", rules, people, qualifications,
      new Set(["P3"]), new Map([["P1", "S0"]]));
    assert.equal(result.required, demand * rules.length);
    assert.equal(result.assigned, 2);
    assert.equal(result.shortage, demand * rules.length - 2);
    assert.equal(result.rows.find((row) => row.stationId === "S0")?.shortage, demand - 1);
    assert.equal(new Set(result.rows.flatMap((row) => row.assignedIds)).size, 2);
    for (const minRequired of [Number.MAX_SAFE_INTEGER, Number.MAX_VALUE, Infinity]) {
      const huge = solveCoverageMatching([{ ...rule("S0"), minRequired }], people, qualifications, "當班");
      assert.equal(huge.assignedByStation.get("S0")?.length, 2);
    }
  });

  it("counts unique effectively qualified stations with blocked status taking precedence in either row order", () => {
    const people = [person("P1"), person("P2"), person("P1")];
    const qualifications = [qualification("P1", "A"), qualification("P1", "A"), qualification("P1", "A", "訓練中"),
      qualification("P1", "B"), qualification("P1", "B", "不可排"), qualification("P1", "C", "訓練中"),
      qualification("P1", "D", ""), qualification("P1", "E", "訓練中"), qualification("P1", "E"),
      qualification("OUTSIDER", "A")];
    const snapshot = structuredClone(qualifications);
    assert.deepEqual([...getQualificationCountMap(people, qualifications)], [["P1", 2], ["P2", 0]]);
    assert.deepEqual([...getQualificationCountMap(people, [...qualifications].reverse())], [["P1", 2], ["P2", 0]]);
    assert.deepEqual(qualifications, snapshot);
  });
});
