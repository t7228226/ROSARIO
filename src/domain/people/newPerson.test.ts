import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Person } from "../../types";
import { prepareNewPerson } from "./newPerson";

function draft(patch: Partial<Person> = {}): Person {
  return {
    id: " p0180 ",
    name: " 新人員 ",
    shift: "翊展班",
    role: "",
    nationality: "",
    employmentStatus: "",
    ...patch,
  };
}

describe("prepareNewPerson", () => {
  it("整理工號與預設欄位", () => {
    const result = prepareNewPerson(draft(), []);
    assert.equal(result.error, "");
    assert.equal(result.person.id, "P0180");
    assert.equal(result.person.name, "新人員");
    assert.equal(result.person.role, "技術員");
    assert.equal(result.person.employmentStatus, "在職");
  });

  it("不分大小寫阻擋重複工號", () => {
    const existing = [draft({ id: "P0180", name: "既有人員" })];
    const result = prepareNewPerson(draft({ id: "p0180" }), existing);
    assert.match(result.error, /已存在/);
  });

  it("阻擋非系統班別", () => {
    const result = prepareNewPerson(draft({ shift: "其他班" }), []);
    assert.match(result.error, /四個班別/);
  });
});
