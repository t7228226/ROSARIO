import type { AppBootstrap, Person } from "../../types";

export const emptyBootstrap: AppBootstrap = {
  people: [],
  stations: [],
  qualifications: [],
  stationRules: [],
};

function normalizeCellText(value: unknown) {
  return String(value ?? "").trim();
}

function containsTemplateMarker(value: unknown) {
  const text = normalizeCellText(value);
  if (!text) return false;
  return [
    "唯一主鍵",
    "不可重複",
    "不可重覆",
    "下拉選單",
    "正式姓名",
    "範例",
    "例如",
    "說明",
    "對應",
    "自由填寫",
    "可用值",
  ].some((marker) => text.includes(marker));
}

function isRealPersonRecord(person: Person) {
  const id = normalizeCellText(person.id);
  const name = normalizeCellText(person.name);
  if (!id || !name) return false;
  if ([id, name, person.shift, person.role, person.nationality, person.note].some(containsTemplateMarker)) return false;
  if (id === "工號" || id === "姓名" || name === "姓名") return false;
  return true;
}

function isRealStationRecord(station: AppBootstrap["stations"][number]) {
  const id = normalizeCellText(station.id);
  const name = normalizeCellText(station.name);
  if (!id || !name) return false;
  if ([id, name, station.description, station.note].some(containsTemplateMarker)) return false;
  if (id === "站點代碼" || name === "站點名稱") return false;
  return true;
}

export function sanitizeBootstrapData(source: AppBootstrap): AppBootstrap {
  const people = (source.people || []).filter(isRealPersonRecord).map((person) => {
    const sanitized = { ...person } as Person & Record<string, unknown>;
    delete sanitized.password;
    delete sanitized.loginPassword;
    delete sanitized.accountPassword;
    delete sanitized["登入密碼"];
    return sanitized as Person;
  });
  const personIds = new Set(people.map((person) => person.id));
  const stations = (source.stations || []).filter(isRealStationRecord);
  const stationIds = new Set(stations.map((station) => station.id));
  const qualifications = (source.qualifications || []).filter((item) => {
    const employeeId = normalizeCellText(item.employeeId);
    const stationId = normalizeCellText(item.stationId);
    if (!employeeId || !stationId) return false;
    if ([employeeId, item.employeeName, stationId, item.status, item.rawStatus].some(containsTemplateMarker)) return false;
    return personIds.has(employeeId) && stationIds.has(stationId);
  });
  const stationRules = (source.stationRules || []).filter((rule) => {
    const team = normalizeCellText(rule.team);
    const stationId = normalizeCellText(rule.stationId);
    if (!team || !stationId) return false;
    if ([team, rule.dayKey, stationId, rule.note].some(containsTemplateMarker)) return false;
    return stationIds.has(stationId);
  });
  return { ...source, people, stations, qualifications, stationRules };
}
