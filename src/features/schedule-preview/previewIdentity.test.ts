import { test } from "node:test";
import assert from "node:assert/strict";
import { previewName, uniquePreviewPeople } from "./previewIdentity";

test("same names retain distinct employee identities in preview and export", () => {
  const people = [{ id: "A", name: "測試姓名" }, { id: "B", name: "測試姓名" }];
  const rows = uniquePreviewPeople(people.map((p) => ({ employeeId: p.id, name: previewName(p, people) })));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "測試姓名（A）");
  assert.equal(uniquePreviewPeople([...rows, rows[0]]).length, 2);
});
