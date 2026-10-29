import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppBootstrap, Person } from "../../types";
import { sanitizeBootstrapData } from "./sanitizeBootstrap";

describe("sanitizeBootstrapData", () => {
  it("移除範本列、孤立關聯與所有密碼欄位", () => {
    const person = {
      id: "P001",
      name: "測試人員",
      shift: "翊展班",
      role: "技術員",
      nationality: "本國",
      employmentStatus: "在職",
      password: "secret",
      loginPassword: "secret",
      accountPassword: "secret",
      登入密碼: "secret",
    } as Person & Record<string, unknown>;
    const source: AppBootstrap = {
      people: [
        person,
        { id: "工號", name: "姓名", shift: "下拉選單", role: "說明", nationality: "", employmentStatus: "" },
      ],
      stations: [
        { id: "S1", name: "雷射", normalMin: 1, reliefMinPerBatch: 1 },
        { id: "站點代碼", name: "站點名稱", normalMin: 0, reliefMinPerBatch: 0 },
      ],
      qualifications: [
        { employeeId: "P001", stationId: "S1", status: "合格" },
        { employeeId: "P999", stationId: "S1", status: "合格" },
      ],
      stationRules: [
        { id: "R1", team: "翊展班", stationId: "S1", minRequired: 1 },
        { id: "R2", team: "翊展班", stationId: "S999", minRequired: 1 },
      ],
    };

    const result = sanitizeBootstrapData(source);
    assert.equal(result.people.length, 1);
    assert.equal(result.stations.length, 1);
    assert.equal(result.qualifications.length, 1);
    assert.equal(result.stationRules?.length, 1);
    assert.equal("password" in (result.people[0] as Person & Record<string, unknown>), false);
    assert.equal("loginPassword" in (result.people[0] as Person & Record<string, unknown>), false);
    assert.equal("accountPassword" in (result.people[0] as Person & Record<string, unknown>), false);
    assert.equal("登入密碼" in (result.people[0] as Person & Record<string, unknown>), false);
  });

  it("保留備註與說明中的範本文字及有效關聯，仍移除結構性範本列與密碼", () => {
    const markers = ["說明", "例如", "對應", "範例", "唯一主鍵", "不可重複", "不可重覆", "下拉選單", "正式姓名", "自由填寫", "可用值"];
    for (const marker of markers) {
      const validPerson = { id: "P001", name: "測試人員", shift: "翊展班", role: "技術員", nationality: "本國",
        employmentStatus: "在職", note: `工作${marker}已確認`, password: "synthetic", loginPassword: "synthetic",
        accountPassword: "synthetic", 登入密碼: "synthetic" } as Person & Record<string, unknown>;
      const validStation = { id: "S1", name: "雷射", normalMin: 1, reliefMinPerBatch: 1,
        description: `作業${marker}內容`, note: `站點${marker}內容` };
      const validRule = { id: "R1", team: "翊展班", stationId: "S1", minRequired: 1, note: `排班${marker}內容` };
      const source: AppBootstrap = {
        revision: 7,
        people: [validPerson,
          { ...validPerson, id: "P-TEMPLATE", name: "正式姓名" },
          { ...validPerson, id: "工號", name: "姓名" },
          { ...validPerson, id: "P-DROPDOWN", shift: "下拉選單" },
          { ...validPerson, id: "P-EMPTY", name: " " }],
        stations: [validStation,
          { ...validStation, id: "唯一主鍵", name: "站點名稱" },
          { ...validStation, id: "站點代碼" },
          { ...validStation, id: "S-EMPTY", name: " " }],
        qualifications: [{ employeeId: "P001", stationId: "S1", status: "合格" },
          { employeeId: "P-TEMPLATE", stationId: "S1", status: "合格" },
          { employeeId: "P001", stationId: "S1", status: "合格", rawStatus: "可用值" },
          { employeeId: "P001", stationId: "MISSING", status: "合格" }],
        stationRules: [validRule,
          { ...validRule, id: "R-TEMPLATE", dayKey: "例如" },
          { ...validRule, id: "R-TEAM", team: "對應班別" },
          { ...validRule, id: "R-ORPHAN", stationId: "MISSING" }],
      };
      const snapshot = structuredClone(source);
      const result = sanitizeBootstrapData(source);
      assert.deepEqual(result.people.map((person) => person.id), ["P001"], marker);
      assert.equal(result.people[0].note, validPerson.note, marker);
      assert.deepEqual(result.stations, [validStation], marker);
      assert.deepEqual(result.qualifications, [{ employeeId: "P001", stationId: "S1", status: "合格" }], marker);
      assert.deepEqual(result.stationRules, [validRule], marker);
      assert.equal(result.revision, 7);
      for (const key of ["password", "loginPassword", "accountPassword", "登入密碼"]) {
        assert.equal(key in result.people[0], false, `${marker}: ${key}`);
      }
      assert.deepEqual(source, snapshot, marker);
    }
  });
});
