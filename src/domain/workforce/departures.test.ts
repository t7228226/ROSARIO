import assert from "node:assert/strict";
import test from "node:test";
import { buildDepartureScenario, departureIdsThrough, normalizeDepartureDate } from "./departures";
import { evaluateWorkforceScenario } from "./engine";
import type { Person } from "../../types";

const person = (id: string, shift = "翊展班", extra: Partial<Person> = {}): Person => ({ id, name: id, shift, role: "技術員", nationality: "本籍", employmentStatus: "在職", aDay1: "日A", bDay1: "日A", departureDate: "2027-01-01", ...extra });

test("departure dates preserve calendar days and reject invalid or ambiguous values", () => {
  assert.equal(normalizeDepartureDate("2027/2/1"), "2027-02-01");
  assert.equal(normalizeDepartureDate("2027-01-01T00:00:00+08:00"), "2027-01-01");
  for (const value of ["2027-02-29", "2027-13-01", "1/2/2027", "說明", ""]) assert.equal(normalizeDepartureDate(value), "");
});

test("planned departure is opt-in, current attendance only, and deduplicated with absence", () => {
  const people = [person("A"), person("B"), person("C", "翊展班", { employmentStatus: "留停" }), person("D", "翊展班", { departureDate: "" })];
  assert.deepEqual(buildDepartureScenario(people, "翊展班", "當班", []).unavailableIds, []);
  const result = buildDepartureScenario(people, "翊展班", "當班", ["A", "C", "D", "unknown"], ["A", "B"]);
  assert.deepEqual(result.departures.map((p) => p.id), ["A"]);
  assert.deepEqual(result.unavailableIds, ["A", "B"]);
  assert.deepEqual(departureIdsThrough([person("A"), person("B", "翊展班", { departureDate: "2027-02-01" })], "2027-01-01"), ["A"]);
});

test("removing a multi-qualified worker exposes the actual non-duplicated station gap", () => {
  const people = [person("A"), person("B")];
  const snapshot = { people, stations: [], qualifications: [{ employeeId: "A", stationId: "S1", status: "合格" as const }, { employeeId: "A", stationId: "S2", status: "合格" as const }, { employeeId: "B", stationId: "S1", status: "合格" as const }], stationRules: [{ id: "R1", team: "翊展班", stationId: "S1", minRequired: 1 }, { id: "R2", team: "翊展班", stationId: "S2", minRequired: 1 }] };
  const before = evaluateWorkforceScenario(snapshot, { team: "翊展班", mode: "當班", assignments: [] });
  const unavailableIds = buildDepartureScenario(people, "翊展班", "當班", ["A"]).unavailableIds;
  const after = evaluateWorkforceScenario(snapshot, { team: "翊展班", mode: "當班", assignments: [], unavailableIds });
  assert.equal(before.analysis.shortage, 0);
  assert.equal(after.analysis.shortage, 1);
  assert.equal(after.rows.find((row) => row.stationId === "S2")?.shortage, 1);
  assert.equal(after.rows.flatMap((row) => row.assignedIds).includes("A"), false);
  assert.equal(after.analysis.trainingSuggestions.some((item) => item.employeeId === "A"), false);
  assert.equal(after.analysis.officerSuggestions.some((item) => item.employeeId === "A"), false);
  assert.equal(people[0].employmentStatus, "在職");
});

test("first and second days include selected departing support but not off-duty or suspended people", () => {
  const own = person("OWN", "婷芬班", { aDay1: "日A", aDay2: "日A" });
  const support = person("SUPPORT", "美香班", { aDay1: "日B", aDay2: "日B" });
  const off = person("OFF", "美香班", { aDay1: "休", aDay2: "休" });
  for (const mode of ["第一天", "第二天"] as const) {
    const result = buildDepartureScenario([own, support, off], "婷芬班", mode, ["SUPPORT", "OFF"]);
    assert.deepEqual(result.departures.map((p) => p.id), ["SUPPORT"]);
    assert.deepEqual(result.unavailableIds, ["SUPPORT"]);
  }
  assert.deepEqual(buildDepartureScenario([own, support], "婷芬班", "當班", ["SUPPORT"]).unavailableIds, []);
});
