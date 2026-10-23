import { test } from "node:test";
import assert from "node:assert/strict";
import { compareBootstrap } from "./compareBootstrap";
import type { AppBootstrap } from "../../types";
test("refresh differences identify personnel edits and qualification conflicts without comparing passwords", () => {
  const before: AppBootstrap = { stations: [], people: [{ id: "QA", name: "測試", shift: "翊展班", role: "技術員", nationality: "本籍", employmentStatus: "在職", note: "本機編輯" }], qualifications: [{ employeeId: "QA", stationId: "A", status: "合格" }] };
  const after = structuredClone(before);
  after.people[0].note = "雲端編輯";
  after.qualifications[0].status = "不可排";
  const changes = compareBootstrap(before, after);
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0], { record: "QA 測試", field: "備註", before: "本機編輯", after: "雲端編輯" });
  assert.equal(changes[1].after, "不可排");
  assert.deepEqual(compareBootstrap(before, before), []);
});
