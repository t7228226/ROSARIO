import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fixture } from "./helpers/gasFixture.mjs";
import { sanitizeBootstrapData } from "../src/domain/bootstrap/sanitizeBootstrap.ts";
import { buildDepartureScenario } from "../src/domain/workforce/departures.ts";
import { evaluateWorkforceScenario } from "../src/domain/workforce/engine.ts";
import { getCoverageQualificationStatus, TEAM_OPTIONS } from "../src/lib/selectors.ts";

const privateRoot = await realpath(resolve("private-backups"));
const input = await realpath(resolve(process.argv[2] || ""));
assert.ok(input.startsWith(privateRoot + sep), "Private fixture must stay under private-backups/");
const snapshot = JSON.parse(await readFile(input, "utf8"));
const f = fixture();
for (const [name, rows] of Object.entries(snapshot.sheets)) {
  assert.notEqual(name, "07_帳號管理");
  if (f.sheets.has(name)) f.sheets.get(name).rows = rows;
}
const identity = f.people.rows.find((row, i) => i > 1 && row[0] && row[1]);
f.accounts.rows[2][0] = String(identity[0]);
const login = f.login("root", "synthetic-admin-password");
assert.equal(login.ok, true, login.message);
const originalMatrix = JSON.stringify(f.sheets.get("03_站點矩陣").rows);
const originalDetails = JSON.stringify(f.sheets.get("03_資格明細").rows);
const result = f.post("bootstrap", {}, { sessionToken: login.sessionToken });
assert.equal(result.ok, true, result.message);
const data = sanitizeBootstrapData(result);
assert.equal(data.people.length, 180);
assert.equal(data.stations.length, 20);
assert.equal(data.qualifications.length, 637);
assert.equal(data.people.filter((p) => p.departureDate).length, 20);
assert.equal(JSON.stringify(f.sheets.get("03_站點矩陣").rows), originalMatrix);
assert.equal(JSON.stringify(f.sheets.get("03_資格明細").rows), originalDetails);

const scenarios = [];
for (const team of TEAM_OPTIONS) {
  for (const mode of ["當班", "第一天", "第二天"]) {
    const before = evaluateWorkforceScenario(data, { team, mode, assignments: [] });
    const candidates = buildDepartureScenario(data.people, team, mode, []).candidates;
    const selected = candidates.map((p) => p.id);
    const departure = buildDepartureScenario(data.people, team, mode, selected);
    const after = evaluateWorkforceScenario(data, { team, mode, assignments: [], unavailableIds: departure.unavailableIds });
    assert.ok(after.analysis.shortage >= before.analysis.shortage);
    for (const scenario of [before, after]) {
      const assigned = scenario.rows.flatMap((r) => r.assignedIds);
      assert.equal(new Set(assigned).size, assigned.length);
      assert.equal(scenario.analysis.shortage, scenario.rows.reduce((sum, r) => sum + r.shortage, 0));
      for (const row of scenario.rows) for (const id of row.assignedIds) {
        assert.equal(getCoverageQualificationStatus(data.qualifications, id, row.stationId), "合格");
        assert.equal(["領班", "組長", "主任"].includes(data.people.find((p) => p.id === id)?.role), false);
      }
    }
    assert.equal(after.rows.some((r) => r.assignedIds.some((id) => selected.includes(id))), false);
    scenarios.push({ team, mode, selectedDepartures: selected.length, required: before.analysis.required, beforeShortage: before.analysis.shortage, afterShortage: after.analysis.shortage,
      changedStations: after.rows.flatMap((r) => {
        const previous = before.rows.find((b) => b.stationId === r.stationId).shortage;
        return previous === r.shortage ? [] : [{ stationId: r.stationId, before: previous, after: r.shortage }];
      }) });
  }
}
const report = { sourceSha256: snapshot.sourceSha256, people: data.people.length, stations: data.stations.length, qualifications: data.qualifications.length, departureDates: 20, scenarios, limits: ["Memory-only Google service replacements; not a cloud deployment or live workforce decision."] };
await writeFile(resolve(dirname(input), "coverage-validation.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
