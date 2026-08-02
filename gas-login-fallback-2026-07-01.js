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
 * 5. bootstrap 前會先嘗試由 03_站點矩陣同步重建 03_資格明細，
 *    讓使用者日常只維護矩陣，前端仍維持讀取 qualifications 長表。
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
  // 若 00_系統設定 內有同名設定，會以試算表設定為準。
  APP_VERSION: '2026-08-02-v2-preview.4',
  MIN_WRITE_VERSION: '2026-05-03-004',
};

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || '').trim();
    if (action === 'version') {
      return jsonOutput_(buildVersionStatus_((e && e.parameter && e.parameter.appVersion) || ''));
    }
    if (action === 'bootstrap') {
      return jsonOutput_(buildBootstrap_());
    }
    if (action === 'syncQualificationsFromMatrix') {
      return jsonOutput_(syncQualificationsFromMatrix_({ source: 'GET' }));
    }
    if (action === 'matrixDebug') {
      return jsonOutput_(debugQualificationMatrix_());
    }
    if (action === 'permissionConfig') {
      return jsonOutput_(buildPermissionConfig_());
    }
    if (action === 'loadScheduleDrafts') {
      return jsonOutput_(loadScheduleDrafts_((e && e.parameter) || {}));
    }
    return jsonOutput_({ ok: false, message: 'Unknown GET action', action });
  } catch (error) {
    return jsonOutput_(errorPayload_(error));
  }
}

function doPost(e) {
  try {
    const body = parsePostBody_(e);
    const action = String(body.action || '').trim();
    const payload = body.payload || {};

    switch (action) {
      case 'version':
        return jsonOutput_(buildVersionStatus_(body.appVersion || body.version || payload.appVersion));
      case 'login':
        return jsonOutput_(login_(payload));
      case 'upsertQualification':
        assertWritableAppVersion_(body.appVersion || body.version || payload.appVersion);
        return jsonOutput_(upsertQualification_(payload));
      case 'deleteQualification':
        assertWritableAppVersion_(body.appVersion || body.version || payload.appVersion);
        return jsonOutput_(deleteQualification_(payload));
      case 'updateStationRule':
        assertWritableAppVersion_(body.appVersion || body.version || payload.appVersion);
        return jsonOutput_(updateStationRule_(payload));
      case 'updatePerson':
        assertWritableAppVersion_(body.appVersion || body.version || payload.appVersion);
        return jsonOutput_(updatePerson_(payload));
      case 'createPerson':
        assertWritableAppVersion_(body.appVersion || body.version || payload.appVersion);
        return jsonOutput_(createPerson_(payload));
      case 'updatePermissionItem':
        assertWritableAppVersion_(body.appVersion || body.version || payload.appVersion);
        return jsonOutput_(updatePermissionItem_(payload));
      case 'updateRolePermission':
        assertWritableAppVersion_(body.appVersion || body.version || payload.appVersion);
        return jsonOutput_(updateRolePermission_(payload));
      case 'upsertPersonalPermissionException':
        assertWritableAppVersion_(body.appVersion || body.version || payload.appVersion);
        return jsonOutput_(upsertPersonalPermissionException_(payload));
      case 'deletePersonalPermissionException':
        assertWritableAppVersion_(body.appVersion || body.version || payload.appVersion);
        return jsonOutput_(deletePersonalPermissionException_(payload));
      case 'saveScheduleDraft':
        assertWritableAppVersion_(body.appVersion || body.version || payload.appVersion);
        return jsonOutput_(saveScheduleDraft_(payload));
      case 'loadScheduleDrafts':
        return jsonOutput_(loadScheduleDrafts_(payload));
      case 'permissionConfig':
        return jsonOutput_(buildPermissionConfig_());
      case 'syncQualificationsFromMatrix':
        assertWritableAppVersion_(body.appVersion || body.version || payload.appVersion);
        return jsonOutput_(syncQualificationsFromMatrix_(payload));
      case 'matrixDebug':
        return jsonOutput_(debugQualificationMatrix_());
      case 'bootstrap':
        return jsonOutput_(buildBootstrap_());
      default:
        return jsonOutput_({ ok: false, message: 'Unknown POST action', action });
    }
  } catch (error) {
    return jsonOutput_(errorPayload_(error));
  }
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
  const permissionItemRows = getSheetObjects_(SHEETS.PERMISSION_ITEMS);
  const rolePermissionRows = getSheetObjects_(SHEETS.ROLE_PERMISSIONS);
  const personalPermissionRows = getSheetObjects_(SHEETS.PERSONAL_PERMISSION_EXCEPTIONS);

  const people = mergeAccountFieldsIntoPeople_(normalizePeople_(peopleRows), accountRows);
  const stations = normalizeStations_(stationRows);
  const qualifications = normalizeQualifications_(qualificationRows);
  const stationRules = normalizeTeamOnlyRules_(ruleRows, stationRows);
  const permissionItems = normalizePermissionItems_(permissionItemRows);
  const rolePermissionMaps = normalizeRolePermissionMaps_(rolePermissionRows);
  const personalPermissionExceptions = normalizePersonalPermissionExceptions_(personalPermissionRows);

  return {
    ok: true,
    people,
    stations,
    qualifications,
    stationRules,
    permissionItems,
    rolePermissionMaps,
    personalPermissionExceptions,
    qualificationSync,
  };
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
      loginPassword: normalizeString_(account['登入密碼']),
      password: normalizeString_(account['登入密碼']),
      accountEnabled: normalizeString_(account['啟用狀態']) || '啟用',
      accountStatus: normalizeString_(account['啟用狀態']) || '啟用',
      systemPermission: normalizeString_(account['系統權限']) || person.systemPermission || '技術員',
      permissionLevel: normalizeString_(account['系統權限']) || person.permissionLevel || '技術員',
    });
  });
}

function login_(payload) {
  const account = normalizeString_(payload.account);
  const password = normalizeString_(payload.password);
  const accountKey = account.toLowerCase();
  const passwordKey = password.toLowerCase();

  if (!account || !password) {
    return { ok: false, message: '請輸入登入帳號與密碼。' };
  }

  const accountRows = getSheetObjects_(SHEETS.ACCOUNTS);
  const peopleRows = getSheetObjects_(SHEETS.PEOPLE);
  const peopleMap = mapByKey_(normalizePeople_(peopleRows), 'id');

  const matched = accountRows.find(function (row) {
    return normalizeString_(row['登入帳號']).toLowerCase() === accountKey &&
      normalizeString_(row['登入密碼']).toLowerCase() === passwordKey;
  });

  if (!matched) {
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
      debug: {
        account: loginAccount,
        employeeId: employeeId,
      },
    };
  }

  const user = Object.assign({}, person, {
    systemPermission: normalizeString_(matched['系統權限']) || '技術員',
    permissionLevel: normalizeString_(matched['系統權限']) || '技術員',
    account: normalizeString_(matched['登入帳號']),
    loginPassword: normalizeString_(matched['登入密碼']),
    password: normalizeString_(matched['登入密碼']),
    accountEnabled: enabled || '啟用',
    accountStatus: enabled || '啟用',
  });

  return {
    ok: true,
    message: '登入成功',
    user,
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
    ws.appendRow(newRow);
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

  ws.appendRow(row);
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
    detailSheet.getRange(startRow, 1, rows.length, detailHeaders.length).setValues(rows);
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
  return ['工號', '姓名', '班別', '職務', '國籍', '備註', '更新時間', '更新人'].indexOf(key) >= 0;
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

  matrixInfo.sheet.getRange(targetRow + 1, stationCol + 1).setValue(status || '');
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
    rulesSheet.appendRow(newRow);
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

function updatePerson_(payload) {
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

  setCellIfExists_(peopleSheet, peopleHeaders, rowNumber, '姓名', payload.name);
  setCellIfExists_(peopleSheet, peopleHeaders, rowNumber, '班別', payload.shift);
  setCellIfExists_(peopleSheet, peopleHeaders, rowNumber, '職務', payload.role);
  setCellIfExists_(peopleSheet, peopleHeaders, rowNumber, '國籍', payload.nationality);
  setCellIfExists_(peopleSheet, peopleHeaders, rowNumber, '(A)第一天', payload.aDay1);
  setCellIfExists_(peopleSheet, peopleHeaders, rowNumber, '(A)第二天', payload.aDay2);
  setCellIfExists_(peopleSheet, peopleHeaders, rowNumber, '(B)第一天', payload.bDay1);
  setCellIfExists_(peopleSheet, peopleHeaders, rowNumber, '(B)第二天', payload.bDay2);
  setCellIfExists_(peopleSheet, peopleHeaders, rowNumber, '在職狀態', payload.employmentStatus);
  setCellIfExists_(peopleSheet, peopleHeaders, rowNumber, '備註', payload.note);

  // 若前端有傳系統權限、帳號狀態或密碼，也同步更新 07_帳號管理
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
          setCellIfExists_(accountSheet, accountHeaders, accountRowNumber, '登入密碼', nextPassword);
        }
        if (nextStatus) {
          setCellIfExists_(accountSheet, accountHeaders, accountRowNumber, '啟用狀態', nextStatus === '停用' ? '停用' : '啟用');
        }
      }
    }
  }

  return { ok: true, person: payload };
}

function createPerson_(payload) {
  payload = payload || {};
  const employeeId = normalizeString_(payload.id).toUpperCase();
  const name = normalizeString_(payload.name);
  const shift = normalizeString_(payload.shift);
  if (!employeeId || !name || !shift) {
    throw new Error('createPerson 缺少工號、姓名或班別');
  }

  const lock = LockService.getDocumentLock();
  lock.waitLock(10000);
  try {
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

    peopleSheet.appendRow(peopleHeaders.map(function (header) {
      return Object.prototype.hasOwnProperty.call(valuesByHeader, header) ? valuesByHeader[header] : '';
    }));

    return { ok: true, message: '人員已新增', person: person };
  } finally {
    lock.releaseLock();
  }
}

/** =========================
 *  Permission Management / Schedule Draft Persistence
 *  ========================= */

function buildPermissionConfig_() {
  return {
    ok: true,
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
    ws.appendRow(headers.map(function (header) {
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
    ws.appendRow(headers.map(function (header) {
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
    ws.appendRow(headers.map(function (header) {
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

function saveScheduleDraft_(payload) {
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
    draftSheet.appendRow(draftHeaders.map(function (header) {
      switch (header) {
        case '試排ID': return draftId;
        case '名稱': return name;
        case '班別': return normalizeString_(draft.team);
        case '日別': return normalizeString_(draft.dayKey);
        case '模式': return normalizeString_(draft.mode);
        case '狀態': return normalizeString_(draft.status) || '草稿';
        case '建立人': return normalizeString_(draft.createdBy || payload.updatedBy) || '系統';
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
    detailSheet.getRange(detailSheet.getLastRow() + 1, 1, values.length, detailHeaders.length).setValues(values);
  }
  return { ok: true, message: '站點試排草稿已儲存', draftId: draftId, assignmentCount: assignments.length };
}

function loadScheduleDrafts_(payload) {
  payload = payload || {};
  const drafts = normalizeScheduleDrafts_(getSheetObjects_(SHEETS.SCHEDULE_DRAFTS));
  const includeDetails = String(payload.includeDetails || '').toLowerCase() === 'true' || payload.includeDetails === true;
  const team = normalizeString_(payload.team);
  const dayKey = normalizeString_(payload.dayKey);
  let filtered = drafts;
  if (team) filtered = filtered.filter(function (item) { return item.team === team; });
  if (dayKey) filtered = filtered.filter(function (item) { return item.dayKey === dayKey; });
  const result = { ok: true, drafts: filtered };
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
  const appVersion = settings.APP_VERSION || SETTINGS.APP_VERSION;
  const minWriteVersion = settings.MIN_WRITE_VERSION || SETTINGS.MIN_WRITE_VERSION || appVersion;
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
  return String(a || '').localeCompare(String(b || ''), 'en', { numeric: true });
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
    ws.getRange(1, 1, 1, headers.length).setValues([headers]);
    return ws;
  }
  headers.forEach(function (header) {
    if (existingHeaders.indexOf(header) < 0) {
      ws.getRange(1, ws.getLastColumn() + 1).setValue(header);
      existingHeaders.push(header);
    }
  });
  return ws;
}

function getSheetObjects_(sheetName) {
  const ws = getSheet_(sheetName, true);
  if (!ws) return [];
  const values = ws.getDataRange().getValues();
  if (values.length < 2) return [];
  const headerInfo = getSheetHeaderInfo_(ws, values);
  const headers = headerInfo.headers;

  return values.slice(headerInfo.rowIndex + 1).map(function (row, rowOffset) {
    const obj = {};
    headers.forEach(function (header, index) {
      obj[header] = row[index];
    });
    obj.__rowNumber = headerInfo.rowIndex + rowOffset + 2;
    return obj;
  });
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
  ws.getRange(rowNumber, colIndex + 1).setValue(value);
  return true;
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
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? String(error.stack) : '',
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
