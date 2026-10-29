import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { fixture } from "./helpers/gasFixture.mjs";

const VERSION = "2026-10-30-016", SHEET = "13_配置預設";
const preset = (patch = {}) => ({
  id: "86f16c76-5869-441b-94e0-4e84b9ad70ac", name: "Synthetic preset", team: "TEAM_A", dayKey: "當班", isDefault: false,
  configuration: {
    assignments: [{ employeeId: "P1001", stationId: "ST01", source: "manual" }],
    rules: [{ employeeId: "ROOT", mode: "allowed", stationIds: ["ST01"] }],
  }, ...patch,
});
function setup(options) {
  const f = fixture(options), spreadsheet = f.context.SpreadsheetApp.getActiveSpreadsheet();
  spreadsheet.deleteSheet = sheet => { assert.equal(f.locked(), true); f.events.push({ kind: "deleteSheet", name: SHEET }); f.sheets.delete(SHEET); };
  f.context.SpreadsheetApp.getActiveSpreadsheet = () => spreadsheet;
  const token = f.login().sessionToken;
  let operation = 0;
  return Object.assign(f, {
    token, spreadsheet,
    save(value, owner = token, extra = {}) {
      return f.write(owner, "saveCoveragePreset", { preset: value }, {
        appVersion: VERSION, operationId: `OP_coverage_preset_${String(++operation).padStart(8, "0")}`, ...extra,
      });
    },
    load(team = "TEAM_A", dayKey = "當班", owner = token) { return f.post("loadCoveragePresets", { team, dayKey }, { sessionToken: owner }); },
  });
}

test("016 preset storage is registered with reliable writes and the global fingerprint", async () => {
  const f = setup();
  assert.equal(vm.runInContext("SHEETS.COVERAGE_PRESETS", f.context), SHEET);
  assert.equal(vm.runInContext("SETTINGS.APP_VERSION", f.context), VERSION);
  assert.equal(vm.runInContext("SETTINGS.MIN_WRITE_VERSION", f.context), VERSION);
  assert.match(await readFile(new URL("../src/config/writeActions.ts", import.meta.url), "utf8"), /"saveCoveragePreset"/);
  const value = preset(), saved = f.save(value);
  assert.equal(saved.ok, true, saved.message);
  assert.equal(saved.operationStatus, "success");
  assert.equal(saved.presetId, value.id);
  assert.equal(saved.updatedAt, f.context.Date.now());
  assert.equal(saved.revision, 1);
  assert.deepEqual(f.load().presets, [{ ...value, updatedAt: saved.updatedAt }]);
  const row = f.sheets.get(SHEET).rows[1];
  assert.equal(row[1], "P1001"); assert.equal(row[3], value.team); assert.equal(row[4], value.dayKey); assert.equal(row[6], saved.updatedAt);
  assert.deepEqual(JSON.parse(row.slice(7).join("")), value.configuration);
  assert.ok(f.events.some(event => event.name === SHEET && event.kind === "set" && event.data.length === 2));
  assert.equal("preset" in saved, false, "large configurations must not be copied into receipts");
});

test("read-only actions never create preset storage and bootstrap never includes presets", () => {
  const f = setup();
  assert.deepEqual(f.load().presets, []);
  const result = f.post("bootstrap", { includeOperations: false }, { sessionToken: f.token });
  assert.equal(result.ok, true);
  assert.equal("presets" in result, false);
  assert.equal(f.sheets.has(SHEET), false);
  assert.equal(f.events.some(event => event.name === SHEET), false);
  assert.equal(JSON.parse(f.context.doGet({ parameter: { action: "loadCoveragePresets" } })).code, "POST_REQUIRED");
});

test("load/save require PERM_006, a session, and explicit valid team/day scope", () => {
  const denied = setup({ permissions: ["PERM_007", "PERM_008"] });
  assert.equal(denied.load().code, "FORBIDDEN");
  assert.equal(denied.save(preset()).code, "FORBIDDEN");
  assert.equal(denied.sheets.has(SHEET), false);
  const f = setup();
  for (const payload of [{}, { team: "TEAM_A" }, { dayKey: "當班" }, { team: "unknown", dayKey: "當班" }, { team: "TEAM_A", dayKey: "tomorrow" }, { team: "TEAM_A", dayKey: "當班", ownerId: "ROOT" }]) {
    assert.equal(f.post("loadCoveragePresets", payload, { sessionToken: f.token }).code, "COVERAGE_PRESET_INVALID");
  }
  assert.equal(f.post("loadCoveragePresets", { team: "TEAM_A", dayKey: "當班" }).code, "AUTH_REQUIRED");
  assert.equal(f.post("saveCoveragePreset", { preset: preset() }, { appVersion: VERSION, operationId: "OP_coverage_no_auth_00000001" }).code, "AUTH_REQUIRED");
});

test("presets are personal even for admins while analysis team/day scopes remain accessible", () => {
  const f = setup(), admin = f.login("root", "synthetic-admin-password").sessionToken;
  const own = preset(), otherTeam = preset({ id: "team-b", team: "TEAM_B" }), otherDay = preset({ id: "day-two", dayKey: "第二天" });
  for (const value of [own, otherTeam, otherDay]) assert.equal(f.save(value).ok, true);
  assert.deepEqual(f.load().presets.map(item => item.id), [own.id]);
  assert.deepEqual(f.load("TEAM_B").presets.map(item => item.id), [otherTeam.id]);
  assert.deepEqual(f.load("TEAM_A", "第二天").presets.map(item => item.id), [otherDay.id]);
  assert.deepEqual(f.load("TEAM_A", "當班", admin).presets, []);
  assert.equal(f.save(own, admin).code, "FORBIDDEN");
  assert.equal(f.save({ ...own, team: "TEAM_B" }).code, "FORBIDDEN");
  assert.equal(f.save(preset({ id: "root-preset" }), admin).ok, true);
  assert.equal(f.save(preset({ id: "root-preset" })).code, "FORBIDDEN");
  assert.deepEqual(f.load("TEAM_A", "當班", admin).presets.map(item => item.id), ["root-preset"]);
});

test("defaults are unique per owner/team/day and can be explicitly cleared", () => {
  const f = setup(), admin = f.login("root", "synthetic-admin-password").sessionToken;
  assert.equal(f.save(preset({ id: "first", isDefault: true })).ok, true);
  f.advance(1000);
  assert.equal(f.save(preset({ id: "second", isDefault: true })).ok, true);
  assert.equal(f.save(preset({ id: "other-team", team: "TEAM_B", isDefault: true })).ok, true);
  assert.equal(f.save(preset({ id: "other-day", dayKey: "第一天", isDefault: true })).ok, true);
  assert.equal(f.save(preset({ id: "other-owner", isDefault: true }), admin).ok, true);
  assert.deepEqual(f.load().presets.filter(item => item.isDefault).map(item => item.id), ["second"]);
  assert.equal(f.load("TEAM_B").presets[0].isDefault, true);
  assert.equal(f.load("TEAM_A", "第一天").presets[0].isDefault, true);
  assert.equal(f.load("TEAM_A", "當班", admin).presets[0].isDefault, true);
  assert.equal(f.save(preset({ id: "second", isDefault: false })).ok, true);
  assert.equal(f.load().presets.some(item => item.isDefault), false);
});

test("unknown keys, identifiers, source/mode and collection bounds fail before receipts or data mutations", () => {
  const f = setup();
  f.sheets.get("02_站點主表").rows.push(["ST02", "Synthetic second station"]);
  const invalid = [null, [], {}, preset({ name: "x".repeat(61) }), preset({ id: "x".repeat(81) }), preset({ name: 3 }), preset({ team: "unknown" }),
    preset({ dayKey: "tomorrow" }), preset({ isDefault: "true" }), preset({ updatedAt: "now" }), preset({ ownerId: "ROOT" }), preset({ password: "do-not-store" }),
    preset({ configuration: { assignments: [], rules: [], password: "do-not-store" } }),
    ...["assignments", "rules"].flatMap(key => [null, {}, [null], Array.from({ length: 201 }, () => ({}))].map(value => preset({ configuration: { assignments: [], rules: [], [key]: value } }))),
  ];
  for (const source of ["auto", "qualified", 3, null]) invalid.push(preset({ configuration: { assignments: [{ employeeId: "P1001", stationId: "ST01", source }], rules: [] } }));
  for (const extra of [{ employeeId: "unknown" }, { stationId: "unknown" }, { employeeName: "do-not-store" }, { password: "do-not-store" }, { stationId: "x".repeat(81) }]) {
    invalid.push(preset({ configuration: { assignments: [{ employeeId: "P1001", stationId: "ST01", source: "manual", ...extra }], rules: [] } }));
  }
  for (const extra of [{ mode: "blocked" }, { stationIds: [] }, { stationIds: ["ST01", "ST01"] }, { stationIds: ["ST01", "ST02"], mode: "fixed" }, { stationIds: Array(21).fill("ST01") }, { password: "do-not-store" }]) {
    invalid.push(preset({ configuration: { assignments: [], rules: [{ employeeId: "P1001", mode: "allowed", stationIds: ["ST01"], ...extra }] } }));
  }
  for (const key of ["assignments", "rules"]) {
    const item = preset().configuration[key][0];
    invalid.push(preset({ configuration: { assignments: [], rules: [], [key]: [item, item] } }));
  }
  for (const value of invalid) {
    f.advance(61000);
    const result = f.save(value);
    assert.equal(result.code, "COVERAGE_PRESET_INVALID", JSON.stringify(value));
    assert.equal(f.sheets.has(SHEET), false);
    assert.equal([...f.properties.keys()].some(key => key.startsWith("ROSARIO_OP_")), false);
    assert.equal(f.sheets.has("13_操作收據"), false);
  }
  for (const payload of [{ preset: preset(), password: "do-not-store" }, JSON.parse('{"preset":null,"__proto__":{"password":"do-not-store"}}')]) {
    assert.equal(f.write(f.token, "saveCoveragePreset", payload, { appVersion: VERSION }).code, "COVERAGE_PRESET_INVALID");
  }
});

test("formula-like text is literal and presets never write workforce or qualification authority", () => {
  const f = setup(), before = [...f.sheets].map(([name, sheet]) => [name, JSON.stringify(sheet.rows)]);
  const result = f.save(preset({ id: "=synthetic-id", name: "=HYPERLINK(\"synthetic\")" }));
  assert.equal(result.ok, true, result.message);
  assert.equal(f.load().presets[0].name, '=HYPERLINK("synthetic")');
  const writes = f.events.filter(event => event.name === SHEET && event.kind === "set").flatMap(event => event.data);
  assert.ok(writes.some(row => row[0] === "'=synthetic-id" && row[2].startsWith("'=")));
  for (const [name, rows] of before) assert.equal(JSON.stringify(f.sheets.get(name).rows), rows, name);
  assert.doesNotMatch(JSON.stringify(f.sheets.get(SHEET).rows), /Synthetic worker|Synthetic admin|synthetic-old-password/);
});

test("inactive people and all three simulation sources remain storable without granting qualifications", () => {
  const f = setup();
  f.people.rows[0].push("在職狀態"); f.people.rows[1].push("離職");
  for (const source of ["manual", "training", "officer"]) {
    const value = preset({ id: source, configuration: { assignments: [{ employeeId: "P1001", stationId: "ST01", source }], rules: [{ employeeId: "ROOT", mode: "fixed", stationIds: ["ST01"] }] } });
    assert.equal(f.save(value).ok, true);
  }
  assert.equal(f.load().presets.length, 3);
});

test("scope capacity is 20 with updates still allowed and no impact on other scopes", () => {
  const f = setup();
  for (let index = 0; index < 20; index++) assert.equal(f.save(preset({ id: `preset-${index}` })).ok, true);
  assert.equal(f.save(preset({ id: "too-many" })).code, "COVERAGE_PRESET_CAPACITY");
  assert.equal(f.save(preset({ id: "preset-0", name: "Updated" })).ok, true);
  assert.equal(f.save(preset({ id: "other-team", team: "TEAM_B" })).ok, true);
  assert.equal(f.load().presets.length, 20);
});

test("large valid configurations round trip in bounded JSON cells with small receipts", () => {
  const f = setup(), people = [], stations = [];
  for (let i = 0; i < 400; i++) {
    const id = `P${String(i).padStart(3, "0")}_${"x".repeat(75)}`;
    people.push(id); f.people.rows.push([id, "Synthetic person", "TEAM_A", "技術員", ""]);
  }
  for (let i = 0; i < 20; i++) {
    const id = `S${String(i).padStart(3, "0")}_${"y".repeat(75)}`;
    stations.push(id); f.sheets.get("02_站點主表").rows.push([id, "Synthetic station"]);
  }
  const configuration = { assignments: people.slice(0, 200).map(employeeId => ({ employeeId, stationId: stations[0], source: "training" })),
    rules: people.slice(200).map(employeeId => ({ employeeId, mode: "preferred", stationIds: stations })) };
  const saved = f.save(preset({ configuration }));
  assert.equal(saved.ok, true, saved.message);
  assert.deepEqual(f.load().presets[0].configuration, configuration);
  const cells = f.sheets.get(SHEET).rows[1].slice(7);
  assert.ok(cells.filter(Boolean).length > 1);
  assert.ok(cells.every(cell => cell.length <= 45000));
  assert.ok(JSON.stringify(saved).length < 1000);
  assert.ok(f.sheets.get("13_操作收據").rows.every(row => String(row[1]).length < 9000));
});

test("cross-list employee duplicates are rejected before receipts, revision changes or preset mutations", () => {
  const f = setup();
  let attempt = 0;
  const rejectDuplicate = (source, mode, employeeId) => {
    const before = JSON.stringify(f.sheets.get(SHEET)?.rows);
    const revision = f.context.getDataRevision_();
    const operationId = `OP_coverage_cross_list_${String(++attempt).padStart(8, "0")}`;
    const value = preset({ configuration: {
      assignments: [{ employeeId: "P1001", stationId: "ST01", source }],
      rules: [{ employeeId, mode, stationIds: ["ST01"] }],
    } });
    const result = f.save(value, f.token, { operationId });
    assert.equal(result.code, "COVERAGE_PRESET_INVALID", `${source}/${mode}/${employeeId}`);
    assert.equal(f.context.getDataRevision_(), revision);
    assert.equal(f.properties.has(`ROSARIO_OP_${operationId}`), false);
    assert.equal(JSON.stringify(f.sheets.get(SHEET)?.rows), before);
    const ledger = f.sheets.get("13_操作收據");
    assert.equal(ledger?.rows.some(row => row[0] === operationId) || false, false);
  };
  for (const source of ["manual", "training", "officer"]) {
    for (const mode of ["fixed", "allowed", "preferred"]) rejectDuplicate(source, mode, "P1001");
  }
  assert.equal(f.sheets.has(SHEET), false);
  assert.equal(f.sheets.has("13_操作收據"), false);
  assert.equal(f.save(preset()).ok, true);
  rejectDuplicate("manual", "fixed", " P1001 ");
  assert.equal(f.load().presets[0].configuration.rules[0].employeeId, "ROOT");
});

test("manual edits conflict and an identical operation replays without another preset mutation", () => {
  const f = setup(), value = preset(), operationId = "OP_coverage_replay_00000001";
  const first = f.save(value, f.token, { operationId });
  assert.equal(first.ok, true);
  const before = JSON.stringify(f.sheets.get(SHEET).rows);
  assert.equal(f.save(value, f.token, { operationId, expectedRevision: 0 }).replayed, true);
  assert.equal(JSON.stringify(f.sheets.get(SHEET).rows), before);
  f.sheets.get(SHEET).rows[1][2] = "Synthetic manual edit";
  const conflict = f.save({ ...value, name: "stale overwrite" });
  assert.equal(conflict.code, "REVISION_CONFLICT");
  assert.equal(f.sheets.get(SHEET).rows[1][2], "Synthetic manual edit");
  assert.equal(f.save({ ...value, name: "changed request" }, f.token, { operationId }).code, "OPERATION_CONFLICT");
});

test("batch failure restores the previous default and content; failed operations never rerun", () => {
  const f = setup();
  assert.equal(f.save(preset({ id: "first", isDefault: true })).ok, true);
  const before = JSON.stringify(f.sheets.get(SHEET).rows), setter = f.context.setLiteralValues_;
  let fail = true;
  f.context.setLiteralValues_ = (range, values) => {
    const result = setter(range, values);
    if (fail && values.some(row => row[0] === "second")) { fail = false; throw new Error("synthetic batch completion loss"); }
    return result;
  };
  const value = preset({ id: "second", isDefault: true }), operationId = "OP_coverage_rollback_00000001";
  const expectedRevision = f.context.getDataRevision_();
  const failed = f.save(value, f.token, { operationId, expectedRevision });
  assert.equal(failed.code, "COVERAGE_PRESET_SAVE_FAILED", failed.message);
  assert.equal(JSON.stringify(f.sheets.get(SHEET).rows), before);
  assert.equal(f.save(value, f.token, { operationId, expectedRevision }).code, "COVERAGE_PRESET_SAVE_FAILED");
  assert.equal(JSON.stringify(f.sheets.get(SHEET).rows), before);
  assert.equal(f.load().presets[0].isDefault, true);
});

test("failed first save removes only its newly-created sheet; failed rollback stays unknown and cannot repeat", () => {
  for (const failRollback of [false, true]) {
    const f = setup(), setter = f.context.setLiteralValues_;
    f.context.setLiteralValues_ = (range, values) => {
      const result = setter(range, values);
      if (values.some(row => row[0] === "new-preset")) throw new Error("synthetic write outcome loss");
      return result;
    };
    if (failRollback) f.spreadsheet.deleteSheet = () => { throw new Error("synthetic rollback failure"); };
    const value = preset({ id: "new-preset" }), operationId = "OP_coverage_unknown_00000001";
    const failed = f.save(value, f.token, { operationId, expectedRevision: 0 });
    assert.equal(failed.code, failRollback ? "WRITE_OUTCOME_UNKNOWN" : "COVERAGE_PRESET_SAVE_FAILED", failed.message);
    assert.equal(f.sheets.has(SHEET), failRollback);
    assert.equal(f.save(value, f.token, { operationId, expectedRevision: 0 }).code, failRollback ? "WRITE_OUTCOME_UNKNOWN" : "COVERAGE_PRESET_SAVE_FAILED");
    assert.equal(f.sheets.has(SHEET), failRollback);
    if (failRollback) assert.equal(f.post("operationStatus", { operationId }, { sessionToken: f.token }).status, "unknown");
  }
});

test("corrupt configuration and unknown stored keys fail closed without exposing another owner", () => {
  const f = setup(), admin = f.login("root", "synthetic-admin-password").sessionToken;
  assert.equal(f.save(preset()).ok, true);
  f.sheets.get(SHEET).rows[1][7] = JSON.stringify({ assignments: [], rules: [], password: "do-not-return" });
  assert.deepEqual(f.load("TEAM_A", "當班", admin).presets, []);
  const failed = f.load();
  assert.equal(failed.code, "COVERAGE_PRESET_STORAGE_INVALID");
  assert.doesNotMatch(JSON.stringify(failed), /do-not-return/);
});

test("server-generated IDs are returned and replayed without creating a second preset", () => {
  const f = setup(), value = preset(), operationId = "OP_coverage_generated_00000001";
  delete value.id;
  const first = f.save(value, f.token, { operationId, expectedRevision: 0 });
  assert.equal(first.ok, true, first.message);
  assert.match(first.presetId, /^COVERAGE_/);
  const replay = f.save(value, f.token, { operationId, expectedRevision: 0 });
  assert.equal(replay.replayed, true);
  assert.equal(replay.presetId, first.presetId);
  assert.equal(f.load().presets.length, 1);
});

test("a lost completion receipt remains unknown even when the preset data committed", () => {
  const f = setup(), value = preset(), operationId = "OP_coverage_receipt_loss_00000001";
  f.faults.ledgerWrite = true;
  const result = f.save(value, f.token, { operationId, expectedRevision: 0 });
  assert.equal(result.code, "WRITE_OUTCOME_UNKNOWN");
  assert.equal(f.load().presets.length, 1);
  const before = JSON.stringify(f.sheets.get(SHEET).rows);
  f.faults.ledgerWrite = false;
  assert.equal(f.save(value, f.token, { operationId, expectedRevision: 0 }).code, "WRITE_OUTCOME_UNKNOWN");
  assert.equal(JSON.stringify(f.sheets.get(SHEET).rows), before);
});

test("manual edits during preset preflight reject the new operation before reserving a receipt", () => {
  const f = setup();
  assert.equal(f.save(preset()).ok, true);
  const table = f.context.coveragePresetTable_;
  let changed = false;
  f.context.coveragePresetTable_ = () => {
    const result = table();
    if (!changed) { changed = true; f.people.rows[1][4] = "synthetic concurrent manual edit"; }
    return result;
  };
  const operationId = "OP_coverage_preflight_conflict_00000001";
  assert.equal(f.save(preset({ name: "must not replace" }), f.token, { operationId }).code, "REVISION_CONFLICT");
  assert.equal(f.properties.has(`ROSARIO_OP_${operationId}`), false);
  assert.equal(f.sheets.get(SHEET).rows[1][2], "Synthetic preset");
});

test("preset schema and formula cells are never silently rewritten", () => {
  const f = setup();
  assert.equal(f.save(preset()).ok, true);
  const sheet = f.sheets.get(SHEET), original = JSON.stringify(sheet.rows);
  sheet.formulas.set("2,3", "=synthetic_formula()");
  assert.equal(f.load().ok, true);
  assert.equal(f.save(preset({ name: "must not write" })).code, "COVERAGE_PRESET_STORAGE_INVALID");
  assert.equal(JSON.stringify(sheet.rows), original);
  sheet.formulas.clear(); sheet.rows[0].push("unknown");
  assert.equal(f.save(preset()).code, "REVISION_CONFLICT");
  assert.equal(f.load().code, "SHEET_SCHEMA_INVALID");
});
