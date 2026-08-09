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
});
