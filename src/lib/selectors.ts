import type { Person, Qualification, ShiftMode, Station } from "../types";

export function isPersonActiveInMode(person: Person, mode: ShiftMode): boolean {
  if (person.employmentStatus !== "在職" || person.role === "主任") {
    return false;
  }
  if (mode === "B班") {
    return person.shift === "B班";
  }
  if (mode === "第一天") {
    return person.shift === "B班" || (person.shift === "A班" && person.day1 === "Y");
  }
  return person.shift === "B班" || (person.shift === "A班" && person.day2 === "Y");
}

export function qualificationBadge(status: string): string {
  if (status === "合格") return "badge badge-pass";
  if (status === "訓練中") return "badge badge-training";
  if (status === "不可排") return "badge badge-blocked";
  return "badge badge-empty";
}

export function groupQualificationsByEmployee(qualifications: Qualification[]) {
  return qualifications.reduce<Record<string, Qualification[]>>((acc, current) => {
    acc[current.employeeId] ||= [];
    acc[current.employeeId].push(current);
    return acc;
  }, {});
}

export function groupQualificationsByStation(qualifications: Qualification[]) {
  return qualifications.reduce<Record<string, Qualification[]>>((acc, current) => {
    acc[current.stationId] ||= [];
    acc[current.stationId].push(current);
    return acc;
  }, {});
}

export function getStationCoverage(
  station: Station,
  people: Person[],
  qualifications: Qualification[],
  mode: ShiftMode
) {
  const activePeople = new Set(people.filter((person) => isPersonActiveInMode(person, mode)).map((person) => person.id));
  const related = qualifications.filter((item) => item.stationId === station.id && activePeople.has(item.employeeId));
  const qualified = related.filter((item) => item.status === "合格").length;
  const training = related.filter((item) => item.status === "訓練中").length;
  const blocked = related.filter((item) => item.status === "不可排").length;

  const normalGap = Math.max(0, station.normalMin - qualified);
  const reliefSafeNeed = station.reliefMinPerBatch * 2;
  const reliefGap = Math.max(0, reliefSafeNeed - qualified);

  return {
    related,
    qualified,
    training,
    blocked,
    normalGap,
    reliefSafeNeed,
    reliefGap,
  };
}

export function searchText(values: Array<string | undefined | null>, keyword: string) {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(normalized));
}

export function buildSmartAssignments(
  stations: Station[],
  people: Person[],
  qualifications: Qualification[],
  mode: ShiftMode
) {
  const activePeople = people
    .filter((person) => isPersonActiveInMode(person, mode))
    .sort((a, b) => a.role.localeCompare(b.role, "zh-Hant") || a.name.localeCompare(b.name, "zh-Hant"));

  const qualificationMap = new Map<string, Qualification[]>();
  for (const q of qualifications) {
    if (!qualificationMap.has(q.employeeId)) qualificationMap.set(q.employeeId, []);
    qualificationMap.get(q.employeeId)!.push(q);
  }

  const flexibility = new Map<string, number>();
  for (const person of activePeople) {
    const count = (qualificationMap.get(person.id) || []).filter((q) => q.status === "合格").length;
    flexibility.set(person.id, count);
  }

  const candidatesByStation = new Map<string, Person[]>();
  for (const station of stations) {
    const candidates = activePeople
      .filter((person) =>
        (qualificationMap.get(person.id) || []).some(
          (q) => q.stationId === station.id && q.status === "合格"
        )
      )
      .sort((a, b) => (flexibility.get(a.id) || 0) - (flexibility.get(b.id) || 0));
    candidatesByStation.set(station.id, candidates);
  }

  const orderedStations = [...stations].sort((a, b) => {
    const priorityA = a.priority ?? 999;
    const priorityB = b.priority ?? 999;
    return priorityA - priorityB || a.name.localeCompare(b.name, "zh-Hant");
  });

  const used = new Set<string>();
  const assignments: Array<{ stationId: string; assigned: Person[]; shortage: number }> = [];

  for (const station of orderedStations) {
    const need = station.normalMin;
    const candidates = candidatesByStation.get(station.id) || [];
    const assigned: Person[] = [];
    for (const person of candidates) {
      if (used.has(person.id)) continue;
      assigned.push(person);
      used.add(person.id);
      if (assigned.length >= need) break;
    }
    assignments.push({
      stationId: station.id,
      assigned,
      shortage: Math.max(0, need - assigned.length),
    });
  }

  return assignments;
}
