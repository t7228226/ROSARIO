import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitAlternatingRotationGroups, splitBalancedRotationRows } from "./rotationGroups";

describe("splitAlternatingRotationGroups", () => {
  it("依原順序交錯分配到 A、B 組", () => {
    const result = splitAlternatingRotationGroups(["甲", "乙", "丙", "丁", "戊"]);

    assert.deepEqual(result.groupA, ["甲", "丙", "戊"]);
    assert.deepEqual(result.groupB, ["乙", "丁"]);
  });

  it("空名單會產生兩個空組別", () => {
    assert.deepEqual(splitAlternatingRotationGroups([]), { groupA: [], groupB: [] });
  });

  it("每位人員只會出現在其中一組", () => {
    const people = ["A", "B", "C", "D", "E", "F"];
    const result = splitAlternatingRotationGroups(people);

    assert.deepEqual([...result.groupA, ...result.groupB].sort(), [...people].sort());
    assert.equal(new Set([...result.groupA, ...result.groupB]).size, people.length);
  });

  it("可指定由 B 組開始交錯", () => {
    const result = splitAlternatingRotationGroups(["甲", "乙", "丙"], "B");

    assert.deepEqual(result.groupA, ["乙"]);
    assert.deepEqual(result.groupB, ["甲", "丙"]);
  });
});

describe("splitBalancedRotationRows", () => {
  it("多站點含奇數人時會平衡全班 A、B 總人數", () => {
    const rows = [
      ["甲", "乙", "丙", "丁"],
      ["戊"],
      ["己", "庚", "辛"],
      ["壬"],
    ];
    const result = splitBalancedRotationRows(rows);
    const groupA = result.flatMap((groups) => groups.groupA);
    const groupB = result.flatMap((groups) => groups.groupB);

    assert.ok(Math.abs(groupA.length - groupB.length) <= 1);
    assert.deepEqual([...groupA, ...groupB].sort(), rows.flat().sort());
    assert.equal(new Set([...groupA, ...groupB]).size, rows.flat().length);
  });
});
