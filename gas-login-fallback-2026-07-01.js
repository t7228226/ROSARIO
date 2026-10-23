/**
 * 站點資格管理系統 - Apps Script 後端
 * 
 * 這版是依目前你上傳的試算表原檔設計：
 * 01_人員主表
 * 02_站點主表
 * 03_站點矩陣（人工維護矩陣）
 * 03_資格明細（系統讀取長表，由矩陣同步產生）
 * 04_站點規則
 * 06_資格異動紀錄
 * 07_帳號管理
 * 08_權限項目
 * 09_角色權限設定
 * 10_個人例外權限
 * 11_站點試排紀錄
 * 12_站點試排明細
 *
 * 特別處理：
 * 1. 04_站點規則 即使仍保留「日別」，bootstrap 仍會自動投影成「單班規則」給前端。
 * 2. 若 04 沒有「輪休需求(單批)」，會優先改寫 02_站點主表 的「輪休最低人數」。
 * 3. updateStationRule 會同步更新同班同站的所有規則列，避免三日別殘留不同值。
 * 4. upsertQualification / deleteQualification 會自動寫入 06_資格異動紀錄。
 * 5. bootstrap 只回傳日常操作必要資料，權限設定改由 permissionConfig 背景載入。
 */

const SHEETS = {
  PEOPLE: '01_人員主表',
  STATIONS: '02_站點主表',
  QUALIFICATION_MATRIX: '03_站點矩陣',
  QUALIFICATIONS: '03_資格明細',
  RULES: '04_站點規則',
  CHANGE_LOG: '06_資格異動紀錄',
  ACCOUNTS: '07_帳號管理',
  PERMISSION_ITEMS: '08_權限項目',
  ROLE_PERMISSIONS: '09_角色權限設定',
  PERSONAL_PERMISSION_EXCEPTIONS: '10_個人例外權限',
  SCHEDULE_DRAFTS: '11_站點試排紀錄',
  SCHEDULE_DRAFT_DETAILS: '12_站點試排明細',
  SYSTEM: '00_系統設定',
};

const SETTINGS = {
  // 若載入速度或 Google 配額壓力變大，可改成 false，改用 action=syncQualificationsFromMatrix 手動同步。
  AUTO_SYNC_QUALIFICATIONS_FROM_MATRIX_ON_BOOTSTRAP: false,

  // 前端版本防護：APP_VERSION 是目前最新版本，MIN_WRITE_VERSION 是允許寫入的最低版本。
  // 若 00_系統設定 內有更高版本才採用，避免舊設定覆蓋新部署。
  APP_VERSION: '2026-10-24-013',
  MIN_WRITE_VERSION: '2026-10-24-013',
  OPERATION_TTL_MS: 24 * 60 * 60 * 1000,
  OPERATION_MAX_RECORDS: 160,
  OPERATION_STALE_MS: 7 * 60 * 1000,
  OPERATION_STORAGE_BUDGET: 250000,
  WRITE_LOCK_TIMEOUT_MS: 20000,
  SESSION_DEFAULT_TTL_MS: 12 * 60 * 60 * 1000,
  SESSION_MIN_TTL_MS: 30 * 60 * 1000,
  SESSION_MAX_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  SESSION_MAX_RECORDS: 240,
  LOGIN_FAILURE_LIMIT: 5,
  LOGIN_FAILURE_WINDOW_MS: 5 * 60 * 1000,
  LOGIN_COOLDOWN_MS: 60 * 1000,
  LOGIN_MAX_RECORDS: 240,
  RULE_DIRECTOR_ROLES: ['主任'],
};

const OPERATION_PROPERTY_PREFIX = 'ROSARIO_OP_';
const SESSION_PROPERTY_PREFIX = 'ROSARIO_SESSION_';
const PASSWORD_HASH_PREFIX = 'rosario-v1$';
const PASSWORD_PEPPER_PROPERTY = 'ROSARIO_PASSWORD_PEPPER';
const LOGIN_PROPERTY_PREFIX = 'ROSARIO_LOGIN_';
const DATA_REVISION_PROPERTY = 'ROSARIO_DATA_REVISION';
const DATA_FINGERPRINT_PROPERTY = 'ROSARIO_DATA_FINGERPRINT';
let scriptLockHeld_ = false;
let requestSheetCache_ = null;
let dataMutationAttempted_ = false;

const ACTION_PERMISSION_MAP = {
  upsertQualification: 'PERM_005',
  deleteQualification: 'PERM_005',
  updateStationRule: 'PERM_012',
  updatePerson: 'PERM_014',
  createPerson: 'PERM_014',
  updatePermissionItem: 'PERM_016',
  updateRolePermission: 'PERM_016',
  upsertPersonalPermissionException: 'PERM_016',
  deletePersonalPermissionException: 'PERM_016',
  saveScheduleDraft: 'PERM_008',
  syncQualificationsFromMatrix: 'PERM_005',
  acknowledgeOperation: 'PERM_016',
};

const SUPER_ADMIN_ACTIONS = {
  updatePermissionItem: true,
  updateRolePermission: true,
  upsertPersonalPermissionException: true,
  deletePersonalPermissionException: true,
  acknowledgeOperation: true,
};

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || '').trim();
    if (action === 'version') {
      return jsonOutput_(buildVersionStatus_((e && e.parameter && e.parameter.appVersion) || ''));
    }
    if (action === 'bootstrap' || action === 'syncQualificationsFromMatrix' || action === 'matrixDebug' || action === 'permissionConfig' || action === 'loadScheduleDrafts' || action === 'operationStatus' || action === 'listOperations') {
      return jsonOutput_({ ok: false, code: 'POST_REQUIRED', message: '此操作必須使用已驗證的 POST 請求。' });
    }
    return jsonOutput_({ ok: false, message: 'Unknown GET action', action });
  } catch (error) {
    return jsonOutput_(errorPayload_(error));
  }
}

function doPost(e) {
  requestSheetCache_ = Object.create(null);
  try {
    const body = parsePostBody_(e);
    const action = String(body.action || '').trim();
    const payload = body.payload || {};

    return withScriptLock_(function () {
      switch (action) {
        case 'version':
          return jsonOutput_(buildVersionStatus_(body.appVersion || body.version || payload.appVersion));
        case 'login':
          return jsonOutput_(login_(payload));
        case 'session':
          return jsonOutput_(validateSessionResponse_(resolveSessionToken_(body, payload), payload));
        case 'logout':
          return jsonOutput_(logout_({ sessionToken: resolveSessionToken_(body, payload) }));
        case 'upsertQualification':
          return jsonOutput_(executeWriteRequest_(action, body, payload, function () { return upsertQualification_(payload); }));
        case 'deleteQualification':
          return jsonOutput_(executeWriteRequest_(action, body, payload, function () { return deleteQualification_(payload); }));
        case 'updateStationRule':
          return jsonOutput_(executeWriteRequest_(action, body, payload, function () { return updateStationRule_(payload); }));
        case 'updatePerson':
          return jsonOutput_(executeWriteRequest_(action, body, payload, function (session) { return updatePerson_(payload, session); }));
        case 'createPerson':
          return jsonOutput_(executeWriteRequest_(action, body, payload, function () { return createPerson_(payload); }));
        case 'acknowledgeOperation':
          return jsonOutput_(executeWriteRequest_(action, body, payload, function (session) { return acknowledgeOperation_(payload, session); }));
        case 'updatePermissionItem':
          return jsonOutput_(executeWriteRequest_(action, body, payload, function () { return updatePermissionItem_(payload); }));
        case 'updateRolePermission':
          return jsonOutput_(executeWriteRequest_(action, body, payload, function () { return updateRolePermission_(payload); }));
        case 'upsertPersonalPermissionException':
          return jsonOutput_(executeWriteRequest_(action, body, payload, function () { return upsertPersonalPermissionException_(payload); }));
        case 'deletePersonalPermissionException':
          return jsonOutput_(executeWriteRequest_(action, body, payload, function () { return deletePersonalPermissionException_(payload); }));
        case 'saveScheduleDraft':
          return jsonOutput_(executeWriteRequest_(action, body, payload, function (session) { return saveScheduleDraft_(payload, session); }));
        case 'loadScheduleDrafts': {
          const session = assertReadPermission_(resolveSessionToken_(body, payload), 'PERM_007');
          return jsonOutput_(readRevisionSnapshot_(function () { return loadScheduleDrafts_(payload, session); }));
        }
        case 'permissionConfig': {
          const session = requireSession_(resolveSessionToken_(body, payload));
          return jsonOutput_(readRevisionSnapshot_(function () { return buildPermissionConfigForSession_(session); }));
        }
        case 'syncQualificationsFromMatrix':
          return jsonOutput_(executeWriteRequest_(action, body, payload, function () { return syncQualificationsFromMatrix_(payload); }));
        case 'operationStatus':
          return jsonOutput_(getOperationStatus_(body.operationId || payload.operationId || '', requireSession_(resolveSessionToken_(body, payload))));
        case 'listOperations':
          return jsonOutput_(listOperations_(requireSession_(resolveSessionToken_(body, payload)), payload));
        case 'matrixDebug':
          assertSuperAdmin_(requireSession_(resolveSessionToken_(body, payload)));
          return jsonOutput_(debugQualificationMatrix_());
        case 'bootstrap': {
          const session = requireSession_(resolveSessionToken_(body, payload));
          return jsonOutput_(readRevisionSnapshot_(function () { return buildBootstrapForSession_(session); }));
        }
        default:
          return jsonOutput_({ ok: false, message: 'Unknown POST action', action });
      }
    });
  } catch (error) {
    return jsonOutput_(errorPayload_(error));
  } finally {
    requestSheetCache_ = null;
  }
}

function executeWriteRequest_(action, body, payload, callback) {
  return withScriptLock_(function () {
    const session = authorizeWriteAction_(resolveSessionToken_(body, payload), action, payload);
    assertWritableAppVersion_(body.appVersion || body.version || payload.appVersion);
    const operationId = normalizeString_(body.operationId || payload.operationId);
    if (!operationId) throw authError_('寫入必須提供操作編號。', 'OPERATION_REQUIRED');
    const expectedRevision = body.expectedRevision !== undefined ? body.expectedRevision : payload.expectedRevision;
    return executeReliableWrite_(action, operationId, function () {
      assertExpectedRevision_(expectedRevision);
      const validationOnly = action === 'createPerson' && (payload.validateOnly === true || normalizeString_(payload.validateOnly).toUpperCase() === 'Y');
      // Advance before mutation so a partial failure also invalidates stale snapshots.
      const revision = validationOnly ? getDataRevision_() : advanceDataRevision_();
      try {
        return Object.assign({}, callback(session), { revision: revision });
      } catch (error) {
        error.revision = revision;
        throw error;
      }
    }, session, { payload: operationPayload_(payload), expectedRevision: expectedRevision });
  });
}

function executeReliableWrite_(action, operationId, callback, session, request) {
  return withScriptLock_(function () {
    if (!operationId) {
      return withDocumentWriteLock_(callback);
    }
    if (!/^OP_[A-Za-z0-9_-]{8,117}$/.test(operationId)) {
      throw new Error('操作編號格式不正確');
    }

    const ownerId = session ? normalizeString_(session.employeeId) : '';
    const requestDigest = digestText_(canonicalJson_(request || {}));
    const begin = beginOperation_(action, operationId, ownerId, requestDigest);
    if (!begin.started) {
      assertOperationOwner_(begin.record, session);
      if (begin.record.action !== action || begin.record.requestDigest !== requestDigest) {
        throw authError_('操作編號已用於不同請求，請重新整理後建立新操作。', 'OPERATION_CONFLICT');
      }
      return operationRecordResponse_(operationId, begin.record);
    }

    let result;
    const beforeFingerprint = PropertiesService.getScriptProperties().getProperty(DATA_FINGERPRINT_PROPERTY);
    dataMutationAttempted_ = false;
    try {
      result = withDocumentWriteLock_(callback);
    } catch (error) {
      let changed = dataMutationAttempted_;
      const baselineFingerprint = beforeFingerprint || PropertiesService.getScriptProperties().getProperty(DATA_FINGERPRINT_PROPERTY);
      if (changed && !error.outcomeUnknown && baselineFingerprint) {
        try { changed = dataFingerprint_() !== baselineFingerprint; } catch (_) { changed = true; }
      }
      if (error.outcomeUnknown || changed) {
        const unknown = authError_('部分資料可能已寫入，請至操作狀態核對；勿重新建立相同操作。', 'WRITE_OUTCOME_UNKNOWN');
        unknown.revision = getDataRevision_();
        try { finishOperation_(operationId, 'unknown', null, unknown.message, unknown); } catch (_) { /* Keep the processing reservation. */ }
        throw unknown;
      }
      const message = error && error.message ? error.message : String(error);
      try {
        finishOperation_(operationId, 'failed', null, message, error);
      } catch (recordError) {
        const unknown = authError_('操作結果無法保存，請重新載入確認，勿建立新操作重送。', 'WRITE_OUTCOME_UNKNOWN');
        unknown.revision = getDataRevision_();
        throw unknown;
      }
      throw error;
    }
    // If persisting completion fails, keep processing: never report a committed write as safe to repeat.
    try {
      if (request) storeDataFingerprint_();
      finishOperation_(operationId, 'success', result, '');
    } catch (error) {
      const unknown = authError_('寫入可能已完成，但無法保存完成紀錄；請重新載入確認，勿建立新操作重送。', 'WRITE_OUTCOME_UNKNOWN');
      unknown.revision = getDataRevision_();
      try { finishOperation_(operationId, 'unknown', null, unknown.message, unknown); } catch (_) { /* Keep the processing reservation. */ }
      throw unknown;
    }
    return Object.assign({}, result || { ok: true }, {
      operationId: operationId,
      operationStatus: 'success',
    });
  });
}

function withScriptLock_(callback) {
  if (scriptLockHeld_) return callback();
  const lock = LockService.getScriptLock();
  lock.waitLock(SETTINGS.WRITE_LOCK_TIMEOUT_MS);
  scriptLockHeld_ = true;
  try {
    return callback();
  } finally {
    scriptLockHeld_ = false;
    lock.releaseLock();
  }
}

function withDocumentWriteLock_(callback) {
  return withScriptLock_(function () {
    try {
      return callback();
    } finally {
      try {
        SpreadsheetApp.flush();
      } catch (error) {
        const unknown = authError_('試算表寫入結果無法確認，請重新載入檢查，勿建立新操作重送。', 'WRITE_OUTCOME_UNKNOWN');
        unknown.outcomeUnknown = true;
        unknown.revision = getDataRevision_();
        throw unknown;
      }
    }
  });
}

function getDataRevision_() {
  const value = PropertiesService.getScriptProperties().getProperty(DATA_REVISION_PROPERTY);
  if (value === null) return 0;
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) throw authError_('資料版本無效，請聯絡管理員。', 'REVISION_INVALID');
  return revision;
}

function dataFingerprint_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const content = Object.keys(SHEETS).sort().map(function (key) {
    const name = SHEETS[key];
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) return [name, null];
    const range = sheet.getDataRange();
    return [name, range.getValues(), range.getFormulas()];
  });
  return digestText_(canonicalJson_(content));
}

function storeDataFingerprint_() {
  const fingerprint = dataFingerprint_();
  PropertiesService.getScriptProperties().setProperty(DATA_FINGERPRINT_PROPERTY, fingerprint);
  return fingerprint;
}

function syncDataRevision_() {
  const properties = PropertiesService.getScriptProperties();
  const fingerprint = dataFingerprint_();
  const previous = properties.getProperty(DATA_FINGERPRINT_PROPERTY);
  if (previous && previous !== fingerprint) advanceDataRevision_();
  properties.setProperty(DATA_FINGERPRINT_PROPERTY, fingerprint);
  return getDataRevision_();
}

function readRevisionSnapshot_(callback) {
  // A script lock excludes other app requests, not a person editing the Sheet.
  return withScriptLock_(function () {
    const revision = syncDataRevision_();
    const fingerprint = PropertiesService.getScriptProperties().getProperty(DATA_FINGERPRINT_PROPERTY);
    const result = callback();
    if (fingerprint !== dataFingerprint_()) {
      const error = authError_('讀取期間試算表內容已變動，請重新載入。', 'REVISION_CONFLICT');
      error.revision = syncDataRevision_();
      throw error;
    }
    return Object.assign({}, result, { revision: revision });
  });
}

function advanceDataRevision_() {
  const revision = getDataRevision_() + 1;
  if (!Number.isSafeInteger(revision)) throw authError_('資料版本超出範圍。', 'REVISION_INVALID');
  PropertiesService.getScriptProperties().setProperty(DATA_REVISION_PROPERTY, String(revision));
  return revision;
}

function assertExpectedRevision_(expectedRevision) {
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw authError_('請重新載入資料並提供 expectedRevision。', 'REVISION_REQUIRED');
  }
  const revision = syncDataRevision_();
  if (expectedRevision !== revision) {
    const error = authError_('資料已被其他操作更新，請重新載入後確認再送出。', 'REVISION_CONFLICT');
    error.revision = revision;
    throw error;
  }
}

function operationPayload_(payload) {
  const result = {};
  Object.keys(payload || {}).forEach(function (key) {
    if (['sessionToken', 'operationId', 'appVersion', 'expectedRevision'].indexOf(key) < 0) result[key] = payload[key];
  });
  return result;
}

function canonicalJson_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(canonicalJson_).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).filter(function (key) { return value[key] !== undefined; }).sort().map(function (key) {
      return JSON.stringify(key) + ':' + canonicalJson_(value[key]);
    }).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

function beginOperation_(action, operationId, ownerId, requestDigest) {
  return withScriptLock_(function () {
    const properties = PropertiesService.getScriptProperties();
    pruneOperationRecords_(properties);
    const existing = readOperationRecord_(properties, operationId);
    if (existing) return { started: false, record: existing };
    const count = Object.keys(properties.getProperties()).filter(function (key) { return key.indexOf(OPERATION_PROPERTY_PREFIX) === 0; }).length;
    if (count >= SETTINGS.OPERATION_MAX_RECORDS) throw authError_('操作紀錄容量已滿，請稍後再試；既有操作不會重複執行。', 'OPERATION_CAPACITY');
    const stored = properties.getProperties();
    const size = Object.keys(stored).reduce(function (total, key) { return total + (key.length + String(stored[key]).length) * 3; }, 0);
    if (size > SETTINGS.OPERATION_STORAGE_BUDGET) throw authError_('操作儲存空間不足，本次未寫入；請聯絡管理員。', 'OPERATION_CAPACITY');

    const record = {
      action: action,
      ownerId: normalizeString_(ownerId),
      requestDigest: requestDigest,
      status: 'processing',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    try {
      properties.setProperty(operationPropertyKey_(operationId), JSON.stringify(record));
    } catch (error) {
      throw authError_('無法保留操作紀錄，目前未執行寫入。', 'OPERATION_CAPACITY');
    }
    return { started: true, record: record };
  });
}

function finishOperation_(operationId, status, result, message, error) {
  return withScriptLock_(function () {
    const properties = PropertiesService.getScriptProperties();
    const current = readOperationRecord_(properties, operationId) || { createdAt: Date.now() };
    const record = {
      action: current.action || '',
      ownerId: current.ownerId || '',
      requestDigest: current.requestDigest || '',
      status: status,
      createdAt: current.createdAt || Date.now(),
      updatedAt: Date.now(),
      result: result || null,
      message: message || '',
      code: error && error.code ? error.code : '',
      revision: error && error.revision !== undefined ? error.revision : undefined,
    };
    properties.setProperty(operationPropertyKey_(operationId), JSON.stringify(record));
  });
}

function getOperationStatus_(operationId, session) {
  operationId = normalizeString_(operationId);
  if (!operationId) {
    return { ok: false, message: '缺少操作編號' };
  }
  const properties = PropertiesService.getScriptProperties();
  const record = readOperationRecord_(properties, operationId);
  if (!record) {
    return { ok: true, found: false, status: 'unknown', operationId: operationId };
  }
  assertOperationOwner_(record, session);
  return {
    ok: true,
    found: true,
    status: visibleOperationStatus_(record),
    operationId: operationId,
    result: record.status === 'success' ? (record.result || { ok: true }) : undefined,
    message: record.message || '',
    code: record.code || undefined,
    revision: record.revision,
    updatedAt: record.updatedAt || record.createdAt || 0,
  };
}

function visibleOperationStatus_(record) {
  if (record.status === 'processing' && Date.now() - Number(record.updatedAt || record.createdAt || 0) > SETTINGS.OPERATION_STALE_MS) return 'unknown';
  return record.status;
}

function listOperations_(session, payload) {
  const all = payload && payload.all === true;
  if (all) assertSuperAdmin_(session);
  const properties = PropertiesService.getScriptProperties();
  pruneOperationRecords_(properties);
  const items = Object.keys(properties.getProperties()).filter(function (key) { return key.indexOf(OPERATION_PROPERTY_PREFIX) === 0; }).map(function (key) {
    const operationId = key.slice(OPERATION_PROPERTY_PREFIX.length);
    const record = readOperationRecord_(properties, operationId);
    if (!all && record.ownerId !== normalizeString_(session.employeeId)) return null;
    return { operationId: operationId, action: record.action, ownerId: record.ownerId, status: visibleOperationStatus_(record),
      code: record.code || '', createdAt: record.createdAt, updatedAt: record.updatedAt,
      revision: record.result && record.result.revision !== undefined ? record.result.revision : record.revision };
  }).filter(function (item) { return !!item; }).sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  return { ok: true, operations: items, retentionHours: SETTINGS.OPERATION_TTL_MS / 3600000 };
}

function acknowledgeOperation_(payload, session) {
  assertSuperAdmin_(session);
  if (payload.confirmedReview !== true) throw authError_('必須先核對最新資料，再確認處理紀錄。', 'REVIEW_REQUIRED');
  const id = normalizeString_(payload.targetOperationId);
  if (!/^OP_[A-Za-z0-9_-]{8,117}$/.test(id)) throw new Error('操作編號格式不正確');
  const properties = PropertiesService.getScriptProperties();
  const record = readOperationRecord_(properties, id);
  if (!record || visibleOperationStatus_(record) !== 'unknown') throw authError_('只能核對結果不明或已中斷的操作。', 'REVIEW_NOT_APPLICABLE');
  properties.setProperty(operationPropertyKey_(id), JSON.stringify(Object.assign({}, record, {
    status: 'reviewed', updatedAt: Date.now(), result: null, code: 'OPERATION_REVIEWED',
    message: '已由管理員人工核對；不代表系統自動認定原操作成功。', reviewedBy: session.employeeId,
  })));
  return { ok: true, reviewedOperationId: id };
}

function operationRecordResponse_(operationId, record) {
  if (record.status === 'reviewed') return { ok: false, code: 'OPERATION_REVIEWED', operationId: operationId, message: '原操作已人工核對，系統不會重新執行。' };
  if (record.status === 'success') {
    return Object.assign({}, record.result || { ok: true }, {
      operationId: operationId,
      operationStatus: 'success',
      replayed: true,
    });
  }
  if (record.status === 'failed') {
    return {
      ok: false,
      operationId: operationId,
      operationStatus: 'failed',
      replayed: true,
      message: record.message || '先前操作失敗',
      code: record.code || 'REQUEST_FAILED',
      revision: record.revision,
    };
  }
  if (record.status === 'unknown' || visibleOperationStatus_(record) === 'unknown') {
    return { ok: false, code: 'WRITE_OUTCOME_UNKNOWN', operationId: operationId, message: '先前寫入結果待確認；請核對資料與操作紀錄，系統不會再次執行。' };
  }
  return {
    ok: true,
    pending: true,
    operationId: operationId,
    operationStatus: 'processing',
    message: '同一筆資料仍在處理中',
  };
}

function operationPropertyKey_(operationId) {
  return OPERATION_PROPERTY_PREFIX + operationId;
}

function readOperationRecord_(properties, operationId) {
  const raw = properties.getProperty(operationPropertyKey_(operationId));
  if (!raw) return null;
  try {
    const record = JSON.parse(raw);
    if (!record || typeof record !== 'object' || Array.isArray(record) || ['processing', 'success', 'failed', 'unknown', 'reviewed'].indexOf(record.status) < 0) throw new Error('Invalid operation record');
    return record;
  } catch (error) {
    throw authError_('操作紀錄損壞，請聯絡管理員確認原操作結果。', 'OPERATION_RECORD_INVALID');
  }
}

function pruneOperationRecords_(properties) {
  const now = Date.now();
  const records = Object.keys(properties.getProperties())
    .filter(function (key) { return key.indexOf(OPERATION_PROPERTY_PREFIX) === 0; })
    .map(function (key) {
      try {
        const record = JSON.parse(properties.getProperty(key) || '{}');
        return { key: key, status: record.status, updatedAt: Number(record.updatedAt || record.createdAt || 0) };
      } catch (error) {
        return { key: key, status: 'invalid', updatedAt: 0 };
      }
    })
    .sort(function (left, right) { return right.updatedAt - left.updatedAt; });

  records.forEach(function (item) {
    if ((item.status === 'success' || item.status === 'failed' || item.status === 'reviewed') && item.updatedAt > 0 && now - item.updatedAt > SETTINGS.OPERATION_TTL_MS) {
      properties.deleteProperty(item.key);
    }
  });
}

/** =========================
 *  Authentication / Authorization
 *  ========================= */

function resolveSessionToken_(body, payload) {
  return normalizeString_((body && body.sessionToken) || (payload && payload.sessionToken));
}

function authError_(message, code) {
  const error = new Error(message);
  error.code = code || 'AUTH_REQUIRED';
  return error;
}

function sessionPropertyKey_(sessionToken) {
  return SESSION_PROPERTY_PREFIX + digestText_(normalizeString_(sessionToken));
}

function digestText_(value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ''),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function getPasswordPepper_() {
  const properties = PropertiesService.getScriptProperties();
  let pepper = normalizeString_(properties.getProperty(PASSWORD_PEPPER_PROPERTY));
  if (pepper) return pepper;

  return withScriptLock_(function () {
    pepper = normalizeString_(properties.getProperty(PASSWORD_PEPPER_PROPERTY));
    if (!pepper) {
      pepper = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
      properties.setProperty(PASSWORD_PEPPER_PROPERTY, pepper);
    }
    return pepper;
  });
}

function hashPassword_(password, salt) {
  const normalizedPassword = String(password == null ? '' : password);
  const passwordSalt = normalizeString_(salt) || Utilities.getUuid().replace(/-/g, '');
  const digest = digestText_(passwordSalt + '|' + normalizedPassword + '|' + getPasswordPepper_());
  return PASSWORD_HASH_PREFIX + passwordSalt + '$' + digest;
}

function verifyPassword_(password, storedPassword) {
  const stored = String(storedPassword == null ? '' : storedPassword);
  if (stored.indexOf(PASSWORD_HASH_PREFIX) !== 0) {
    return constantTimeEquals_(String(password == null ? '' : password), stored);
  }

  const parts = stored.slice(PASSWORD_HASH_PREFIX.length).split('$');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  return constantTimeEquals_(hashPassword_(password, parts[0]), stored);
}

function constantTimeEquals_(left, right) {
  const a = String(left == null ? '' : left);
  const b = String(right == null ? '' : right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index % Math.max(1, a.length)) || 0) ^ (b.charCodeAt(index % Math.max(1, b.length)) || 0);
  }
  return mismatch === 0;
}

function upgradeLegacyPassword_(accountRow, password) {
  const stored = normalizeString_(accountRow && accountRow['登入密碼']);
  if (!stored || stored.indexOf(PASSWORD_HASH_PREFIX) === 0) return false;
  const rowNumber = Number(accountRow.__rowNumber || 0);
  if (!rowNumber) return false;
  const accountSheet = getSheet_(SHEETS.ACCOUNTS);
  const headers = getHeaders_(accountSheet);
  const hashed = hashPassword_(password);
  const updated = setCellIfExists_(accountSheet, headers, rowNumber, '登入密碼', hashed);
  if (updated) accountRow['登入密碼'] = hashed;
  return updated;
}

function migrateLegacyAccountPasswords() {
  return withDocumentWriteLock_(function () {
    const ws = getSheet_(SHEETS.ACCOUNTS);
    const headerInfo = getSheetHeaderInfo_(ws);
    const passwordColumn = headerInfo.headers.indexOf('登入密碼') + 1;
    const firstDataRow = headerInfo.rowIndex + 2;
    const rowCount = Math.max(0, ws.getLastRow() - firstDataRow + 1);
    if (!passwordColumn || !rowCount) return { ok: true, migrated: 0, message: '沒有需要轉換的帳號密碼。' };

    const range = ws.getRange(firstDataRow, passwordColumn, rowCount, 1);
    const values = range.getValues();
    let migrated = 0;
    const nextValues = values.map(function (row) {
      const stored = normalizeString_(row[0]);
      if (!stored || stored.indexOf(PASSWORD_HASH_PREFIX) === 0) return [row[0]];
      migrated += 1;
      return [hashPassword_(stored)];
    });
    if (migrated) setLiteralValues_(range, nextValues);
    return { ok: true, migrated: migrated, message: '帳號密碼雜湊轉換完成。' };
  });
}

function createSession_(accountRow, requestedDurationMs) {
  return withScriptLock_(function () {
    const account = normalizeString_(accountRow['登入帳號']);
    const employeeId = normalizeString_(accountRow['工號']) || account;
    const role = normalizeString_(accountRow['系統權限']) || '技術員';
    const durationMs = clampSessionDuration_(requestedDurationMs);
    const now = Date.now();
    const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    const record = {
      employeeId: employeeId,
      account: account,
      role: role,
      credentialVersion: accountCredentialVersion_(accountRow),
      createdAt: now,
      updatedAt: now,
      expiresAt: now + durationMs,
    };

    const properties = PropertiesService.getScriptProperties();
    pruneSessionRecords_(properties);
    const activeCount = Object.keys(properties.getProperties()).filter(function (key) { return key.indexOf(SESSION_PROPERTY_PREFIX) === 0; }).length;
    if (activeCount >= SETTINGS.SESSION_MAX_RECORDS) throw authError_('登入工作階段容量已滿，請稍後再試。', 'SESSION_CAPACITY');
    properties.setProperty(sessionPropertyKey_(token), JSON.stringify(record));

    return { token: token, record: record };
  });
}

function accountCredentialVersion_(accountRow) {
  return digestText_(canonicalJson_([
    normalizeString_(accountRow['工號']),
    normalizeString_(accountRow['登入帳號']).toLowerCase(),
    String(accountRow['登入密碼'] == null ? '' : accountRow['登入密碼']),
  ]));
}

function clampSessionDuration_(value) {
  const requested = Number(value);
  if (!isFinite(requested) || requested <= 0) return SETTINGS.SESSION_DEFAULT_TTL_MS;
  return Math.max(SETTINGS.SESSION_MIN_TTL_MS, Math.min(SETTINGS.SESSION_MAX_TTL_MS, requested));
}

function requireSession_(sessionToken) {
  return withScriptLock_(function () {
    const token = normalizeString_(sessionToken);
    if (!token) throw authError_('登入工作階段不存在，請重新登入。', 'AUTH_REQUIRED');
    if (!/^[A-Za-z0-9_-]{40,160}$/.test(token)) {
      throw authError_('登入工作階段格式不正確，請重新登入。', 'AUTH_INVALID');
    }

    const properties = PropertiesService.getScriptProperties();
    const key = sessionPropertyKey_(token);
    const raw = properties.getProperty(key);
    if (!raw) throw authError_('登入工作階段已失效，請重新登入。', 'AUTH_REQUIRED');

    let record;
    try {
      record = JSON.parse(raw);
    } catch (error) {
      properties.deleteProperty(key);
      throw authError_('登入工作階段已失效，請重新登入。', 'AUTH_INVALID');
    }

    if (!record.expiresAt || Date.now() >= Number(record.expiresAt)) {
      properties.deleteProperty(key);
      throw authError_('登入已逾時，請重新登入。', 'AUTH_EXPIRED');
    }

    const accountRow = findCurrentAccount_(record.employeeId, record.account);
    const status = normalizeString_(accountRow && accountRow['啟用狀態']);
    if (!accountRow || (status && status !== '啟用') || record.credentialVersion !== accountCredentialVersion_(accountRow)) {
      properties.deleteProperty(key);
      throw authError_('帳號已停用或不存在，請重新登入。', 'AUTH_REVOKED');
    }

    record.employeeId = normalizeString_(accountRow['工號']) || normalizeString_(record.employeeId) || normalizeString_(record.account);
    record.account = normalizeString_(accountRow['登入帳號']) || normalizeString_(record.account);
    record.role = normalizeString_(accountRow['系統權限']) || '技術員';
    return record;
  });
}

function validateSessionResponse_(sessionToken, payload) {
  return withScriptLock_(function () {
    const record = requireSession_(sessionToken);
    const user = buildSessionUser_(record);
    if (!user) throw authError_('找不到登入者的人員主檔，請聯絡管理員。', 'AUTH_REVOKED');
    const requestedDuration = Number(payload && payload.sessionDurationMs);
    if (isFinite(requestedDuration) && requestedDuration > 0) {
      record.expiresAt = Date.now() + clampSessionDuration_(requestedDuration);
      record.updatedAt = Date.now();
      PropertiesService.getScriptProperties().setProperty(sessionPropertyKey_(sessionToken), JSON.stringify(record));
    }

    return {
      ok: true,
      message: '登入工作階段有效',
      user: user,
      sessionExpiresAt: Number(record.expiresAt),
    };
  });
}

function logout_(payload) {
  return withScriptLock_(function () {
    const token = normalizeString_(payload && payload.sessionToken);
    if (token) PropertiesService.getScriptProperties().deleteProperty(sessionPropertyKey_(token));
    return { ok: true, message: '已登出' };
  });
}

function revokeSessionsForEmployee_(employeeId) {
  return withScriptLock_(function () {
    const targetId = normalizeString_(employeeId);
    if (!targetId) return 0;
    const properties = PropertiesService.getScriptProperties();
    let revoked = 0;
    Object.keys(properties.getProperties()).forEach(function (key) {
      if (key.indexOf(SESSION_PROPERTY_PREFIX) !== 0) return;
      try {
        const record = JSON.parse(properties.getProperty(key) || '{}');
        if (normalizeString_(record.employeeId) !== targetId) return;
      } catch (error) {
        // Invalid session records are removed together with matching sessions.
      }
      properties.deleteProperty(key);
      revoked += 1;
    });
    return revoked;
  });
}

function findCurrentAccount_(employeeId, account) {
  const employeeKey = normalizeString_(employeeId);
  const accountKey = normalizeString_(account).toLowerCase();
  return getSheetObjects_(SHEETS.ACCOUNTS).find(function (row) {
    if (!accountKey || normalizeString_(row['登入帳號']).toLowerCase() !== accountKey) return false;
    const rowEmployee = normalizeString_(row['工號']);
    return !rowEmployee || !employeeKey || rowEmployee === employeeKey;
  }) || null;
}

function buildSessionUser_(session) {
  const people = normalizePeople_(getSheetObjects_(SHEETS.PEOPLE));
  const employeeId = normalizeString_(session && session.employeeId);
  const account = normalizeString_(session && session.account);
  const person = people.find(function (item) { return item.id === employeeId || item.id === account; });
  if (!person) return null;
  session.employeeId = person.id;
  return Object.assign({}, person, {
    account: session.account,
    accountEnabled: '啟用',
    accountStatus: '啟用',
    systemPermission: session.role,
    permissionLevel: session.role,
  });
}

function pruneSessionRecords_(properties) {
  const now = Date.now();
  const records = Object.keys(properties.getProperties())
    .filter(function (key) { return key.indexOf(SESSION_PROPERTY_PREFIX) === 0; })
    .map(function (key) {
      try {
        const record = JSON.parse(properties.getProperty(key) || '{}');
        return { key: key, expiresAt: Number(record.expiresAt || 0), updatedAt: Number(record.updatedAt || record.createdAt || 0) };
      } catch (error) {
        return { key: key, expiresAt: 0, updatedAt: 0 };
      }
    })
    .sort(function (left, right) { return right.updatedAt - left.updatedAt; });

  records.forEach(function (item) {
    if (item.expiresAt <= now) properties.deleteProperty(item.key);
  });
}

function authorizeWriteAction_(sessionToken, action, payload) {
  const session = requireSession_(sessionToken);
  const isSensitiveAccountUpdate = action === 'updatePerson' && hasSensitiveAccountFields_(payload);
  if (SUPER_ADMIN_ACTIONS[action] || isSensitiveAccountUpdate) assertSuperAdmin_(session);

  const permissionId = isSensitiveAccountUpdate ? 'PERM_016' : ACTION_PERMISSION_MAP[action];
  if (!permissionId || !hasPermission_(session, permissionId)) {
    throw authError_('權限不足，無法執行此操作。', 'FORBIDDEN');
  }
  assertActionScope_(session, action, payload);
  return session;
}

function assertActionScope_(session, action, payload) {
  if (normalizeString_(session.role) === '最高權限') return true;
  if (action === 'saveScheduleDraft') {
    const user = buildSessionUser_(session);
    const draft = payload.draft || payload;
    const team = normalizeString_(user && user.shift);
    if (!team || normalizeString_(draft.team) !== team) throw authError_('只能儲存自己班別的試排草稿。', 'FORBIDDEN');
    const existing = getSheetObjects_(SHEETS.SCHEDULE_DRAFTS).find(function (row) {
      return normalizeString_(row['試排ID']) === normalizeString_(draft.id);
    });
    if (existing && normalizeString_(existing['班別']) !== team) throw authError_('不能覆寫其他班別的試排草稿。', 'FORBIDDEN');
    return true;
  }
  if (action !== 'updateStationRule') return true;

  const user = buildSessionUser_(session);
  const ownTeam = normalizeString_(user && user.shift);
  const requestedTeam = normalizeString_(payload && payload.team);
  if (!ownTeam || !requestedTeam || ownTeam !== requestedTeam) {
    throw authError_('只能修改自己班別的站點規則。', 'FORBIDDEN');
  }
  if (!isRuleManager_(session, 'PERM_012', user)) throw authError_('站點規則僅開放主任或明確授權的人員修改。', 'FORBIDDEN');
  return true;
}

function personalPermissionException_(session, permissionId) {
  const exceptions = getSheetObjects_(SHEETS.PERSONAL_PERMISSION_EXCEPTIONS).filter(function (row) {
    return normalizeString_(row['工號']) === session.employeeId &&
      normalizeString_(row['權限ID']) === permissionId && normalizeString_(row['啟用狀態']) !== '停用';
  });
  return exceptions.find(function (row) { return normalizeString_(row['效果']).toLowerCase() === 'deny'; }) ||
    (exceptions.length ? exceptions[exceptions.length - 1] : null);
}

function isRuleManager_(session, permissionId, user) {
  if (normalizeString_(session.role) === '最高權限') return true;
  const person = user || buildSessionUser_(session);
  const exception = personalPermissionException_(session, permissionId);
  if (exception) return normalizeString_(exception['效果']).toLowerCase() === 'allow';
  // An explicit editor may use an independently granted read permission, never override a read deny.
  if (permissionId === 'PERM_011') {
    const editException = personalPermissionException_(session, 'PERM_012');
    if (editException && normalizeString_(editException['效果']).toLowerCase() === 'allow' && hasPermission_(session, 'PERM_012')) return true;
  }
  return SETTINGS.RULE_DIRECTOR_ROLES.some(function (role) {
    return !!role && (normalizeString_(session.role) === role || normalizeString_(person && person.role).indexOf(role) >= 0);
  });
}

function assertReadPermission_(sessionToken, permissionId) {
  const session = requireSession_(sessionToken);
  if (!hasPermission_(session, permissionId)) throw authError_('權限不足，無法讀取此資料。', 'FORBIDDEN');
  return session;
}

function assertSuperAdmin_(session) {
  if (!session || normalizeString_(session.role) !== '最高權限') {
    throw authError_('此操作僅限最高權限管理員。', 'FORBIDDEN');
  }
  return true;
}

function hasPermission_(session, permissionId) {
  if (normalizeString_(session.role) === '最高權限') return true;

  const permissionItem = getSheetObjects_(SHEETS.PERMISSION_ITEMS).find(function (row) {
    return normalizeString_(row['權限ID']) === permissionId;
  });
  if (!permissionItem || normalizeString_(permissionItem['啟用狀態']) === '停用') return false;

  const exception = personalPermissionException_(session, permissionId);
  if (exception) return normalizeString_(exception['效果']).toLowerCase() === 'allow';

  const rolePermissions = getSheetObjects_(SHEETS.ROLE_PERMISSIONS).filter(function (row) {
    return normalizeString_(row['角色']) === session.role &&
      normalizeString_(row['權限ID']) === permissionId &&
      normalizeString_(row['啟用狀態']) !== '停用';
  });
  const rolePermission = rolePermissions.length ? rolePermissions[rolePermissions.length - 1] : null;
  return !!rolePermission && normalizeString_(rolePermission['允許']).toUpperCase() === 'Y';
}

function hasSensitiveAccountFields_(payload) {
  return !!payload && [
    'systemPermission', 'permissionLevel', 'isSuperAdmin', 'password', 'loginPassword',
    'accountPassword', 'accountEnabled', 'accountStatus', 'enabled', '登入密碼',
  ].some(function (key) { return Object.prototype.hasOwnProperty.call(payload, key); });
}

function assertOperationOwner_(record, session) {
  if (!session) return true;
  const ownerId = normalizeString_(record && record.ownerId);
  if (ownerId && ownerId === normalizeString_(session.employeeId)) return true;
  if (!ownerId && normalizeString_(session.role) === '最高權限') return true;
  throw authError_('無法讀取其他使用者的操作結果。', 'FORBIDDEN');
}

/** =========================
 *  Bootstrap / Login
 *  ========================= */

function buildBootstrap_() {
  let qualificationSync = null;
  if (SETTINGS.AUTO_SYNC_QUALIFICATIONS_FROM_MATRIX_ON_BOOTSTRAP) {
    try {
      qualificationSync = syncQualificationsFromMatrix_({ source: 'bootstrap', silent: true });
    } catch (error) {
      // 同步失敗時不讓整個系統無資料，先回退讀取既有 03_資格明細。
      qualificationSync = { ok: false, message: error && error.message ? error.message : String(error) };
    }
  }

  const peopleRows = getSheetObjects_(SHEETS.PEOPLE);
  const stationRows = getSheetObjects_(SHEETS.STATIONS);
  const qualificationRows = getSheetObjects_(SHEETS.QUALIFICATIONS);
  const ruleRows = getSheetObjects_(SHEETS.RULES);
  const accountRows = getSheetObjects_(SHEETS.ACCOUNTS);

  const people = mergeAccountFieldsIntoPeople_(normalizePeople_(peopleRows), accountRows);
  const stations = normalizeStations_(stationRows);
  const qualifications = normalizeQualifications_(qualificationRows);
  const stationRules = normalizeTeamOnlyRules_(ruleRows, stationRows);

  return {
    ok: true,
    people,
    stations,
    qualifications,
    stationRules,
    qualificationSync,
  };
}

function buildBootstrapForSession_(session) {
  const bootstrap = buildBootstrap_();
  bootstrap.capabilities = { operationReceipts: true, revision: true };
  bootstrap.recentOperations = listOperations_(session, {}).operations;
  bootstrap.revision = getDataRevision_();
  const rules = bootstrap.stationRules || [];
  const ownUser = buildSessionUser_(session);
  const ownTeam = normalizeString_(ownUser && ownUser.shift);
  const teams = rules.map(function (rule) { return rule.team; }).concat(bootstrap.people.map(function (person) { return person.shift; }))
    .filter(function (team, index, all) { return team && all.indexOf(team) === index; });
  const isAdmin = normalizeString_(session.role) === '最高權限';
  bootstrap.viewableRuleTeams = isAdmin ? teams :
    (ownTeam && hasPermission_(session, 'PERM_011') && isRuleManager_(session, 'PERM_011', ownUser) ? [ownTeam] : []);
  bootstrap.editableRuleTeams = isAdmin ? teams :
    (ownTeam && hasPermission_(session, 'PERM_012') && isRuleManager_(session, 'PERM_012', ownUser) ? [ownTeam] : []);
  bootstrap.managementStationRules = rules.filter(function (rule) { return bootstrap.viewableRuleTeams.indexOf(rule.team) >= 0; });
  const canAnalyze = isAdmin || ['PERM_001', 'PERM_006', 'PERM_007', 'PERM_009', 'PERM_010'].some(function (permissionId) {
    return hasPermission_(session, permissionId);
  });
  // Analysis may need cross-team numeric rules, but never management notes or internal rule IDs.
  bootstrap.stationRules = canAnalyze ? rules.map(analysisStationRule_) : [];
  if (normalizeString_(session.role) === '最高權限') return bootstrap;
  bootstrap.people = bootstrap.people.map(function (person) {
    const sanitized = Object.assign({}, person);
    delete sanitized.account;
    delete sanitized.accountEnabled;
    delete sanitized.accountStatus;
    delete sanitized.systemPermission;
    delete sanitized.permissionLevel;
    delete sanitized.isSuperAdmin;
    if (person.id === session.employeeId) {
      sanitized.systemPermission = session.role;
      sanitized.permissionLevel = session.role;
    }
    return sanitized;
  });
  return bootstrap;
}

function analysisStationRule_(rule) {
  const result = { id: 'RULE_' + rule.team + '_' + rule.stationId };
  ['team', 'stationId', 'dayKey', 'minRequired', 'reliefMinPerBatch', 'backupTarget', 'maxAssignable',
    'priority', 'isMandatory', 'trainingCanFill', 'qualificationLimit', 'canShare', 'enabled'].forEach(function (key) {
    if (rule[key] !== undefined) result[key] = rule[key];
  });
  return result;
}

function mergeAccountFieldsIntoPeople_(people, accountRows) {
  const accountMap = {};
  accountRows.forEach(function (row) {
    const employeeId = normalizeString_(row['工號']);
    const loginAccount = normalizeString_(row['登入帳號']);
    const key = employeeId || loginAccount;
    if (!key) return;
    accountMap[key] = row;
  });

  return people.map(function (person) {
    const account = accountMap[person.id];
    if (!account) return person;

    return Object.assign({}, person, {
      account: normalizeString_(account['登入帳號']),
      accountEnabled: normalizeString_(account['啟用狀態']) || '啟用',
      accountStatus: normalizeString_(account['啟用狀態']) || '啟用',
      systemPermission: normalizeString_(account['系統權限']) || person.systemPermission || '技術員',
      permissionLevel: normalizeString_(account['系統權限']) || person.permissionLevel || '技術員',
    });
  });
}

function login_(payload) {
  return withDocumentWriteLock_(function () { return loginLocked_(payload || {}); });
}

function loginThrottleError_(until) {
  const error = authError_('登入嘗試過於頻繁，請稍後再試。', 'LOGIN_THROTTLED');
  error.retryAfterSeconds = Math.max(1, Math.ceil((until - Date.now()) / 1000));
  return error;
}

function loginThrottleState_(accountKey) {
  const properties = PropertiesService.getScriptProperties();
  const now = Date.now();
  Object.keys(properties.getProperties()).forEach(function (key) {
    if (key.indexOf(LOGIN_PROPERTY_PREFIX) !== 0) return;
    try {
      const record = JSON.parse(properties.getProperty(key));
      if ((record.blockedUntil && record.blockedUntil <= now) || (!record.blockedUntil && now - record.windowStartedAt >= SETTINGS.LOGIN_FAILURE_WINDOW_MS)) properties.deleteProperty(key);
    } catch (error) {
      properties.deleteProperty(key);
    }
  });
  const key = LOGIN_PROPERTY_PREFIX + digestText_(accountKey);
  const raw = properties.getProperty(key);
  const count = Object.keys(properties.getProperties()).filter(function (item) { return item.indexOf(LOGIN_PROPERTY_PREFIX) === 0; }).length;
  if (!raw && count >= SETTINGS.LOGIN_MAX_RECORDS) throw loginThrottleError_(now + SETTINGS.LOGIN_COOLDOWN_MS);
  const state = raw ? JSON.parse(raw) : { failures: 0, windowStartedAt: now, blockedUntil: 0 };
  if (state.blockedUntil > now) throw loginThrottleError_(state.blockedUntil);
  return { key: key, state: state };
}

function recordLoginFailure_(attempt) {
  const properties = PropertiesService.getScriptProperties();
  const state = attempt.state;
  state.failures += 1;
  if (state.failures >= SETTINGS.LOGIN_FAILURE_LIMIT) state.blockedUntil = Date.now() + SETTINGS.LOGIN_COOLDOWN_MS;
  const count = Object.keys(properties.getProperties()).filter(function (key) { return key.indexOf(LOGIN_PROPERTY_PREFIX) === 0; }).length;
  if (!properties.getProperty(attempt.key) && count >= SETTINGS.LOGIN_MAX_RECORDS) throw loginThrottleError_(Date.now() + SETTINGS.LOGIN_COOLDOWN_MS);
  properties.setProperty(attempt.key, JSON.stringify(state));
  if (state.blockedUntil) throw loginThrottleError_(state.blockedUntil);
}

function loginLocked_(payload) {
  const account = normalizeString_(payload.account);
  const password = normalizeString_(payload.password);
  const accountKey = account.toLowerCase();

  if (!account || !password) {
    return { ok: false, message: '請輸入登入帳號與密碼。' };
  }

  const attempt = loginThrottleState_(accountKey);
  const accountRows = getSheetObjects_(SHEETS.ACCOUNTS);
  const peopleRows = getSheetObjects_(SHEETS.PEOPLE);
  const peopleMap = mapByKey_(normalizePeople_(peopleRows), 'id');

  const matched = accountRows.find(function (row) {
    return normalizeString_(row['登入帳號']).toLowerCase() === accountKey;
  });

  if (!matched || !verifyPassword_(password, matched['登入密碼'])) {
    recordLoginFailure_(attempt);
    return { ok: false, message: '帳號或密碼錯誤。' };
  }

  const enabled = normalizeString_(matched['啟用狀態']);
  if (enabled && enabled !== '啟用') {
    return { ok: false, message: '此帳號目前停用。' };
  }

  const employeeId = normalizeString_(matched['工號']);
  const loginAccount = normalizeString_(matched['登入帳號']);
  const person = peopleMap[employeeId] || peopleMap[loginAccount] || peopleMap[account];
  if (!person) {
    return {
      ok: false,
      message: '找不到此帳號對應的人員主檔。',
    };
  }

  const user = Object.assign({}, person, {
    systemPermission: normalizeString_(matched['系統權限']) || '技術員',
    permissionLevel: normalizeString_(matched['系統權限']) || '技術員',
    account: normalizeString_(matched['登入帳號']),
    accountEnabled: enabled || '啟用',
    accountStatus: enabled || '啟用',
  });

  try {
    upgradeLegacyPassword_(matched, password);
  } catch (error) {
    // 舊密碼轉換失敗不阻擋本次合法登入；管理員可執行 migrateLegacyAccountPasswords 補轉。
  }

  const session = createSession_(matched, payload.sessionDurationMs);
  PropertiesService.getScriptProperties().deleteProperty(attempt.key);
  return {
    ok: true,
    message: '登入成功',
    user,
    sessionToken: session.token,
    sessionExpiresAt: session.record.expiresAt,
  };
}

/** =========================
 *  Qualifications
 *  ========================= */

function upsertQualification_(payload) {
  const employeeId = normalizeString_(payload.employeeId);
  const stationId = normalizeString_(payload.stationId);
  const status = normalizeString_(payload.status);

  if (!employeeId || !stationId) {
    throw new Error('upsertQualification 缺少 employeeId 或 stationId');
  }

  const ws = getSheet_(SHEETS.QUALIFICATIONS);
  const headers = getHeaders_(ws);
  const rows = getSheetObjects_(SHEETS.QUALIFICATIONS);
  const now = new Date();

  const existingIndex = rows.findIndex(function (row) {
    return normalizeString_(row['工號']) === employeeId &&
      normalizeString_(row['站點代碼']) === stationId;
  });

  let oldStatus = '';

  if (existingIndex >= 0) {
    const rowNumber = getSourceRowNumber_(rows, existingIndex);
    oldStatus = normalizeString_(rows[existingIndex]['資格狀態']);
    setCellIfExists_(ws, headers, rowNumber, '資格狀態', status);
    setCellIfExists_(ws, headers, rowNumber, '更新時間', now);
    if (payload.employeeName) {
      setCellIfExists_(ws, headers, rowNumber, '姓名', normalizeString_(payload.employeeName));
    }
  } else {
    const qualificationId = buildQualificationId_(employeeId, stationId, now);
    const newRow = headers.map(function (header) {
      switch (header) {
        case '資格ID': return qualificationId;
        case '工號': return employeeId;
        case '站點代碼': return stationId;
        case '資格狀態': return status;
        case '生效日': return now;
        case '更新時間': return now;
        case '姓名': return normalizeString_(payload.employeeName);
        default: return '';
      }
    });
    appendLiteralRow_(ws, newRow);
  }

  try {
    setQualificationMatrixCell_(employeeId, stationId, status);
  } catch (error) {
    // 矩陣同步失敗不阻斷資格明細更新，避免前端修改失敗。
    console.warn('同步 03_站點矩陣失敗：' + (error && error.message ? error.message : String(error)));
  }

  appendQualificationLog_({
    employeeId: employeeId,
    stationId: stationId,
    oldStatus: oldStatus,
    newStatus: status,
    reason: '系統更新資格',
  });

  return {
    ok: true,
    employeeId: employeeId,
    stationId: stationId,
    status: status,
  };
}

function deleteQualification_(payload) {
  const employeeId = normalizeString_(payload.employeeId);
  const stationId = normalizeString_(payload.stationId);

  if (!employeeId || !stationId) {
    throw new Error('deleteQualification 缺少 employeeId 或 stationId');
  }

  const ws = getSheet_(SHEETS.QUALIFICATIONS);
  const rows = getSheetObjects_(SHEETS.QUALIFICATIONS);

  const existingIndex = rows.findIndex(function (row) {
    return normalizeString_(row['工號']) === employeeId &&
      normalizeString_(row['站點代碼']) === stationId;
  });

  if (existingIndex < 0) {
    return { ok: true, message: '找不到資料，視為已刪除。' };
  }

  const oldStatus = normalizeString_(rows[existingIndex]['資格狀態']);
  invalidateSheetReads_();
  ws.deleteRow(getSourceRowNumber_(rows, existingIndex));

  try {
    setQualificationMatrixCell_(employeeId, stationId, '');
  } catch (error) {
    console.warn('清空 03_站點矩陣失敗：' + (error && error.message ? error.message : String(error)));
  }

  appendQualificationLog_({
    employeeId: employeeId,
    stationId: stationId,
    oldStatus: oldStatus,
    newStatus: '',
    reason: '系統刪除資格',
  });

  return { ok: true };
}

function appendQualificationLog_(args) {
  const ws = getSheet_(SHEETS.CHANGE_LOG, true);
  if (!ws) return;

  const headers = getHeaders_(ws);
  const now = new Date();
  const logId = 'LOG_' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss_SSS');

  const row = headers.map(function (header) {
    switch (header) {
      case '異動ID': return logId;
      case '工號': return args.employeeId || '';
      case '站點代碼': return args.stationId || '';
      case '原狀態': return args.oldStatus || '';
      case '新狀態': return args.newStatus || '';
      case '異動原因': return args.reason || '';
      case '異動人': return '系統';
      case '異動時間': return now;
      case '審核狀態': return '已完成';
      case '備註': return '';
      default: return '';
    }
  });

  appendLiteralRow_(ws, row);
}


/** =========================
 *  Matrix -> Qualification Detail Sync
 *  ========================= */

function syncQualificationsFromMatrix_(payload) {
  payload = payload || {};
  const now = new Date();
  const stationRows = getSheetObjects_(SHEETS.STATIONS);
  const stationAliasMap = buildStationAliasMap_(stationRows);
  const matrixInfo = readQualificationMatrix_();
  const detailSheet = getSheet_(SHEETS.QUALIFICATIONS);
  const detailHeaders = getHeaders_(detailSheet);
  const startRow = getQualificationDetailDataStartRow_(detailSheet);

  const rows = [];
  const skippedUnknownStations = [];
  const stationColumnInfos = [];
  const seenKeys = {};

  matrixInfo.headers.forEach(function (header, colIndex) {
    if (isMatrixBaseColumn_(header)) return;
    const stationId = stationAliasMap[normalizeStationKey_(header)];
    if (stationId) {
      stationColumnInfos.push({ colIndex: colIndex, stationId: stationId, header: header });
    } else if (normalizeString_(header)) {
      skippedUnknownStations.push(header);
    }
  });

  for (var r = matrixInfo.headerRowIndex + 1; r < matrixInfo.values.length; r++) {
    var row = matrixInfo.values[r];
    var employeeId = normalizeString_(row[matrixInfo.employeeIdCol]);
    var employeeName = normalizeString_(row[matrixInfo.employeeNameCol]);
    if (!employeeId || employeeId === '工號' || employeeId === '唯一主鍵') continue;
    if (employeeId.indexOf('範例') >= 0 || employeeId.indexOf('說明') >= 0 || employeeId.indexOf('可用') >= 0) continue;

    stationColumnInfos.forEach(function (info) {
      var rawValue = normalizeString_(row[info.colIndex]);
      var status = normalizeQualificationStatusFromMatrix_(rawValue);
      if (!status) return;
      var key = employeeId + '||' + info.stationId;
      if (seenKeys[key]) return;
      seenKeys[key] = true;
      rows.push(buildQualificationDetailRow_(detailHeaders, {
        employeeId: employeeId,
        employeeName: employeeName,
        stationId: info.stationId,
        status: status,
        rawStatus: rawValue,
        canLead: canLeadFromMatrixStatus_(rawValue),
        now: now,
      }));
    });
  }

  const lastRow = detailSheet.getLastRow();
  if (lastRow >= startRow) {
    detailSheet.getRange(startRow, 1, lastRow - startRow + 1, detailSheet.getLastColumn()).clearContent();
  }

  if (rows.length > 0) {
    setLiteralValues_(detailSheet.getRange(startRow, 1, rows.length, detailHeaders.length), rows);
  }

  return {
    ok: true,
    message: '已由 03_站點矩陣同步重建 03_資格明細',
    matrixSheetName: SHEETS.QUALIFICATION_MATRIX,
    detailSheetName: SHEETS.QUALIFICATIONS,
    headerRow: matrixInfo.headerRowIndex + 1,
    stationColumnCount: stationColumnInfos.length,
    qualificationCount: rows.length,
    skippedUnknownStations: Array.from(new Set(skippedUnknownStations)).slice(0, 30),
    updatedAt: now,
  };
}

function debugQualificationMatrix_() {
  const stationRows = getSheetObjects_(SHEETS.STATIONS);
  const stationAliasMap = buildStationAliasMap_(stationRows);
  const matrixInfo = readQualificationMatrix_();
  const stationColumns = [];
  const unknownHeaders = [];

  matrixInfo.headers.forEach(function (header, colIndex) {
    if (isMatrixBaseColumn_(header)) return;
    const normalized = normalizeStationKey_(header);
    const stationId = stationAliasMap[normalized];
    if (stationId) {
      stationColumns.push({ header: header, stationId: stationId, colIndex: colIndex + 1 });
    } else if (normalizeString_(header)) {
      unknownHeaders.push(header);
    }
  });

  return {
    ok: true,
    matrixSheetName: SHEETS.QUALIFICATION_MATRIX,
    detailSheetName: SHEETS.QUALIFICATIONS,
    headerRow: matrixInfo.headerRowIndex + 1,
    employeeIdCol: matrixInfo.employeeIdCol + 1,
    employeeNameCol: matrixInfo.employeeNameCol + 1,
    stationRows: stationRows.length,
    stationColumnCount: stationColumns.length,
    stationColumns: stationColumns.slice(0, 80),
    unknownHeaders: Array.from(new Set(unknownHeaders)).slice(0, 50),
    sampleRows: matrixInfo.values.slice(matrixInfo.headerRowIndex + 1, matrixInfo.headerRowIndex + 6),
  };
}

function readQualificationMatrix_() {
  const ws = getSheet_(SHEETS.QUALIFICATION_MATRIX);
  const values = ws.getDataRange().getDisplayValues();
  const maxScanRows = Math.min(values.length, 10);

  for (var r = 0; r < maxScanRows; r++) {
    var headers = values[r].map(function (value) { return normalizeString_(value); });
    var employeeIdCol = findHeaderColumn_(headers, ['工號', '員工工號', '人員工號']);
    var employeeNameCol = findHeaderColumn_(headers, ['姓名', '人員姓名', '員工姓名']);
    if (employeeIdCol >= 0 && employeeNameCol >= 0) {
      return {
        sheet: ws,
        values: values,
        headerRowIndex: r,
        headers: headers,
        employeeIdCol: employeeIdCol,
        employeeNameCol: employeeNameCol,
      };
    }
  }

  throw new Error('03_站點矩陣 找不到標題列：需有「工號」與「姓名」。');
}

function buildStationAliasMap_(stationRows) {
  const map = {};
  stationRows.forEach(function (row) {
    const code = normalizeString_(row['站點代碼']);
    const name = normalizeString_(row['站點名稱']);
    if (!code) return;

    addStationAlias_(map, code, code);
    if (name) {
      addStationAlias_(map, name, code);
      addStationAlias_(map, name + '(' + code + ')', code);
      addStationAlias_(map, name + '（' + code + '）', code);
      addStationAlias_(map, code + name, code);
      addStationAlias_(map, code + ' ' + name, code);
    }
  });
  return map;
}

function addStationAlias_(map, alias, code) {
  const key = normalizeStationKey_(alias);
  if (key) map[key] = code;
}

function normalizeStationKey_(value) {
  return normalizeString_(value)
    .replace(/\s+/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .toUpperCase();
}

function isMatrixBaseColumn_(header) {
  const key = normalizeStationKey_(header);
  return [
    '工號', '姓名', '班別', '職務', '職稱', '國籍',
    '(A)第一天', '(A)第二天', '(B)第一天', '(B)第二天',
    '在職狀態', '備註', '更新時間', '更新人',
  ].indexOf(key) >= 0;
}

function findHeaderColumn_(headers, candidates) {
  for (var i = 0; i < headers.length; i++) {
    var header = normalizeString_(headers[i]);
    for (var j = 0; j < candidates.length; j++) {
      if (header === candidates[j]) return i;
    }
  }
  return -1;
}

function normalizeQualificationStatusFromMatrix_(value) {
  const text = normalizeString_(value);
  const upper = text.toUpperCase();
  if (!text) return '';
  if (text === '合格') return '合格';
  if (text === '訓練中' || text.indexOf('訓練') >= 0) return '訓練中';
  if (text === '不可排' || text.indexOf('不可') >= 0 || text.indexOf('停用') >= 0) return '不可排';
  if (['Y', 'YES', 'OK', 'O', '1', 'TRUE', '✓', '✔'].indexOf(upper) >= 0) return '合格';
  if (['N', 'NO', '0', 'FALSE', '-'].indexOf(upper) >= 0) return '';
  // 若矩陣內用「導師 / 師傅 / 可帶人」表示更高階資格，前端仍以合格判斷，並另寫入可帶人=Y。
  if (text.indexOf('導師') >= 0 || text.indexOf('師傅') >= 0 || text.indexOf('可帶') >= 0) return '合格';
  return text;
}

function canLeadFromMatrixStatus_(value) {
  const text = normalizeString_(value);
  if (!text) return false;
  return text.indexOf('導師') >= 0 || text.indexOf('師傅') >= 0 || text.indexOf('可帶') >= 0;
}

function buildQualificationDetailRow_(headers, args) {
  const qualificationId = buildQualificationId_(args.employeeId, args.stationId, args.now);
  return headers.map(function (header) {
    switch (header) {
      case '資格ID': return qualificationId;
      case '工號': return args.employeeId;
      case '姓名': return args.employeeName || '';
      case '站點代碼': return args.stationId;
      case '資格狀態': return args.status;
      case '可帶人': return args.canLead ? 'Y' : 'N';
      case '生效日': return '';
      case '失效日': return '';
      case '備註': return '由03_站點矩陣轉入' + (args.rawStatus && args.rawStatus !== args.status ? '（原值：' + args.rawStatus + '）' : '');
      case '更新人': return '系統';
      case '更新時間': return args.now;
      default: return '';
    }
  });
}

function getQualificationDetailDataStartRow_(ws) {
  if (ws.getLastRow() < 2) return 2;
  const secondRow = ws.getRange(2, 1, 1, ws.getLastColumn()).getDisplayValues()[0].join(' ');
  if (secondRow.indexOf('可用') >= 0 || secondRow.indexOf('對應') >= 0 || secondRow.indexOf('自由填寫') >= 0) {
    return 3;
  }
  return 2;
}

function getQualificationMatrixPersonCell_(header, person, now) {
  const key = normalizeStationKey_(header);
  switch (key) {
    case '工號':
    case '員工工號':
    case '人員工號': return { recognized: true, value: person.id };
    case '姓名':
    case '員工姓名':
    case '人員姓名': return { recognized: true, value: person.name };
    case '班別': return { recognized: true, value: person.shift };
    case '職務':
    case '職稱': return { recognized: true, value: person.role };
    case '國籍': return { recognized: true, value: person.nationality };
    case '(A)第一天': return { recognized: true, value: person.aDay1 };
    case '(A)第二天': return { recognized: true, value: person.aDay2 };
    case '(B)第一天': return { recognized: true, value: person.bDay1 };
    case '(B)第二天': return { recognized: true, value: person.bDay2 };
    case '在職狀態': return { recognized: true, value: person.employmentStatus };
    case '備註': return { recognized: true, value: person.note };
    case '更新時間': return { recognized: true, value: now };
    case '更新人': return { recognized: true, value: '系統' };
    default: return { recognized: false, value: '' };
  }
}

function copyQualificationMatrixRowPresentation_(sheet, sourceRow, targetRow, columnCount) {
  if (!sourceRow || sourceRow === targetRow || columnCount <= 0) return;
  try {
    const sourceRange = sheet.getRange(sourceRow, 1, 1, columnCount);
    const targetRange = sheet.getRange(targetRow, 1, 1, columnCount);
    if (typeof sourceRange.copyTo === 'function') {
      sourceRange.copyTo(targetRange, { formatOnly: true });
    }
    if (typeof sourceRange.getDataValidations === 'function' && typeof targetRange.setDataValidations === 'function') {
      targetRange.setDataValidations(sourceRange.getDataValidations());
    }
  } catch (error) {
    console.warn('複製 03_站點矩陣列格式失敗：' + (error && error.message ? error.message : String(error)));
  }
}

function ensureQualificationMatrixPersonRow_(person) {
  const matrixInfo = readQualificationMatrix_();
  const employeeId = normalizeString_(person && person.id).toUpperCase();
  const employeeName = normalizeString_(person && person.name);
  if (!employeeId || !employeeName) {
    throw new Error('建立 03_站點矩陣人員列時缺少工號或姓名');
  }

  const matchingRows = [];
  for (var r = matrixInfo.headerRowIndex + 1; r < matrixInfo.values.length; r++) {
    if (normalizeString_(matrixInfo.values[r][matrixInfo.employeeIdCol]).toUpperCase() === employeeId) {
      matchingRows.push(r);
    }
  }
  if (matchingRows.length > 1) {
    throw new Error('03_站點矩陣存在重複工號：' + employeeId);
  }

  const now = new Date();
  if (matchingRows.length === 1) {
    const rowNumber = matchingRows[0] + 1;
    const fields = {};
    matrixInfo.headers.forEach(function (header) {
      const cell = getQualificationMatrixPersonCell_(header, person, now);
      if (cell.recognized) fields[header] = cell.value || '';
    });
    setRowFields_(matrixInfo.sheet, matrixInfo.headers, rowNumber, fields);
    return { created: false, rowNumber: rowNumber };
  }

  const rowValues = matrixInfo.headers.map(function (header) {
    const cell = getQualificationMatrixPersonCell_(header, person, now);
    return cell.recognized ? (cell.value || '') : '';
  });
  rowValues[matrixInfo.employeeIdCol] = employeeId;
  rowValues[matrixInfo.employeeNameCol] = employeeName;

  let presentationSourceRow = 0;
  for (var sourceIndex = matrixInfo.values.length - 1; sourceIndex > matrixInfo.headerRowIndex; sourceIndex--) {
    const sourceEmployeeId = normalizeString_(matrixInfo.values[sourceIndex][matrixInfo.employeeIdCol]);
    if (sourceEmployeeId && sourceEmployeeId !== '工號' && sourceEmployeeId.indexOf('範例') < 0 && sourceEmployeeId.indexOf('說明') < 0) {
      presentationSourceRow = sourceIndex + 1;
      break;
    }
  }

  appendLiteralRow_(matrixInfo.sheet, rowValues);
  const rowNumber = matrixInfo.sheet.getLastRow();
  copyQualificationMatrixRowPresentation_(matrixInfo.sheet, presentationSourceRow, rowNumber, matrixInfo.headers.length);
  return { created: true, rowNumber: rowNumber };
}

function setQualificationMatrixCell_(employeeId, stationId, status) {
  const stationRows = getSheetObjects_(SHEETS.STATIONS);
  const stationAliasMap = buildStationAliasMap_(stationRows);
  const matrixInfo = readQualificationMatrix_();
  const normalizedStationId = normalizeString_(stationId);

  let stationCol = -1;
  matrixInfo.headers.forEach(function (header, colIndex) {
    if (stationCol >= 0 || isMatrixBaseColumn_(header)) return;
    const mappedStationId = stationAliasMap[normalizeStationKey_(header)];
    if (mappedStationId === normalizedStationId) stationCol = colIndex;
  });
  if (stationCol < 0) throw new Error('03_站點矩陣 找不到站點欄位：' + stationId);

  let targetRow = -1;
  for (var r = matrixInfo.headerRowIndex + 1; r < matrixInfo.values.length; r++) {
    if (normalizeString_(matrixInfo.values[r][matrixInfo.employeeIdCol]) === employeeId) {
      targetRow = r;
      break;
    }
  }
  if (targetRow < 0) throw new Error('03_站點矩陣 找不到工號：' + employeeId);

  setLiteralValue_(matrixInfo.sheet.getRange(targetRow + 1, stationCol + 1), status || '');
}

/** =========================
 *  Station Rules
 *  ========================= */

function updateStationRule_(payload) {
  const team = normalizeString_(payload.team);
  const stationId = normalizeString_(payload.stationId);

  if (!team || !stationId) {
    throw new Error('updateStationRule 缺少 team 或 stationId');
  }

  const rulesSheet = getSheet_(SHEETS.RULES);
  const headers = getHeaders_(rulesSheet);
  const rows = getSheetObjects_(SHEETS.RULES);

  const matchedIndexes = [];
  rows.forEach(function (row, index) {
    if (
      normalizeString_(row['班別']) === team &&
      normalizeString_(row['站點代碼']) === stationId &&
      !isTemplateRuleRow_(row)
    ) {
      matchedIndexes.push(getSourceRowNumber_(rows, index));
    }
  });

  if (matchedIndexes.length === 0) {
    const newRow = headers.map(function (header) {
      switch (header) {
        case '規則ID': return normalizeString_(payload.id) || ('RULE_' + team + '_' + stationId);
        case '班別': return team;
        case '日別': return '當班';
        case '站點代碼': return stationId;
        case '最低需求': return toNumberOrBlank_(payload.minRequired);
        case '輪休需求(單批)': return toNumberOrBlank_(payload.reliefMinPerBatch);
        case '可排滿':
        case '可排滿人數':
        case 'maxAssignable':
          return toNumberOrBlank_(payload.maxAssignable);
        case '備援目標': return toNumberOrBlank_(payload.backupTarget);
        case '排班優先順序': return toNumberOrBlank_(payload.priority);
        case '是否必站':
        case '必站':
          return toYN_(payload.isMandatory);
        case '訓練中可補位':
        case '訓練中':
          return toYN_(payload.trainingCanFill);
        case '可否共用人力':
        case '支援補位':
          return toYN_(payload.canShare);
        case '資格限制': return normalizeString_(payload.qualificationLimit) || '不限';
        case '啟用狀態': return payload.enabled === false ? '停用' : '啟用';
        case '備註': return normalizeString_(payload.note);
        default: return '';
      }
    });
    appendLiteralRow_(rulesSheet, newRow);
  } else {
    matchedIndexes.forEach(function (rowNumber) {
      if (payload.id !== undefined) setCellIfExists_(rulesSheet, headers, rowNumber, '規則ID', normalizeString_(payload.id));
      if (payload.minRequired !== undefined) setCellIfExists_(rulesSheet, headers, rowNumber, '最低需求', toNumberOrBlank_(payload.minRequired));
      if (payload.backupTarget !== undefined) setCellIfExists_(rulesSheet, headers, rowNumber, '備援目標', toNumberOrBlank_(payload.backupTarget));
      if (payload.maxAssignable !== undefined) {
        setCellIfExists_(rulesSheet, headers, rowNumber, '可排滿', toNumberOrBlank_(payload.maxAssignable));
        setCellIfExists_(rulesSheet, headers, rowNumber, '可排滿人數', toNumberOrBlank_(payload.maxAssignable));
        setCellIfExists_(rulesSheet, headers, rowNumber, 'maxAssignable', toNumberOrBlank_(payload.maxAssignable));
      }
      if (payload.priority !== undefined) setCellIfExists_(rulesSheet, headers, rowNumber, '排班優先順序', toNumberOrBlank_(payload.priority));
      if (payload.isMandatory !== undefined) {
        setCellIfExists_(rulesSheet, headers, rowNumber, '是否必站', toYN_(payload.isMandatory));
        setCellIfExists_(rulesSheet, headers, rowNumber, '必站', toYN_(payload.isMandatory));
      }
      if (payload.trainingCanFill !== undefined) {
        setCellIfExists_(rulesSheet, headers, rowNumber, '訓練中可補位', toYN_(payload.trainingCanFill));
        setCellIfExists_(rulesSheet, headers, rowNumber, '訓練中', toYN_(payload.trainingCanFill));
      }
      if (payload.canShare !== undefined) {
        setCellIfExists_(rulesSheet, headers, rowNumber, '可否共用人力', toYN_(payload.canShare));
        setCellIfExists_(rulesSheet, headers, rowNumber, '支援補位', toYN_(payload.canShare));
      }
      if (payload.qualificationLimit !== undefined) setCellIfExists_(rulesSheet, headers, rowNumber, '資格限制', normalizeString_(payload.qualificationLimit));
      if (payload.enabled !== undefined) setCellIfExists_(rulesSheet, headers, rowNumber, '啟用狀態', payload.enabled === false ? '停用' : '啟用');
      if (payload.note !== undefined) setCellIfExists_(rulesSheet, headers, rowNumber, '備註', normalizeString_(payload.note));
      if (payload.reliefMinPerBatch !== undefined) {
        const wroteDirectly = setCellIfExists_(rulesSheet, headers, rowNumber, '輪休需求(單批)', toNumberOrBlank_(payload.reliefMinPerBatch))
          || setCellIfExists_(rulesSheet, headers, rowNumber, '輪休需求', toNumberOrBlank_(payload.reliefMinPerBatch));
        if (!wroteDirectly) {
          syncReliefDemandToStations_(stationId, payload.reliefMinPerBatch);
        }
      }
    });
  }

  // 若 04 沒有輪休欄位，也同步寫回 02_站點主表
  if (payload.reliefMinPerBatch !== undefined) {
    syncReliefDemandToStations_(stationId, payload.reliefMinPerBatch);
  }

  return {
    ok: true,
    message: '站點規則已更新',
    stationRule: payload,
  };
}

function syncReliefDemandToStations_(stationId, reliefValue) {
  const ws = getSheet_(SHEETS.STATIONS);
  const headers = getHeaders_(ws);
  const rows = getSheetObjects_(SHEETS.STATIONS);

  rows.forEach(function (row, index) {
    if (normalizeString_(row['站點代碼']) === stationId) {
      const rowNumber = getSourceRowNumber_(rows, index);
      setCellIfExists_(ws, headers, rowNumber, '輪休最低人數', toNumberOrBlank_(reliefValue));
    }
  });
}

/** =========================
 *  People / Accounts
 *  ========================= */

function updatePerson_(payload, session) {
  const employeeId = normalizeString_(payload.id);
  if (!employeeId) {
    throw new Error('updatePerson 缺少 id');
  }

  const peopleSheet = getSheet_(SHEETS.PEOPLE);
  const peopleHeaders = getHeaders_(peopleSheet);
  const peopleRows = getSheetObjects_(SHEETS.PEOPLE);

  const peopleIndex = peopleRows.findIndex(function (row) {
    return normalizeString_(row['工號']) === employeeId;
  });

  if (peopleIndex < 0) {
    throw new Error('找不到人員主檔：' + employeeId);
  }

  const rowNumber = getSourceRowNumber_(peopleRows, peopleIndex);

  const profileFields = { '姓名': payload.name, '班別': payload.shift, '職務': payload.role, '國籍': payload.nationality,
    '(A)第一天': payload.aDay1, '(A)第二天': payload.aDay2, '(B)第一天': payload.bDay1, '(B)第二天': payload.bDay2,
    '在職狀態': payload.employmentStatus, '備註': payload.note };
  setRowFields_(peopleSheet, peopleHeaders, rowNumber, profileFields);
  if (Object.keys(profileFields).some(function (key) { return profileFields[key] !== undefined; })) {
    const person = Object.assign({}, normalizePeople_([peopleRows[peopleIndex]])[0], payload);
    ensureQualificationMatrixPersonRow_(person);
  }

  // 帳號權限、狀態與密碼屬敏感欄位，只允許最高權限工作階段修改。
  if (
    payload.systemPermission !== undefined ||
    payload.permissionLevel !== undefined ||
    payload.isSuperAdmin !== undefined ||
    payload.password !== undefined ||
    payload.loginPassword !== undefined ||
    payload.accountEnabled !== undefined ||
    payload.accountStatus !== undefined ||
    payload.enabled !== undefined
  ) {
    assertSuperAdmin_(session);
    const accountSheet = getSheet_(SHEETS.ACCOUNTS, true);
    if (accountSheet) {
      const accountHeaders = getHeaders_(accountSheet);
      const accountRows = getSheetObjects_(SHEETS.ACCOUNTS);
      const accountIndex = accountRows.findIndex(function (row) {
        return normalizeString_(row['工號']) === employeeId;
      });

      if (accountIndex >= 0) {
        const accountRowNumber = getSourceRowNumber_(accountRows, accountIndex);
        const permission = normalizeString_(payload.systemPermission || payload.permissionLevel);
        const nextPassword = normalizeString_(payload.password || payload.loginPassword);
        const nextStatus = normalizeString_(payload.accountStatus || payload.accountEnabled || payload.enabled);

        if (permission) {
          setCellIfExists_(accountSheet, accountHeaders, accountRowNumber, '系統權限', permission);
        }
        if (nextPassword) {
          setCellIfExists_(accountSheet, accountHeaders, accountRowNumber, '登入密碼', hashPassword_(nextPassword));
        }
        if (nextStatus) {
          setCellIfExists_(accountSheet, accountHeaders, accountRowNumber, '啟用狀態', nextStatus === '停用' ? '停用' : '啟用');
        }
        if (nextPassword || nextStatus === '停用') revokeSessionsForEmployee_(employeeId);
      }
    }
  }

  const responsePerson = Object.assign({}, payload);
  delete responsePerson.password;
  delete responsePerson.loginPassword;
  delete responsePerson.accountPassword;
  delete responsePerson['登入密碼'];
  return { ok: true, person: responsePerson };
}

function createPerson_(payload) {
  payload = payload || {};
  const employeeId = normalizeString_(payload.id).toUpperCase();
  const name = normalizeString_(payload.name);
  const shift = normalizeString_(payload.shift);
  if (!employeeId || !name || !shift) {
    throw new Error('createPerson 缺少工號、姓名或班別');
  }

  const peopleSheet = getSheet_(SHEETS.PEOPLE);
  const peopleHeaders = getHeaders_(peopleSheet);
  const peopleRows = getSheetObjects_(SHEETS.PEOPLE);
  const duplicate = peopleRows.some(function (row) {
    return normalizeString_(row['工號']).toUpperCase() === employeeId;
  });
  if (duplicate) {
    throw new Error('工號已存在：' + employeeId);
  }

  const person = {
    id: employeeId,
    name: name,
    shift: shift,
    role: normalizeString_(payload.role) || '技術員',
    nationality: normalizeString_(payload.nationality),
    aDay1: normalizeString_(payload.aDay1),
    aDay2: normalizeString_(payload.aDay2),
    bDay1: normalizeString_(payload.bDay1),
    bDay2: normalizeString_(payload.bDay2),
    employmentStatus: normalizeString_(payload.employmentStatus) || '在職',
    note: normalizeString_(payload.note),
  };
  const valuesByHeader = {
    '工號': person.id,
    '姓名': person.name,
    '班別': person.shift,
    '職務': person.role,
    '國籍': person.nationality,
    '(A)第一天': person.aDay1,
    '(A)第二天': person.aDay2,
    '(B)第一天': person.bDay1,
    '(B)第二天': person.bDay2,
    '在職狀態': person.employmentStatus,
    '備註': person.note,
  };

  if (payload.validateOnly === true || normalizeString_(payload.validateOnly).toUpperCase() === 'Y') {
    return {
      ok: true,
      message: '新增人員驗證通過，未寫入正式資料',
      validatedOnly: true,
      person: person,
    };
  }

  const personRowNumber = peopleSheet.getLastRow() + 1;
  appendLiteralRow_(peopleSheet, peopleHeaders.map(function (header) {
    return Object.prototype.hasOwnProperty.call(valuesByHeader, header) ? valuesByHeader[header] : '';
  }));

  let matrixResult;
  try {
    matrixResult = ensureQualificationMatrixPersonRow_(person);
  } catch (error) {
    try {
      invalidateSheetReads_();
      peopleSheet.deleteRow(personRowNumber);
    } catch (rollbackError) {
      throw new Error(
        '新增人員時站點矩陣同步失敗，且人員主表回滾失敗，請立即人工檢查：' +
        (error && error.message ? error.message : String(error)) + '；回滾錯誤：' +
        (rollbackError && rollbackError.message ? rollbackError.message : String(rollbackError))
      );
    }
    throw new Error('新增人員未完成：站點矩陣同步失敗，已回滾人員主表。' + (error && error.message ? error.message : String(error)));
  }

  SpreadsheetApp.flush();
  const savedPeople = getSheetObjects_(SHEETS.PEOPLE).filter(function (row) { return normalizeString_(row['工號']).toUpperCase() === employeeId; });
  const savedMatrix = readQualificationMatrix_();
  const savedRows = savedMatrix.values.slice(savedMatrix.headerRowIndex + 1).filter(function (row) { return normalizeString_(row[savedMatrix.employeeIdCol]).toUpperCase() === employeeId; });
  if (savedPeople.length !== 1 || normalizeString_(savedPeople[0]['姓名']) !== name || savedRows.length !== 1 || normalizeString_(savedRows[0][savedMatrix.employeeNameCol]) !== name) {
    throw new Error('新增人員後主表與矩陣核對不一致，請先檢查資料，不要再次新增。');
  }

  return {
    ok: true,
    message: matrixResult.created ? '人員已新增並建立站點矩陣列' : '人員已新增並確認站點矩陣列',
    person: person,
    matrixRowCreated: matrixResult.created,
    matrixRowNumber: matrixResult.rowNumber,
  };
}

/** =========================
 *  Permission Management / Schedule Draft Persistence
 *  ========================= */

function buildPermissionConfig_() {
  return {
    ok: true,
    revision: getDataRevision_(),
    permissionItems: normalizePermissionItems_(getSheetObjects_(SHEETS.PERMISSION_ITEMS)),
    rolePermissionMaps: normalizeRolePermissionMaps_(getSheetObjects_(SHEETS.ROLE_PERMISSIONS)),
    personalPermissionExceptions: normalizePersonalPermissionExceptions_(getSheetObjects_(SHEETS.PERSONAL_PERMISSION_EXCEPTIONS)),
  };
}

function updatePermissionItem_(payload) {
  payload = payload || {};
  const id = normalizeString_(payload.id || payload.permissionId);
  if (!id) throw new Error('updatePermissionItem 缺少 id / permissionId');

  const headers = ['權限ID', '權限名稱', '分類', '頁面', '動作', '手機優先', '啟用狀態', '備註', '更新時間', '更新人'];
  const ws = ensureSheetWithHeaders_(SHEETS.PERMISSION_ITEMS, headers);
  const rows = getSheetObjects_(SHEETS.PERMISSION_ITEMS);
  const existingIndex = rows.findIndex(function (row) { return normalizeString_(row['權限ID']) === id; });
  const now = new Date();
  const item = {
    id: id,
    name: normalizeString_(payload.name || payload.permissionName),
    category: normalizeString_(payload.category),
    page: normalizeString_(payload.page),
    action: normalizeString_(payload.action),
    mobileFirst: normalizeString_(payload.mobileFirst) || 'Y',
    enabled: normalizeEnabled_(payload.enabled),
    note: normalizeString_(payload.note),
  };

  if (existingIndex >= 0) {
    const rowNumber = getSourceRowNumber_(rows, existingIndex);
    setCellIfExists_(ws, headers, rowNumber, '權限名稱', item.name);
    setCellIfExists_(ws, headers, rowNumber, '分類', item.category);
    setCellIfExists_(ws, headers, rowNumber, '頁面', item.page);
    setCellIfExists_(ws, headers, rowNumber, '動作', item.action);
    setCellIfExists_(ws, headers, rowNumber, '手機優先', item.mobileFirst);
    setCellIfExists_(ws, headers, rowNumber, '啟用狀態', item.enabled);
    setCellIfExists_(ws, headers, rowNumber, '備註', item.note);
    setCellIfExists_(ws, headers, rowNumber, '更新時間', now);
    setCellIfExists_(ws, headers, rowNumber, '更新人', normalizeString_(payload.updatedBy) || '系統');
  } else {
    appendLiteralRow_(ws, headers.map(function (header) {
      switch (header) {
        case '權限ID': return item.id;
        case '權限名稱': return item.name;
        case '分類': return item.category;
        case '頁面': return item.page;
        case '動作': return item.action;
        case '手機優先': return item.mobileFirst;
        case '啟用狀態': return item.enabled;
        case '備註': return item.note;
        case '更新時間': return now;
        case '更新人': return normalizeString_(payload.updatedBy) || '系統';
        default: return '';
      }
    }));
  }

  return { ok: true, message: '權限項目已儲存', permissionItem: item };
}

function updateRolePermission_(payload) {
  payload = payload || {};
  const role = normalizeString_(payload.role);
  const permissionId = normalizeString_(payload.permissionId || payload.id);
  if (!role || !permissionId) throw new Error('updateRolePermission 缺少 role 或 permissionId');

  const headers = ['權限設定ID', '角色', '權限ID', '允許', '啟用狀態', '備註', '更新時間', '更新人'];
  const ws = ensureSheetWithHeaders_(SHEETS.ROLE_PERMISSIONS, headers);
  const rows = getSheetObjects_(SHEETS.ROLE_PERMISSIONS);
  const mapId = normalizeString_(payload.mapId || payload.id) || ('ROLEMAP_' + role + '_' + permissionId);
  const existingIndex = rows.findIndex(function (row) {
    const rowId = normalizeString_(row['權限設定ID']);
    return rowId === mapId || (normalizeString_(row['角色']) === role && normalizeString_(row['權限ID']) === permissionId);
  });
  const now = new Date();
  const item = {
    id: mapId,
    role: role,
    permissionId: permissionId,
    allowed: role === '最高權限' ? 'Y' : normalizeAllowed_(payload.allowed),
    enabled: role === '最高權限' ? '啟用' : normalizeEnabled_(payload.enabled),
    note: normalizeString_(payload.note),
  };

  if (existingIndex >= 0) {
    const rowNumber = getSourceRowNumber_(rows, existingIndex);
    setCellIfExists_(ws, headers, rowNumber, '權限設定ID', item.id);
    setCellIfExists_(ws, headers, rowNumber, '角色', item.role);
    setCellIfExists_(ws, headers, rowNumber, '權限ID', item.permissionId);
    setCellIfExists_(ws, headers, rowNumber, '允許', item.allowed);
    setCellIfExists_(ws, headers, rowNumber, '啟用狀態', item.enabled);
    setCellIfExists_(ws, headers, rowNumber, '備註', item.note);
    setCellIfExists_(ws, headers, rowNumber, '更新時間', now);
    setCellIfExists_(ws, headers, rowNumber, '更新人', normalizeString_(payload.updatedBy) || '系統');
  } else {
    appendLiteralRow_(ws, headers.map(function (header) {
      switch (header) {
        case '權限設定ID': return item.id;
        case '角色': return item.role;
        case '權限ID': return item.permissionId;
        case '允許': return item.allowed;
        case '啟用狀態': return item.enabled;
        case '備註': return item.note;
        case '更新時間': return now;
        case '更新人': return normalizeString_(payload.updatedBy) || '系統';
        default: return '';
      }
    }));
  }

  return { ok: true, message: role === '最高權限' ? '最高權限固定全功能開放，已保護不被關閉' : '角色權限已儲存', rolePermissionMap: item };
}

function upsertPersonalPermissionException_(payload) {
  payload = payload || {};
  const employeeId = normalizeString_(payload.employeeId);
  const permissionId = normalizeString_(payload.permissionId);
  if (!employeeId || !permissionId) throw new Error('upsertPersonalPermissionException 缺少 employeeId 或 permissionId');

  const headers = ['例外ID', '工號', '權限ID', '效果', '啟用狀態', '備註', '更新時間', '更新人'];
  const ws = ensureSheetWithHeaders_(SHEETS.PERSONAL_PERMISSION_EXCEPTIONS, headers);
  const rows = getSheetObjects_(SHEETS.PERSONAL_PERMISSION_EXCEPTIONS);
  const exceptionId = normalizeString_(payload.id) || ('EXC_' + employeeId + '_' + permissionId);
  const existingIndex = rows.findIndex(function (row) {
    const rowId = normalizeString_(row['例外ID']);
    return rowId === exceptionId || (normalizeString_(row['工號']) === employeeId && normalizeString_(row['權限ID']) === permissionId);
  });
  const now = new Date();
  const effect = normalizeString_(payload.effect) === 'deny' ? 'deny' : 'allow';
  const item = { id: exceptionId, employeeId: employeeId, permissionId: permissionId, effect: effect, enabled: normalizeEnabled_(payload.enabled), note: normalizeString_(payload.note) };

  if (existingIndex >= 0) {
    const rowNumber = getSourceRowNumber_(rows, existingIndex);
    setCellIfExists_(ws, headers, rowNumber, '例外ID', item.id);
    setCellIfExists_(ws, headers, rowNumber, '工號', item.employeeId);
    setCellIfExists_(ws, headers, rowNumber, '權限ID', item.permissionId);
    setCellIfExists_(ws, headers, rowNumber, '效果', item.effect);
    setCellIfExists_(ws, headers, rowNumber, '啟用狀態', item.enabled);
    setCellIfExists_(ws, headers, rowNumber, '備註', item.note);
    setCellIfExists_(ws, headers, rowNumber, '更新時間', now);
    setCellIfExists_(ws, headers, rowNumber, '更新人', normalizeString_(payload.updatedBy) || '系統');
  } else {
    appendLiteralRow_(ws, headers.map(function (header) {
      switch (header) {
        case '例外ID': return item.id;
        case '工號': return item.employeeId;
        case '權限ID': return item.permissionId;
        case '效果': return item.effect;
        case '啟用狀態': return item.enabled;
        case '備註': return item.note;
        case '更新時間': return now;
        case '更新人': return normalizeString_(payload.updatedBy) || '系統';
        default: return '';
      }
    }));
  }
  return { ok: true, message: '個人例外權限已儲存', personalPermissionException: item };
}

function deletePersonalPermissionException_(payload) {
  payload = payload || {};
  const id = normalizeString_(payload.id);
  const employeeId = normalizeString_(payload.employeeId);
  const permissionId = normalizeString_(payload.permissionId);
  if (!id && (!employeeId || !permissionId)) throw new Error('deletePersonalPermissionException 缺少 id，或 employeeId + permissionId');

  const headers = ['例外ID', '工號', '權限ID', '效果', '啟用狀態', '備註', '更新時間', '更新人'];
  const ws = ensureSheetWithHeaders_(SHEETS.PERSONAL_PERMISSION_EXCEPTIONS, headers);
  const rows = getSheetObjects_(SHEETS.PERSONAL_PERMISSION_EXCEPTIONS);
  const existingIndex = rows.findIndex(function (row) {
    if (id && normalizeString_(row['例外ID']) === id) return true;
    return normalizeString_(row['工號']) === employeeId && normalizeString_(row['權限ID']) === permissionId;
  });
  if (existingIndex < 0) return { ok: true, message: '找不到個人例外權限，視為已停用。' };

  const rowNumber = getSourceRowNumber_(rows, existingIndex);
  setCellIfExists_(ws, headers, rowNumber, '啟用狀態', '停用');
  setCellIfExists_(ws, headers, rowNumber, '更新時間', new Date());
  setCellIfExists_(ws, headers, rowNumber, '更新人', normalizeString_(payload.updatedBy) || '系統');
  return { ok: true, message: '個人例外權限已停用' };
}

function saveScheduleDraft_(payload, session) {
  if (!session) throw authError_('缺少登入工作階段。', 'AUTH_REQUIRED');
  assertActionScope_(session, 'saveScheduleDraft', payload || {});
  payload = payload || {};
  const draft = payload.draft || payload;
  const draftId = normalizeString_(draft.id) || ('DRAFT_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss_SSS'));
  const name = normalizeString_(draft.name) || ('站點試排_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm'));
  const now = new Date();
  const draftHeaders = ['試排ID', '名稱', '班別', '日別', '模式', '狀態', '建立人', '建立時間', '更新時間', '備註'];
  const detailHeaders = ['試排ID', '項目ID', '站點代碼', '工號', '類型', '順序', '備註'];
  const draftSheet = ensureSheetWithHeaders_(SHEETS.SCHEDULE_DRAFTS, draftHeaders);
  const detailSheet = ensureSheetWithHeaders_(SHEETS.SCHEDULE_DRAFT_DETAILS, detailHeaders);
  const draftRows = getSheetObjects_(SHEETS.SCHEDULE_DRAFTS);
  const existingIndex = draftRows.findIndex(function (row) { return normalizeString_(row['試排ID']) === draftId; });
  if (existingIndex >= 0) {
    const rowNumber = getSourceRowNumber_(draftRows, existingIndex);
    setCellIfExists_(draftSheet, draftHeaders, rowNumber, '名稱', name);
    setCellIfExists_(draftSheet, draftHeaders, rowNumber, '班別', normalizeString_(draft.team));
    setCellIfExists_(draftSheet, draftHeaders, rowNumber, '日別', normalizeString_(draft.dayKey));
    setCellIfExists_(draftSheet, draftHeaders, rowNumber, '模式', normalizeString_(draft.mode));
    setCellIfExists_(draftSheet, draftHeaders, rowNumber, '狀態', normalizeString_(draft.status) || '草稿');
    setCellIfExists_(draftSheet, draftHeaders, rowNumber, '更新時間', now);
    setCellIfExists_(draftSheet, draftHeaders, rowNumber, '備註', normalizeString_(draft.note));
  } else {
    appendLiteralRow_(draftSheet, draftHeaders.map(function (header) {
      switch (header) {
        case '試排ID': return draftId;
        case '名稱': return name;
        case '班別': return normalizeString_(draft.team);
        case '日別': return normalizeString_(draft.dayKey);
        case '模式': return normalizeString_(draft.mode);
        case '狀態': return normalizeString_(draft.status) || '草稿';
        case '建立人': return normalizeString_(session.employeeId);
        case '建立時間': return now;
        case '更新時間': return now;
        case '備註': return normalizeString_(draft.note);
        default: return '';
      }
    }));
  }
  removeScheduleDraftDetails_(detailSheet, draftId);
  const assignments = Array.isArray(payload.assignments) ? payload.assignments : [];
  if (assignments.length) {
    const values = assignments.map(function (item, index) {
      return detailHeaders.map(function (header) {
        switch (header) {
          case '試排ID': return draftId;
          case '項目ID': return normalizeString_(item.id) || ('ITEM_' + (index + 1));
          case '站點代碼': return normalizeString_(item.stationId);
          case '工號': return normalizeString_(item.employeeId || item.personId);
          case '類型': return normalizeString_(item.type) || '站點';
          case '順序': return index + 1;
          case '備註': return normalizeString_(item.note);
          default: return '';
        }
      });
    });
    setLiteralValues_(detailSheet.getRange(detailSheet.getLastRow() + 1, 1, values.length, detailHeaders.length), values);
  }
  return { ok: true, message: '站點試排草稿已儲存', draftId: draftId, assignmentCount: assignments.length };
}

function loadScheduleDrafts_(payload, session) {
  if (!session) throw authError_('缺少登入工作階段。', 'AUTH_REQUIRED');
  payload = payload || {};
  const drafts = normalizeScheduleDrafts_(getSheetObjects_(SHEETS.SCHEDULE_DRAFTS));
  const includeDetails = String(payload.includeDetails || '').toLowerCase() === 'true' || payload.includeDetails === true;
  let team = normalizeString_(payload.team);
  if (normalizeString_(session.role) !== '最高權限') {
    const user = buildSessionUser_(session);
    const ownTeam = normalizeString_(user && user.shift);
    if (!ownTeam || (team && team !== ownTeam)) throw authError_('只能讀取自己班別的試排草稿。', 'FORBIDDEN');
    team = ownTeam;
  }
  const dayKey = normalizeString_(payload.dayKey);
  let filtered = drafts;
  if (team) filtered = filtered.filter(function (item) { return item.team === team; });
  if (dayKey) filtered = filtered.filter(function (item) { return item.dayKey === dayKey; });
  const result = { ok: true, drafts: filtered, revision: getDataRevision_() };
  if (includeDetails) {
    const details = normalizeScheduleDraftDetails_(getSheetObjects_(SHEETS.SCHEDULE_DRAFT_DETAILS));
    result.details = details.filter(function (detail) { return filtered.some(function (draft) { return draft.id === detail.draftId; }); });
  }
  return result;
}

function removeScheduleDraftDetails_(detailSheet, draftId) {
  const rows = getSheetObjects_(SHEETS.SCHEDULE_DRAFT_DETAILS);
  for (var i = rows.length - 1; i >= 0; i--) {
    if (normalizeString_(rows[i]['試排ID']) === draftId) {
      invalidateSheetReads_();
      detailSheet.deleteRow(getSourceRowNumber_(rows, i));
    }
  }
}

/** =========================
 *  Normalizers
 *  ========================= */

function normalizePeople_(rows) {
  return rows
    .filter(function (row) {
      return normalizeString_(row['工號']) &&
        normalizeString_(row['工號']) !== '工號' &&
        normalizeString_(row['工號']) !== '唯一主鍵';
    })
    .map(function (row) {
      return {
        id: normalizeString_(row['工號']),
        name: normalizeString_(row['姓名']),
        shift: normalizeString_(row['班別']),
        role: normalizeString_(row['職務']),
        nationality: normalizeString_(row['國籍']),
        aDay1: normalizeString_(row['(A)第一天']),
        aDay2: normalizeString_(row['(A)第二天']),
        bDay1: normalizeString_(row['(B)第一天']),
        bDay2: normalizeString_(row['(B)第二天']),
        employmentStatus: normalizeString_(row['在職狀態']),
        note: normalizeString_(row['備註']),
      };
    });
}

function normalizeStations_(rows) {
  return rows
    .filter(function (row) {
      return normalizeString_(row['站點代碼']) &&
        normalizeString_(row['站點代碼']) !== '站點代碼' &&
        normalizeString_(row['站點代碼']) !== '唯一主鍵';
    })
    .map(function (row) {
      return {
        id: normalizeString_(row['站點代碼']),
        name: normalizeString_(row['站點名稱']),
        normalMin: toNumber_(row['正班最低人數']),
        reliefMinPerBatch: toNumber_(row['輪休最低人數']),
        priority: toNullableNumber_(row['排班優先順序']),
        isMandatory: toBoolean_(row['是否必站']),
        backupTarget: toNullableNumber_(row['備援目標人數']),
        description: normalizeString_(row['站點群組']),
        note: normalizeString_(row['備註']),
      };
    });
}

function normalizeQualifications_(rows) {
  return rows
    .filter(function (row) {
      const employeeId = normalizeString_(row['工號']);
      const stationId = normalizeString_(row['站點代碼']);
      if (!employeeId || !stationId) return false;
      if (employeeId === '工號' || employeeId === '唯一主鍵') return false;
      if (employeeId.indexOf('對應') >= 0 || employeeId.indexOf('可用') >= 0) return false;
      if (stationId.indexOf('對應') >= 0 || stationId.indexOf('例如') >= 0) return false;
      return true;
    })
    .map(function (row) {
      return {
        employeeId: normalizeString_(row['工號']),
        employeeName: normalizeString_(row['姓名']),
        stationId: normalizeString_(row['站點代碼']),
        status: normalizeString_(row['資格狀態']),
        rawStatus: normalizeString_(row['資格狀態']),
      };
    });
}

function normalizeTeamOnlyRules_(ruleRows, stationRows) {
  const stationMap = mapByKey_(normalizeStations_(stationRows), 'id');
  const buckets = {};

  ruleRows.forEach(function (row) {
    if (isTemplateRuleRow_(row)) return;

    const team = normalizeString_(row['班別']);
    const stationId = normalizeString_(row['站點代碼']);
    if (!team || !stationId) return;

    const key = team + '||' + stationId;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(row);
  });

  return Object.keys(buckets).map(function (key) {
    const rows = buckets[key].slice().sort(compareRuleRows_);
    const base = rows[0];
    const stationId = normalizeString_(base['站點代碼']);
    const station = stationMap[stationId] || {};

    return {
      id: normalizeString_(base['規則ID']) || ('RULE_' + normalizeString_(base['班別']) + '_' + stationId),
      team: normalizeString_(base['班別']),
      dayKey: normalizeString_(base['日別']),
      stationId: stationId,
      minRequired: firstNumber_(rows, ['最低需求']),
      reliefMinPerBatch: firstNumber_(rows, ['輪休需求(單批)', '輪休需求'], station.reliefMinPerBatch || 0),
      backupTarget: firstNumber_(rows, ['備援目標'], station.backupTarget || 0),
      maxAssignable: firstNumber_(rows, ['可排滿', '可排滿人數', 'maxAssignable'], 0),
      priority: firstNumber_(rows, ['排班優先順序'], station.priority || 999),
      isMandatory: firstBoolean_(rows, ['是否必站', '必站'], station.isMandatory || false),
      trainingCanFill: firstBoolean_(rows, ['訓練中可補位', '訓練中'], false),
      qualificationLimit: firstString_(rows, ['資格限制'], '不限'),
      canShare: firstBoolean_(rows, ['可否共用人力', '支援補位'], false),
      enabled: normalizeString_(base['啟用狀態']) !== '停用',
      note: firstString_(rows, ['備註'], ''),
    };
  });
}

function isTemplateRuleRow_(row) {
  const ruleId = normalizeString_(row['規則ID']);
  const team = normalizeString_(row['班別']);
  const stationId = normalizeString_(row['站點代碼']);
  if (!team || !stationId) return true;
  if (ruleId === '唯一主鍵') return true;
  if (team.indexOf('A班/B班') >= 0) return true;
  if (stationId.indexOf('對應') >= 0) return true;
  return false;
}

function compareRuleRows_(a, b) {
  return dayRank_(normalizeString_(a['日別'])) - dayRank_(normalizeString_(b['日別']));
}

function dayRank_(dayValue) {
  if (!dayValue) return 99;
  if (dayValue === '當班') return 1;
  if (dayValue === '第一天') return 2;
  if (dayValue === '第二天') return 3;
  if (dayValue.indexOf('第一天') >= 0) return 4;
  if (dayValue.indexOf('第二天') >= 0) return 5;
  return 99;
}

function normalizePermissionItems_(rows) {
  return rows.filter(function (row) { return normalizeString_(row['權限ID']); }).map(function (row) {
    return { id: normalizeString_(row['權限ID']), name: normalizeString_(row['權限名稱']), category: normalizeString_(row['分類']), page: normalizeString_(row['頁面']), action: normalizeString_(row['動作']), mobileFirst: normalizeString_(row['手機優先']) || 'Y', enabled: normalizeString_(row['啟用狀態']) || '啟用', note: normalizeString_(row['備註']) };
  });
}

function normalizeRolePermissionMaps_(rows) {
  return rows.filter(function (row) { return normalizeString_(row['角色']) && normalizeString_(row['權限ID']); }).map(function (row) {
    return { id: normalizeString_(row['權限設定ID']) || ('ROLEMAP_' + normalizeString_(row['角色']) + '_' + normalizeString_(row['權限ID'])), role: normalizeString_(row['角色']), permissionId: normalizeString_(row['權限ID']), allowed: normalizeString_(row['允許']) || 'N', enabled: normalizeString_(row['啟用狀態']) || '啟用', note: normalizeString_(row['備註']) };
  });
}

function normalizePersonalPermissionExceptions_(rows) {
  return rows.filter(function (row) { return normalizeString_(row['工號']) && normalizeString_(row['權限ID']); }).map(function (row) {
    return { id: normalizeString_(row['例外ID']) || ('EXC_' + normalizeString_(row['工號']) + '_' + normalizeString_(row['權限ID'])), employeeId: normalizeString_(row['工號']), permissionId: normalizeString_(row['權限ID']), effect: normalizeString_(row['效果']) === 'deny' ? 'deny' : 'allow', enabled: normalizeString_(row['啟用狀態']) || '啟用', note: normalizeString_(row['備註']) };
  });
}

function normalizeScheduleDrafts_(rows) {
  return rows.filter(function (row) { return normalizeString_(row['試排ID']); }).map(function (row) {
    return { id: normalizeString_(row['試排ID']), name: normalizeString_(row['名稱']), team: normalizeString_(row['班別']), dayKey: normalizeString_(row['日別']), mode: normalizeString_(row['模式']), status: normalizeString_(row['狀態']) || '草稿', createdBy: normalizeString_(row['建立人']), createdAt: row['建立時間'], updatedAt: row['更新時間'], note: normalizeString_(row['備註']) };
  });
}

function normalizeScheduleDraftDetails_(rows) {
  return rows.filter(function (row) { return normalizeString_(row['試排ID']) && normalizeString_(row['項目ID']); }).map(function (row) {
    return { draftId: normalizeString_(row['試排ID']), id: normalizeString_(row['項目ID']), stationId: normalizeString_(row['站點代碼']), employeeId: normalizeString_(row['工號']), type: normalizeString_(row['類型']) || '站點', order: toNullableNumber_(row['順序']), note: normalizeString_(row['備註']) };
  });
}


/** =========================
 *  Version Guard
 *  ========================= */

function buildVersionStatus_(clientVersion) {
  const settings = getSystemSettings_();
  const configuredAppVersion = settings.APP_VERSION || '';
  const configuredMinWriteVersion = settings.MIN_WRITE_VERSION || '';
  const appVersion = configuredAppVersion && compareVersion_(configuredAppVersion, SETTINGS.APP_VERSION) > 0
    ? configuredAppVersion
    : SETTINGS.APP_VERSION;
  const minWriteVersion = configuredMinWriteVersion && compareVersion_(configuredMinWriteVersion, SETTINGS.MIN_WRITE_VERSION) > 0
    ? configuredMinWriteVersion
    : SETTINGS.MIN_WRITE_VERSION;
  const version = normalizeString_(clientVersion);
  const maintenanceMode = String(settings.MAINTENANCE_MODE || 'N').toUpperCase() === 'Y';
  const outdated = !version || compareVersion_(version, appVersion) < 0;
  const writeBlocked = maintenanceMode || !version || compareVersion_(version, minWriteVersion) < 0;

  return {
    ok: true,
    appVersion: appVersion,
    latestVersion: appVersion,
    minWriteVersion: minWriteVersion,
    maintenanceMode: maintenanceMode,
    outdated: outdated,
    writeBlocked: writeBlocked,
    message: writeBlocked
      ? (maintenanceMode ? '系統維護中，目前暫停寫入。' : '系統已有新版，請重新整理後繼續操作。')
      : outdated
        ? '系統已有新版，請重新整理後繼續使用。'
        : '版本資訊讀取成功',
  };
}

function assertWritableAppVersion_(clientVersion) {
  const status = buildVersionStatus_(clientVersion);

  if (status.maintenanceMode) {
    throw new Error('系統維護中，目前暫停寫入。');
  }

  const version = normalizeString_(clientVersion);
  if (!version) {
    throw new Error('缺少 appVersion，請重新整理後再操作。');
  }

  if (status.writeBlocked) {
    throw new Error(status.message || '目前網頁版本過舊，請重新整理後再操作。');
  }

  return true;
}

function compareVersion_(a, b) {
  const left = parseVersion_(a);
  const right = parseVersion_(b);
  if (left && right) {
    if (left.date !== right.date) return left.date - right.date;
    if (left.revision !== right.revision) return left.revision - right.revision;
  }
  return String(a || '').localeCompare(String(b || ''), 'en', { numeric: true });
}

function buildPermissionConfigForSession_(session) {
  const config = buildPermissionConfig_();
  if (normalizeString_(session.role) === '最高權限') return config;
  return {
    ok: true,
    revision: config.revision,
    permissionItems: config.permissionItems,
    rolePermissionMaps: config.rolePermissionMaps.filter(function (item) { return item.role === session.role; }),
    personalPermissionExceptions: config.personalPermissionExceptions.filter(function (item) { return item.employeeId === session.employeeId; }),
  };
}

function parseVersion_(value) {
  const text = String(value || '').trim();
  const dateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dateMatch) return null;
  const revisionMatch = text.match(/(?:-v\d+)?-(\d+)$/);
  return {
    date: Number(dateMatch[1] + dateMatch[2] + dateMatch[3]),
    revision: Number(revisionMatch ? revisionMatch[1] : 0),
  };
}

function getSystemSettings_() {
  const ws = getSheet_(SHEETS.SYSTEM, true);
  if (!ws) return {};

  const values = ws.getDataRange().getValues();
  if (values.length < 2) return {};

  const headers = values[0].map(function (v) { return normalizeString_(v); });
  const keyCol = headers.indexOf('設定鍵');
  const valueCol = headers.indexOf('設定值');

  if (keyCol < 0 || valueCol < 0) return {};

  const settings = {};
  values.slice(1).forEach(function (row) {
    const key = normalizeString_(row[keyCol]);
    if (!key) return;
    settings[key] = normalizeString_(row[valueCol]);
  });

  return settings;
}


/** =========================
 *  Sheet Helpers
 *  ========================= */

function getSheet_(name, optional) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ws = ss.getSheetByName(name);
  if (!ws && !optional) {
    throw new Error('找不到工作表：' + name);
  }
  return ws || null;
}

function getHeaders_(ws) {
  return getSheetHeaderInfo_(ws).headers;
}

function ensureSheetWithHeaders_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let ws = ss.getSheetByName(name);
  if (!ws) {
    ws = ss.insertSheet(name);
  }
  const existingHeaders = getHeaders_(ws);
  if (existingHeaders.length === 0) {
    setLiteralValues_(ws.getRange(1, 1, 1, headers.length), [headers]);
    return ws;
  }
  headers.forEach(function (header) {
    if (existingHeaders.indexOf(header) < 0) {
      setLiteralValue_(ws.getRange(1, ws.getLastColumn() + 1), header);
      existingHeaders.push(header);
    }
  });
  return ws;
}

function getSheetObjects_(sheetName) {
  if (requestSheetCache_ && requestSheetCache_[sheetName]) return requestSheetCache_[sheetName].map(function (row) { return Object.assign({}, row); });
  const ws = getSheet_(sheetName, true);
  if (!ws) return [];
  const values = ws.getDataRange().getValues();
  if (values.length < 2) return [];
  const headerInfo = getSheetHeaderInfo_(ws, values);
  const headers = headerInfo.headers;

  const rows = values.slice(headerInfo.rowIndex + 1).map(function (row, rowOffset) {
    const obj = {};
    headers.forEach(function (header, index) {
      obj[header] = row[index];
    });
    obj.__rowNumber = headerInfo.rowIndex + rowOffset + 2;
    return obj;
  });
  if (requestSheetCache_) requestSheetCache_[sheetName] = rows;
  return rows.map(function (row) { return Object.assign({}, row); });
}

function getSheetHeaderInfo_(ws, existingValues) {
  const lastColumn = ws.getLastColumn();
  if (lastColumn <= 0) return { rowIndex: 0, headers: [] };

  const values = existingValues || ws.getDataRange().getValues();
  if (!values.length) return { rowIndex: 0, headers: [] };

  const knownHeaders = [
    '工號', '姓名', '班別', '職務', '國籍', '在職狀態',
    '登入帳號', '登入密碼', '系統權限', '啟用狀態',
    '站點編號', '站點名稱', '站點代碼', '資格狀態',
    '權限ID', '角色', '規則ID', '例外ID', '試排ID', '項目ID',
  ];
  const scanCount = Math.min(values.length, 20);
  let bestRowIndex = 0;
  let bestScore = -1;

  for (let rowIndex = 0; rowIndex < scanCount; rowIndex += 1) {
    const headers = values[rowIndex].map(function (value) { return normalizeString_(value); });
    const recognized = headers.filter(function (header) { return knownHeaders.indexOf(header) >= 0; }).length;
    const nonEmpty = headers.filter(function (header) { return !!header; }).length;
    const unique = {};
    headers.forEach(function (header) { if (header) unique[header] = true; });
    const duplicatePenalty = nonEmpty - Object.keys(unique).length;
    const score = recognized * 100 + nonEmpty - duplicatePenalty * 10;

    if (score > bestScore) {
      bestScore = score;
      bestRowIndex = rowIndex;
    }
  }

  return {
    rowIndex: bestRowIndex,
    headers: values[bestRowIndex].map(function (value) { return normalizeString_(value); }),
  };
}

function getSourceRowNumber_(rows, index) {
  return Number(rows[index] && rows[index].__rowNumber) || index + 2;
}

function setCellIfExists_(ws, headers, rowNumber, headerName, value) {
  const colIndex = headers.indexOf(headerName);
  if (colIndex < 0 || value === undefined) return false;
  setLiteralValue_(ws.getRange(rowNumber, colIndex + 1), value);
  return true;
}

function literalCellValue_(value) {
  return typeof value === 'string' && /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/.test(value) ? "'" + value : value;
}

function setLiteralValue_(range, value) {
  invalidateSheetReads_();
  return range.setValue(literalCellValue_(value));
}

function setLiteralValues_(range, values) {
  invalidateSheetReads_();
  return range.setValues(values.map(function (row) { return row.map(literalCellValue_); }));
}

function appendLiteralRow_(sheet, values) {
  invalidateSheetReads_();
  return sheet.appendRow(values.map(literalCellValue_));
}

function invalidateSheetReads_() {
  dataMutationAttempted_ = true;
  if (requestSheetCache_) requestSheetCache_ = Object.create(null);
}

function setRowFields_(sheet, headers, rowNumber, fields) {
  const cells = headers.map(function (header, index) { return { column: index + 1, value: fields[header] }; })
    .filter(function (cell) { return cell.value !== undefined; });
  for (let i = 0; i < cells.length;) {
    const start = cells[i].column;
    const values = [cells[i++].value];
    while (i < cells.length && cells[i].column === start + values.length) values.push(cells[i++].value);
    setLiteralValues_(sheet.getRange(rowNumber, start, 1, values.length), [values]);
  }
}

/** =========================
 *  Generic Helpers
 *  ========================= */

function parsePostBody_(e) {
  const text = (e && e.postData && e.postData.contents) || '{}';
  return JSON.parse(text);
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorPayload_(error) {
  return {
    ok: false,
    code: error && error.code ? String(error.code) : 'REQUEST_FAILED',
    message: error && error.message ? error.message : String(error),
    revision: error && error.revision !== undefined ? error.revision : undefined,
    retryAfterSeconds: error && error.retryAfterSeconds ? error.retryAfterSeconds : undefined,
  };
}

function normalizeString_(value) {
  return String(value == null ? '' : value).trim();
}

function toNumber_(value) {
  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

function toNullableNumber_(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

function toNumberOrBlank_(value) {
  if (value === '' || value == null) return '';
  const n = Number(value);
  return isNaN(n) ? '' : n;
}

function toBoolean_(value) {
  const v = normalizeString_(value).toUpperCase();
  return v === 'Y' || v === 'TRUE' || v === '啟用';
}

function toYN_(value) {
  return value ? 'Y' : 'N';
}

function normalizeEnabled_(value) {
  const text = normalizeString_(value);
  if (!text) return '啟用';
  if (text === '停用' || text.toUpperCase() === 'N' || text.toUpperCase() === 'FALSE') return '停用';
  return '啟用';
}

function normalizeAllowed_(value) {
  const text = normalizeString_(value).toUpperCase();
  if (!text) return 'N';
  return ['Y', 'YES', 'TRUE', '1', '啟用', '允許', '開放'].indexOf(text) >= 0 ? 'Y' : 'N';
}

function mapByKey_(list, key) {
  return list.reduce(function (acc, item) {
    acc[item[key]] = item;
    return acc;
  }, {});
}

function firstNumber_(rows, keys, defaultValue) {
  for (var i = 0; i < rows.length; i++) {
    for (var j = 0; j < keys.length; j++) {
      var value = rows[i][keys[j]];
      if (value !== '' && value != null && !isNaN(Number(value))) {
        return Number(value);
      }
    }
  }
  return defaultValue == null ? 0 : defaultValue;
}

function firstString_(rows, keys, defaultValue) {
  for (var i = 0; i < rows.length; i++) {
    for (var j = 0; j < keys.length; j++) {
      var value = normalizeString_(rows[i][keys[j]]);
      if (value) return value;
    }
  }
  return defaultValue == null ? '' : defaultValue;
}

function firstBoolean_(rows, keys, defaultValue) {
  for (var i = 0; i < rows.length; i++) {
    for (var j = 0; j < keys.length; j++) {
      var raw = rows[i][keys[j]];
      if (raw !== '' && raw != null) {
        return toBoolean_(raw);
      }
    }
  }
  return !!defaultValue;
}

function buildQualificationId_(employeeId, stationId, now) {
  return [
    'Q',
    employeeId,
    stationId,
    Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMddHHmmss')
  ].join('_');
}
