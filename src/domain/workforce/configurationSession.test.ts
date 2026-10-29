import assert from "node:assert/strict";
import { it } from "node:test";
import { changeConfiguration, emptyConfigurationSession, planningPlacementConflicts, readPlanningConfiguration, resetConfiguration, undoConfiguration } from "./configurationSession";
it("還原清空所有指定與規則，復原可取回；不修改輸入或預設", () => {
  const configuration = { assignments: [{ employeeId: "P", stationId: "A", source: "officer" as const }], rules: [{ employeeId: "Q", mode: "allowed" as const, stationIds: ["A", "B"] }] };
  const before = changeConfiguration(emptyConfigurationSession, configuration);
  const reset = resetConfiguration(before);
  assert.deepEqual(reset.configuration, { assignments: [], rules: [] });
  assert.deepEqual(undoConfiguration(reset).configuration, configuration);
  assert.equal(configuration.assignments.length, 1);
  assert.equal(emptyConfigurationSession.touched, false);
});
it("試排核對固定未安排及限定外站位，優先規則不當作硬限制", () => {
  const rules = [{ employeeId: "P", mode: "fixed" as const, stationIds: ["A"] }, { employeeId: "Q", mode: "allowed" as const, stationIds: ["B"] }, { employeeId: "R", mode: "preferred" as const, stationIds: ["B"] }];
  assert.deepEqual(planningPlacementConflicts(rules, { A: ["Q", "R"] }), ["P", "Q"]);
  assert.deepEqual(planningPlacementConflicts(rules, { A: ["P"], B: ["Q"] }), []);
});
it("暫停與關閉不刪除配置，歷史最多二十筆", () => {
  let session = emptyConfigurationSession;
  for (let i = 0; i < 40; i++) session = changeConfiguration(session, { assignments: [], rules: [{ employeeId: `${i}`, mode: "preferred", stationIds: ["A"] }] });
  const suspended = { ...session, enabled: false };
  assert.equal(suspended.configuration.rules[0].employeeId, "39");
  assert.equal(suspended.history.length, 20);
  assert.equal(undoConfiguration(emptyConfigurationSession), emptyConfigurationSession);
});
it("拒絕損壞或重複預設，避免部分套用或畫面崩潰", () => {
  assert.throws(() => readPlanningConfiguration({ assignments: [], rules: [{ employeeId: "P", mode: "allowed", stationIds: "A" }] }));
  assert.throws(() => readPlanningConfiguration({ assignments: [{ employeeId: "P", stationId: "A", source: "manual" }], rules: [{ employeeId: "P", mode: "allowed", stationIds: ["A"] }] }));
  assert.deepEqual(readPlanningConfiguration({ assignments: [], rules: [] }), { assignments: [], rules: [] });
});
