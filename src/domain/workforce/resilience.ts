import {
  getApplicableRules,
  getAttendanceForTeam,
  getQualificationCountMap,
  getRuleNeed,
  solveCoverageMatching,
} from "../../lib/selectors";
import type {
  Person,
  Qualification,
  ShiftMode,
  StationRule,
  TeamName,
} from "../../types";

const OFFICER_ROLES = new Set(["領班", "組長", "主任"]);
const FULL_ENUMERATION_LIMIT = 25_000;
const SAMPLED_SCENARIOS_PER_LEVEL = 12_000;
const TRAINING_EVALUATION_LIMIT = 600;
const TRAINING_STATION_LIMIT = 8;
const TRAINING_CANDIDATE_LIMIT = 8;

export interface ResilienceInput {
  team: TeamName;
  mode: ShiftMode;
  stationRules: StationRule[];
  people: Person[];
  qualifications: Qualification[];
  maxAbsences: number;
}

export interface ResilienceLevelResult {
  absenceCount: number;
  totalCombinations: number;
  testedCombinations: number;
  fullyCoveredScenarios: number;
  baselineMaintainedScenarios: number;
  riskScenarios: number;
  coverageRate: number;
  baselineMaintainedRate: number;
  exhaustive: boolean;
}

export interface RiskStationImpact {
  stationId: string;
  shortage: number;
  addedShortage: number;
}

export interface CriticalAbsenceCombination {
  absentIds: string[];
  absenceCount: number;
  totalShortage: number;
  addedShortage: number;
  affectedStations: RiskStationImpact[];
  exhaustiveLevel: boolean;
}

export interface StationResilienceRisk {
  stationId: string;
  minAbsenceCount: number;
  riskScenarioCount: number;
  maxShortage: number;
  maxAddedShortage: number;
  criticalCombinations: string[][];
}

export interface ResilienceTrainingSuggestion {
  employeeId: string;
  stationId: string;
  qualificationCount: number;
  baselineShortageReduced: number;
  riskScenariosResolved: number;
  shortageSlotsReduced: number;
  coverageRateBefore: number;
  coverageRateAfter: number;
  estimated: boolean;
  priority: "當前缺口" | "預防補強" | "交叉覆蓋";
  reason: string;
}

export interface CoverageResilienceResult {
  team: TeamName;
  mode: ShiftMode;
  maxAbsences: number;
  activeWorkerCount: number;
  baselineRequired: number;
  baselineAssigned: number;
  baselineShortage: number;
  totalCombinations: number;
  testedCombinations: number;
  exhaustive: boolean;
  levels: ResilienceLevelResult[];
  criticalCombinations: CriticalAbsenceCombination[];
  stationRisks: StationResilienceRisk[];
  trainingSuggestions: ResilienceTrainingSuggestion[];
}

interface ScenarioSnapshot {
  absentIds: string[];
  absenceCount: number;
  totalShortage: number;
  addedShortage: number;
  affectedStations: RiskStationImpact[];
  exhaustiveLevel: boolean;
}

interface SolvedScenario {
  totalShortage: number;
  assigned: number;
  shortageByStation: Map<string, number>;
}

function isOfficer(person: Person) {
  return OFFICER_ROLES.has(String(person.role || "").trim());
}

function clampMaxAbsences(value: number, workerCount: number) {
  return Math.max(1, Math.min(5, workerCount, Math.floor(Number(value) || 1)));
}

export function countCombinations(total: number, selected: number) {
  if (selected < 0 || selected > total) return 0;
  if (selected === 0 || selected === total) return 1;
  const k = Math.min(selected, total - selected);
  let result = 1;
  for (let index = 1; index <= k; index += 1) {
    result = (result * (total - k + index)) / index;
  }
  return Math.round(result);
}

function generateAllCombinations(ids: string[], selected: number) {
  const output: string[][] = [];
  const current: string[] = [];
  function visit(start: number) {
    if (current.length === selected) {
      output.push([...current]);
      return;
    }
    const remaining = selected - current.length;
    for (let index = start; index <= ids.length - remaining; index += 1) {
      current.push(ids[index]);
      visit(index + 1);
      current.pop();
    }
  }
  visit(0);
  return output;
}

function createSeededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function generateSampledCombinations(ids: string[], selected: number, limit: number) {
  const total = countCombinations(ids.length, selected);
  if (total <= limit) return generateAllCombinations(ids, selected);

  const random = createSeededRandom(ids.length * 10_007 + selected * 97);
  const unique = new Map<string, string[]>();
  const maxAttempts = limit * 30;
  let attempts = 0;
  while (unique.size < limit && attempts < maxAttempts) {
    attempts += 1;
    const picked = new Set<number>();
    while (picked.size < selected) picked.add(Math.floor(random() * ids.length));
    const combination = [...picked].sort((a, b) => a - b).map((index) => ids[index]);
    unique.set(combination.join("|"), combination);
  }
  return [...unique.values()];
}

function isSubset(subset: string[], superset: string[]) {
  const values = new Set(superset);
  return subset.every((id) => values.has(id));
}

function solveScenario(
  rules: StationRule[],
  workingPeople: Person[],
  qualifications: Qualification[],
  mode: ShiftMode,
  unavailableIds: Set<string>,
  ownIds: Set<string>,
  supportIds: Set<string>
): SolvedScenario {
  const { assignedByStation } = solveCoverageMatching(
    rules,
    workingPeople,
    qualifications,
    mode,
    unavailableIds,
    mode === "當班" ? "資格優先" : "支援優先",
    ownIds,
    supportIds
  );
  const shortageByStation = new Map<string, number>();
  let totalShortage = 0;
  let assigned = 0;
  for (const rule of rules) {
    const stationAssigned = assignedByStation.get(rule.stationId)?.length || 0;
    const shortage = Math.max(0, getRuleNeed(rule, mode) - stationAssigned);
    shortageByStation.set(rule.stationId, shortage);
    totalShortage += shortage;
    assigned += stationAssigned;
  }
  return { totalShortage, assigned, shortageByStation };
}

function selectTrainingEvaluationScenarios(scenarios: ScenarioSnapshot[]) {
  if (scenarios.length <= TRAINING_EVALUATION_LIMIT) return scenarios;
  const sorted = [...scenarios].sort((a, b) =>
    b.addedShortage - a.addedShortage || a.absenceCount - b.absenceCount
  );
  const selected: ScenarioSnapshot[] = [];
  const step = sorted.length / TRAINING_EVALUATION_LIMIT;
  for (let index = 0; index < TRAINING_EVALUATION_LIMIT; index += 1) {
    selected.push(sorted[Math.min(sorted.length - 1, Math.floor(index * step))]);
  }
  return selected;
}

function buildTrainingSuggestions(
  rules: StationRule[],
  workingPeople: Person[],
  qualifications: Qualification[],
  mode: ShiftMode,
  baseline: SolvedScenario,
  riskScenarios: ScenarioSnapshot[],
  stationRisks: StationResilienceRisk[],
  testedCombinations: number,
  fullyCoveredScenarios: number,
  ownIds: Set<string>,
  supportIds: Set<string>
) {
  const qualificationCountMap = getQualificationCountMap(workingPeople, qualifications);
  const targetStationIds = [
    ...rules
      .filter((rule) => (baseline.shortageByStation.get(rule.stationId) || 0) > 0)
      .map((rule) => rule.stationId),
    ...stationRisks.map((item) => item.stationId),
  ].filter((stationId, index, values) => values.indexOf(stationId) === index)
    .slice(0, TRAINING_STATION_LIMIT);

  if (!targetStationIds.length) return [];

  const evaluationScenarios = selectTrainingEvaluationScenarios(riskScenarios);
  const exactRiskEvaluation = evaluationScenarios.length === riskScenarios.length;
  const coverageRateBefore = testedCombinations
    ? (fullyCoveredScenarios / testedCombinations) * 100
    : baseline.totalShortage === 0 ? 100 : 0;
  const candidates: ResilienceTrainingSuggestion[] = [];

  const trainingPeople = mode === "當班"
    ? workingPeople
    : workingPeople.filter((person) => ownIds.has(person.id));

  for (const stationId of targetStationIds) {
    const stationCandidates = trainingPeople
      .filter((person) => !qualifications.some((item) =>
        item.employeeId === person.id && item.stationId === stationId && Boolean(item.status)
      ))
      .sort((a, b) =>
        (qualificationCountMap.get(a.id) || 0) - (qualificationCountMap.get(b.id) || 0) ||
        a.name.localeCompare(b.name, "zh-Hant", { numeric: true })
      )
      .slice(0, TRAINING_CANDIDATE_LIMIT);

    for (const person of stationCandidates) {
      const simulatedQualifications: Qualification[] = [
        ...qualifications,
        {
          employeeId: person.id,
          employeeName: person.name,
          stationId,
          status: "合格",
        },
      ];
      const simulatedBaseline = solveScenario(
        rules,
        workingPeople,
        simulatedQualifications,
        mode,
        new Set<string>(),
        ownIds,
        supportIds
      );
      const baselineShortageReduced = Math.max(0, baseline.totalShortage - simulatedBaseline.totalShortage);
      let riskScenariosResolved = 0;
      let shortageSlotsReduced = 0;
      let evaluated = 0;

      for (const scenario of evaluationScenarios) {
        if (scenario.absentIds.includes(person.id)) continue;
        evaluated += 1;
        const simulated = solveScenario(
          rules,
          workingPeople,
          simulatedQualifications,
          mode,
          new Set(scenario.absentIds),
          ownIds,
          supportIds
        );
        shortageSlotsReduced += Math.max(0, scenario.totalShortage - simulated.totalShortage);
        if (scenario.addedShortage > 0 && simulated.totalShortage <= baseline.totalShortage) {
          riskScenariosResolved += 1;
        }
      }

      if (!baselineShortageReduced && !riskScenariosResolved && !shortageSlotsReduced) continue;

      const resolvedEstimate = exactRiskEvaluation || !evaluated
        ? riskScenariosResolved
        : (riskScenariosResolved / evaluated) * riskScenarios.length;
      const coverageRateAfter = baseline.totalShortage === 0 && testedCombinations
        ? Math.min(100, ((fullyCoveredScenarios + resolvedEstimate) / testedCombinations) * 100)
        : coverageRateBefore;
      const priority: ResilienceTrainingSuggestion["priority"] = baselineShortageReduced > 0
        ? "當前缺口"
        : riskScenariosResolved > 0
          ? "預防補強"
          : "交叉覆蓋";
      const reason = baselineShortageReduced > 0
        ? `全勤基準缺口可少 ${baselineShortageReduced} 人`
        : riskScenariosResolved > 0
          ? `可解除 ${riskScenariosResolved}${exactRiskEvaluation ? "" : "（抽樣）"} 種缺勤風險`
          : `可減少 ${shortageSlotsReduced} 個缺口人次`;

      candidates.push({
        employeeId: person.id,
        stationId,
        qualificationCount: qualificationCountMap.get(person.id) || 0,
        baselineShortageReduced,
        riskScenariosResolved,
        shortageSlotsReduced,
        coverageRateBefore,
        coverageRateAfter,
        estimated: !exactRiskEvaluation,
        priority,
        reason,
      });
    }
  }

  candidates.sort((a, b) =>
    b.baselineShortageReduced - a.baselineShortageReduced ||
    b.riskScenariosResolved - a.riskScenariosResolved ||
    b.shortageSlotsReduced - a.shortageSlotsReduced ||
    a.qualificationCount - b.qualificationCount ||
    a.stationId.localeCompare(b.stationId, "zh-Hant", { numeric: true })
  );
  const usedPeople = new Set<string>();
  return candidates.filter((item) => {
    if (usedPeople.has(item.employeeId)) return false;
    usedPeople.add(item.employeeId);
    return true;
  }).slice(0, 10);
}

export function analyzeCoverageResilience(input: ResilienceInput): CoverageResilienceResult {
  const attendance = getAttendanceForTeam(input.people, input.team, input.mode);
  const workingPeople = attendance.all.filter((person) => !isOfficer(person));
  const workingPersonIds = new Set(workingPeople.map((person) => person.id));
  const ownIds = new Set(attendance.own.map((person) => person.id).filter((id) => workingPersonIds.has(id)));
  const supportIds = new Set(attendance.support.map((person) => person.id).filter((id) => workingPersonIds.has(id)));
  const rules = getApplicableRules(input.team, input.mode, input.stationRules);
  const maxAbsences = clampMaxAbsences(input.maxAbsences, workingPeople.length);
  const baseline = solveScenario(
    rules,
    workingPeople,
    input.qualifications,
    input.mode,
    new Set<string>(),
    ownIds,
    supportIds
  );
  const baselineRequired = rules.reduce((sum, rule) => sum + getRuleNeed(rule, input.mode), 0);
  const workerIds = workingPeople.map((person) => person.id).sort((a, b) =>
    a.localeCompare(b, "zh-Hant", { numeric: true })
  );
  const levels: ResilienceLevelResult[] = [];
  const riskScenarios: ScenarioSnapshot[] = [];
  const minimalRiskScenarios: ScenarioSnapshot[] = [];
  let totalCombinations = 0;
  let testedCombinations = 0;
  let fullyCoveredScenarios = 0;

  for (let absenceCount = 1; absenceCount <= maxAbsences; absenceCount += 1) {
    const possible = countCombinations(workerIds.length, absenceCount);
    if (!possible) continue;
    const exhaustive = possible <= FULL_ENUMERATION_LIMIT;
    const combinations = exhaustive
      ? generateAllCombinations(workerIds, absenceCount)
      : generateSampledCombinations(workerIds, absenceCount, SAMPLED_SCENARIOS_PER_LEVEL);
    let levelFullyCovered = 0;
    let levelBaselineMaintained = 0;
    let levelRiskScenarios = 0;

    for (const absentIds of combinations) {
      const scenario = solveScenario(
        rules,
        workingPeople,
        input.qualifications,
        input.mode,
        new Set(absentIds),
        ownIds,
        supportIds
      );
      const addedShortage = Math.max(0, scenario.totalShortage - baseline.totalShortage);
      if (scenario.totalShortage === 0) levelFullyCovered += 1;
      if (scenario.totalShortage <= baseline.totalShortage) levelBaselineMaintained += 1;
      if (addedShortage <= 0) continue;

      levelRiskScenarios += 1;
      const affectedStations = rules
        .map((rule) => {
          const shortage = scenario.shortageByStation.get(rule.stationId) || 0;
          const baselineShortage = baseline.shortageByStation.get(rule.stationId) || 0;
          return {
            stationId: rule.stationId,
            shortage,
            addedShortage: Math.max(0, shortage - baselineShortage),
          };
        })
        .filter((item) => item.addedShortage > 0);
      const snapshot: ScenarioSnapshot = {
        absentIds,
        absenceCount,
        totalShortage: scenario.totalShortage,
        addedShortage,
        affectedStations,
        exhaustiveLevel: exhaustive,
      };
      riskScenarios.push(snapshot);
      const isMinimal = !minimalRiskScenarios.some((item) => isSubset(item.absentIds, absentIds));
      if (isMinimal) minimalRiskScenarios.push(snapshot);
    }

    totalCombinations += possible;
    testedCombinations += combinations.length;
    fullyCoveredScenarios += levelFullyCovered;
    levels.push({
      absenceCount,
      totalCombinations: possible,
      testedCombinations: combinations.length,
      fullyCoveredScenarios: levelFullyCovered,
      baselineMaintainedScenarios: levelBaselineMaintained,
      riskScenarios: levelRiskScenarios,
      coverageRate: combinations.length ? (levelFullyCovered / combinations.length) * 100 : 0,
      baselineMaintainedRate: combinations.length ? (levelBaselineMaintained / combinations.length) * 100 : 0,
      exhaustive,
    });
  }

  const stationRiskMap = new Map<string, StationResilienceRisk>();
  for (const scenario of riskScenarios) {
    for (const impact of scenario.affectedStations) {
      const current = stationRiskMap.get(impact.stationId) || {
        stationId: impact.stationId,
        minAbsenceCount: scenario.absenceCount,
        riskScenarioCount: 0,
        maxShortage: 0,
        maxAddedShortage: 0,
        criticalCombinations: [],
      };
      current.minAbsenceCount = Math.min(current.minAbsenceCount, scenario.absenceCount);
      current.riskScenarioCount += 1;
      current.maxShortage = Math.max(current.maxShortage, impact.shortage);
      current.maxAddedShortage = Math.max(current.maxAddedShortage, impact.addedShortage);
      if (minimalRiskScenarios.includes(scenario) && current.criticalCombinations.length < 8) {
        current.criticalCombinations.push(scenario.absentIds);
      }
      stationRiskMap.set(impact.stationId, current);
    }
  }
  const stationRisks = [...stationRiskMap.values()].sort((a, b) =>
    a.minAbsenceCount - b.minAbsenceCount ||
    b.riskScenarioCount - a.riskScenarioCount ||
    b.maxAddedShortage - a.maxAddedShortage
  );
  const criticalCombinations: CriticalAbsenceCombination[] = minimalRiskScenarios
    .sort((a, b) =>
      a.absenceCount - b.absenceCount ||
      b.addedShortage - a.addedShortage ||
      a.absentIds.join("|").localeCompare(b.absentIds.join("|"), "zh-Hant", { numeric: true })
    )
    .slice(0, 80);
  const trainingSuggestions = buildTrainingSuggestions(
    rules,
    workingPeople,
    input.qualifications,
    input.mode,
    baseline,
    riskScenarios,
    stationRisks,
    testedCombinations,
    fullyCoveredScenarios,
    ownIds,
    supportIds
  );

  return {
    team: input.team,
    mode: input.mode,
    maxAbsences,
    activeWorkerCount: workingPeople.length,
    baselineRequired,
    baselineAssigned: baseline.assigned,
    baselineShortage: baseline.totalShortage,
    totalCombinations,
    testedCombinations,
    exhaustive: levels.every((item) => item.exhaustive),
    levels,
    criticalCombinations,
    stationRisks,
    trainingSuggestions,
  };
}
