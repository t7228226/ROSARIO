import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gasSource = await readFile(path.join(root, "gas-login-fallback-2026-07-01.js"), "utf8");

function createGasContext({ role = "技術員", allowedPermissions = ["PERM_005"] } = {}) {
  const properties = new Map();
  const lock = { waitLock() {}, releaseLock() {} };
  const propertyStore = {
    getProperty(key) { return properties.has(key) ? properties.get(key) : null; },
    setProperty(key, value) { properties.set(key, String(value)); },
    deleteProperty(key) { properties.delete(key); },
    getProperties() { return Object.fromEntries(properties); },
  };
  let uuidCounter = 0;
  const context = vm.createContext({
    console,
    LockService: {
      getDocumentLock: () => lock,
      getScriptLock: () => lock,
    },
    PropertiesService: {
      getScriptProperties: () => propertyStore,
    },
    Utilities: {
      Charset: { UTF_8: "utf8" },
      DigestAlgorithm: { SHA_256: "sha256" },
      getUuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`,
      computeDigest: (_algorithm, value) => [...createHash("sha256").update(String(value)).digest()],
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString("base64url"),
    },
  });
  vm.runInContext(gasSource, context);

  const accountRows = [{
    工號: "P1001",
    登入帳號: "worker",
    登入密碼: "correct-password",
    系統權限: role,
    啟用狀態: "啟用",
  }];
  const peopleRows = [{ id: "P1001", name: "測試人員", role: "技術員", shift: "翊展班" }];
  const permissionItems = allowedPermissions.map((permissionId) => ({
    權限ID: permissionId,
    啟用狀態: "啟用",
  }));
  const rolePermissions = allowedPermissions.map((permissionId) => ({
    角色: role,
    權限ID: permissionId,
    允許: "Y",
    啟用狀態: "啟用",
  }));

  context.normalizePeople_ = (rows) => rows;
  context.getSheetObjects_ = (sheetName) => {
    if (sheetName === "07_帳號管理") return accountRows;
    if (sheetName === "01_人員主表") return peopleRows;
    if (sheetName === "08_權限項目") return permissionItems;
    if (sheetName === "09_角色權限設定") return rolePermissions;
    if (sheetName === "10_個人例外權限") return [];
    return [];
  };
  context.assertWritableAppVersion_ = () => true;

  return { context, properties, accountRows, peopleRows };
}

test("login issues a server session without returning the password", () => {
  const { context } = createGasContext();
  const result = context.login_({
    account: "worker",
    password: "correct-password",
    sessionDurationMs: 8 * 60 * 60 * 1000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.user.id, "P1001");
  assert.match(result.sessionToken, /^[A-Za-z0-9_-]{40,}$/);
  assert.ok(result.sessionExpiresAt > Date.now());
  assert.equal("password" in result.user, false);
  assert.equal("loginPassword" in result.user, false);
});

test("public GET cannot read bootstrap data", () => {
  const { context } = createGasContext();
  context.jsonOutput_ = (value) => value;

  const result = context.doGet({ parameter: { action: "bootstrap" } });
  assert.equal(result.ok, false);
  assert.equal(result.code, "POST_REQUIRED");
});

test("non-admin bootstrap strips account metadata from personnel records", () => {
  const { context } = createGasContext();
  const login = context.login_({ account: "worker", password: "correct-password" });
  context.buildBootstrap_ = () => ({
    ok: true,
    people: [
      { id: "P1001", name: "測試人員", account: "worker", systemPermission: "技術員" },
      { id: "P2002", name: "其他人員", account: "other", systemPermission: "主任" },
    ],
    stations: [],
    qualifications: [],
    stationRules: [],
  });

  const result = context.buildBootstrapForSession_(context.requireSession_(login.sessionToken));
  assert.equal("account" in result.people[0], false);
  assert.equal(result.people[0].systemPermission, "技術員");
  assert.equal("account" in result.people[1], false);
  assert.equal("systemPermission" in result.people[1], false);
});

test("session restore falls back to a matching login account when account employee ID is blank", () => {
  const { context, accountRows } = createGasContext();
  accountRows[0].工號 = "";
  accountRows[0].登入帳號 = "P1001";

  const login = context.login_({ account: "P1001", password: "correct-password" });
  const restored = context.validateSessionResponse_(login.sessionToken, {});

  assert.equal(login.ok, true);
  assert.equal(restored.ok, true);
  assert.equal(restored.user.id, "P1001");
});

test("password hashing verifies the correct password without storing plaintext", () => {
  const { context } = createGasContext();
  const hashed = context.hashPassword_("correct-password", "fixed-salt");

  assert.match(hashed, /^rosario-v1\$fixed-salt\$/);
  assert.equal(hashed.includes("correct-password"), false);
  assert.equal(context.verifyPassword_("correct-password", hashed), true);
  assert.equal(context.verifyPassword_("wrong-password", hashed), false);
});

test("write requests reject missing sessions before executing callbacks", () => {
  const { context } = createGasContext();
  let writes = 0;

  assert.throws(() => context.executeWriteRequest_(
    "upsertQualification",
    { appVersion: "2026-08-10-004" },
    {},
    () => { writes += 1; return { ok: true }; }
  ), /登入|工作階段/);
  assert.equal(writes, 0);
});

test("server permissions allow the matching action and reject privilege escalation", () => {
  const { context } = createGasContext({ allowedPermissions: ["PERM_005"] });
  const login = context.login_({ account: "worker", password: "correct-password" });
  let qualificationWrites = 0;
  let ruleWrites = 0;

  const allowed = context.executeWriteRequest_(
    "upsertQualification",
    { appVersion: "2026-08-10-004", sessionToken: login.sessionToken },
    {},
    () => { qualificationWrites += 1; return { ok: true }; }
  );
  assert.equal(allowed.ok, true);
  assert.equal(qualificationWrites, 1);

  assert.throws(() => context.executeWriteRequest_(
    "updateStationRule",
    { appVersion: "2026-08-10-004", sessionToken: login.sessionToken },
    {},
    () => { ruleWrites += 1; return { ok: true }; }
  ), /權限不足/);
  assert.equal(ruleWrites, 0);
});

test("station rule writes are limited to the signed-in director's own team", () => {
  const { context } = createGasContext({ role: "主任", allowedPermissions: ["PERM_012"] });
  const login = context.login_({ account: "worker", password: "correct-password" });
  let writes = 0;

  context.executeWriteRequest_(
    "updateStationRule",
    { appVersion: "2026-08-10-004", sessionToken: login.sessionToken },
    { team: "翊展班" },
    () => { writes += 1; return { ok: true }; }
  );
  assert.equal(writes, 1);

  assert.throws(() => context.executeWriteRequest_(
    "updateStationRule",
    { appVersion: "2026-08-10-004", sessionToken: login.sessionToken },
    { team: "俊志班" },
    () => { writes += 1; return { ok: true }; }
  ), /自己班別/);
  assert.equal(writes, 1);
});

test("logout revokes the token and expired sessions cannot be reused", () => {
  const { context, properties } = createGasContext();
  const firstLogin = context.login_({ account: "worker", password: "correct-password" });
  assert.equal(context.logout_({ sessionToken: firstLogin.sessionToken }).ok, true);
  assert.throws(() => context.requireSession_(firstLogin.sessionToken), /登入|工作階段/);

  const secondLogin = context.login_({ account: "worker", password: "correct-password" });
  const propertyKey = context.sessionPropertyKey_(secondLogin.sessionToken);
  const session = JSON.parse(properties.get(propertyKey));
  properties.set(propertyKey, JSON.stringify({ ...session, expiresAt: Date.now() - 1 }));
  assert.throws(() => context.requireSession_(secondLogin.sessionToken), /逾時|登入/);
  assert.equal(properties.has(propertyKey), false);
});

test("operation status cannot be read by a different signed-in user", () => {
  const { context } = createGasContext();
  const owner = { employeeId: "P1001", role: "技術員" };
  const stranger = { employeeId: "P2002", role: "技術員" };
  const operationId = "OP_updatePerson_87654321";

  context.executeReliableWrite_("updatePerson", operationId, () => ({ ok: true }), owner);
  assert.equal(context.getOperationStatus_(operationId, owner).status, "success");
  assert.throws(() => context.getOperationStatus_(operationId, stranger), /其他使用者|權限/);
});
