import assert from "node:assert/strict";
import { it } from "node:test";
import { compareConfigurationAssignments, mergeConfigurationAssignments, setConfigurationAssignment } from "./configuration";
import { evaluateWorkforceScenario } from "./engine";
import type { AppBootstrap, Person } from "../../types";

const person = (id: string, role = "技術員"): Person => ({ id, name: id, role, shift: "翊展班", nationality: "本籍", employmentStatus: "在職" });
const snapshot: AppBootstrap = {
  people: [person("flex"), person("onlyA"), person("leader", "站長"), person("officer", "領班"), person("trainee")],
  stations: ["A", "B", "C"].map((id) => ({ id, name: id, normalMin: 1, reliefMinPerBatch: 1 })),
  stationRules: ["A", "B", "C"].map((stationId) => ({ id: stationId, stationId, team: "翊展班", dayKey: "當班", enabled: true, minRequired: 1 })),
  qualifications: [
    ...[["flex", "A"], ["flex", "B"], ["onlyA", "A"], ["leader", "C"], ["officer", "B"]].map(([employeeId, stationId]) => ({ employeeId, stationId, status: "合格" as const })),
    { employeeId: "trainee", stationId: "B", status: "訓練中" },
  ],
};

it("編輯取代同一人的先前指定，保留其他情境", () => {
  const assignments = mergeConfigurationAssignments([{ employeeId: "flex", stationId: "B", source: "training" }, { employeeId: "officer", stationId: "B", source: "officer" }], [{ employeeId: "flex", stationId: "A", source: "manual" }]);
  assert.equal(new Set(assignments.map((item) => item.employeeId)).size, 2);
  assert.equal(assignments.find((item) => item.employeeId === "flex")?.stationId, "A");
  assert.equal(setConfigurationAssignment(assignments, { employeeId: "flex", stationId: "B", source: "manual" }).length, 2);
});

it("固定彈性人員後會揭露其他站缺口；解除可恢復最大覆蓋", () => {
  const baseline = evaluateWorkforceScenario(snapshot, { team: "翊展班", mode: "當班" });
  assert.equal(baseline.analysis.shortage, 0);
  const edited = evaluateWorkforceScenario(snapshot, { team: "翊展班", mode: "當班", assignments: [{ employeeId: "flex", stationId: "A", source: "manual" }] });
  assert.equal(edited.analysis.shortage, 1);
  assert.equal(edited.rows.find((row) => row.stationId === "B")?.shortage, 1);
  assert.equal(new Set(Object.values(edited.assignments).flat()).size, Object.values(edited.assignments).flat().length);
  assert.ok(compareConfigurationAssignments(baseline.assignments, edited.assignments).some((item) => item.employeeId === "flex" && item.to === "A"));
});

it("站長只計入一次，訓練不當作合格，缺勤固定無效", () => {
  const result = evaluateWorkforceScenario(snapshot, { team: "翊展班", mode: "當班", unavailableIds: ["leader"], assignments: [{ employeeId: "leader", stationId: "C", source: "manual" }, { employeeId: "trainee", stationId: "B", source: "manual" }] });
  assert.deepEqual(result.violations.map((item) => item.code), ["ABSENT_ASSIGNMENT", "QUALIFICATION_REQUIRED"]);
  assert.equal(result.analysis.shortage, 1);
  assert.ok(!Object.values(result.assignments).flat().includes("officer"));
});
