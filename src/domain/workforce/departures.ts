import { getAttendanceForTeam } from "../../lib/selectors";
import type { Person, ShiftMode, TeamName } from "../../types";

export function normalizeDepartureDate(value: unknown): string {
  const match = String(value ?? "").trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[T\s])/);
  if (!match) return "";
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return "";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function buildDepartureScenario(
  people: Person[], team: TeamName, mode: ShiftMode, selectedIds: string[], absentIds: string[] = []
) {
  const attendance = getAttendanceForTeam(people, team, mode);
  const candidates = attendance.all.filter((person) => normalizeDepartureDate(person.departureDate))
    .sort((a, b) => normalizeDepartureDate(a.departureDate).localeCompare(normalizeDepartureDate(b.departureDate)) || a.id.localeCompare(b.id));
  const selected = new Set(selectedIds);
  const departures = candidates.filter((person) => selected.has(person.id));
  const activeIds = new Set(attendance.all.map((person) => person.id));
  const unavailableIds = [...new Set([...absentIds.filter((id) => activeIds.has(id)), ...departures.map((person) => person.id)])];
  return { candidates, departures, unavailableIds };
}

export function departureIdsThrough(people: Person[], cutoff: string) {
  const limit = normalizeDepartureDate(cutoff);
  return limit ? people.filter((person) => {
    const date = normalizeDepartureDate(person.departureDate);
    return date && date <= limit;
  }).map((person) => person.id) : [];
}
