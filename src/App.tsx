import { useEffect, useMemo, useRef, useState } from "react";
import Layout from "./components/Layout";
import { Info, PersonDetailView, ReviewDetailView, StationDetailView } from "./components/detailViews";
import {
  deleteQualification,
  fetchBootstrapData,
  loginWithAccount,
  updatePerson,
  updateStationRule,
  upsertQualification,
} from "./lib/api";
import {
  buildSmartAssignments,
  DAY_OPTIONS,
  getApplicableRules,
  getAttendanceForTeam,
  getQualifiedPeopleForStation,
  getStationCoverage,
  getTeamOfPerson,
  REVIEW_TEAM_OPTIONS,
  searchText,
  SMART_MODE_OPTIONS,
  TEAM_OPTIONS,
} from "./lib/selectors";
import type {
  AppBootstrap,
  Person,
  Qualification,
  QualificationStatus,
  ShiftMode,
  SmartScheduleMode,
  StationRule,
  TeamName,
  UserRole,
} from "./types";

type PageKey =
  | "home"
  | "person-query"
  | "station-query"
  | "qualification-review"
  | "station-rules"
  | "people-management"
  | "permission-admin"
  | "gap-analysis"
  | "manual-schedule"
  | "smart-schedule";

type MobileDetailModal =
  | { type: "person"; personId: string }
  | { type: "station"; stationId: string }
  | { type: "review"; personId: string }
  | null;

type ViewMode = "desktop" | "mobile";
type GlobalThemeKey = "glass" | "kawaii" | "cyber" | "premium" | "comic" | "random";
type GlobalFontKey = "system" | "rounded" | "serif" | "mono" | "hand" | "random";
type LoginKeepKey = "8h" | "12h" | "24h" | "7d";

const loginKeepOptions: Array<{ key: LoginKeepKey; label: string; ms: number }> = [
  { key: "8h", label: "8小時", ms: 8 * 60 * 60 * 1000 },
  { key: "12h", label: "12小時", ms: 12 * 60 * 60 * 1000 },
  { key: "24h", label: "24小時", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7天", ms: 7 * 24 * 60 * 60 * 1000 },
];

const loginSessionStorageKey = "stationAppLoginSession";
const loginKeepStorageKey = "stationAppLoginKeep";

function getStoredLoginKeep(): LoginKeepKey {
  const stored = typeof window !== "undefined" ? window.localStorage.getItem(loginKeepStorageKey) : "";
  return loginKeepOptions.some((item) => item.key === stored) ? (stored as LoginKeepKey) : "12h";
}

function getLoginKeepMs(key: LoginKeepKey) {
  return loginKeepOptions.find((item) => item.key === key)?.ms || loginKeepOptions[1].ms;
}

const globalThemeOptions: Array<{ key: GlobalThemeKey; label: string; note: string }> = [
  { key: "glass", label: "極簡玻璃", note: "清爽、乾淨、最適合日常使用" },
  { key: "kawaii", label: "甜心柔和", note: "柔和可愛、提示較親切" },
  { key: "cyber", label: "霓虹科技", note: "高對比、醒目、科技感強" },
  { key: "premium", label: "精品典雅", note: "深藍金色、正式感高" },
  { key: "comic", label: "漫畫活力", note: "活潑、辨識度最高" },
  { key: "random", label: "隨機樣式", note: "每次重新整理自動抽一款" },
];

const globalFontOptions: Array<{ key: GlobalFontKey; label: string; note: string }> = [
  { key: "system", label: "黑體清晰", note: "繁中手機最穩定，適合正式操作" },
  { key: "rounded", label: "圓體柔和", note: "圓潤感明顯，適合可愛柔和樣式" },
  { key: "serif", label: "明體典雅", note: "筆畫有襯線，標題正式感強" },
  { key: "mono", label: "等寬科技", note: "每個字寬接近一致，數字代碼整齊" },
  { key: "hand", label: "楷體手寫", note: "繁中楷體感，和黑體差異明顯" },
  { key: "random", label: "隨機字型", note: "每次重新整理自動抽一款" },
];

const concreteThemeKeys = globalThemeOptions.filter((item) => item.key !== "random").map((item) => item.key) as Exclude<GlobalThemeKey, "random">[];
const concreteFontKeys = globalFontOptions.filter((item) => item.key !== "random").map((item) => item.key) as Exclude<GlobalFontKey, "random">[];

function pickRandomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] || items[0];
}

function getStoredThemeOption(): GlobalThemeKey {
  const stored = typeof window !== "undefined" ? window.localStorage.getItem("globalThemeOption") : "";
  return globalThemeOptions.some((item) => item.key === stored) ? (stored as GlobalThemeKey) : "glass";
}

function getStoredFontOption(): GlobalFontKey {
  const stored = typeof window !== "undefined" ? window.localStorage.getItem("globalFontOption") : "";
  return globalFontOptions.some((item) => item.key === stored) ? (stored as GlobalFontKey) : "system";
}

const emptyBootstrap: AppBootstrap = {
  people: [],
  stations: [],
  qualifications: [],
  stationRules: [],
};

const qualificationOptions: QualificationStatus[] = ["合格", "訓練中", "不可排", ""];
const dayOptions: ShiftMode[] = DAY_OPTIONS;
const permissionOptions: UserRole[] = ["技術員", "領班", "組長", "主任", "站長", "最高權限"];
const permissionEligibleJobs = new Set(["領班", "組長", "主任", "站長"]);
const officerRoleOrder = ["主任", "組長", "領班", "站長"] as const;
type OfficerRole = (typeof officerRoleOrder)[number];
type SchedulePreviewStyle = "card" | "table" | "share" | "section" | "matrix";
type ManualExtraWork = { id: string; workName: string; personIds: string[] };
type SchedulePreviewPerson = { name: string; isOfficer?: boolean };


const schedulePreviewStyleOptions: Array<{ key: SchedulePreviewStyle; label: string }> = [
  { key: "card", label: "卡片版" },
  { key: "table", label: "表格版" },
  { key: "share", label: "可愛圖卡" },
  { key: "section", label: "海報版" },
  { key: "matrix", label: "橫版班表" },
];

const initialManualExtraWorks: ManualExtraWork[] = [
  { id: "manual-extra-work-1", workName: "", personIds: [] },
  { id: "manual-extra-work-2", workName: "", personIds: [] },
];

type PermissionItemDefinition = {
  id: string;
  name: string;
  category: string;
  page: string;
  action: string;
  mobileFirst: string;
  enabled: string;
  note?: string;
};

type RolePermissionMapDefinition = {
  id: string;
  role: UserRole;
  permissionId: string;
  allowed: string;
  enabled: string;
  note?: string;
};

type PermissionAdminTab = "role" | "account" | "items" | "exceptions" | "check";
type PersonalPermissionEffect = "allow" | "deny";
type PersonalPermissionExceptionDefinition = {
  id: string;
  employeeId: string;
  permissionId: string;
  effect: PersonalPermissionEffect;
  enabled: string;
  note?: string;
};

const databasePermissionItems: PermissionItemDefinition[] = [
  { id: "PERM_001", name: "首頁查看", category: "查詢", page: "首頁", action: "查看", mobileFirst: "Y", enabled: "啟用", note: "基本入口" },
  { id: "PERM_002", name: "查詢人員資格查看", category: "查詢", page: "查詢人員資格", action: "查看", mobileFirst: "Y", enabled: "啟用", note: "主功能" },
  { id: "PERM_003", name: "查詢站點人選查看", category: "查詢", page: "查詢站點人選", action: "查看", mobileFirst: "Y", enabled: "啟用", note: "主功能" },
  { id: "PERM_004", name: "站點考核查看", category: "管理", page: "站點考核", action: "查看", mobileFirst: "Y", enabled: "啟用" },
  { id: "PERM_005", name: "站點考核新增修改刪除", category: "管理", page: "站點考核", action: "修改", mobileFirst: "Y", enabled: "啟用" },
  { id: "PERM_006", name: "站點缺口分析查看", category: "管理", page: "站點缺口分析", action: "查看", mobileFirst: "Y", enabled: "啟用" },
  { id: "PERM_007", name: "站點試排查看", category: "管理", page: "站點試排", action: "查看", mobileFirst: "Y", enabled: "啟用" },
  { id: "PERM_008", name: "站點試排修改", category: "管理", page: "站點試排", action: "修改", mobileFirst: "Y", enabled: "啟用", note: "自訂人選 / 手動試排" },
  { id: "PERM_009", name: "智能試排查看", category: "管理", page: "智能試排", action: "查看", mobileFirst: "Y", enabled: "停用", note: "已關閉，避免干涉站點試排" },
  { id: "PERM_010", name: "智能試排執行", category: "管理", page: "智能試排", action: "指派", mobileFirst: "Y", enabled: "停用", note: "已關閉，避免干涉站點試排" },
  { id: "PERM_011", name: "站點規則設定查看", category: "管理", page: "站點規則設定", action: "查看", mobileFirst: "N", enabled: "啟用" },
  { id: "PERM_012", name: "站點規則設定修改", category: "管理", page: "站點規則設定", action: "修改", mobileFirst: "N", enabled: "啟用" },
  { id: "PERM_013", name: "人員名單管理查看", category: "管理", page: "人員名單管理", action: "查看", mobileFirst: "N", enabled: "啟用" },
  { id: "PERM_014", name: "人員名單管理修改", category: "管理", page: "人員名單管理", action: "修改", mobileFirst: "N", enabled: "啟用" },
  { id: "PERM_015", name: "權限管理查看", category: "權限", page: "權限管理", action: "查看", mobileFirst: "N", enabled: "啟用" },
  { id: "PERM_016", name: "權限管理修改", category: "權限", page: "權限管理", action: "修改", mobileFirst: "N", enabled: "啟用" },
];

const databaseRolePermissionMaps: RolePermissionMapDefinition[] = [
  { id: "ROLEMAP_001", role: "技術員", permissionId: "PERM_001", allowed: "Y", enabled: "啟用", note: "首頁" },
  { id: "ROLEMAP_002", role: "技術員", permissionId: "PERM_002", allowed: "Y", enabled: "啟用", note: "查人員" },
  { id: "ROLEMAP_003", role: "技術員", permissionId: "PERM_003", allowed: "Y", enabled: "啟用", note: "查站點" },
  { id: "ROLEMAP_004", role: "領班", permissionId: "PERM_004", allowed: "Y", enabled: "啟用", note: "可看考核" },
  { id: "ROLEMAP_005", role: "領班", permissionId: "PERM_005", allowed: "Y", enabled: "啟用", note: "可維護考核" },
  { id: "ROLEMAP_006", role: "組長", permissionId: "PERM_006", allowed: "Y", enabled: "啟用", note: "可看缺口" },
  { id: "ROLEMAP_007", role: "組長", permissionId: "PERM_007", allowed: "Y", enabled: "啟用", note: "可看試排" },
  { id: "ROLEMAP_008", role: "組長", permissionId: "PERM_008", allowed: "Y", enabled: "啟用", note: "可手動試排" },
  { id: "ROLEMAP_009", role: "主任", permissionId: "PERM_009", allowed: "N", enabled: "停用", note: "智能試排已關閉" },
  { id: "ROLEMAP_010", role: "主任", permissionId: "PERM_010", allowed: "N", enabled: "停用", note: "智能試排已關閉" },
  { id: "ROLEMAP_011", role: "主任", permissionId: "PERM_011", allowed: "Y", enabled: "啟用", note: "可看規則" },
  { id: "ROLEMAP_012", role: "主任", permissionId: "PERM_012", allowed: "Y", enabled: "啟用", note: "可改規則" },
  { id: "ROLEMAP_013", role: "主任", permissionId: "PERM_013", allowed: "Y", enabled: "啟用", note: "可看人員名單" },
  { id: "ROLEMAP_014", role: "主任", permissionId: "PERM_014", allowed: "Y", enabled: "啟用", note: "可改人員名單" },
  { id: "ROLEMAP_015", role: "最高權限", permissionId: "PERM_015", allowed: "Y", enabled: "啟用", note: "可看權限管理" },
  { id: "ROLEMAP_016", role: "最高權限", permissionId: "PERM_016", allowed: "Y", enabled: "啟用", note: "可改權限管理" },
];

function permissionSearchMatches(parts: unknown[], keyword: string) {
  return searchText(parts.map((item) => String(item ?? "")), keyword);
}

function permissionStatusClass(status: string) {
  return status === "啟用" || status === "Y" ? "chip" : "chip danger";
}




function cleanScheduleStationName(raw?: string) {
  const value = String(raw || "").trim();
  const cleaned = value
    .replace(/^[A-Za-z]{0,3}\d{1,4}[\s_\-－—、.．:：]+/, "")
    .replace(/^站點[\s_\-－—、.．:：]*\d{1,4}[\s_\-－—、.．:：]+/, "")
    .trim();
  return cleaned || value || "未命名站點";
}

function getScheduleStationCode(station?: AppBootstrap["stations"][number] | null) {
  if (!station) return "";
  const raw = station as unknown as Record<string, unknown>;
  const direct = String(
    raw.stationCode ??
      raw.code ??
      raw.englishCode ??
      raw.stationEnglishCode ??
      raw.stationCodeEn ??
      raw.codeEn ??
      raw["站點代碼"] ??
      raw["站點代號"] ??
      raw["英文代號"] ??
      raw["站點英文代號"] ??
      raw["英文代碼"] ??
      raw["站點英文代碼"] ??
      station.id ??
      ""
  ).trim();
  if (direct) return direct;

  const noteText = [station.description, station.note].map((item) => String(item || "")).join(" ");
  const bracketMatch = noteText.match(/[（(]([A-Za-z][A-Za-z0-9 ,/&+\-]{1,})[）)]/);
  if (bracketMatch) return bracketMatch[1].trim();
  return "";
}

function getScheduleStationDisplayName(station?: AppBootstrap["stations"][number] | null) {
  const zhName = cleanScheduleStationName(station?.name);
  const code = getScheduleStationCode(station);
  if (!code || code === zhName || zhName.includes(`(${code})`) || zhName.includes(`（${code}）`)) return zhName;
  return `${zhName}（${code}）`;
}

function normalizeOfficerRole(raw?: string): OfficerRole | null {
  const value = String(raw || "").trim();
  if (value.includes("主任")) return "主任";
  if (value.includes("組長")) return "組長";
  if (value.includes("領班")) return "領班";
  if (value.includes("站長")) return "站長";
  return null;
}

function isOfficerPerson(person: Person) {
  return normalizeOfficerRole(person.role) !== null;
}

const roleRank: Record<UserRole, number> = {
  技術員: 1,
  領班: 2,
  組長: 3,
  主任: 4,
  站長: 5,
  最高權限: 6,
};

function normalizePermission(raw?: string): UserRole {
  if (raw === "最高權限") return "最高權限";
  if (raw === "站長") return "站長";
  if (raw === "主任") return "主任";
  if (raw === "組長") return "組長";
  if (raw === "領班") return "領班";
  return "技術員";
}

function getSystemPermission(person?: Person | null): UserRole | null {
  if (!person) return null;
  if (person.isSuperAdmin || person.id === "P0033") return "最高權限";
  const explicit = String(person.systemPermission ?? person.permissionLevel ?? "").trim();
  return normalizePermission(explicit);
}

function canAppearInPermissionAdmin(person: Person) {
  return permissionEligibleJobs.has(String(person.role || "").trim()) || roleRank[getSystemPermission(person) || "技術員"] >= roleRank["領班"];
}

function findVisibleSelection<T extends { id: string }>(list: T[], id: string) {
  return list.find((item) => item.id === id) || list[0] || null;
}

function countAssigned(assignments: Record<string, string[]>) {
  return Object.values(assignments).reduce((sum, list) => sum + list.length, 0);
}

function countUniqueAssigned(assignments: Record<string, string[]>) {
  return new Set(Object.values(assignments).flat()).size;
}

function findDuplicateIds(assignments: Record<string, string[]>) {
  const map = new Map<string, number>();
  Object.values(assignments).flat().forEach((id) => map.set(id, (map.get(id) || 0) + 1));
  return [...map.entries()].filter(([, count]) => count > 1).map(([id]) => id);
}

function appendUniqueAssignment(current: Record<string, string[]>, stationId: string, employeeId: string) {
  const currentIds = current[stationId] || [];
  if (currentIds.includes(employeeId)) {
    return current;
  }
  return {
    ...current,
    [stationId]: [...currentIds, employeeId],
  };
}

function findAssignedStation(assignments: Record<string, string[]>, employeeId: string) {
  return Object.entries(assignments).find(([, ids]) => ids.includes(employeeId))?.[0] || null;
}

function getAssignmentSummary(assignments: Record<string, string[]>, rules: StationRule[]) {
  const required = rules.reduce((sum, rule) => sum + rule.minRequired, 0);
  const assigned = countAssigned(assignments);
  const uniqueAssigned = countUniqueAssigned(assignments);
  const duplicates = findDuplicateIds(assignments).length;
  const shortage = rules.reduce((sum, rule) => sum + Math.max(0, rule.minRequired - (assignments[rule.stationId]?.length || 0)), 0);
  return {
    required,
    assigned,
    uniqueAssigned,
    duplicates,
    shortage,
  };
}

function getViewportMode(): ViewMode {
  if (typeof window === "undefined") return "desktop";
  return window.innerWidth <= 900 ? "mobile" : "desktop";
}

export default function App() {
  const [data, setData] = useState<AppBootstrap>(emptyBootstrap);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<PageKey>("home");
  const [globalThemeOption, setGlobalThemeOption] = useState<GlobalThemeKey>(() => getStoredThemeOption());
  const [globalFontOption, setGlobalFontOption] = useState<GlobalFontKey>(() => getStoredFontOption());
  const [effectiveTheme, setEffectiveTheme] = useState<Exclude<GlobalThemeKey, "random">>(() => {
    const option = getStoredThemeOption();
    return option === "random" ? pickRandomItem(concreteThemeKeys) : option;
  });
  const [effectiveFont, setEffectiveFont] = useState<Exclude<GlobalFontKey, "random">>(() => {
    const option = getStoredFontOption();
    return option === "random" ? pickRandomItem(concreteFontKeys) : option;
  });
  const [flash, setFlash] = useState("");
  const toastDurationMs = 5000;
  const toastStyleMode: "floating" | "banner" = "floating";
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => getViewportMode());
  const [mobileDetailModal, setMobileDetailModal] = useState<MobileDetailModal>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const personDetailRef = useRef<HTMLDivElement | null>(null);
  const stationDetailRef = useRef<HTMLDivElement | null>(null);
  const reviewDetailRef = useRef<HTMLDivElement | null>(null);

  const [loginForm, setLoginForm] = useState({ account: "", password: "" });
  const [loginKeep, setLoginKeep] = useState<LoginKeepKey>(() => getStoredLoginKeep());
  const [currentUser, setCurrentUser] = useState<Person | null>(null);
  const currentRole = getSystemPermission(currentUser);

  const [personTeamFilter, setPersonTeamFilter] = useState<string>("全部班別");
  const [personKeyword, setPersonKeyword] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");

  const [stationTeamFilter, setStationTeamFilter] = useState<TeamName>("婷芬班");
  const [stationDayFilter, setStationDayFilter] = useState<ShiftMode>("當班");
  const [stationKeyword, setStationKeyword] = useState("");
  const [selectedStationId, setSelectedStationId] = useState("");

  const [reviewShift, setReviewShift] = useState<(typeof REVIEW_TEAM_OPTIONS)[number]>("全部班別");
  const [reviewKeyword, setReviewKeyword] = useState("");
  const [reviewEmployeeId, setReviewEmployeeId] = useState("");
  const [reviewStationId, setReviewStationId] = useState("");
  const [reviewStatus, setReviewStatus] = useState<QualificationStatus>("合格");

  const [gapShift, setGapShift] = useState<TeamName>("婷芬班");
  const [gapDay, setGapDay] = useState<ShiftMode>("當班");

  const [manualShift, setManualShift] = useState<TeamName>("婷芬班");
  const [manualDay, setManualDay] = useState<ShiftMode>("當班");
  const [manualMode, setManualMode] = useState<SmartScheduleMode>("當班優先");
  const [manualAssignments, setManualAssignments] = useState<Record<string, string[]>>({});
  const [manualResetDialog, setManualResetDialog] = useState<null | { type: "shift" | "day" | "mode"; value: TeamName | ShiftMode | SmartScheduleMode }>(null);
  const [manualConflictDialog, setManualConflictDialog] = useState<null | { stationId: string; employeeId: string; assignedStationId: string }>(null);
  const [manualCustomDialog, setManualCustomDialog] = useState<null | { stationId: string }>(null);
  const [manualTrainingDialog, setManualTrainingDialog] = useState<null | { stationId: string; personId: string; currentStatus: string }>(null);
  const [manualCustomKeyword, setManualCustomKeyword] = useState("");
  const [manualOfficerStations, setManualOfficerStations] = useState<Record<string, string>>({});
  const [manualExtraWorks, setManualExtraWorks] = useState<ManualExtraWork[]>(() => initialManualExtraWorks.map((item) => ({ ...item, personIds: [] })));
  const [manualExtraDialog, setManualExtraDialog] = useState<null | { extraId: string }>(null);
  const [manualExtraKeyword, setManualExtraKeyword] = useState("");
  const [manualPreviewOpen, setManualPreviewOpen] = useState(false);
  const [manualPreviewStyle, setManualPreviewStyle] = useState<SchedulePreviewStyle>("card");

  const hasManualAssignments = useMemo(
    () => Object.values(manualAssignments).some((list) => list.length > 0) || manualExtraWorks.some((item) => item.workName.trim() || item.personIds.length > 0),
    [manualAssignments, manualExtraWorks]
  );

  function applyManualSwitch(type: "shift" | "day" | "mode", value: TeamName | ShiftMode | SmartScheduleMode) {
    setManualAssignments({});
    setManualOfficerStations({});
    setManualExtraWorks(initialManualExtraWorks.map((item) => ({ ...item, personIds: [] })));
    setManualExtraDialog(null);
    setManualExtraKeyword("");
    setManualPreviewOpen(false);
    if (type === "shift") setManualShift(value as TeamName);
    if (type === "day") setManualDay(value as ShiftMode);
    if (type === "mode") setManualMode(value as SmartScheduleMode);
    setManualResetDialog(null);
  }

  function requestManualSwitch(type: "shift" | "day" | "mode", value: TeamName | ShiftMode | SmartScheduleMode) {
    if (type === "shift" && value === manualShift) return;
    if (type === "day" && value === manualDay) return;
    if (type === "mode" && value === manualMode) return;
    if (hasManualAssignments) {
      setManualResetDialog({ type, value });
      return;
    }
    applyManualSwitch(type, value);
  }

  function handleManualShiftChange(nextShift: TeamName) {
    requestManualSwitch("shift", nextShift);
  }

  function handleManualDayChange(nextDay: ShiftMode) {
    requestManualSwitch("day", nextDay);
  }

  function handleManualModeChange(nextMode: SmartScheduleMode) {
    requestManualSwitch("mode", nextMode);
  }

  const [rulesTeam, setRulesTeam] = useState<TeamName>("婷芬班");

  const [peopleSearchKeyword, setPeopleSearchKeyword] = useState("");
  const [permissionSearchKeyword, setPermissionSearchKeyword] = useState("");
  const [permissionAdminTab, setPermissionAdminTab] = useState<PermissionAdminTab>("role");
  const [permissionSelectedRole, setPermissionSelectedRole] = useState<UserRole>("組長");
  const [permissionSelectedPersonId, setPermissionSelectedPersonId] = useState("");
  const [personalPermissionExceptions, setPersonalPermissionExceptions] = useState<PersonalPermissionExceptionDefinition[]>([]);
  const [permissionItemStates, setPermissionItemStates] = useState<PermissionItemDefinition[]>(() => databasePermissionItems.map((item) => ({ ...item })));
  const [rolePermissionMapStates, setRolePermissionMapStates] = useState<RolePermissionMapDefinition[]>(() => databaseRolePermissionMaps.map((item) => ({ ...item })));
  const [accountStatusById, setAccountStatusById] = useState<Record<string, string>>({});
  const [accountPasswordById, setAccountPasswordById] = useState<Record<string, string>>({});
  const [accountPasswordDrafts, setAccountPasswordDrafts] = useState<Record<string, string>>({});
  const [permissionExceptionKeyword, setPermissionExceptionKeyword] = useState("");

  const [smartShift, setSmartShift] = useState<TeamName>("婷芬班");
  const [smartDay, setSmartDay] = useState<ShiftMode>("當班");
  const [smartMode, setSmartMode] = useState<SmartScheduleMode>("當班優先");
  const [smartAssignments, setSmartAssignments] = useState<Record<string, string[]>>({});

  const isMobileView = viewMode === "mobile";

  function setFlashMessage(text: string) {
    setFlash("");
    window.setTimeout(() => setFlash(text), 0);
  }

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(""), toastDurationMs);
    return () => window.clearTimeout(timer);
  }, [flash, toastDurationMs]);

  function updateGlobalTheme(option: GlobalThemeKey) {
    setGlobalThemeOption(option);
    window.localStorage.setItem("globalThemeOption", option);
    setEffectiveTheme(option === "random" ? pickRandomItem(concreteThemeKeys) : option);
    setFlashMessage(option === "random" ? "已套用隨機全站樣式。" : `已套用全站樣式：${globalThemeOptions.find((item) => item.key === option)?.label || option}`);
  }

  function updateGlobalFont(option: GlobalFontKey) {
    setGlobalFontOption(option);
    window.localStorage.setItem("globalFontOption", option);
    setEffectiveFont(option === "random" ? pickRandomItem(concreteFontKeys) : option);
    setFlashMessage(option === "random" ? "已套用隨機字型。" : `已套用字型：${globalFontOptions.find((item) => item.key === option)?.label || option}`);
  }

  function scrollToTop(behavior: ScrollBehavior = "smooth") {
    if (contentRef.current && !isMobileView) {
      contentRef.current.scrollTo({ top: 0, behavior });
      return;
    }
    window.scrollTo({ top: 0, behavior });
  }

  function scrollMainIntoView(behavior: ScrollBehavior = "smooth") {
    if (!contentRef.current) return;
    contentRef.current.scrollIntoView({ behavior, block: "start" });
  }

  function scrollToSection(target: HTMLDivElement | null) {
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openMobileOrScroll(modal: Exclude<MobileDetailModal, null>, target: HTMLDivElement | null) {
    if (isMobileView) {
      setMobileDetailModal(modal);
      return;
    }
    requestAnimationFrame(() => scrollToSection(target));
  }

  function navigateToPage(nextPage: PageKey) {
    setPage(nextPage);
    setMobileDetailModal(null);
    if (isMobileView) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollMainIntoView("smooth");
        });
      });
    }
  }

  useEffect(() => {
    let active = true;
    async function loadBootstrap() {
      try {
        const next = await fetchBootstrapData();
        if (!active) return;
        setData(next);
      } catch {
        if (!active) return;
        setData(emptyBootstrap);
        setPage("home");
        setFlashMessage("系統資料載入失敗，請確認 GAS bootstrap 與試算表資料。");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadBootstrap();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!data.people.length || currentUser) return;
    try {
      const raw = window.localStorage.getItem(loginSessionStorageKey);
      if (!raw) return;
      const session = JSON.parse(raw) as { userId?: string; expiresAt?: number };
      if (!session.userId || !session.expiresAt || Date.now() > session.expiresAt) {
        window.localStorage.removeItem(loginSessionStorageKey);
        return;
      }
      const restoredUser = data.people.find((person) => person.id === session.userId);
      if (restoredUser) {
        setCurrentUser(restoredUser);
        setFlashMessage(`已恢復登入：${restoredUser.name}`);
      }
    } catch {
      window.localStorage.removeItem(loginSessionStorageKey);
    }
  }, [data.people, currentUser]);

  useEffect(() => {
    const syncViewportMode = () => setViewMode(getViewportMode());
    syncViewportMode();
    window.addEventListener("resize", syncViewportMode);
    return () => window.removeEventListener("resize", syncViewportMode);
  }, []);

  useEffect(() => {
    if (isMobileView) {
      requestAnimationFrame(() => {
        scrollMainIntoView("smooth");
      });
      return;
    }
    scrollToTop("auto");
    setMobileDetailModal(null);
  }, [page, isMobileView]);

  useEffect(() => {
    const node = contentRef.current;
    if (!node || isMobileView) return;
    const onScroll = () => setShowBackToTop(node.scrollTop > 280);
    node.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => node.removeEventListener("scroll", onScroll);
  }, [loading, isMobileView]);

  useEffect(() => {
    const onWindowScroll = () => setShowBackToTop(window.scrollY > 280);
    if (!isMobileView) return;
    window.addEventListener("scroll", onWindowScroll, { passive: true });
    onWindowScroll();
    return () => window.removeEventListener("scroll", onWindowScroll);
  }, [isMobileView]);

  useEffect(() => {
    setReviewKeyword("");
    setReviewEmployeeId("");
    setMobileDetailModal(null);
  }, [reviewShift]);

  useEffect(() => {
    setManualAssignments({});
    setManualExtraWorks(initialManualExtraWorks.map((item) => ({ ...item, personIds: [] })));
    setManualExtraDialog(null);
    setManualExtraKeyword("");
  }, [manualShift, manualDay]);

  useEffect(() => {
    setSmartAssignments({});
  }, [smartShift, smartDay, smartMode]);

  useEffect(() => {
    if (page === "smart-schedule") {
      setSmartAssignments({});
      setPage("manual-schedule");
      setFlashMessage("智能試排已停用，避免干涉站點試排。");
    }
  }, [page]);

  const filteredPeople = useMemo(() => {
    return data.people.filter((person) => {
      const matchTeam = personTeamFilter === "全部班別" || getTeamOfPerson(person) === personTeamFilter;
      const matchKeyword = searchText([person.id, person.name, String(getTeamOfPerson(person)), person.role, person.nationality], personKeyword);
      return matchTeam && matchKeyword;
    });
  }, [data.people, personTeamFilter, personKeyword]);

  const permissionRows = useMemo(() => {
    return data.people.filter((person) =>
      searchText([person.id, person.name, person.role, String(getSystemPermission(person) || ""), String(getTeamOfPerson(person))], permissionSearchKeyword)
    );
  }, [data.people, permissionSearchKeyword]);

  const permissionItemRows = useMemo(() => {
    return permissionItemStates.filter((item) =>
      permissionSearchMatches([item.id, item.name, item.category, item.page, item.action, item.enabled, item.note], permissionSearchKeyword)
    );
  }, [permissionItemStates, permissionSearchKeyword]);

  const rolePermissionRows = useMemo(() => {
    const itemMap = new Map(permissionItemStates.map((item) => [item.id, item]));
    return rolePermissionMapStates.filter((item) => {
      const permissionItem = itemMap.get(item.permissionId);
      return permissionSearchMatches(
        [item.id, item.role, item.permissionId, permissionItem?.name, permissionItem?.page, item.allowed, item.enabled, item.note],
        permissionSearchKeyword
      );
    });
  }, [permissionItemStates, rolePermissionMapStates, permissionSearchKeyword]);

  const selectedEmployee = useMemo(() => findVisibleSelection(filteredPeople, selectedEmployeeId), [filteredPeople, selectedEmployeeId]);
  const mobilePerson = useMemo(() => data.people.find((item) => item.id === mobileDetailModal?.personId) || null, [data.people, mobileDetailModal]);
  const selectedEmployeeQualifications = useMemo(() => data.qualifications.filter((item) => item.employeeId === selectedEmployee?.id), [data.qualifications, selectedEmployee]);
  const mobilePersonQualifications = useMemo(() => data.qualifications.filter((item) => item.employeeId === mobilePerson?.id), [data.qualifications, mobilePerson]);

  const stationAttendance = useMemo(() => getAttendanceForTeam(data.people, stationTeamFilter, stationDayFilter), [data.people, stationTeamFilter, stationDayFilter]);

  const stationScopedQualifications = useMemo(() => {
    const availableIds = new Set(stationAttendance.all.map((person) => person.id));
    return data.qualifications.filter((item) => availableIds.has(item.employeeId));
  }, [data.qualifications, stationAttendance]);

  const filteredStations = useMemo(() => {
    return data.stations.filter((station) => {
      const matchKeyword = searchText([station.id, station.name, station.description, station.note], stationKeyword);
      const hasVisibleCandidate = stationScopedQualifications.some((item) => item.stationId === station.id);
      return matchKeyword && hasVisibleCandidate;
    });
  }, [data.stations, stationKeyword, stationScopedQualifications]);

  const selectedStation = useMemo(() => findVisibleSelection(filteredStations, selectedStationId), [filteredStations, selectedStationId]);
  const mobileStation = useMemo(() => data.stations.find((item) => item.id === mobileDetailModal?.stationId) || null, [data.stations, mobileDetailModal]);
  const selectedStationQualifications = useMemo(() => stationScopedQualifications.filter((item) => item.stationId === selectedStation?.id), [stationScopedQualifications, selectedStation]);
  const mobileStationQualifications = useMemo(() => stationScopedQualifications.filter((item) => item.stationId === mobileStation?.id), [stationScopedQualifications, mobileStation]);

  const reviewPeople = useMemo(() => {
    return data.people.filter((person) => {
      const matchShift = reviewShift === "全部班別" || getTeamOfPerson(person) === reviewShift;
      const matchKeyword = searchText([person.id, person.name], reviewKeyword);
      return matchShift && matchKeyword;
    });
  }, [data.people, reviewShift, reviewKeyword]);

  const reviewSelectedPerson = useMemo(() => findVisibleSelection(reviewPeople, reviewEmployeeId), [reviewPeople, reviewEmployeeId]);
  const mobileReviewPerson = useMemo(() => data.people.find((item) => item.id === mobileDetailModal?.personId) || null, [data.people, mobileDetailModal]);
  const reviewSelectedQualifications = useMemo(() => data.qualifications.filter((item) => item.employeeId === reviewSelectedPerson?.id), [data.qualifications, reviewSelectedPerson]);
  const mobileReviewQualifications = useMemo(() => data.qualifications.filter((item) => item.employeeId === mobileReviewPerson?.id), [data.qualifications, mobileReviewPerson]);

  const reviewOverviewRows = useMemo(() => {
    return reviewPeople.map((person) => {
      const list = data.qualifications.filter((item) => item.employeeId === person.id);
      return {
        id: person.id,
        name: person.name,
        role: person.role,
        nationality: person.nationality,
        qualified: list.filter((item) => item.status === "合格").length,
        training: list.filter((item) => item.status === "訓練中").length,
        blocked: list.filter((item) => item.status === "不可排").length,
      };
    });
  }, [data.qualifications, reviewPeople]);

  const gapAttendance = useMemo(() => getAttendanceForTeam(data.people, gapShift, gapDay), [data.people, gapShift, gapDay]);
  const gapRules = useMemo(() => getApplicableRules(gapShift, gapDay, data.stationRules || []), [data.stationRules, gapShift, gapDay]);

  const manualAttendance = useMemo(() => getAttendanceForTeam(data.people, manualShift, manualDay), [data.people, manualShift, manualDay]);
  const manualRules = useMemo(() => getApplicableRules(manualShift, manualDay, data.stationRules || []), [data.stationRules, manualShift, manualDay]);
  const manualOfficerPeople = useMemo(() => {
    return manualAttendance.all
      .filter(isOfficerPerson)
      .sort((a, b) => {
        const roleA = normalizeOfficerRole(a.role);
        const roleB = normalizeOfficerRole(b.role);
        const orderA = roleA ? officerRoleOrder.indexOf(roleA) : 99;
        const orderB = roleB ? officerRoleOrder.indexOf(roleB) : 99;
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name, "zh-Hant", { numeric: true });
      });
  }, [manualAttendance.all]);
  const manualOfficerGroups = useMemo(() => {
    const groups: Record<OfficerRole, Person[]> = { 主任: [], 組長: [], 領班: [], 站長: [] };
    manualOfficerPeople.forEach((person) => {
      const role = normalizeOfficerRole(person.role);
      if (role) groups[role].push(person);
    });
    return groups;
  }, [manualOfficerPeople]);

  const manualOfficerDisplayGroups = useMemo(() => {
    const groups: Record<OfficerRole, Person[]> = {
      主任: [...manualOfficerGroups.主任],
      組長: [...manualOfficerGroups.組長],
      領班: [...manualOfficerGroups.領班],
      站長: [...manualOfficerGroups.站長],
    };
    if (groups.主任.length > 0) return groups;

    const normalizeTeamText = (value?: string) => String(value || "").replace(/班$/, "").trim();
    const manualShiftToken = normalizeTeamText(manualShift);
    const isActivePerson = (person: Person) => {
      const employment = String(person.employmentStatus || "").trim();
      return !(employment.includes("離職") || employment.includes("停用") || employment.toUpperCase() === "N");
    };
    const matchDirectorTeam = (person: Person) => {
      const personTeam = String(getTeamOfPerson(person) || "");
      const rawShift = String(person.shift || "");
      return (
        personTeam === manualShift ||
        rawShift === manualShift ||
        normalizeTeamText(rawShift) === manualShiftToken
      );
    };
    const directors = data.people
      .filter((person) => isActivePerson(person))
      .filter((person) => normalizeOfficerRole(person.role) === "主任")
      .filter((person) => matchDirectorTeam(person));
    groups.主任 = directors.length
      ? directors
      : data.people.filter((person) => isActivePerson(person) && normalizeOfficerRole(person.role) === "主任");
    return groups;
  }, [data.people, manualOfficerGroups, manualShift]);

  const manualOfficerIds = useMemo(() => new Set(manualOfficerPeople.map((person) => person.id)), [manualOfficerPeople]);
  const manualCountedOfficerCount = useMemo(() => {
    return manualOfficerPeople.filter((person) => normalizeOfficerRole(person.role) !== "主任").length;
  }, [manualOfficerPeople]);
  const manualDirectorCount = manualOfficerDisplayGroups.主任.length;

  const smartAttendance = useMemo(() => getAttendanceForTeam(data.people, smartShift, smartDay), [data.people, smartShift, smartDay]);
  const smartRules = useMemo(() => getApplicableRules(smartShift, smartDay, data.stationRules || []), [data.stationRules, smartShift, smartDay]);

  const stationRuleRows = useMemo(() => getApplicableRules(rulesTeam, "當班", data.stationRules || []), [rulesTeam, data.stationRules]);

  const manualSummary = useMemo(() => getAssignmentSummary(manualAssignments, manualRules), [manualAssignments, manualRules]);
  const manualExtraAssignedCount = useMemo(() => new Set(manualExtraWorks.flatMap((item) => item.personIds)).size, [manualExtraWorks]);
  const manualEffectiveAssigned = manualSummary.assigned + manualCountedOfficerCount + manualExtraAssignedCount;
  const manualCountableTotal = Math.max(0, manualAttendance.totalCount - manualDirectorCount);
  const manualPendingCount = Math.max(0, manualCountableTotal - manualEffectiveAssigned);
  const manualSchedulePreview = useMemo(() => {
    const peopleById = new Map(data.people.map((person) => [person.id, person]));
    const uniqueNames = (names: string[]) => Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
    const uniquePreviewPeople = (people: SchedulePreviewPerson[]) => {
      const map = new Map<string, SchedulePreviewPerson>();
      people.forEach((person) => {
        const name = person.name.trim();
        if (!name) return;
        const current = map.get(name);
        map.set(name, { name, isOfficer: Boolean(current?.isOfficer || person.isOfficer) });
      });
      return Array.from(map.values());
    };
    const toPreviewPerson = (person?: Person | null, forceOfficer = false): SchedulePreviewPerson | null => {
      if (!person?.name) return null;
      return { name: person.name, isOfficer: forceOfficer || normalizeOfficerRole(person.role) !== null };
    };
    const activeTeamPeople = data.people.filter((person) => {
      const employment = String(person.employmentStatus || "").trim();
      const isInactive = employment.includes("離職") || employment.includes("停用") || employment.toUpperCase() === "N";
      return !isInactive && getTeamOfPerson(person) === manualShift;
    });
    const normalizeTeamText = (value?: string) => String(value || "").replace(/班$/, "").trim();
    const manualShiftToken = normalizeTeamText(manualShift);
    const isActivePerson = (person: Person) => {
      const employment = String(person.employmentStatus || "").trim();
      return !(employment.includes("離職") || employment.includes("停用") || employment.toUpperCase() === "N");
    };
    const isSameDisplayTeam = (person: Person) => {
      const personTeam = String(getTeamOfPerson(person) || "");
      const rawShift = String(person.shift || "");
      const name = String(person.name || "");
      return (
        personTeam === manualShift ||
        rawShift === manualShift ||
        normalizeTeamText(rawShift) === manualShiftToken ||
        Boolean(manualShiftToken && name.includes(manualShiftToken))
      );
    };
    const officerNamesByRole = (role: OfficerRole) => {
      const strictNames = uniqueNames(
        activeTeamPeople
          .filter((person) => normalizeOfficerRole(person.role) === role)
          .map((person) => person.name)
      );
      if (strictNames.length > 0) return strictNames;

      // 主任只作為班表標頭顯示，不列入待排/已排計算；若出勤池排除了主任，改由主檔補抓同班主任。
      return uniqueNames(
        data.people
          .filter((person) => isActivePerson(person))
          .filter((person) => normalizeOfficerRole(person.role) === role)
          .filter((person) => isSameDisplayTeam(person))
          .map((person) => person.name)
      );
    };
    const stationOrder = new Map<string, number>(data.stations.map((station, index) => [station.id, index]));
    const orderedManualRules = [...manualRules].sort((a, b) => {
      const orderA = stationOrder.get(a.stationId) ?? 9999;
      const orderB = stationOrder.get(b.stationId) ?? 9999;
      if (orderA !== orderB) return orderA - orderB;
      return String(a.stationId).localeCompare(String(b.stationId), "zh-Hant", { numeric: true });
    });
    return {
      team: manualShift,
      officers: {
        主任: uniqueNames(manualOfficerDisplayGroups.主任.map((person) => person.name)).length ? uniqueNames(manualOfficerDisplayGroups.主任.map((person) => person.name)) : officerNamesByRole("主任"),
        組長: uniqueNames(manualOfficerDisplayGroups.組長.map((person) => person.name)).length ? uniqueNames(manualOfficerDisplayGroups.組長.map((person) => person.name)) : officerNamesByRole("組長"),
        領班: uniqueNames(manualOfficerDisplayGroups.領班.map((person) => person.name)).length ? uniqueNames(manualOfficerDisplayGroups.領班.map((person) => person.name)) : officerNamesByRole("領班"),
      },
      rows: [
        ...orderedManualRules.map((rule) => {
          const station = data.stations.find((item) => item.id === rule.stationId);
          const assignedPeople = (manualAssignments[rule.stationId] || [])
            .map((id) => toPreviewPerson(peopleById.get(id)))
            .filter((person): person is SchedulePreviewPerson => Boolean(person));
          const selectedOfficerPeople = manualOfficerPeople
            .filter((person) => manualOfficerStations[person.id] === rule.stationId)
            .map((person) => toPreviewPerson(person, true))
            .filter((person): person is SchedulePreviewPerson => Boolean(person));
          return {
            stationId: rule.stationId,
            stationName: getScheduleStationDisplayName(station),
            people: uniquePreviewPeople([...assignedPeople, ...selectedOfficerPeople]),
          };
        }),
        ...manualExtraWorks
          .map((item, index) => {
            const stationName = item.workName.trim() || `自訂工作 ${index + 1}`;
            const people = item.personIds
              .map((id) => toPreviewPerson(peopleById.get(id)))
              .filter((person): person is SchedulePreviewPerson => Boolean(person));
            return {
              stationId: item.id,
              stationName,
              people: uniquePreviewPeople(people),
            };
          })
          .filter((row) => row.stationName || row.people.length > 0),
      ],
    };
  }, [data.people, data.stations, manualAssignments, manualOfficerPeople, manualOfficerStations, manualRules, manualShift, manualExtraWorks, manualOfficerDisplayGroups]);
  const smartSummary = useMemo(() => getAssignmentSummary(smartAssignments, smartRules), [smartAssignments, smartRules]);

  function hasAccess(minRole?: UserRole) {
    if (!minRole) return true;
    if (!currentRole) return false;
    return roleRank[currentRole] >= roleRank[minRole];
  }

  function canEditRulesForTeam(team: TeamName) {
    if (!currentUser || !currentRole) return false;
    if (currentRole === "最高權限" || currentRole === "站長") return true;
    return currentRole === "主任" && getTeamOfPerson(currentUser) === team;
  }

  function confirmAction(message: string) {
    return window.confirm(message);
  }

  function updateLoginKeep(option: LoginKeepKey) {
    setLoginKeep(option);
    window.localStorage.setItem(loginKeepStorageKey, option);
    setFlashMessage(`重新整理保持登入時間已設定為：${loginKeepOptions.find((item) => item.key === option)?.label || option}`);
    if (currentUser) {
      window.localStorage.setItem(loginSessionStorageKey, JSON.stringify({
        userId: currentUser.id,
        expiresAt: Date.now() + getLoginKeepMs(option),
      }));
    }
  }

  function logout() {
    setCurrentUser(null);
    window.localStorage.removeItem(loginSessionStorageKey);
    setPage("home");
    setFlashMessage("已登出。");
    setMobileDetailModal(null);
    scrollToTop();
  }

  async function handleLogin() {
    const account = loginForm.account.trim();
    const password = loginForm.password.trim();

    if (!account) {
      setFlashMessage("請輸入登入帳號。");
      return;
    }
    if (!password) {
      setFlashMessage("請輸入登入密碼。");
      return;
    }

    try {
      const result = await loginWithAccount({ account, password });
      if (!result.ok || !result.user) {
        setFlashMessage(result.message || "登入失敗。");
        return;
      }

      const bootstrapUser = data.people.find((person) => person.id === result.user?.id);
      const mergedUser = bootstrapUser ? { ...bootstrapUser, ...result.user } : result.user;

      setCurrentUser(mergedUser);
      window.localStorage.setItem(loginSessionStorageKey, JSON.stringify({
        userId: mergedUser.id,
        expiresAt: Date.now() + getLoginKeepMs(loginKeep),
      }));
      setLoginForm({ account: "", password: "" });
      setPage("home");
      setFlashMessage(`登入成功：${mergedUser.name}，重新整理仍會保留登入。`);
      scrollToTop();
    } catch {
      setFlashMessage("登入失敗，請確認 GAS login 已重新部署。");
      setPage("home");
      scrollToTop();
    }
  }

  async function persistQualification(employee: Person, stationId: string, status: QualificationStatus, confirmBeforeSave = true) {
    const station = data.stations.find((item) => item.id === stationId);
    if (!station) {
      setFlashMessage("找不到指定站點。");
      return false;
    }
    if (confirmBeforeSave && !confirmAction(`確認修改 ${employee.name} 的 ${station.name} 為「${status || "空白"}」？`)) {
      setFlashMessage("已取消修改。");
      return false;
    }
    const payload: Qualification = { employeeId: employee.id, employeeName: employee.name, stationId, status };
    await upsertQualification(payload);
    setData((current) => {
      const exists = current.qualifications.some((item) => item.employeeId === payload.employeeId && item.stationId === payload.stationId);
      return {
        ...current,
        qualifications: exists
          ? current.qualifications.map((item) => (item.employeeId === payload.employeeId && item.stationId === payload.stationId ? payload : item))
          : [...current.qualifications, payload],
      };
    });
    return true;
  }

  async function handleSaveQualification(statusOverride?: QualificationStatus) {
    const employee = reviewSelectedPerson || mobileReviewPerson;
    const nextStatus = statusOverride ?? reviewStatus;
    if (!employee || !reviewStationId) {
      setFlashMessage("請先選擇人員與站點。");
      return;
    }
    const ok = await persistQualification(employee, reviewStationId, nextStatus);
    if (ok) {
      setFlashMessage("站點考核已確認並儲存。");
    }
  }

  async function handleDeleteQualification(employeeId: string, stationId: string) {
    const person = data.people.find((item) => item.id === employeeId);
    const station = data.stations.find((item) => item.id === stationId);
    if (!confirmAction(`確認刪除 ${person?.name || employeeId} 的 ${station?.name || stationId} 資格？`)) {
      setFlashMessage("已取消刪除。");
      return;
    }
    await deleteQualification({ employeeId, stationId });
    setData((current) => ({ ...current, qualifications: current.qualifications.filter((item) => !(item.employeeId === employeeId && item.stationId === stationId)) }));
    setFlashMessage("站點考核已刪除。");
  }

  async function handleUpdatePerson(person: Person, patch: Partial<Person>) {
    const next = { ...person, ...patch };
    if (!confirmAction(`確認修改人員 ${person.name}（${person.id}）？`)) {
      setFlashMessage("已取消修改。");
      return;
    }
    await updatePerson(next);
    setData((current) => ({ ...current, people: current.people.map((item) => (item.id === person.id ? next : item)) }));
    if (currentUser?.id === person.id) setCurrentUser(next);
    setFlashMessage(`人員 ${person.name} 已確認更新。`);
  }

  async function handleUpdatePermission(person: Person, permission: UserRole) {
    if (currentRole !== "最高權限") {
      setFlashMessage("只有最高權限可調整系統權限。");
      return;
    }
    if (person.id === "P0033" && permission !== "最高權限") {
      setFlashMessage("P0033 已鎖定為最高權限，不可降級。");
      return;
    }
    const patch: Partial<Person> = {
      systemPermission: permission,
      permissionLevel: permission,
      isSuperAdmin: permission === "最高權限" || person.id === "P0033",
    };
    await handleUpdatePerson(person, patch);
  }

  async function handleUpdateRule(rule: StationRule, patch: Partial<StationRule>) {
    const next = { ...rule, ...patch };
    const station = data.stations.find((item) => item.id === rule.stationId);
    if (!confirmAction(`確認修改 ${rule.team} 的 ${station?.name || rule.stationId} 規則？`)) {
      setFlashMessage("已取消修改。");
      return;
    }
    await updateStationRule(next);
    setData((current) => {
      const rules = current.stationRules || [];
      const exists = rules.some((item) => item.id === rule.id || (item.team === rule.team && item.stationId === rule.stationId));
      return {
        ...current,
        stationRules: exists
          ? rules.map((item) => (item.id === rule.id || (item.team === rule.team && item.stationId === rule.stationId) ? next : item))
          : [...rules, next],
      };
    });
    setFlashMessage("站點規則已確認更新。");
  }

  function assignManualPerson(stationId: string, employeeId: string, replaceExisting = false) {
    setManualAssignments((current) => {
      const currentIds = current[stationId] || [];
      if (currentIds.includes(employeeId)) {
        return { ...current, [stationId]: currentIds.filter((id) => id !== employeeId) };
      }
      const assignedStationId = findAssignedStation(current, employeeId);
      if (assignedStationId && assignedStationId !== stationId && !replaceExisting) {
        setManualConflictDialog({ stationId, employeeId, assignedStationId });
        return current;
      }
      const next: Record<string, string[]> = { ...current };
      if (assignedStationId && assignedStationId !== stationId) {
        next[assignedStationId] = (next[assignedStationId] || []).filter((id) => id !== employeeId);
      }
      next[stationId] = [...currentIds.filter((id) => id !== employeeId), employeeId];
      return next;
    });
  }

  function toggleManualAssignment(stationId: string, employeeId: string) {
    assignManualPerson(stationId, employeeId, false);
  }

  function confirmManualConflictReplace() {
    if (!manualConflictDialog) return;
    assignManualPerson(manualConflictDialog.stationId, manualConflictDialog.employeeId, true);
    const person = data.people.find((item) => item.id === manualConflictDialog.employeeId);
    const station = data.stations.find((item) => item.id === manualConflictDialog.stationId);
    setFlashMessage(`${person?.name || manualConflictDialog.employeeId} 已更換到 ${station?.name || manualConflictDialog.stationId}。`);
    setManualConflictDialog(null);
  }

  function runManualPlan() {
    const assignablePeople = data.people.filter((person) => !isOfficerPerson(person));
    const rows = buildSmartAssignments(manualShift, manualDay, data.stationRules || [], assignablePeople, data.qualifications, manualMode);
    const next: Record<string, string[]> = {};
    rows.forEach((row) => {
      next[row.stationId] = row.assigned.filter((person) => !manualOfficerIds.has(person.id)).map((person) => person.id);
    });
    setManualAssignments(next);
    setFlashMessage(`一鍵安排已完成：${manualMode}；幹部站位已保留。`);
  }

  const manualCustomCandidates = useMemo(() => {
    if (!manualCustomDialog) return [] as Person[];
    const keyword = manualCustomKeyword.trim().toLowerCase();
    const candidates = manualAttendance.all.filter((person) => !manualOfficerIds.has(person.id));
    if (!keyword) return candidates.slice(0, 30);
    return candidates.filter((person) => {
      return person.id.toLowerCase().includes(keyword) || person.name.toLowerCase().includes(keyword);
    }).slice(0, 30);
  }, [manualAttendance.all, manualOfficerIds, manualCustomDialog, manualCustomKeyword]);

  async function addManualCustomPerson(personId: string) {
    if (!manualCustomDialog) return;
    const stationId = manualCustomDialog.stationId;
    const person = data.people.find((item) => item.id === personId);
    const station = data.stations.find((item) => item.id === stationId);
    if (!person || !station) {
      setFlashMessage("找不到指定人員或站點，無法加入自訂人選。");
      return;
    }
    if (isOfficerPerson(person)) {
      setFlashMessage(`${person.name} 已列入幹部站位，請在幹部區塊安排。`);
      return;
    }

    const qualification = data.qualifications.find((item) => item.employeeId === person.id && item.stationId === stationId);
    const isQualified = qualification?.status === "合格";

    if (!isQualified) {
      setManualTrainingDialog({
        stationId,
        personId: person.id,
        currentStatus: qualification?.status || "無站點資格",
      });
      return;
    }

    assignManualPerson(stationId, person.id, false);
    setFlashMessage(`${person.name} 已加入 ${station.name}。`);
    setManualCustomDialog(null);
    setManualCustomKeyword("");
  }

  async function confirmManualTrainingPerson() {
    if (!manualTrainingDialog) return;
    const { stationId, personId } = manualTrainingDialog;
    const person = data.people.find((item) => item.id === personId);
    const station = data.stations.find((item) => item.id === stationId);
    if (!person || !station) {
      setManualTrainingDialog(null);
      setFlashMessage("找不到指定人員或站點，無法加入訓練。");
      return;
    }

    setManualTrainingDialog(null);
    const ok = await persistQualification(person, stationId, "訓練中", false);
    if (!ok) return;

    setReviewShift(getTeamOfPerson(person) as (typeof REVIEW_TEAM_OPTIONS)[number]);
    setReviewEmployeeId(person.id);
    setReviewStationId(stationId);
    setReviewStatus("訓練中");

    assignManualPerson(stationId, person.id, false);
    setFlashMessage(`${person.name} 已加入 ${station.name}，並同步建立訓練中考核資料。`);
    setManualCustomDialog(null);
    setManualCustomKeyword("");
  }

  function updateManualExtraWork(id: string, patch: Partial<ManualExtraWork>) {
    setManualExtraWorks((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function addManualExtraPerson(extraId: string, personId: string) {
    if (!personId) return;
    setManualExtraWorks((current) => current.map((item) => {
      if (item.id !== extraId) return item;
      if (item.personIds.includes(personId)) return item;
      return { ...item, personIds: [...item.personIds, personId] };
    }));
  }

  function removeManualExtraPerson(extraId: string, personId: string) {
    setManualExtraWorks((current) => current.map((item) => item.id === extraId ? { ...item, personIds: item.personIds.filter((id) => id !== personId) } : item));
  }

  function isPersonUsedInManualExtra(personId: string, currentExtraId?: string) {
    return manualExtraWorks.some((item) => item.id !== currentExtraId && item.personIds.includes(personId));
  }

  function openManualExtraDialog(extraId: string) {
    setManualExtraDialog({ extraId });
    setManualExtraKeyword("");
  }

  function closeManualExtraDialog() {
    setManualExtraDialog(null);
    setManualExtraKeyword("");
  }

  function clearManualExtraWork(extraId: string) {
    updateManualExtraWork(extraId, { workName: "", personIds: [] });
    setManualExtraKeyword("");
  }

  const manualExtraDialogItem = useMemo(() => {
    if (!manualExtraDialog) return null;
    return manualExtraWorks.find((item) => item.id === manualExtraDialog.extraId) || null;
  }, [manualExtraDialog, manualExtraWorks]);

  const manualExtraCandidates = useMemo(() => {
    if (!manualExtraDialogItem) return [] as Person[];
    const keyword = manualExtraKeyword.trim().toLowerCase();
    const usedAssignedIds = new Set([
      ...Object.values(manualAssignments).flat(),
      ...manualOfficerPeople.map((person) => person.id),
    ]);
    return manualAttendance.all
      .filter((person) => !usedAssignedIds.has(person.id) || manualExtraDialogItem.personIds.includes(person.id))
      .filter((person) => !isPersonUsedInManualExtra(person.id, manualExtraDialogItem.id) || manualExtraDialogItem.personIds.includes(person.id))
      .filter((person) => {
        if (!keyword) return true;
        return person.id.toLowerCase().includes(keyword) || person.name.toLowerCase().includes(keyword);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true }))
      .slice(0, 50);
  }, [manualAttendance.all, manualAssignments, manualOfficerPeople, manualExtraDialogItem, manualExtraKeyword, manualExtraWorks]);

  function buildManualSchedulePreviewText() {
    const lines: string[] = [];
    lines.push(manualSchedulePreview.team);
    lines.push("");
    lines.push(`主任　${manualSchedulePreview.officers.主任.join("、") || "-"}`);
    lines.push(`組長　${manualSchedulePreview.officers.組長.join("、") || "-"}`);
    lines.push(`領班　${manualSchedulePreview.officers.領班.join("、") || "-"}`);
    lines.push("");
    manualSchedulePreview.rows.forEach((row) => {
      lines.push(row.stationName);
      lines.push(row.people.map((person) => person.name).join("、") || "-");
      lines.push("");
    });
    return lines.join("\n").trim();
  }

  function completeManualSchedule() {
    setManualPreviewOpen(true);
  }

  async function copyManualSchedulePreview() {
    try {
      await navigator.clipboard.writeText(buildManualSchedulePreviewText());
      setFlashMessage("班表內容已複製，可貼到 LINE 或訊息分享。");
    } catch {
      setFlashMessage("無法複製班表內容，請改用截圖。");
    }
  }

  async function shareManualSchedulePreview() {
    const text = buildManualSchedulePreviewText();
    try {
      if (navigator.share) {
        await navigator.share({ title: `${manualSchedulePreview.team} 班表`, text });
        setFlashMessage("班表已開啟系統分享。");
        return;
      }
      await navigator.clipboard.writeText(text);
      setFlashMessage("此裝置不支援系統分享，已改為複製班表內容。");
    } catch {
      setFlashMessage("已取消分享，班表預覽仍保留。 ");
    }
  }

  function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
    const chars = Array.from(text || "-");
    const lines: string[] = [];
    let current = "";
    chars.forEach((char) => {
      const next = current + char;
      if (ctx.measureText(next).width > maxWidth && current) {
        lines.push(current);
        current = char;
      } else {
        current = next;
      }
    });
    if (current) lines.push(current);
    return lines.length ? lines : ["-"];
  }


  function splitScheduleStationLabel(stationName: string) {
    const text = String(stationName || "").trim();
    const match = text.match(/^(.*?)[（(]([^（）()]+)[）)]$/);
    if (!match) return { name: text || "未命名站點", code: "" };
    return { name: match[1].trim() || text, code: match[2].trim() };
  }

  function downloadManualScheduleMatrixImage() {
    if (typeof document === "undefined") return;
    const scale = 2;
    const leftWidth = 300;
    const colWidth = 136;
    const headerHeight = 190;
    const personRowHeight = 46;
    const footerHeight = 40;
    const rows = manualSchedulePreview.rows;
    const maxPeople = Math.max(4, ...rows.map((row) => row.people.length));
    const width = Math.max(1180, leftWidth + rows.length * colWidth + 48);
    const height = headerHeight + maxPeople * personRowHeight + footerHeight;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setFlashMessage("此瀏覽器不支援產生橫版班表圖片。");
      return;
    }

    canvas.width = width * scale;
    canvas.height = height * scale;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(scale, scale);

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 1;

    const x0 = 24;
    const y0 = 24;
    const tableWidth = leftWidth + rows.length * colWidth;
    const tableHeight = headerHeight + maxPeople * personRowHeight;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x0, y0, tableWidth, tableHeight);
    ctx.strokeRect(x0, y0, tableWidth, tableHeight);

    const leftGrad = ctx.createLinearGradient(x0, y0, x0, y0 + tableHeight);
    leftGrad.addColorStop(0, "#fef08a");
    leftGrad.addColorStop(1, "#dcfce7");
    ctx.fillStyle = leftGrad;
    ctx.fillRect(x0, y0, leftWidth, tableHeight);
    ctx.strokeRect(x0, y0, leftWidth, tableHeight);

    ctx.fillStyle = "#b91c1c";
    ctx.font = "900 34px 'Noto Sans TC', 'PingFang TC', sans-serif";
    ctx.fillText(manualSchedulePreview.team, x0 + 28, y0 + 48);
    ctx.fillStyle = "#0f172a";
    ctx.font = "900 24px 'Noto Sans TC', 'PingFang TC', sans-serif";
    ctx.fillText(`主任　${manualSchedulePreview.officers.主任.join("、") || "-"}`, x0 + 28, y0 + 94);
    ctx.fillText(`組長　${manualSchedulePreview.officers.組長.join("、") || "-"}`, x0 + 28, y0 + 132);
    const leaderText = `領班　${manualSchedulePreview.officers.領班.join("、") || "-"}`;
    wrapCanvasText(ctx, leaderText, leftWidth - 56).slice(0, 2).forEach((line, idx) => {
      ctx.fillText(line, x0 + 28, y0 + 170 + idx * 30);
    });

    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(x0 + leftWidth, y0, rows.length * colWidth, 44);
    ctx.fillStyle = "#0f172a";
    ctx.font = "900 19px 'Noto Sans TC', 'PingFang TC', sans-serif";
    ctx.fillText("站點 / Station", x0 + leftWidth + 16, y0 + 29);

    rows.forEach((row, index) => {
      const x = x0 + leftWidth + index * colWidth;
      const headerColor = index % 4 === 0 ? "#bfdbfe" : index % 4 === 1 ? "#d9f99d" : index % 4 === 2 ? "#fde68a" : "#bae6fd";
      ctx.fillStyle = headerColor;
      ctx.fillRect(x, y0 + 44, colWidth, headerHeight - 44);
      ctx.strokeStyle = "#64748b";
      ctx.strokeRect(x, y0, colWidth, tableHeight);
      ctx.beginPath();
      ctx.moveTo(x, y0 + headerHeight);
      ctx.lineTo(x + colWidth, y0 + headerHeight);
      ctx.stroke();

      const label = splitScheduleStationLabel(row.stationName);
      ctx.fillStyle = "#0f172a";
      ctx.font = "900 20px 'Noto Sans TC', 'PingFang TC', sans-serif";
      const nameLines = wrapCanvasText(ctx, label.name, colWidth - 18).slice(0, 3);
      nameLines.forEach((line, idx) => ctx.fillText(line, x + 9, y0 + 82 + idx * 25));
      if (label.code) {
        ctx.font = "900 18px 'Noto Sans TC', 'PingFang TC', sans-serif";
        ctx.fillText(label.code, x + 9, y0 + 160);
      }
    });

    ctx.font = "900 18px 'Noto Sans TC', 'PingFang TC', sans-serif";
    for (let rowIndex = 0; rowIndex < maxPeople; rowIndex += 1) {
      const y = y0 + headerHeight + rowIndex * personRowHeight;
      ctx.fillStyle = rowIndex % 2 === 0 ? "#ffffff" : "#f8fafc";
      ctx.fillRect(x0 + leftWidth, y, rows.length * colWidth, personRowHeight);
      ctx.strokeStyle = "#cbd5e1";
      ctx.beginPath();
      ctx.moveTo(x0 + leftWidth, y);
      ctx.lineTo(x0 + tableWidth, y);
      ctx.stroke();
      rows.forEach((row, colIndex) => {
        const x = x0 + leftWidth + colIndex * colWidth;
        const person = row.people[rowIndex];
        if (!person) return;
        const chipX = x + 8;
        const chipY = y + 7;
        const chipW = colWidth - 16;
        const chipH = 32;
        ctx.beginPath();
        ctx.roundRect(chipX, chipY, chipW, chipH, 12);
        ctx.fillStyle = person.isOfficer ? "#bbf7d0" : "#f1f5f9";
        ctx.fill();
        ctx.lineWidth = person.isOfficer ? 2 : 1;
        ctx.strokeStyle = person.isOfficer ? "#16a34a" : "#cbd5e1";
        ctx.stroke();
        ctx.fillStyle = person.isOfficer ? "#166534" : "#334155";
        ctx.fillText(person.name, chipX + 10, chipY + 22);
      });
    }

    ctx.fillStyle = "#64748b";
    ctx.font = "700 15px 'Noto Sans TC', 'PingFang TC', sans-serif";
    ctx.fillText("※ 綠色人名為站長以上／幹部站位。", x0, height - 16);

    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    link.download = `${manualSchedulePreview.team}-橫版班表-${date}.png`;
    link.href = canvas.toDataURL("image/png");
    document.body.appendChild(link);
    link.click();
    link.remove();
    setFlashMessage("橫版班表圖片已產生，請依瀏覽器提示下載或分享。手機瀏覽器通常無法靜默自動存入相簿。");
  }

  function downloadManualSchedulePreviewImage() {
    if (manualPreviewStyle === "matrix") {
      downloadManualScheduleMatrixImage();
      return;
    }
    if (typeof document === "undefined") return;
    const scale = 2;
    const width = 900;
    const padding = 54;
    const rowGap = manualPreviewStyle === "table" ? 14 : 18;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setFlashMessage("此瀏覽器不支援產生班表圖片。");
      return;
    }

    ctx.font = "30px 'Noto Sans TC', 'PingFang TC', sans-serif";
    const rowHeights = manualSchedulePreview.rows.map((row) => {
      const lines = wrapCanvasText(ctx, row.people.map((person) => person.name).join("、") || "-", width - padding * 2 - 36);
      return Math.max(88, 56 + lines.length * 36);
    });
    const height = Math.max(860, 260 + rowHeights.reduce((sum, item) => sum + item + rowGap, 0));
    canvas.width = width * scale;
    canvas.height = height * scale;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(scale, scale);

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    if (manualPreviewStyle === "share") {
      gradient.addColorStop(0, "#fff7ed");
      gradient.addColorStop(0.5, "#fef3f2");
      gradient.addColorStop(1, "#eefdf5");
    } else if (manualPreviewStyle === "section") {
      gradient.addColorStop(0, "#172033");
      gradient.addColorStop(1, "#334155");
    } else {
      gradient.addColorStop(0, "#f8fafc");
      gradient.addColorStop(1, "#edf2f7");
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const isPoster = manualPreviewStyle === "section";
    const textMain = isPoster ? "#ffffff" : "#0f172a";
    const textSub = isPoster ? "#dbeafe" : "#475569";

    ctx.fillStyle = textMain;
    ctx.font = "800 46px 'Noto Sans TC', 'PingFang TC', sans-serif";
    ctx.fillText(`${manualSchedulePreview.team} 班表`, padding, 84);

    ctx.font = "700 26px 'Noto Sans TC', 'PingFang TC', sans-serif";
    ctx.fillStyle = textSub;
    ctx.fillText(`主任　${manualSchedulePreview.officers.主任.join("、") || "-"}`, padding, 130);
    ctx.fillText(`組長　${manualSchedulePreview.officers.組長.join("、") || "-"}`, padding, 170);
    ctx.fillText(`領班　${manualSchedulePreview.officers.領班.join("、") || "-"}`, padding, 210);

    let y = 250;
    manualSchedulePreview.rows.forEach((row, index) => {
      const rowHeight = rowHeights[index];
      const x = padding;
      const w = width - padding * 2;
      const r = 28;
      ctx.beginPath();
      ctx.roundRect(x, y, w, rowHeight, r);
      ctx.fillStyle = manualPreviewStyle === "share"
        ? ["#ffffff", "#fff8e7", "#f0fdf4", "#fdf2f8"][index % 4]
        : isPoster
          ? "rgba(255,255,255,.12)"
          : "#ffffff";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = isPoster ? "rgba(255,255,255,.22)" : "#e2e8f0";
      ctx.stroke();

      ctx.fillStyle = isPoster ? "#ffffff" : "#172033";
      ctx.font = "800 30px 'Noto Sans TC', 'PingFang TC', sans-serif";
      ctx.fillText(row.stationName, x + 28, y + 40);

      ctx.font = "700 24px 'Noto Sans TC', 'PingFang TC', sans-serif";
      const chipHeight = 34;
      const chipGap = 10;
      let chipX = x + 28;
      let chipY = y + 64;
      const chipMaxX = x + w - 28;
      const people = row.people.length ? row.people : [{ name: "-", isOfficer: false }];
      people.forEach((person) => {
        const text = person.name;
        const chipWidth = Math.min(Math.max(58, ctx.measureText(text).width + 24), chipMaxX - x - 56);
        if (chipX + chipWidth > chipMaxX && chipX > x + 28) {
          chipX = x + 28;
          chipY += chipHeight + 10;
        }
        ctx.beginPath();
        ctx.roundRect(chipX, chipY, chipWidth, chipHeight, 16);
        ctx.fillStyle = person.isOfficer ? "#dcfce7" : (isPoster ? "rgba(255,255,255,.16)" : "#f1f5f9");
        ctx.fill();
        ctx.lineWidth = person.isOfficer ? 2 : 1;
        ctx.strokeStyle = person.isOfficer ? "#22c55e" : (isPoster ? "rgba(255,255,255,.24)" : "#e2e8f0");
        ctx.stroke();
        ctx.fillStyle = person.isOfficer ? "#166534" : (isPoster ? "#e2e8f0" : "#334155");
        ctx.fillText(text, chipX + 12, chipY + 24);
        chipX += chipWidth + chipGap;
      });
      y += rowHeight + rowGap;
    });

    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    link.download = `${manualSchedulePreview.team}-站點班表-${date}.png`;
    link.href = canvas.toDataURL("image/png");
    document.body.appendChild(link);
    link.click();
    link.remove();
    setFlashMessage("班表圖片已產生，請依瀏覽器提示下載或分享。手機瀏覽器通常無法靜默自動存入相簿。");
  }

  function confirmManualSchedulePreview() {
    downloadManualSchedulePreviewImage();
    setManualPreviewOpen(false);
  }

  function renderSchedulePreviewPeople(people: SchedulePreviewPerson[], joinMode: "comma" | "space" = "comma") {
    if (!people.length) return <span className="schedule-empty-name">-</span>;
    return (
      <span className={`schedule-name-tags ${joinMode === "space" ? "space" : "comma"}`}>
        {people.map((person, index) => (
          <span key={`${person.name}-${index}`} className={`schedule-person-tag${person.isOfficer ? " officer" : ""}`}>
            {person.name}
          </span>
        ))}
      </span>
    );
  }

  async function handleCustomAssign(target: "manual" | "smart", stationId: string) {
    const raw = window.prompt("請輸入工號或姓名");
    if (!raw) return;
    const attendance = target === "manual" ? manualAttendance : smartAttendance;
    const assignments = target === "manual" ? manualAssignments : smartAssignments;
    const person = attendance.all.find((item) => item.id === raw.trim() || item.name === raw.trim());
    const station = data.stations.find((item) => item.id === stationId);
    if (!person || !station) {
      setFlashMessage("找不到可用人員，請確認該人員存在於本次出勤池。");
      return;
    }
    const assignedStationId = findAssignedStation(assignments, person.id);
    if (assignedStationId && assignedStationId !== stationId) {
      const assignedStation = data.stations.find((item) => item.id === assignedStationId);
      setFlashMessage(`${person.name} 已安排在 ${assignedStation?.name || assignedStationId}，不可重複佔站。`);
      return;
    }
    const qualified = data.qualifications.some((item) => item.employeeId === person.id && item.stationId === stationId && item.status === "合格");
    if (!qualified) {
      const training = confirmAction(`${person.name} 目前不符合 ${station.name} 資格。是否標記為訓練人力？`);
      if (training) {
        const ok = await persistQualification(person, stationId, "訓練中");
        if (!ok) return;
      } else {
        const complete = confirmAction(`是否直接標記 ${person.name} 為 ${station.name} 訓練完成？`);
        if (!complete) {
          setFlashMessage("已取消自訂安排。");
          return;
        }
        const ok = await persistQualification(person, stationId, "合格");
        if (!ok) return;
      }
      setReviewShift(getTeamOfPerson(person) as (typeof REVIEW_TEAM_OPTIONS)[number]);
      setReviewEmployeeId(person.id);
      setReviewStationId(stationId);
    }
    const setter = target === "manual" ? setManualAssignments : setSmartAssignments;
    setter((current) => appendUniqueAssignment(current, stationId, person.id));
    setFlashMessage(`${person.name} 已加入 ${station.name}。`);
  }

  function releaseActiveControl() {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  }

  function runSmartPlan() {
    releaseActiveControl();
    const rows = buildSmartAssignments(smartShift, smartDay, data.stationRules || [], data.people, data.qualifications, smartMode);
    const next: Record<string, string[]> = {};
    rows.forEach((row) => {
      next[row.stationId] = row.assigned.map((person) => person.id);
    });
    setSmartAssignments(next);
    setFlashMessage(`一鍵試排已完成：${smartMode}`);
    window.setTimeout(releaseActiveControl, 0);
    window.setTimeout(releaseActiveControl, 120);
  }

  function renderPermissionAdmin() {
    const permissionItemMap = new Map(permissionItemStates.map((item) => [item.id, item]));
    const getAccountStatus = (person: Person) =>
      accountStatusById[person.id] || (String((person as Person & Record<string, unknown>).accountStatus || (person as Person & Record<string, unknown>).enabled || "啟用").includes("停") ? "停用" : "啟用");
    const getAccountPassword = (person: Person) => String(
      accountPasswordById[person.id] ??
        (person as Person & Record<string, unknown>).password ??
        (person as Person & Record<string, unknown>).loginPassword ??
        (person as Person & Record<string, unknown>)["登入密碼"] ??
        ""
    );
    const enabledAccountCount = permissionRows.filter((person) => getAccountStatus(person) === "啟用").length;
    const visiblePermissions = permissionItemStates.filter((item) => permissionSearchMatches([item.id, item.name, item.category, item.page, item.action, item.enabled, item.note], permissionSearchKeyword));
    const availablePermissions = permissionItemStates.filter((item) => item.enabled !== "停用");
    const selectedPermissionPerson = permissionRows.find((person) => person.id === permissionSelectedPersonId) || permissionRows[0] || null;
    const selectedPersonExceptions = selectedPermissionPerson
      ? personalPermissionExceptions.filter((item) => item.employeeId === selectedPermissionPerson.id && item.enabled !== "停用")
      : [];
    const selectedPersonExceptionMap = new Map(selectedPersonExceptions.map((item) => [item.permissionId, item]));

    function getRoleAllowed(role: UserRole, permissionId: string) {
      // 角色權限管理頁採「該角色直接設定」口徑。
      // 不再繼承低階角色權限，避免例如「組長」因技術員已開放而無法關閉同一功能。
      const match = rolePermissionMapStates.find((item) =>
        item.role === role &&
        item.permissionId === permissionId &&
        item.enabled === "啟用"
      );
      return match?.allowed === "Y";
    }

    function getPersonFinalAllowed(person: Person, permissionId: string) {
      const role = getSystemPermission(person) || "技術員";
      const exception = personalPermissionExceptions.find((item) => item.employeeId === person.id && item.permissionId === permissionId && item.enabled !== "停用");
      if (exception?.effect === "deny") return false;
      if (exception?.effect === "allow") return true;
      return getRoleAllowed(role, permissionId);
    }

    function setPersonalException(person: Person | null, permissionId: string, effect: PersonalPermissionEffect) {
      if (!person) return;
      setPersonalPermissionExceptions((current) => {
        const exists = current.find((item) => item.employeeId === person.id && item.permissionId === permissionId);
        if (exists?.effect === effect && exists.enabled !== "停用") {
          return current.map((item) => item.id === exists.id ? { ...item, enabled: "停用" } : item);
        }
        if (exists) {
          return current.map((item) => item.id === exists.id ? { ...item, effect, enabled: "啟用" } : item);
        }
        return [
          ...current,
          {
            id: `EXC_${Date.now()}_${permissionId}`,
            employeeId: person.id,
            permissionId,
            effect,
            enabled: "啟用",
            note: effect === "allow" ? "個人額外開放" : "個人單獨禁止",
          },
        ];
      });
    }

    function togglePermissionItemEnabled(permissionId: string) {
      if (currentRole !== "最高權限") return;
      setPermissionItemStates((current) => current.map((item) => item.id === permissionId ? { ...item, enabled: item.enabled === "啟用" ? "停用" : "啟用" } : item));
      setFlashMessage("本頁範本暫存：權限項目啟用狀態已切換；若要永久保存，需補 GAS 寫入端點。");
    }

    function toggleRolePermission(role: UserRole, permissionId: string) {
      if (currentRole !== "最高權限") return;
      const mapId = `ROLEMAP_${role}_${permissionId}`;
      setRolePermissionMapStates((current) => {
        const exists = current.find((item) => item.role === role && item.permissionId === permissionId);
        if (exists) {
          const nextAllowed = exists.allowed === "Y" && exists.enabled === "啟用" ? "N" : "Y";
          return current.map((item) => item.id === exists.id ? { ...item, allowed: nextAllowed, enabled: "啟用", note: nextAllowed === "Y" ? "角色已開放" : "角色已關閉" } : item);
        }
        return [...current, { id: mapId, role, permissionId, allowed: "Y", enabled: "啟用", note: "角色已開放" }];
      });
      setFlashMessage("本頁範本暫存：角色權限已切換；若要永久保存，需補 GAS 寫入端點。");
    }

    async function toggleAccountEnabled(person: Person) {
      if (currentRole !== "最高權限") return;
      const nextStatus = getAccountStatus(person) === "啟用" ? "停用" : "啟用";
      setAccountStatusById((current) => ({ ...current, [person.id]: nextStatus }));
      try {
        const payload = { ...person, accountStatus: nextStatus, enabled: nextStatus === "啟用" ? "Y" : "N" } as Person & Record<string, unknown>;
        await updatePerson(payload as Person);
        setFlashMessage(`帳號 ${person.name} 已${nextStatus}。`);
      } catch {
        setFlashMessage("帳號狀態已在本頁切換；若未寫回試算表，請確認 GAS updatePerson 是否支援 accountStatus/enabled 欄位。");
      }
    }

    async function updateAccountPassword(person: Person) {
      if (currentRole !== "最高權限") return;
      const nextPassword = String(accountPasswordDrafts[person.id] || "").trim();
      if (!nextPassword) {
        setFlashMessage("請先輸入新密碼。");
        return;
      }
      try {
        const payload = { ...person, password: nextPassword, loginPassword: nextPassword } as Person & Record<string, unknown>;
        await updatePerson(payload as Person);
        setAccountPasswordById((current) => ({ ...current, [person.id]: nextPassword }));
        setAccountPasswordDrafts((current) => ({ ...current, [person.id]: "" }));
        setFlashMessage(`已更新 ${person.name} 的密碼，畫面已同步顯示。`);
      } catch {
        setFlashMessage("密碼更新未完成：請確認 GAS updatePerson 是否支援 password/loginPassword 欄位。");
      }
    }

    const enabledToggleButton = (enabled: boolean, onClick: () => void, label?: string) => (
      <button
        type="button"
        onClick={onClick}
        style={{
          border: 0,
          borderRadius: 999,
          padding: "8px 13px",
          fontWeight: 950,
          background: enabled ? "#dcfce7" : "#fee2e2",
          color: enabled ? "#166534" : "#991b1b",
          boxShadow: enabled ? "inset 0 0 0 1px #86efac" : "inset 0 0 0 1px #fecaca",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {label || (enabled ? "啟用" : "停用")}
      </button>
    );

    const tabButton = (key: PermissionAdminTab, label: string) => (
      <button
        key={key}
        type="button"
        className={permissionAdminTab === key ? "primary" : "ghost"}
        onClick={() => setPermissionAdminTab(key)}
        style={{ minHeight: 40, borderRadius: 999, padding: "8px 14px", fontWeight: 900 }}
      >
        {label}
      </button>
    );

    const roleButton = (role: UserRole) => (
      <button
        key={role}
        type="button"
        className={permissionSelectedRole === role ? "primary" : "ghost"}
        onClick={() => setPermissionSelectedRole(role)}
        style={{ minHeight: 38, borderRadius: 999, padding: "8px 13px", fontWeight: 900 }}
      >
        {role}
      </button>
    );

    return (
      <Layout title="權限管理" subtitle="最高權限可直接調整角色權限、帳號密碼、功能啟用與個人例外權限。">
        <div className="grid three compact-home-stats">
          <StatCard title="07 帳號管理" value={String(permissionRows.length)} note={`啟用參考：${enabledAccountCount}`} />
          <StatCard title="08 權限項目" value={String(permissionItemStates.length)} note="可切換啟用/停用" />
          <StatCard title="個人例外權限" value={String(personalPermissionExceptions.filter((item) => item.enabled !== "停用").length)} note="本頁範本暫存" />
        </div>

        <div className="panel">
          <div className="toolbar" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[tabButton("role", "角色權限"), tabButton("account", "帳號管理"), tabButton("items", "權限項目"), tabButton("exceptions", "例外權限"), tabButton("check", "權限檢查")]}
          </div>
          <div className="toolbar">
            <input placeholder="搜尋工號、姓名、權限項目、角色、功能頁面" value={permissionSearchKeyword} onChange={(e) => setPermissionSearchKeyword(e.target.value)} />
          </div>
          <p className="muted">判斷順序：個人單獨禁止 ＞ 個人額外開放 ＞ 角色預設權限。智能試排保留停用紀錄，不開放操作入口。</p>
        </div>

        {permissionAdminTab === "role" ? (
          <>
            <div className="panel">
              <div className="panel-header"><h3>角色權限</h3><span>最高權限可直接點擊切換該角色是否開放功能；每個角色獨立設定，不再被低階角色繼承卡住</span></div>
              <div className="toolbar" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {permissionOptions.map(roleButton)}
              </div>
              <div className="grid two">
                {visiblePermissions.map((item) => {
                  const allowed = getRoleAllowed(permissionSelectedRole, item.id);
                  const disabled = item.enabled === "停用";
                  const enabled = allowed && !disabled;
                  return (
                    <div key={item.id} className="panel" style={{ margin: 0, padding: 14, opacity: disabled ? 0.58 : 1 }}>
                      <div className="panel-header" style={{ alignItems: "center", gap: 8 }}>
                        <div>
                          <h3 style={{ marginBottom: 2 }}>{item.page}</h3>
                          <span>{item.name}</span>
                        </div>
                        {enabledToggleButton(enabled, () => {
                          if (disabled) togglePermissionItemEnabled(item.id);
                          else toggleRolePermission(permissionSelectedRole, item.id);
                        }, disabled ? "功能停用" : enabled ? "啟用" : "停用")}
                      </div>
                      <p className="muted" style={{ margin: "8px 0 0" }}>{item.category}｜{item.action}{item.note ? `｜${item.note}` : ""}</p>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="panel">
              <div className="panel-header"><h3>{permissionSelectedRole} 人員</h3><span>此區只做檢視；人員角色請到帳號管理調整</span></div>
              <div className="grid three">
                {permissionRows.filter((person) => getSystemPermission(person) === permissionSelectedRole).map((person) => (
                  <div key={person.id} className="panel" style={{ margin: 0, padding: 12 }}>
                    <strong>{person.name}</strong>
                    <p className="muted" style={{ margin: "4px 0 8px" }}>{person.id}｜{String(getTeamOfPerson(person))}</p>
                    {enabledToggleButton(getAccountStatus(person) === "啟用", () => toggleAccountEnabled(person))}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {permissionAdminTab === "account" ? (
          <div className="panel">
            <div className="panel-header"><h3>07_帳號管理</h3><span>緊湊版：角色 / 密碼 / 啟用狀態</span></div>
            <div style={{ display: "grid", gap: 8 }}>
              {permissionRows.map((person) => {
                const permission = String(getSystemPermission(person) || "技術員");
                const accountStatus = getAccountStatus(person);
                const currentPassword = getAccountPassword(person);
                return (
                  <div
                    key={person.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(86px, 1fr) minmax(82px, 0.85fr) minmax(108px, 1.05fr) auto",
                      gap: 7,
                      alignItems: "center",
                      padding: "8px 9px",
                      border: "1px solid #e2e8f0",
                      borderRadius: 15,
                      background: "#ffffff",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ display: "block", fontSize: 15, lineHeight: 1.2 }}>{person.name}</strong>
                      <span className="muted" style={{ fontSize: 12 }}>{person.id}</span>
                    </div>
                    {person.id === "P0033" ? (
                      <span className="chip" style={{ justifyContent: "center" }}>最高權限</span>
                    ) : (
                      <ConfirmSelect value={permission} options={permissionOptions.map((item) => ({ label: item, value: item }))} onCommit={(value) => handleUpdatePermission(person, value as UserRole)} />
                    )}
                    <div style={{ display: "grid", gap: 5 }}>
                      <input
                        type="text"
                        readOnly
                        value={currentPassword || "未讀取"}
                        title="目前密碼"
                        style={{ minHeight: 32, fontSize: 13, background: "#f8fafc" }}
                      />
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 5 }}>
                        <input
                          type="text"
                          placeholder="新密碼"
                          value={accountPasswordDrafts[person.id] || ""}
                          onChange={(e) => setAccountPasswordDrafts((current) => ({ ...current, [person.id]: e.target.value }))}
                          style={{ minHeight: 32, fontSize: 13 }}
                        />
                        <button className="primary" type="button" onClick={() => updateAccountPassword(person)} style={{ borderRadius: 12, minHeight: 32, padding: "0 9px", fontSize: 13 }}>改</button>
                      </div>
                    </div>
                    {enabledToggleButton(accountStatus === "啟用", () => toggleAccountEnabled(person))}
                  </div>
                );
              })}
            </div>
            <p className="muted">目前密碼會讀取 07_帳號管理；若剛修改成功，畫面會立即顯示新密碼。若仍顯示未讀取，請同步更新 GAS 與 api.ts。</p>
          </div>
        ) : null}

        {permissionAdminTab === "items" ? (
          <div className="panel">
            <div className="panel-header"><h3>08_權限項目</h3><span>簡化版：功能名稱 / 頁面 / 啟用狀態</span></div>
            <div className="grid two">
              {permissionItemRows.map((item) => {
                const enabled = item.enabled === "啟用";
                return (
                  <div key={item.id} className="panel" style={{ margin: 0, padding: 12 }}>
                    <div className="panel-header" style={{ alignItems: "center", gap: 8 }}>
                      <div>
                        <h3 style={{ marginBottom: 2 }}>{item.name}</h3>
                        <span>{item.page}｜{item.action}</span>
                      </div>
                      {enabledToggleButton(enabled, () => togglePermissionItemEnabled(item.id))}
                    </div>
                    <p className="muted" style={{ margin: "8px 0 0" }}>{item.note || item.category}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {permissionAdminTab === "exceptions" ? (
          <div className="panel">
            <div className="panel-header"><h3>10_個人例外權限</h3><span>針對特定對象單獨開放或禁止，不改變原本身分</span></div>
            <input
              value={permissionExceptionKeyword}
              onChange={(e) => setPermissionExceptionKeyword(e.target.value)}
              placeholder="搜尋姓名、工號、權限項目"
              style={{ marginBottom: 12 }}
            />
            <div className="grid two">
              <div className="panel" style={{ margin: 0 }}>
                <h3>選擇人員</h3>
                <div className="list-scroll" style={{ maxHeight: 420 }}>
                  {permissionRows
                    .filter((person) => permissionSearchMatches([person.name, person.id, String(getSystemPermission(person) || "技術員")], permissionExceptionKeyword))
                    .map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      className={selectedPermissionPerson?.id === person.id ? "list-row active" : "list-row"}
                      onClick={() => setPermissionSelectedPersonId(person.id)}
                    >
                      <strong>{person.name}</strong>
                      <span>{person.id}｜{String(getSystemPermission(person) || "技術員")}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="panel" style={{ margin: 0 }}>
                <h3>{selectedPermissionPerson ? `${selectedPermissionPerson.name} 的例外權限` : "請先選擇人員"}</h3>
                <p className="muted">綠色代表額外開放；紅色代表單獨禁止。再次點同一狀態可取消例外。</p>
                <div className="list-scroll" style={{ maxHeight: 420 }}>
                  {availablePermissions
                    .filter((item) => permissionSearchMatches([item.id, item.name, item.page, item.category], permissionExceptionKeyword))
                    .map((item) => {
                    const exception = selectedPersonExceptionMap.get(item.id);
                    const finalAllowed = selectedPermissionPerson ? getPersonFinalAllowed(selectedPermissionPerson, item.id) : false;
                    return (
                      <div key={item.id} className="list-row" style={{ alignItems: "stretch" }}>
                        <div>
                          <strong>{item.page}</strong>
                          <span>{item.name}｜最後結果：{finalAllowed ? "可使用" : "不可使用"}</span>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          <button type="button" className={exception?.effect === "allow" ? "primary" : "ghost"} onClick={() => setPersonalException(selectedPermissionPerson, item.id, "allow")}>額外開放</button>
                          <button type="button" className={exception?.effect === "deny" ? "danger" : "ghost"} onClick={() => setPersonalException(selectedPermissionPerson, item.id, "deny")}>單獨禁止</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <p className="muted">目前這版先以前端暫存呈現流程；若要寫回資料庫，建議新增 10_個人例外權限 並補 GAS/API 寫入端點。</p>
          </div>
        ) : null}

        {permissionAdminTab === "check" ? (
          <div className="panel">
            <div className="panel-header"><h3>權限檢查</h3><span>快速盤查停用功能、例外權限與高權限帳號</span></div>
            <div className="grid three compact-home-stats">
              <StatCard title="停用功能" value={String(permissionItemStates.filter((item) => item.enabled === "停用").length)} note="例如智能試排" />
              <StatCard title="個人例外" value={String(personalPermissionExceptions.filter((item) => item.enabled !== "停用").length)} note="allow / deny" />
              <StatCard title="最高權限帳號" value={String(permissionRows.filter((person) => getSystemPermission(person) === "最高權限").length)} note="需定期檢查" />
            </div>
            <table className="table">
              <thead><tr><th>人員</th><th>角色</th><th>例外項目</th><th>效果</th></tr></thead>
              <tbody>{personalPermissionExceptions.filter((item) => item.enabled !== "停用").map((item) => {
                const person = permissionRows.find((row) => row.id === item.employeeId);
                const perm = permissionItemMap.get(item.permissionId);
                return <tr key={item.id}><td>{person?.name || item.employeeId}</td><td>{String(person ? getSystemPermission(person) || "技術員" : "-")}</td><td>{perm?.name || item.permissionId}</td><td><span className={item.effect === "allow" ? "chip" : "chip danger"}>{item.effect === "allow" ? "額外開放" : "單獨禁止"}</span></td></tr>;
              })}</tbody>
            </table>
          </div>
        ) : null}
      </Layout>
    );
  }

  const navItems: Array<{ key: PageKey; label: string; minRole?: UserRole }> = [
    { key: "home", label: "首頁" },
    { key: "person-query", label: "查詢人員資格", minRole: "技術員" },
    { key: "station-query", label: "查詢站點人選", minRole: "技術員" },
    { key: "qualification-review", label: "站點考核", minRole: "領班" },
    { key: "gap-analysis", label: "站點缺口分析", minRole: "組長" },
    { key: "manual-schedule", label: "站點試排", minRole: "組長" },
    { key: "station-rules", label: "站點規則設定", minRole: "主任" },
    { key: "people-management", label: "人員名單管理", minRole: "主任" },
    { key: "permission-admin", label: "權限管理", minRole: "最高權限" },
  ];

  const allowedNav = currentRole ? navItems.filter((item) => hasAccess(item.minRole)) : navItems.filter((item) => item.key === "home");

  if (loading) return <div className="app-shell loading" translate="no">資料載入中...</div>;

  return (
    <>
      <style>{`
        .app-shell {
          --theme-bg: #f5f7fb;
          --theme-surface: rgba(255,255,255,.92);
          --theme-panel: #ffffff;
          --theme-border: #dbe5f0;
          --theme-text: #06142f;
          --theme-muted: #64748b;
          --theme-primary: #2563eb;
          --theme-primary-contrast: #ffffff;
          --theme-soft: #eff6ff;
          --theme-success: #16a34a;
          --theme-danger: #dc2626;
          --theme-accent: #38bdf8;
          --theme-shadow: 0 18px 42px rgba(15, 23, 42, .10);
          --theme-title-spacing: .02em;
          --theme-radius: 22px;
          background: var(--theme-bg);
          color: var(--theme-text);
          font-family: var(--theme-font-family, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif);
          transition: background .25s ease, color .25s ease;
        }
        .app-theme-glass {
          --theme-bg: radial-gradient(circle at 12% 0%, #e0f2fe 0, transparent 30%), linear-gradient(180deg, #f8fbff 0%, #eef4fb 100%);
          --theme-surface: rgba(255,255,255,.74);
          --theme-panel: rgba(255,255,255,.86);
          --theme-border: rgba(148, 163, 184, .32);
          --theme-primary: #2563eb;
          --theme-soft: #eff6ff;
          --theme-accent: #22c55e;
          --theme-shadow: 0 18px 52px rgba(59, 130, 246, .14);
        }
        .app-theme-kawaii {
          --theme-bg: radial-gradient(circle at 18% 8%, #ffe4ef 0, transparent 28%), radial-gradient(circle at 92% 2%, #fff7ad 0, transparent 22%), linear-gradient(180deg, #fff7f2 0%, #fffaf7 100%);
          --theme-surface: rgba(255,248,244,.92);
          --theme-panel: #fffafa;
          --theme-border: #ffd6c8;
          --theme-text: #3f2f2f;
          --theme-muted: #9a7b72;
          --theme-primary: #fb7185;
          --theme-soft: #fff1f2;
          --theme-accent: #fbbf24;
          --theme-success: #22c55e;
          --theme-shadow: 0 18px 42px rgba(251, 113, 133, .15);
          --theme-radius: 28px;
        }
        .app-theme-cyber {
          --theme-bg: radial-gradient(circle at 20% 10%, rgba(14,165,233,.24), transparent 30%), radial-gradient(circle at 88% 0%, rgba(217,70,239,.28), transparent 32%), linear-gradient(180deg, #07111f 0%, #0f172a 100%);
          --theme-surface: rgba(15, 23, 42, .78);
          --theme-panel: rgba(15, 23, 42, .82);
          --theme-border: rgba(34, 211, 238, .42);
          --theme-text: #e0f2fe;
          --theme-muted: #93c5fd;
          --theme-primary: #06b6d4;
          --theme-soft: rgba(8, 47, 73, .72);
          --theme-accent: #e879f9;
          --theme-success: #22d3ee;
          --theme-danger: #fb7185;
          --theme-shadow: 0 0 34px rgba(34,211,238,.16), 0 18px 44px rgba(0,0,0,.32);
          --theme-radius: 12px;
          --theme-title-spacing: .06em;
        }
        .app-theme-premium {
          --theme-bg: linear-gradient(180deg, #fbf7ef 0%, #f5efe4 100%);
          --theme-surface: rgba(255,252,247,.9);
          --theme-panel: #fffdf8;
          --theme-border: #d9c49e;
          --theme-text: #102033;
          --theme-muted: #927a55;
          --theme-primary: #0f2742;
          --theme-soft: #f6efe4;
          --theme-accent: #b98c42;
          --theme-success: #2f7d5b;
          --theme-shadow: 0 18px 42px rgba(73, 54, 28, .13);
          --theme-radius: 20px;
          --theme-title-spacing: .04em;
        }
        .app-theme-comic {
          --theme-bg: radial-gradient(circle at 10% 12%, #fff176 0, transparent 20%), radial-gradient(circle at 92% 8%, #7dd3fc 0, transparent 22%), linear-gradient(180deg, #fff 0%, #f8fafc 100%);
          --theme-surface: #ffffff;
          --theme-panel: #ffffff;
          --theme-border: #111827;
          --theme-text: #111827;
          --theme-muted: #475569;
          --theme-primary: #2563eb;
          --theme-soft: #fef3c7;
          --theme-accent: #f43f5e;
          --theme-success: #22c55e;
          --theme-shadow: 6px 6px 0 rgba(17,24,39,.15);
          --theme-radius: 18px;
          --theme-title-spacing: .03em;
        }
        .app-font-system { --theme-font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif; }
        .app-font-rounded { --theme-font-family: "Arial Rounded MT Bold", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif; }
        .app-font-serif { --theme-font-family: "Noto Serif TC", "Songti TC", "PMingLiU", Georgia, serif; }
        .app-font-mono { --theme-font-family: "SFMono-Regular", Consolas, "Noto Sans Mono CJK TC", "Noto Sans TC", monospace; }
        .app-font-hand { --theme-font-family: "Comic Sans MS", "Marker Felt", "Noto Sans TC", "PingFang TC", cursive; }
        .content h1, .content h2, .content h3, .brand-card h1, .panel h3, .layout-title h1 {
          color: var(--theme-text);
          letter-spacing: var(--theme-title-spacing);
          line-height: 1.18;
        }
        .content .panel, .control-card, .brand-card, .list-row, .stat-card {
          background: var(--theme-panel);
          border-color: var(--theme-border);
          box-shadow: var(--theme-shadow);
          border-radius: var(--theme-radius);
        }
        .content input, .content select, .content textarea {
          background: color-mix(in srgb, var(--theme-panel) 88%, white);
          color: var(--theme-text);
          border-color: var(--theme-border);
        }
        .primary, .nav-item.active, .toolbar .primary {
          background: var(--theme-primary) !important;
          color: var(--theme-primary-contrast) !important;
          border-color: var(--theme-primary) !important;
        }
        .ghost, .chip, .manual-officer-chip {
          background: var(--theme-soft);
          color: var(--theme-primary);
          border-color: color-mix(in srgb, var(--theme-primary) 35%, var(--theme-border));
        }
        .app-toast {
          background: var(--theme-toast-bg, rgba(15, 23, 42, .94));
          color: var(--theme-toast-text, #fff);
          border-color: var(--theme-toast-border, rgba(148, 163, 184, .45));
        }
        .app-theme-glass .app-toast { --theme-toast-bg: rgba(255,255,255,.78); --theme-toast-text: #0f172a; --theme-toast-border: rgba(34,197,94,.28); box-shadow: 0 20px 60px rgba(15,23,42,.16); backdrop-filter: blur(16px); }
        .app-theme-kawaii .app-toast { --theme-toast-bg: #fff7ed; --theme-toast-text: #422006; --theme-toast-border: #fed7aa; border-radius: 28px; }
        .app-theme-cyber .app-toast { --theme-toast-bg: rgba(2,6,23,.92); --theme-toast-text: #e0f2fe; --theme-toast-border: #22d3ee; box-shadow: 0 0 32px rgba(34,211,238,.24), 0 0 48px rgba(232,121,249,.16); border-radius: 10px; }
        .app-theme-premium .app-toast { --theme-toast-bg: #fffdf7; --theme-toast-text: #102033; --theme-toast-border: #d6b16a; }
        .app-theme-comic .app-toast { --theme-toast-bg: #fef08a; --theme-toast-text: #111827; --theme-toast-border: #111827; border-width: 2px; box-shadow: 5px 5px 0 rgba(17,24,39,.22); }
        .home-style-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
        .home-style-card { border: 1px solid var(--theme-border); border-radius: 20px; padding: 14px; background: var(--theme-surface); color: var(--theme-text); text-align: left; cursor: pointer; box-shadow: var(--theme-shadow); min-height: 112px; transition: transform .18s ease, border-color .18s ease; }
        .home-style-card:hover { transform: translateY(-2px); }
        .home-style-card.active { border-color: var(--theme-primary); outline: 3px solid color-mix(in srgb, var(--theme-primary) 18%, transparent); }
        .home-style-card strong { display: block; font-size: 17px; margin-bottom: 8px; }
        .home-style-card span { display: block; color: var(--theme-muted); font-size: 13px; line-height: 1.45; }
        .home-style-swatch { width: 100%; height: 10px; border-radius: 999px; margin-bottom: 12px; background: linear-gradient(90deg, var(--theme-primary), var(--theme-accent)); }
        .theme-selector-heading { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 14px; }
        .theme-selector-heading h3 { margin: 0; font-size: 22px; }
        .theme-selector-heading p { margin: 6px 0 0; color: var(--theme-muted); }

        /* 全站水平置中與可讀性修正 */
        .brand-card, .control-card, .layout-title, .content > section, .panel, .stat-card {
          text-align: center;
        }
        .brand-card, .control-card {
          background: var(--theme-panel) !important;
          color: var(--theme-text) !important;
          border: 1px solid var(--theme-border) !important;
        }
        .brand-card *, .control-card *, .layout-title *, .panel *, .stat-card * {
          color: inherit;
        }
        .brand-card p, .control-card label, .layout-title p, .panel p, .muted, .list-row span {
          color: var(--theme-muted) !important;
        }
        .brand-kicker, .brand-card h1, .layout-title h1, .content h1, .content h2, .content h3, .panel h3 {
          color: var(--theme-text) !important;
          text-align: center;
        }
        .control-card input, .control-card select, .control-card button,
        .toolbar input, .toolbar select, .toolbar button,
        .content input, .content select, .content textarea {
          text-align: center;
        }
        .nav-list {
          align-items: stretch;
        }
        .nav-item {
          text-align: center;
          justify-content: center;
        }
        .list-row {
          text-align: center;
          justify-content: center;
          align-items: center;
        }
        .list-row strong, .list-row span {
          width: 100%;
          text-align: center;
        }
        .panel-header {
          justify-content: center;
          text-align: center;
        }
        .panel-header > * {
          text-align: center;
        }
        .grid, .toolbar {
          justify-items: center;
        }
        .toolbar {
          justify-content: center;
        }
        .home-style-card {
          text-align: center;
        }
        .home-style-card strong, .home-style-card span {
          text-align: center;
        }

        /* 通知 Toast：強制浮在目前視窗，不佔頁面高度 */
        .app-toast {
          position: fixed !important;
          top: calc(env(safe-area-inset-top, 0px) + 14px) !important;
          left: 50% !important;
          transform: translateX(-50%) !important;
          z-index: 99999 !important;
          width: min(720px, calc(100vw - 28px)) !important;
          max-width: calc(100vw - 28px);
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          gap: 12px;
          padding: 14px 16px;
          border-radius: 18px;
          pointer-events: none;
          text-align: center;
        }
        .app-toast span {
          color: var(--theme-toast-text, #fff) !important;
          text-align: center;
          font-weight: 950;
        }
        .app-toast-close {
          pointer-events: auto !important;
          color: var(--theme-toast-text, #fff) !important;
          background: color-mix(in srgb, var(--theme-toast-text, #fff) 13%, transparent) !important;
          border: 1px solid color-mix(in srgb, var(--theme-toast-text, #fff) 28%, transparent) !important;
        }

        /* 繁體中文字型：使用系統內常見可用字族，差異比原本更明顯 */
        .app-font-system { --theme-font-family: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif; }
        .app-font-rounded { --theme-font-family: "jf open 粉圓 2.0", "Gen Jyuu Gothic", "Kosugi Maru", "Arial Rounded MT Bold", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif; }
        .app-font-serif { --theme-font-family: "Noto Serif TC", "Source Han Serif TC", "Songti TC", "PMingLiU", "MingLiU", serif; }
        .app-font-mono { --theme-font-family: "Noto Sans Mono CJK TC", "Sarasa Mono TC", "Cascadia Mono", "Consolas", "Courier New", "Noto Sans TC", monospace; }
        .app-font-hand { --theme-font-family: "BiauKai", "DFKai-SB", "KaiTi", "Kaiti TC", "Noto Serif TC", "PMingLiU", serif; }

        @media (max-width: 700px) {
          .app-toast {
            top: calc(env(safe-area-inset-top, 0px) + 10px) !important;
            width: calc(100vw - 20px) !important;
            max-width: calc(100vw - 20px);
          }
          .brand-card, .control-card, .panel {
            border-radius: 20px;
          }
        }
      `}</style>
      <div className={`app-shell app-theme-${effectiveTheme} app-font-${effectiveFont}`} translate="no">
        <aside className="sidebar">
          <div className="brand-card">
            <div className="brand-kicker">通用型檢測系統</div>
            <h1>站點資格管理</h1>
            <p>提供幹部查詢站點資格、維護考核、分析缺口與執行試排。</p>
          </div>
          <div className="control-card">
            <label>登入系統</label>
            {currentUser ? (
              <div className="logged-user">
                <strong>{currentUser.name}</strong>
                <span>{currentUser.id}｜權限 {currentRole || "-"}</span>
                <button className="ghost" type="button" onClick={logout}>登出</button>
              </div>
            ) : (
              <>
                <input placeholder="登入帳號（不分大小寫）" value={loginForm.account} onChange={(e) => setLoginForm((c) => ({ ...c, account: e.target.value }))} />
                <input type="password" placeholder="登入密碼（不分大小寫）" value={loginForm.password} onChange={(e) => setLoginForm((c) => ({ ...c, password: e.target.value }))} />
                <select value={loginKeep} onChange={(e) => updateLoginKeep(e.target.value as LoginKeepKey)} aria-label="保持登入時間">
                  {loginKeepOptions.map((item) => <option key={item.key} value={item.key}>重新整理保持登入：{item.label}</option>)}
                </select>
                <button className="primary" type="button" onClick={handleLogin}>登入</button>
              </>
            )}
          </div>
          <nav className="nav-list">
            {allowedNav.map((item) => <button key={item.key} className={page === item.key ? "nav-item active" : "nav-item"} onClick={() => navigateToPage(item.key)}>{item.label}</button>)}
          </nav>
        </aside>
        {flash ? (
          <div
            className={`app-toast ${toastStyleMode}`}
            role="status"
            aria-live="polite"
            style={{
              position: "fixed",
              top: "calc(env(safe-area-inset-top, 0px) + 14px)",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 99999,
              width: "min(720px, calc(100vw - 28px))",
              pointerEvents: "none",
            }}
          >
            <span>{flash}</span>
            <button type="button" className="app-toast-close" onClick={() => setFlash("")} aria-label="關閉通知">×</button>
          </div>
        ) : null}
        <main className="content" ref={contentRef}>
          {page === "home" ? (
            <Layout title="首頁" subtitle="全站入口、系統摘要與個人外觀設定。">
              <div className="grid three compact-home-stats">
                <StatCard title="人員總數" value={String(data.people.length)} note="人員主檔" />
                <StatCard title="站點總數" value={String(data.stations.length)} note="站點主檔" />
                <StatCard title="資格筆數" value={String(data.qualifications.length)} note="站點資格" />
              </div>

              <div className="panel intro-panel">
                <h3>系統說明</h3>
                <p>這是通用型站點資格管理系統，提供查詢人員資格、查詢站點人選、站點考核、缺口分析與站點試排。</p>
                <p>未登入只能看首頁；登入後，系統會依帳號權限顯示可用功能。</p>
              </div>

              <div className="panel">
                <div className="theme-selector-heading">
                  <div>
                    <h3>全區域樣式</h3>
                    <p>任何人都可以依自己的手機或電腦喜好選擇，全站立即套用。</p>
                  </div>
                  <span className="chip">目前：{globalThemeOptions.find((item) => item.key === globalThemeOption)?.label} / {globalFontOptions.find((item) => item.key === globalFontOption)?.label}</span>
                </div>
                <div className="home-style-grid">
                  {globalThemeOptions.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`home-style-card${globalThemeOption === item.key ? " active" : ""}`}
                      onClick={() => updateGlobalTheme(item.key)}
                    >
                      <i className="home-style-swatch" />
                      <strong>{item.label}</strong>
                      <span>{item.note}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel">
                <div className="theme-selector-heading">
                  <div>
                    <h3>字型風格</h3>
                    <p>提供 5 款字型與隨機選項，讓標題、清單與按鈕文字排列更一致。</p>
                  </div>
                </div>
                <div className="home-style-grid">
                  {globalFontOptions.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`home-style-card${globalFontOption === item.key ? " active" : ""}`}
                      onClick={() => updateGlobalFont(item.key)}
                    >
                      <i className="home-style-swatch" />
                      <strong>{item.label}</strong>
                      <span>{item.note}</span>
                    </button>
                  ))}
                </div>
              </div>
            </Layout>
          ) : null}
          {!currentRole && page !== "home" ? <Layout title="尚未登入" subtitle="請先登入後開啟對應功能。"><Empty text="請先登入。" /></Layout> : null}

          {currentRole && page === "person-query" ? (
            <Layout title="查詢人員資格" subtitle="可依班別快速篩選，只找自己班的人，右側顯示班別與出勤資料。">
              <div className="grid two">
                <div className="panel">
                  <div className="toolbar">
                    <select value={personTeamFilter} onChange={(e) => setPersonTeamFilter(e.target.value)}>
                      <option value="全部班別">全部班別</option>
                      {TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <input placeholder="輸入工號、姓名、角色、國籍" value={personKeyword} onChange={(e) => setPersonKeyword(e.target.value)} />
                  </div>
                  <div className="list-scroll">
                    {filteredPeople.map((person) => (
                      <button key={person.id} className={selectedEmployee?.id === person.id ? "list-row active" : "list-row"} onClick={() => { setSelectedEmployeeId(person.id); openMobileOrScroll({ type: "person", personId: person.id }, personDetailRef.current); }}>
                        <strong>{person.name}</strong>
                        <span>{person.id}｜{String(getTeamOfPerson(person))}｜{person.role}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="panel" ref={personDetailRef}>
                  {selectedEmployee ? <PersonDetailView person={selectedEmployee} qualifications={selectedEmployeeQualifications} /> : <Empty text="此班別目前沒有可顯示人員。" />}
                </div>
              </div>
            </Layout>
          ) : null}

          {currentRole && page === "station-query" ? (
            <Layout title="查詢站點人選" subtitle="新增班別選項與日別選項，可快速檢視當班與對班支援人力。">
              <div className="grid two">
                <div className="panel">
                  <div className="toolbar">
                    <select value={stationTeamFilter} onChange={(e) => setStationTeamFilter(e.target.value as TeamName)}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select>
                    <select value={stationDayFilter} onChange={(e) => setStationDayFilter(e.target.value as ShiftMode)}>{dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select>
                    <input placeholder="搜尋站點" value={stationKeyword} onChange={(e) => setStationKeyword(e.target.value)} />
                  </div>
                  <div className="list-scroll">
                    {filteredStations.map((station) => (
                      <button key={station.id} className={selectedStation?.id === station.id ? "list-row active" : "list-row"} onClick={() => { setSelectedStationId(station.id); openMobileOrScroll({ type: "station", stationId: station.id }, stationDetailRef.current); }}>
                        <strong>{station.name}</strong>
                        <span>{station.id}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="panel" ref={stationDetailRef}>
                  {selectedStation ? <StationDetailView station={selectedStation} team={stationTeamFilter} day={stationDayFilter} attendance={stationAttendance} qualifications={selectedStationQualifications} people={data.people} /> : <Empty text="找不到符合條件的站點。" />}
                </div>
              </div>
            </Layout>
          ) : null}

          {currentRole && page === "qualification-review" && hasAccess("領班") ? (
            <Layout title="站點考核" subtitle="(A)/(B)為班別，第一天/第二天為出勤；切換班別時清空輸入框並顯示該班人員。">
              <div className="grid two">
                <div className="panel">
                  <div className="toolbar">
                    <select value={reviewShift} onChange={(e) => setReviewShift(e.target.value as (typeof REVIEW_TEAM_OPTIONS)[number])}>{REVIEW_TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select>
                    <input placeholder="輸入工號或姓名" value={reviewKeyword} onChange={(e) => setReviewKeyword(e.target.value)} />
                  </div>
                  <div className="list-scroll">
                    {reviewPeople.map((person) => (
                      <button key={person.id} className={reviewSelectedPerson?.id === person.id ? "list-row active" : "list-row"} onClick={() => { setReviewEmployeeId(person.id); openMobileOrScroll({ type: "review", personId: person.id }, reviewDetailRef.current); }}>
                        <strong>{person.name}</strong>
                        <span>{person.id}｜{String(getTeamOfPerson(person))}｜{person.role}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="panel" ref={reviewDetailRef}>
                  {reviewSelectedPerson ? (
                    <ReviewDetailView
                      person={reviewSelectedPerson}
                      permission={String(getSystemPermission(reviewSelectedPerson) || "-")}
                      qualifications={reviewSelectedQualifications}
                      stationId={reviewStationId}
                      reviewStatus={reviewStatus}
                      setStationId={setReviewStationId}
                      setReviewStatus={setReviewStatus}
                      stations={data.stations}
                      onSave={() => handleSaveQualification()}
                      onDelete={handleDeleteQualification}
                    />
                  ) : <Empty text="請先選取人員。" />}
                </div>
              </div>
              <div className="panel">
                <h3>班別人員總攬</h3>
                <table className="table"><thead><tr><th>工號</th><th>姓名</th><th>職務</th><th>系統權限</th><th>國籍</th><th>合格</th><th>訓練中</th><th>不可排</th></tr></thead><tbody>{reviewOverviewRows.map((row) => <tr key={row.id}><td>{row.id}</td><td>{row.name}</td><td>{row.role}</td><td>{String(getSystemPermission(data.people.find((p) => p.id === row.id) || null) || "-")}</td><td>{row.nationality}</td><td>{row.qualified}</td><td>{row.training}</td><td>{row.blocked}</td></tr>)}</tbody></table>
              </div>
            </Layout>
          ) : null}

          {currentRole && page === "gap-analysis" && hasAccess("組長") ? <Layout title="站點缺口分析" subtitle="切換班別與日別時即時刷新，出勤人力與該班規則會重新計算。"><div className="panel"><div className="toolbar"><select value={gapShift} onChange={(e) => setGapShift(e.target.value as TeamName)}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={gapDay} onChange={(e) => setGapDay(e.target.value as ShiftMode)}>{dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><div className="detail-grid"><Info label="本籍出勤" value={String(gapAttendance.localCount)} /><Info label="菲籍出勤" value={String(gapAttendance.filipinoCount)} /><Info label="越籍出勤" value={String(gapAttendance.vietnamCount)} /><Info label="總出勤" value={String(gapAttendance.totalCount)} /><Info label={gapDay === "當班" ? "本班人力" : "本班出勤"} value={String(gapAttendance.own.length)} /><Info label="支援人力" value={String(gapAttendance.support.length)} /><Info label="支援對班" value={gapDay === "當班" ? "-" : gapAttendance.supportTeam} /></div>{gapRules.length ? <table className="table"><thead><tr><th>站點</th><th>最低需求</th><th>本班合格</th><th>支援合格</th><th>總合格</th><th>訓練中</th><th>不可排</th><th>缺口</th><th>支援可補</th></tr></thead><tbody>{gapRules.map((rule) => { const station = data.stations.find((item) => item.id === rule.stationId); const coverage = getStationCoverage(rule.stationId, rule.minRequired, gapAttendance.all, gapAttendance.support, data.qualifications); const supportNames = coverage.supportQualifiedIds.map((id) => `${data.people.find((p) => p.id === id)?.name || id}（${gapAttendance.supportTeam}）`); return <tr key={`${rule.team}-${rule.stationId}`}><td>{station?.name || rule.stationId}</td><td>{rule.minRequired}</td><td>{coverage.ownQualified}</td><td>{coverage.supportQualified}</td><td>{coverage.qualified}</td><td>{coverage.training}</td><td>{coverage.blocked}</td><td>{coverage.shortage}</td><td>{supportNames.join("、") || "-"}</td></tr>; })}</tbody></table> : <Empty text="找不到此班別的正式站點規則，無法進行缺口分析。" />}</div></Layout> : null}
          {currentRole && page === "manual-schedule" && hasAccess("組長") ? (
            <Layout title="站點試排" subtitle="正式 React 版站點試排：一鍵安排、模式、分區、顏色、重複更換、自訂人選與分享。">
              <div translate="no">
              <style>{`
                .app-toast { position: fixed; top: calc(env(safe-area-inset-top, 0px) + 14px); left: 50%; transform: translateX(-50%); z-index: 9999; width: min(720px, calc(100vw - 28px)); display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 18px; background: rgba(15, 23, 42, .94); color: #fff; border: 1px solid rgba(148, 163, 184, .45); box-shadow: 0 16px 40px rgba(15, 23, 42, .22); backdrop-filter: blur(12px); pointer-events: none; animation: toastSlideIn .22s ease-out; }
                .app-toast.banner { top: calc(env(safe-area-inset-top, 0px) + 8px); width: min(920px, calc(100vw - 16px)); border-radius: 14px; }
                .app-toast span { font-weight: 900; font-size: 16px; line-height: 1.35; }
                .app-toast-close { pointer-events: auto; border: 0; width: 32px; height: 32px; border-radius: 999px; background: rgba(255,255,255,.14); color: #fff; font-size: 24px; line-height: 1; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
                .app-toast-close:hover { background: rgba(255,255,255,.24); }
                @keyframes toastSlideIn { from { opacity: 0; transform: translate(-50%, -12px); } to { opacity: 1; transform: translate(-50%, 0); } }
                @media (max-width: 700px) { .app-toast { top: calc(env(safe-area-inset-top, 0px) + 10px); width: calc(100vw - 20px); padding: 12px 14px; border-radius: 16px; } .app-toast span { font-size: 15px; } }
                .manual-schedule-station .manual-schedule-group { margin-top: 18px; }
                .manual-schedule-station .manual-schedule-group h4 { margin: 0 0 10px; font-size: 22px; font-weight: 950; color: #06142f; }
                .manual-schedule-list { display: flex; flex-wrap: wrap; gap: 10px; max-height: none; overflow: visible; }
                .manual-schedule-list .list-row { width: auto; min-width: 88px; min-height: 48px; justify-content: center; touch-action: manipulation; }
                .manual-schedule-list .list-row.active { background: #2563eb; color: #fff; border-color: #2563eb; }
                .manual-schedule-list .list-row.active strong, .manual-schedule-list .list-row.active span { color: #fff; }
                .manual-schedule-list .list-row.conflict { background: #fee2e2; color: #991b1b; border-color: #ef4444; }
                .manual-officer-board { display: grid; gap: 14px; }
                .manual-officer-row { display: grid; grid-template-columns: 88px 1fr; gap: 12px; align-items: start; }
                .manual-officer-title { font-size: 22px; font-weight: 950; color: #0f172a; padding-top: 9px; }
                .manual-officer-list { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
                .manual-officer-list.station-leader-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; align-items: stretch; width: 100%; }
                .manual-officer-chip { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; min-width: 76px; padding: 8px 16px; border-radius: 999px; border: 1px solid #bfdbfe; background: #eff6ff; color: #1d4ed8; font-size: 18px; font-weight: 900; white-space: nowrap; }
                .manual-officer-chip.station-leader { background: #dcfce7; border-color: #22c55e; color: #166534; box-shadow: 0 2px 10px rgba(34, 197, 94, .16); }
                .manual-officer-station { display: inline-flex; align-items: center; gap: 8px; padding: 6px; border-radius: 18px; background: #f8fafc; border: 1px solid #e2e8f0; }
                .manual-officer-station.leader-card { display: flex; flex-direction: column; align-items: stretch; gap: 6px; min-width: 0; padding: 8px; border-radius: 18px; background: linear-gradient(180deg, #f8fffb 0%, #eefdf3 100%); border-color: #bbf7d0; }
                .manual-officer-station select { width: auto; min-width: 126px; min-height: 42px; border-radius: 14px; padding: 6px 10px; font-size: 16px; }
                .manual-officer-station.leader-card select { width: 100%; min-width: 0; min-height: 40px; font-size: 15px; font-weight: 850; background: #ffffff; border-color: #bbf7d0; }
                .manual-officer-station.leader-card .manual-officer-chip { width: 100%; min-width: 0; box-sizing: border-box; min-height: 38px; padding: 6px 8px; font-size: 17px; }
                .manual-officer-note { margin: 10px 0 0; color: #64748b; font-weight: 800; line-height: 1.6; }
                .manual-extra-work-panel { border: 1px dashed #93c5fd; background: linear-gradient(180deg, #f8fbff 0%, #eef6ff 100%); }
                .manual-extra-work-panel.compact { padding: 14px; }
                .manual-extra-compact-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
                .manual-extra-compact-header h3 { margin: 0 0 4px; font-size: 22px; color: #0f172a; }
                .manual-extra-compact-header p { margin: 0; color: #64748b; font-size: 14px; font-weight: 850; line-height: 1.5; }
                .manual-extra-pill-row { display: flex; flex-wrap: wrap; gap: 10px; }
                .manual-extra-pill { display: inline-grid; grid-template-columns: auto 1fr; grid-template-areas: "label title" "count people"; align-items: center; column-gap: 8px; row-gap: 2px; width: min(100%, 330px); min-height: 58px; border: 1px solid #bfdbfe; border-radius: 999px; padding: 8px 14px; background: #ffffff; color: #0f172a; box-shadow: 0 8px 22px rgba(37, 99, 235, .08); cursor: pointer; text-align: left; }
                .manual-extra-pill:hover { border-color: #60a5fa; transform: translateY(-1px); }
                .manual-extra-pill .slot-label { grid-area: label; display: inline-flex; align-items: center; justify-content: center; min-width: 34px; height: 34px; border-radius: 999px; background: #dbeafe; color: #1d4ed8; font-size: 13px; font-weight: 950; }
                .manual-extra-pill strong { grid-area: title; display: block; font-size: 16px; font-weight: 950; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .manual-extra-pill em { grid-area: people; display: block; color: #64748b; font-size: 13px; font-style: normal; font-weight: 850; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .manual-extra-pill .slot-count { grid-area: count; color: #2563eb; font-size: 12px; font-weight: 950; text-align: center; }
                .manual-extra-pill.is-filled { background: linear-gradient(135deg, #eff6ff 0%, #ffffff 100%); border-color: #60a5fa; }
                .manual-extra-pill.is-empty strong { color: #64748b; }
                .manual-extra-note { color: #64748b; font-weight: 800; line-height: 1.6; margin: 10px 0 0; }
                .manual-extra-dialog-field { display: grid; gap: 7px; margin: 12px 0; color: #475569; font-weight: 950; }
                .manual-extra-dialog-field input { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 16px; min-height: 48px; padding: 10px 13px; font-size: 17px; background: #fff; }
                .manual-extra-selected { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 12px; }
                .manual-extra-selected button { border: 0; border-radius: 999px; padding: 8px 12px; background: #dbeafe; color: #1d4ed8; font-weight: 950; cursor: pointer; }
                .manual-extra-selected button:hover { background: #bfdbfe; }
                .manual-floating-tip-react { position: fixed; right: 18px; bottom: 18px; z-index: 260; border-radius: 18px; background: #0ea5e9; color: #fff; padding: 16px; box-shadow: 0 18px 48px rgba(2, 132, 199, .28); font-size: 20px; font-weight: 950; text-align: center; min-width: 128px; }
                .manual-floating-tip-react button { display: block; width: 100%; margin-top: 10px; border: 0; border-radius: 14px; background: #fff; color: #075985; padding: 10px 16px; font-weight: 950; cursor: pointer; }
                .manual-modal-backdrop { position: fixed; inset: 0; z-index: 500; display: grid; place-items: center; padding: 18px; background: rgba(15, 23, 42, .44); }
                .manual-modal-backdrop-top { z-index: 900 !important; background: rgba(15, 23, 42, .58); }
                .manual-modal-backdrop-top .manual-modal { box-shadow: 0 30px 80px rgba(15, 23, 42, .42); }
                .manual-modal { width: min(460px, 100%); max-height: 86vh; overflow: auto; border-radius: 20px; background: #fff; padding: 18px; box-shadow: 0 22px 60px rgba(15, 23, 42, .3); color: #0f172a; overscroll-behavior: contain; }
                .manual-modal h3 { position: sticky; top: -18px; z-index: 3; margin: -18px -18px 12px; padding: 18px 18px 12px; font-size: 22px; font-weight: 950; background: #fff; border-bottom: 1px solid rgba(226, 232, 240, .85); }
                .manual-modal-title-row { position: sticky; top: -18px; z-index: 8; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: -18px -18px 12px; padding: 16px 16px 12px 18px; background: #fff; border-bottom: 1px solid rgba(226, 232, 240, .9); }
                .manual-modal-title-row h3 { position: static; margin: 0; padding: 0; border: 0; font-size: 22px; font-weight: 950; background: transparent; }
                .manual-modal-close-button { width: 44px; height: 44px; flex: 0 0 auto; border: 0; border-radius: 999px; background: #e2e8f0; color: #0f172a; font-size: 26px; line-height: 1; font-weight: 950; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; touch-action: manipulation; }
                .manual-modal-close-button:active { transform: scale(.96); }
                .manual-modal p { line-height: 1.7; color: #334155; font-weight: 800; }
                .manual-modal input { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 14px; padding: 13px 14px; font-size: 18px; }
                .manual-modal-actions { position: sticky; bottom: -18px; z-index: 4; display: flex; justify-content: flex-end; gap: 10px; margin: 16px -18px -18px; padding: 14px 18px 18px; background: rgba(255,255,255,.96); border-top: 1px solid rgba(226, 232, 240, .95); box-shadow: 0 -12px 28px rgba(15, 23, 42, .08); backdrop-filter: blur(10px); }
                .manual-modal-actions button, .manual-custom-result button { border: 0; border-radius: 14px; padding: 11px 15px; font-weight: 950; cursor: pointer; }
                .manual-modal-actions .primary, .manual-custom-result button { background: #2563eb; color: #fff; }
                .manual-modal-actions .ghost { background: #e2e8f0; color: #0f172a; }
                .manual-custom-result button.ghost { background: #e2e8f0; color: #0f172a; }
                .manual-custom-results { display: grid; gap: 8px; margin-top: 12px; }
                .manual-custom-result { display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid #e2e8f0; border-radius: 14px; padding: 10px; background: #f8fafc; }
                .manual-preview-modal { width: min(720px, 100%); }
                .manual-preview-title-row { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
                .manual-preview-title-row h3 { position: static; margin: 0; padding: 0; border: 0; font-size: 24px; }
                .manual-preview-close { border: 0; border-radius: 999px; width: 38px; height: 38px; background: #e2e8f0; color: #0f172a; font-size: 22px; font-weight: 950; cursor: pointer; }
                .manual-preview-tabs { display: flex; gap: 8px; overflow-x: auto; padding: 2px 0 12px; margin-bottom: 8px; }
                .manual-preview-tabs button { flex: 0 0 auto; border: 1px solid #cbd5e1; border-radius: 999px; background: #fff; color: #334155; padding: 10px 14px; font-weight: 950; cursor: pointer; }
                .manual-preview-tabs button.active { background: #2563eb; border-color: #2563eb; color: #fff; }
                .schedule-paper { border-radius: 24px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; }
                .schedule-paper h4 { margin: 0 0 10px; font-size: 26px; font-weight: 950; color: #0f172a; }
                .schedule-officers { display: grid; gap: 6px; margin: 0 0 16px; padding: 12px; border-radius: 18px; background: #fff; border: 1px solid #e2e8f0; }
                .schedule-officers div { font-size: 17px; font-weight: 900; color: #1e293b; line-height: 1.5; }
                .schedule-card-list { display: grid; gap: 10px; }
                .schedule-card-row { border-radius: 18px; background: #fff; border: 1px solid #e2e8f0; padding: 13px 14px; }
                .schedule-card-row strong { display: block; margin-bottom: 8px; color: #0f172a; font-size: 18px; font-weight: 950; }
                .schedule-name-line { color: #334155; font-size: 16px; font-weight: 850; line-height: 1.65; }
                .schedule-name-tags { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
                .schedule-person-tag { display: inline-flex; align-items: center; min-height: 28px; border-radius: 999px; padding: 3px 10px; background: #f1f5f9; border: 1px solid #e2e8f0; color: #334155; font-size: 15px; font-weight: 900; line-height: 1.35; }
                .schedule-person-tag.officer { background: #dcfce7; border-color: #22c55e; color: #166534; box-shadow: 0 2px 8px rgba(34, 197, 94, .14); }
                .schedule-empty-name { color: #94a3b8; font-weight: 900; }
                .schedule-table-preview .schedule-name-tags { gap: 6px; }
                .schedule-table-preview .schedule-person-tag { font-size: 14px; min-height: 26px; }
                .schedule-poster-card .schedule-person-tag { background: rgba(255,255,255,.14); border-color: rgba(255,255,255,.24); color: #dbeafe; }
                .schedule-poster-card .schedule-person-tag.officer { background: rgba(34,197,94,.22); border-color: #4ade80; color: #dcfce7; }
                .schedule-share-card .schedule-person-tag.officer { background: #dcfce7; border-color: #22c55e; color: #166534; }
                .schedule-table-preview { width: 100%; border-collapse: separate; border-spacing: 0 8px; }
                .schedule-table-preview th { text-align: left; padding: 10px 12px; color: #fff; background: #243b53; font-size: 14px; }
                .schedule-table-preview th:first-child { border-radius: 14px 0 0 14px; }
                .schedule-table-preview th:last-child { border-radius: 0 14px 14px 0; }
                .schedule-table-preview td { padding: 12px; background: #fff; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; font-weight: 850; }
                .schedule-table-preview td:first-child { border-left: 1px solid #e2e8f0; border-radius: 14px 0 0 14px; color: #0f172a; white-space: nowrap; }
                .schedule-table-preview td:last-child { border-right: 1px solid #e2e8f0; border-radius: 0 14px 14px 0; color: #334155; }
                .schedule-share-card { position: relative; overflow: hidden; background: linear-gradient(160deg, #fff7ed 0%, #fef3f2 46%, #eefdf5 100%); border-color: #fed7aa; padding: 20px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.72); }
                .schedule-share-card::before { content: "✦"; position: absolute; top: 12px; right: 20px; color: #f59e0b; font-size: 28px; opacity: .75; }
                .schedule-share-card::after { content: "♡"; position: absolute; bottom: 16px; right: 28px; color: #fb7185; font-size: 34px; opacity: .5; }
                .schedule-share-card .schedule-officers { background: rgba(255,255,255,.78); border-color: rgba(251, 146, 60, .25); }
                .schedule-share-card .schedule-card-list { gap: 12px; }
                .schedule-share-card .schedule-card-row { border: 0; background: rgba(255,255,255,.82); box-shadow: 0 10px 24px rgba(180, 83, 9, .10); transform: rotate(-.25deg); }
                .schedule-share-card .schedule-card-row:nth-child(even) { transform: rotate(.25deg); background: rgba(255, 251, 235, .9); }
                .schedule-poster-card { background: linear-gradient(160deg, #172033 0%, #263b54 100%); border-color: rgba(255,255,255,.18); color: #fff; padding: 20px; }
                .schedule-poster-card h4 { color: #fff; letter-spacing: .04em; }
                .schedule-poster-card .schedule-officers { background: rgba(255,255,255,.10); border-color: rgba(255,255,255,.18); }
                .schedule-poster-card .schedule-officers div { color: #e2e8f0; }
                .schedule-poster-list { display: grid; gap: 10px; margin-top: 14px; }
                .schedule-poster-row { display: grid; grid-template-columns: minmax(90px, .36fr) 1fr; gap: 12px; align-items: start; padding: 13px 14px; border-radius: 18px; background: rgba(255,255,255,.10); border: 1px solid rgba(255,255,255,.16); }
                .schedule-poster-row strong { color: #fff; font-size: 17px; font-weight: 950; }
                .schedule-poster-row span { color: #dbeafe; font-size: 16px; font-weight: 850; line-height: 1.6; }
                .schedule-matrix-paper { background: #f8fafc; border-color: #cbd5e1; padding: 12px; }
                .schedule-matrix-scroll { overflow-x: auto; border-radius: 18px; border: 1px solid #94a3b8; background: #fff; }
                .schedule-matrix-table { border-collapse: collapse; min-width: 1080px; width: max-content; table-layout: fixed; }
                .schedule-matrix-table th, .schedule-matrix-table td { border: 1px solid #94a3b8; vertical-align: top; }
                .schedule-matrix-meta { width: 260px; min-width: 260px; background: linear-gradient(180deg, #fef08a 0%, #dcfce7 100%); padding: 14px; text-align: left; }
                .schedule-matrix-team { color: #b91c1c; font-size: 28px; font-weight: 950; margin-bottom: 12px; }
                .schedule-matrix-officers { display: grid; gap: 8px; color: #0f172a; font-size: 17px; font-weight: 950; line-height: 1.45; }
                .schedule-matrix-station { width: 126px; min-width: 126px; height: 132px; padding: 8px; background: #bfdbfe; color: #0f172a; text-align: center; }
                .schedule-matrix-table th:nth-child(4n+2) { background: #bfdbfe; }
                .schedule-matrix-table th:nth-child(4n+3) { background: #d9f99d; }
                .schedule-matrix-table th:nth-child(4n+4) { background: #fde68a; }
                .schedule-matrix-table th:nth-child(4n+5) { background: #bae6fd; }
                .schedule-matrix-station-name { display: block; font-size: 18px; font-weight: 950; line-height: 1.25; word-break: keep-all; }
                .schedule-matrix-station-code { display: block; margin-top: 8px; font-size: 17px; font-weight: 950; color: #1e3a8a; }
                .schedule-matrix-row-label { width: 260px; min-width: 260px; background: #f1f5f9; color: #475569; font-size: 15px; font-weight: 950; text-align: center; padding: 8px; }
                .schedule-matrix-person-cell { width: 126px; min-width: 126px; height: 42px; padding: 5px; background: #fff; text-align: center; }
                .schedule-matrix-table tr:nth-child(even) .schedule-matrix-person-cell { background: #f8fafc; }
                .schedule-matrix-person-chip { display: inline-flex; align-items: center; justify-content: center; min-width: 72px; max-width: 112px; min-height: 28px; border-radius: 10px; padding: 2px 8px; background: #f1f5f9; border: 1px solid #cbd5e1; color: #334155; font-size: 15px; font-weight: 950; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .schedule-matrix-person-chip.officer { background: #bbf7d0; border-color: #16a34a; color: #166534; box-shadow: 0 2px 8px rgba(22, 163, 74, .15); }
                .schedule-matrix-note { margin: 10px 4px 0; color: #64748b; font-weight: 850; font-size: 13px; }
                .mobile-modal-header { position: sticky; top: 0; z-index: 5; background: #fff; border-bottom: 1px solid rgba(226, 232, 240, .95); }
                .mobile-modal-close { position: sticky; top: 8px; z-index: 6; }
                .mobile-modal-fab-close { position: sticky; bottom: 14px; z-index: 6; }
                @media (max-width: 900px) {
                  .manual-floating-tip-react { right: 10px; bottom: 12px; font-size: 18px; }
                  .manual-schedule-station .manual-schedule-group h4 { font-size: 20px; }
                  .manual-officer-row { grid-template-columns: 1fr; gap: 6px; }
                  .manual-officer-title { font-size: 20px; padding-top: 0; }
                  .manual-officer-chip { min-height: 46px; font-size: 17px; }
                  .manual-officer-list.station-leader-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
                  .manual-officer-station { width: 100%; justify-content: space-between; box-sizing: border-box; }
                  .manual-officer-station:not(.leader-card) select { flex: 1; min-width: 0; }
                  .manual-officer-station.leader-card { width: 100%; box-sizing: border-box; padding: 6px; border-radius: 16px; }
                  .manual-officer-station.leader-card select { min-height: 38px; padding: 5px 7px; font-size: 13px; }
                  .manual-officer-station.leader-card .manual-officer-chip { min-height: 34px; padding: 5px 6px; font-size: 14px; }
                  .manual-extra-compact-header { display: block; }
                  .manual-extra-pill { width: 100%; border-radius: 22px; }
                  .manual-modal { width: calc(100vw - 24px); max-height: 84dvh; padding: 16px; }
                  .manual-modal h3 { top: -16px; margin: -16px -16px 12px; padding: 16px 16px 12px; }
                  .manual-modal-title-row { top: -16px; margin: -16px -16px 12px; padding: 14px 14px 10px 16px; }
                  .manual-modal-close-button { width: 42px; height: 42px; font-size: 25px; }
                  .manual-modal-actions { bottom: -16px; margin: 16px -16px -16px; padding: 12px 16px calc(16px + env(safe-area-inset-bottom)); flex-direction: column-reverse; }
                  .manual-modal-actions button { width: 100%; min-height: 52px; font-size: 17px; }
                  .manual-preview-modal { max-height: 88dvh; }
                  .manual-preview-title-row h3 { font-size: 22px; }
                  .schedule-paper { padding: 12px; border-radius: 20px; }
                  .schedule-paper h4 { font-size: 24px; }
                  .schedule-poster-row { grid-template-columns: 1fr; gap: 4px; }
                  .schedule-table-preview { min-width: 520px; }
                  .schedule-table-wrap { overflow-x: auto; }
                  .schedule-matrix-table { min-width: 1040px; }
                  .schedule-matrix-meta, .schedule-matrix-row-label { width: 230px; min-width: 230px; }
                }
              `}</style>

              <div className="panel">
                <div className="toolbar">
                  <select value={manualShift} onChange={(e) => handleManualShiftChange(e.target.value as TeamName)}>
                    {TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <select value={manualDay} onChange={(e) => handleManualDayChange(e.target.value as ShiftMode)}>
                    {dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <select value={manualMode} onChange={(e) => handleManualModeChange(e.target.value as SmartScheduleMode)}>
                    {SMART_MODE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <button className="primary" type="button" onClick={runManualPlan}>一鍵安排</button>
                </div>
                <div className="detail-grid">
                  <Info label="本籍出勤" value={String(manualAttendance.localCount)} />
                  <Info label="菲籍出勤" value={String(manualAttendance.filipinoCount)} />
                  <Info label="越籍出勤" value={String(manualAttendance.vietnamCount)} />
                  <Info label="總出勤" value={String(manualAttendance.totalCount)} />
                  <Info label={manualDay === "當班" ? "本班人力" : "本班出勤"} value={String(manualAttendance.own.length)} />
                  <Info label="支援人力" value={String(manualAttendance.support.length)} />
                  <Info label="支援對班" value={manualDay === "當班" ? "-" : manualAttendance.supportTeam} />
                </div>
              </div>

              <div className="panel manual-officer-panel">
                <h3>幹部站位</h3>
                <div className="manual-officer-board">
                  {officerRoleOrder.map((role) => {
                    const people = manualOfficerDisplayGroups[role];
                    return (
                      <div className="manual-officer-row" key={role}>
                        <div className="manual-officer-title">{role}</div>
                        <div className={`manual-officer-list${role === "站長" ? " station-leader-grid" : ""}`}>
                          {people.length ? people.map((person) => role === "站長" ? (
                            <label className="manual-officer-station leader-card" key={person.id}>
                              <select
                                aria-label={`${person.name} 站長站點`}
                                value={manualOfficerStations[person.id] || ""}
                                onChange={(event) => setManualOfficerStations((current) => ({ ...current, [person.id]: event.target.value }))}
                              >
                                <option value="">站點選單</option>
                                {manualRules.map((rule) => {
                                  const station = data.stations.find((item) => item.id === rule.stationId);
                                  return <option key={rule.stationId} value={rule.stationId}>{station?.name || rule.stationId}</option>;
                                })}
                              </select>
                              <span className={`manual-officer-chip${manualOfficerStations[person.id] ? " station-leader" : ""}`}>{person.name}</span>
                            </label>
                          ) : (
                            <span className="manual-officer-chip" key={person.id}>{person.name}</span>
                          )) : <span className="muted">-</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="manual-officer-note">幹部站位會先保留出勤人力；主任僅顯示姓名，不列入待排人力計算。</p>
              </div>

              <div className="panel manual-extra-work-panel compact">
                <div className="manual-extra-compact-header">
                  <div>
                    <h3>自訂工作</h3>
                    <p>提供 2 個臨時欄位；需要時點一下小標籤設定工作與人員，只會進入本次班表與圖片。</p>
                  </div>
                </div>
                <div className="manual-extra-pill-row">
                  {manualExtraWorks.map((extra, index) => {
                    const selectedPeople = extra.personIds.map((id) => data.people.find((person) => person.id === id)).filter(Boolean) as Person[];
                    const title = extra.workName.trim() || `自訂工作 ${index + 1}`;
                    const isFilled = Boolean(extra.workName.trim() || selectedPeople.length);
                    return (
                      <button
                        type="button"
                        className={`manual-extra-pill ${isFilled ? "is-filled" : "is-empty"}`}
                        key={extra.id}
                        onClick={() => openManualExtraDialog(extra.id)}
                      >
                        <span className="slot-label">{index + 1}</span>
                        <strong>{title}</strong>
                        <span className="slot-count">{selectedPeople.length} 人</span>
                        <em>{selectedPeople.length ? selectedPeople.map((person) => person.name).join("、") : "點一下設定內容"}</em>
                      </button>
                    );
                  })}
                </div>
              </div>

              {manualRules.length ? (
                <div className="grid two">
                  {manualRules.map((rule) => {
                    const station = data.stations.find((item) => item.id === rule.stationId);
                    const selectedIds = manualAssignments[rule.stationId] || [];
                    const assignableAttendance = manualAttendance.all.filter((person) => !manualOfficerIds.has(person.id));
                    const candidates = getQualifiedPeopleForStation(rule.stationId, assignableAttendance, data.qualifications)
                      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true }));
                    const assignedPeople = candidates.filter((person) => selectedIds.includes(person.id));
                    const pendingPeople = candidates.filter((person) => !selectedIds.includes(person.id));

                    return (
                      <div className="panel manual-schedule-station" key={rule.stationId}>
                        <div className="panel-header">
                          <h3>{station?.name || rule.stationId}</h3>
                          <span>需求 {rule.minRequired}</span>
                        </div>

                        <div className="toolbar">
                          <button type="button" className="ghost" onClick={() => { setManualCustomDialog({ stationId: rule.stationId }); setManualCustomKeyword(""); }}>自訂人選</button>
                        </div>

                        <div className="manual-schedule-group">
                          <h4>已安排</h4>
                          <div className="list-scroll short manual-schedule-list">
                            {assignedPeople.length ? assignedPeople.map((person) => (
                              <button
                                key={person.id}
                                type="button"
                                className="list-row active"
                                onClick={() => toggleManualAssignment(rule.stationId, person.id)}
                              >
                                <strong>{person.name}</strong>
                              </button>
                            )) : <span className="muted">-</span>}
                          </div>
                        </div>

                        <div className="manual-schedule-group">
                          <h4>尚未安排</h4>
                          <div className="list-scroll short manual-schedule-list">
                            {pendingPeople.map((person) => {
                              const assignedStationId = findAssignedStation(manualAssignments, person.id);
                              const isConflict = Boolean(assignedStationId && assignedStationId !== rule.stationId);
                              return (
                                <button
                                  key={person.id}
                                  type="button"
                                  className={`list-row ${isConflict ? "conflict" : ""}`}
                                  onClick={() => toggleManualAssignment(rule.stationId, person.id)}
                                >
                                  <strong>{person.name}</strong>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <Empty text="找不到此班別的正式站點規則，無法進行站點試排。" />}

              {manualEffectiveAssigned > 0 ? (
                <div className="manual-floating-tip-react">
                  <div>已排:{manualEffectiveAssigned}</div>
                  <div>待排:{manualPendingCount}</div>
                  <button type="button" onClick={completeManualSchedule}>安排完成</button>
                  <button type="button" onClick={() => scrollToTop()}>回到頂部</button>
                </div>
              ) : null}

              {manualPreviewOpen ? (
                <div className="manual-modal-backdrop manual-modal-backdrop-top" role="dialog" aria-modal="true" translate="no">
                  <div className="manual-modal manual-preview-modal">
                    <div className="manual-preview-title-row">
                      <div>
                        <h3>班表預覽</h3>
                        <p>可切換樣式；班表只顯示班別、幹部、站點名稱與人名，站點英文名會以括號標示。</p>
                      </div>
                      <button type="button" className="manual-preview-close" aria-label="關閉班表預覽" onClick={() => setManualPreviewOpen(false)}>×</button>
                    </div>
                    <div className="manual-preview-tabs">
                      {schedulePreviewStyleOptions.map((item) => (
                        <button key={item.key} type="button" className={manualPreviewStyle === item.key ? "active" : ""} onClick={() => setManualPreviewStyle(item.key)}>{item.label}</button>
                      ))}
                    </div>

                    {manualPreviewStyle === "card" ? (
                      <div className="schedule-paper">
                        <h4>{manualSchedulePreview.team}</h4>
                        <div className="schedule-officers">
                          <div>主任　{manualSchedulePreview.officers.主任.join("、") || "-"}</div>
                          <div>組長　{manualSchedulePreview.officers.組長.join("、") || "-"}</div>
                          <div>領班　{manualSchedulePreview.officers.領班.join("、") || "-"}</div>
                        </div>
                        <div className="schedule-card-list">
                          {manualSchedulePreview.rows.map((row) => (
                            <div className="schedule-card-row" key={row.stationId}>
                              <strong>{row.stationName}</strong>
                              <div className="schedule-name-line">{renderSchedulePreviewPeople(row.people)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {manualPreviewStyle === "table" ? (
                      <div className="schedule-paper">
                        <h4>{manualSchedulePreview.team}</h4>
                        <div className="schedule-officers">
                          <div>主任　{manualSchedulePreview.officers.主任.join("、") || "-"}</div>
                          <div>組長　{manualSchedulePreview.officers.組長.join("、") || "-"}</div>
                          <div>領班　{manualSchedulePreview.officers.領班.join("、") || "-"}</div>
                        </div>
                        <div className="schedule-table-wrap">
                          <table className="schedule-table-preview">
                            <thead><tr><th>站點</th><th>人員</th></tr></thead>
                            <tbody>
                              {manualSchedulePreview.rows.map((row) => (
                                <tr key={row.stationId}><td>{row.stationName}</td><td>{renderSchedulePreviewPeople(row.people)}</td></tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : null}

                    {manualPreviewStyle === "share" ? (
                      <div className="schedule-paper schedule-share-card">
                        <h4>{manualSchedulePreview.team}</h4>
                        <div className="schedule-officers">
                          <div>主任　{manualSchedulePreview.officers.主任.join("、") || "-"}</div>
                          <div>組長　{manualSchedulePreview.officers.組長.join("、") || "-"}</div>
                          <div>領班　{manualSchedulePreview.officers.領班.join("、") || "-"}</div>
                        </div>
                        <div className="schedule-card-list">
                          {manualSchedulePreview.rows.map((row) => (
                            <div className="schedule-card-row" key={row.stationId}>
                              <strong>{row.stationName}</strong>
                              <div className="schedule-name-line">{renderSchedulePreviewPeople(row.people, "space")}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {manualPreviewStyle === "section" ? (
                      <div className="schedule-paper schedule-poster-card">
                        <h4>{manualSchedulePreview.team} 班表</h4>
                        <div className="schedule-officers">
                          <div>主任　{manualSchedulePreview.officers.主任.join("、") || "-"}</div>
                          <div>組長　{manualSchedulePreview.officers.組長.join("、") || "-"}</div>
                          <div>領班　{manualSchedulePreview.officers.領班.join("、") || "-"}</div>
                        </div>
                        <div className="schedule-poster-list">
                          {manualSchedulePreview.rows.map((row) => (
                            <div className="schedule-poster-row" key={row.stationId}>
                              <strong>{row.stationName}</strong>
                              <span>{renderSchedulePreviewPeople(row.people)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}


                    {manualPreviewStyle === "matrix" ? (
                      <div className="schedule-paper schedule-matrix-paper">
                        <div className="schedule-matrix-scroll">
                          <table className="schedule-matrix-table">
                            <thead>
                              <tr>
                                <th className="schedule-matrix-meta">
                                  <div className="schedule-matrix-team">{manualSchedulePreview.team}</div>
                                  <div className="schedule-matrix-officers">
                                    <div>主任　{manualSchedulePreview.officers.主任.join("、") || "-"}</div>
                                    <div>組長　{manualSchedulePreview.officers.組長.join("、") || "-"}</div>
                                    <div>領班　{manualSchedulePreview.officers.領班.join("、") || "-"}</div>
                                  </div>
                                </th>
                                {manualSchedulePreview.rows.map((row) => {
                                  const label = splitScheduleStationLabel(row.stationName);
                                  return (
                                    <th className="schedule-matrix-station" key={row.stationId}>
                                      <span className="schedule-matrix-station-name">{label.name}</span>
                                      {label.code ? <span className="schedule-matrix-station-code">{label.code}</span> : null}
                                    </th>
                                  );
                                })}
                              </tr>
                            </thead>
                            <tbody>
                              {Array.from({ length: Math.max(4, ...manualSchedulePreview.rows.map((row) => row.people.length)) }).map((_, rowIndex) => (
                                <tr key={`matrix-row-${rowIndex}`}>
                                  <td className="schedule-matrix-row-label">人員 {rowIndex + 1}</td>
                                  {manualSchedulePreview.rows.map((row) => {
                                    const person = row.people[rowIndex];
                                    return (
                                      <td className="schedule-matrix-person-cell" key={`${row.stationId}-${rowIndex}`}>
                                        {person ? <span className={`schedule-matrix-person-chip${person.isOfficer ? " officer" : ""}`}>{person.name}</span> : null}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="schedule-matrix-note">橫向滑動查看完整班表；確認完成會輸出完整橫版 PNG。</div>
                      </div>
                    ) : null}

                    <div className="manual-modal-actions">
                      <button type="button" className="ghost" onClick={() => setManualPreviewOpen(false)}>返回修改</button>
                      <button type="button" className="ghost" onClick={copyManualSchedulePreview}>複製文字</button>
                      <button type="button" className="primary" onClick={shareManualSchedulePreview}>系統分享</button>
                      <button type="button" className="primary" onClick={confirmManualSchedulePreview}>確認完成並下載圖片</button>
                    </div>
                  </div>
                </div>
              ) : null}

              {manualResetDialog ? (
                <div className="manual-modal-backdrop" role="dialog" aria-modal="true" translate="no">
                  <div className="manual-modal">
                    <h3>重置目前站點試排？</h3>
                    <p>更換班別 / 日別 / 模式會清空目前已安排人員，是否繼續？</p>
                    <div className="manual-modal-actions">
                      <button type="button" className="ghost" onClick={() => setManualResetDialog(null)}>取消</button>
                      <button type="button" className="primary" onClick={() => applyManualSwitch(manualResetDialog.type, manualResetDialog.value)}>確認重置</button>
                    </div>
                  </div>
                </div>
              ) : null}

              {manualConflictDialog ? (() => {
                const person = data.people.find((item) => item.id === manualConflictDialog.employeeId);
                const oldStation = data.stations.find((item) => item.id === manualConflictDialog.assignedStationId);
                const nextStation = data.stations.find((item) => item.id === manualConflictDialog.stationId);
                return (
                  <div className="manual-modal-backdrop" role="dialog" aria-modal="true" translate="no">
                    <div className="manual-modal">
                      <h3>更換站點？</h3>
                      <p>{person?.name || manualConflictDialog.employeeId} 已安排在「{oldStation?.name || manualConflictDialog.assignedStationId}」，是否更換到「{nextStation?.name || manualConflictDialog.stationId}」？</p>
                      <div className="manual-modal-actions">
                        <button type="button" className="ghost" onClick={() => setManualConflictDialog(null)}>取消</button>
                        <button type="button" className="primary" onClick={confirmManualConflictReplace}>確認更換</button>
                      </div>
                    </div>
                  </div>
                );
              })() : null}

              {manualTrainingDialog ? (() => {
                const person = data.people.find((item) => item.id === manualTrainingDialog.personId);
                const station = data.stations.find((item) => item.id === manualTrainingDialog.stationId);
                return (
                  <div className="manual-modal-backdrop manual-modal-backdrop-top" role="dialog" aria-modal="true" translate="no">
                    <div className="manual-modal">
                      <h3>加入訓練人員？</h3>
                      <p><strong>{person?.name || manualTrainingDialog.personId}</strong> 目前在「{station?.name || manualTrainingDialog.stationId}」{manualTrainingDialog.currentStatus === "無站點資格" ? "沒有站點資格" : `狀態為「${manualTrainingDialog.currentStatus}」`}。</p>
                      <p>是否加入訓練並同步連動到考核資料，將此站點狀態設為「訓練中」？</p>
                      <div className="manual-modal-actions">
                        <button type="button" className="ghost" onClick={() => setManualTrainingDialog(null)}>取消</button>
                        <button type="button" className="primary" onClick={confirmManualTrainingPerson}>加入訓練</button>
                      </div>
                    </div>
                  </div>
                );
              })() : null}

              {manualExtraDialog && manualExtraDialogItem ? (() => {
                const selectedPeople = manualExtraDialogItem.personIds.map((id) => data.people.find((person) => person.id === id)).filter(Boolean) as Person[];
                return (
                  <div className="manual-modal-backdrop manual-modal-backdrop-top" role="dialog" aria-modal="true" translate="no" onClick={closeManualExtraDialog}>
                    <div className="manual-modal" onClick={(event) => event.stopPropagation()}>
                      <div className="manual-modal-title-row">
                        <h3>設定自訂工作</h3>
                        <button type="button" className="manual-modal-close-button" aria-label="關閉自訂工作視窗" onClick={closeManualExtraDialog}>×</button>
                      </div>
                      <label className="manual-extra-dialog-field">
                        自訂工作名稱
                        <input
                          value={manualExtraDialogItem.workName}
                          onChange={(event) => updateManualExtraWork(manualExtraDialogItem.id, { workName: event.target.value })}
                          placeholder="例如：搬料、清潔、支援外務"
                          autoFocus
                        />
                      </label>
                      <label className="manual-extra-dialog-field">
                        搜尋人員
                        <input
                          value={manualExtraKeyword}
                          onChange={(event) => setManualExtraKeyword(event.target.value)}
                          placeholder="輸入姓名或工號"
                        />
                      </label>
                      <div className="manual-extra-selected">
                        {selectedPeople.length ? selectedPeople.map((person) => (
                          <button key={person.id} type="button" onClick={() => removeManualExtraPerson(manualExtraDialogItem.id, person.id)} title="點擊移除">
                            {person.name} ×
                          </button>
                        )) : <span className="muted">尚未加入人員</span>}
                      </div>
                      <div className="manual-custom-results">
                        {manualExtraCandidates.length ? manualExtraCandidates.map((person) => {
                          const selected = manualExtraDialogItem.personIds.includes(person.id);
                          return (
                            <div className="manual-custom-result" key={person.id}>
                              <div><strong>{person.name}</strong><br /><span className="muted">{person.id}｜{String(getTeamOfPerson(person))}</span></div>
                              {selected ? (
                                <button type="button" className="ghost" onClick={() => removeManualExtraPerson(manualExtraDialogItem.id, person.id)}>移除</button>
                              ) : (
                                <button type="button" onClick={() => addManualExtraPerson(manualExtraDialogItem.id, person.id)}>加入</button>
                              )}
                            </div>
                          );
                        }) : <p className="muted">找不到可加入的人員，或人員已安排在其他站點。</p>}
                      </div>
                      <div className="manual-modal-actions">
                        <button type="button" className="ghost" onClick={() => clearManualExtraWork(manualExtraDialogItem.id)}>清空此欄</button>
                        <button type="button" className="primary" onClick={closeManualExtraDialog}>完成</button>
                      </div>
                    </div>
                  </div>
                );
              })() : null}

              {manualCustomDialog ? (
                <div className="manual-modal-backdrop" role="dialog" aria-modal="true" translate="no">
                  <div className="manual-modal">
                    <h3>自訂人選</h3>
                    <input value={manualCustomKeyword} onChange={(e) => setManualCustomKeyword(e.target.value)} placeholder="搜尋姓名或工號" autoFocus />
                    <div className="manual-custom-results">
                      {manualCustomCandidates.length ? manualCustomCandidates.map((person) => (
                        <div className="manual-custom-result" key={person.id}>
                          <div><strong>{person.name}</strong><br /><span className="muted">{person.id}｜{String(getTeamOfPerson(person))}｜{person.nationality}</span></div>
                          <button type="button" onClick={() => addManualCustomPerson(person.id)}>加入</button>
                        </div>
                      )) : <p className="muted">找不到符合的人員。</p>}
                    </div>
                    <div className="manual-modal-actions">
                      <button type="button" className="ghost" onClick={() => { setManualCustomDialog(null); setManualCustomKeyword(""); }}>關閉</button>
                    </div>
                  </div>
                </div>
              ) : null}
              </div>
            </Layout>
          ) : null}
          {currentRole && page === "station-rules" && hasAccess("主任") ? <Layout title="站點規則設定" subtitle="此頁僅依班別設定規則，設定完成後會對應該班缺口分析與規則使用頁面。"><div className="panel"><div className="toolbar"><select value={rulesTeam} onChange={(e) => setRulesTeam(e.target.value as TeamName)}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>{stationRuleRows.length ? <table className="table"><thead><tr><th>站點</th><th>最低需求</th><th>輪休需求(單批)</th><th>優先序</th><th>必站</th><th>訓練中</th><th>備援目標</th><th>支援補位</th></tr></thead><tbody>{stationRuleRows.map((rule) => { const station = data.stations.find((item) => item.id === rule.stationId); const disabled = !canEditRulesForTeam(rulesTeam); return <tr key={`${rule.team}-${rule.stationId}`}><td>{station?.name || rule.stationId}</td><td><ConfirmNumberInput value={rule.minRequired} disabled={disabled} onCommit={(value) => handleUpdateRule(rule, { minRequired: value })} /></td><td><ConfirmNumberInput value={rule.reliefMinPerBatch ?? 0} disabled={disabled} onCommit={(value) => handleUpdateRule(rule, { reliefMinPerBatch: value })} /></td><td><ConfirmNumberInput value={rule.priority ?? 0} disabled={disabled} onCommit={(value) => handleUpdateRule(rule, { priority: value })} /></td><td><ConfirmSelect value={rule.isMandatory ? "Y" : "N"} disabled={disabled} options={[{ label: "Y", value: "Y" }, { label: "N", value: "N" }]} onCommit={(value) => handleUpdateRule(rule, { isMandatory: value === "Y" })} /></td><td><ConfirmSelect value={rule.trainingCanFill ? "Y" : "N"} disabled={disabled} options={[{ label: "Y", value: "Y" }, { label: "N", value: "N" }]} onCommit={(value) => handleUpdateRule(rule, { trainingCanFill: value === "Y" })} /></td><td><ConfirmNumberInput value={rule.backupTarget ?? 0} disabled={disabled} onCommit={(value) => handleUpdateRule(rule, { backupTarget: value })} /></td><td><ConfirmSelect value={rule.canShare ? "Y" : "N"} disabled={disabled} options={[{ label: "Y", value: "Y" }, { label: "N", value: "N" }]} onCommit={(value) => handleUpdateRule(rule, { canShare: value === "Y" })} /></td></tr>; })}</tbody></table> : <Empty text="找不到此班別的正式站點規則，請先至資料端補齊。" />}</div></Layout> : null}
          {currentRole && page === "people-management" && hasAccess("主任") ? <Layout title="人員名單管理" subtitle="職務標籤與系統權限已分離；此頁只維護人員資料，系統權限請至權限管理。"><div className="panel"><div className="toolbar"><input placeholder="快速搜尋工號、姓名、班別、職務、權限" value={peopleSearchKeyword} onChange={(e) => setPeopleSearchKeyword(e.target.value)} /></div><table className="table"><thead><tr><th>工號</th><th>姓名</th><th>班別</th><th>職務</th><th>系統權限</th><th>國籍</th><th>A1</th><th>A2</th><th>B1</th><th>B2</th><th>在職</th></tr></thead><tbody>{data.people.filter((person) => searchText([person.id, person.name, String(getTeamOfPerson(person)), person.role, String(getSystemPermission(person) || "")], peopleSearchKeyword)).map((person) => <tr key={person.id}><td>{person.id}</td><td><ConfirmTextInput value={person.name} onCommit={(value) => handleUpdatePerson(person, { name: value })} /></td><td><ConfirmSelect value={String(getTeamOfPerson(person))} options={TEAM_OPTIONS.map((item) => ({ label: item, value: item }))} onCommit={(value) => handleUpdatePerson(person, { shift: value })} /></td><td><ConfirmTextInput value={person.role} onCommit={(value) => handleUpdatePerson(person, { role: value })} /></td><td>{String(getSystemPermission(person) || "技術員")}{person.id === "P0033" ? "（鎖定）" : ""}</td><td><ConfirmTextInput value={person.nationality} onCommit={(value) => handleUpdatePerson(person, { nationality: value })} /></td><td><ConfirmTextInput value={person.aDay1 || ""} onCommit={(value) => handleUpdatePerson(person, { aDay1: value })} /></td><td><ConfirmTextInput value={person.aDay2 || ""} onCommit={(value) => handleUpdatePerson(person, { aDay2: value })} /></td><td><ConfirmTextInput value={person.bDay1 || ""} onCommit={(value) => handleUpdatePerson(person, { bDay1: value })} /></td><td><ConfirmTextInput value={person.bDay2 || ""} onCommit={(value) => handleUpdatePerson(person, { bDay2: value })} /></td><td><ConfirmTextInput value={person.employmentStatus} onCommit={(value) => handleUpdatePerson(person, { employmentStatus: value })} /></td></tr>)}</tbody></table></div></Layout> : null}
                    {currentRole && page === "permission-admin" && hasAccess("最高權限") ? renderPermissionAdmin() : null}
          {false && page === "smart-schedule" ? null : null}
          {showBackToTop ? <button type="button" className="back-to-top" onClick={() => scrollToTop()}>回到頂部</button> : null}
        </main>
      </div>

      {mobileDetailModal ? (
        <div className="mobile-modal-backdrop" onClick={() => setMobileDetailModal(null)}>
          <div className="mobile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-modal-header">
              <strong>{mobileDetailModal.type === "person" ? "人員資訊" : mobileDetailModal.type === "station" ? "站點資訊" : "站點考核"}</strong>
              <button type="button" className="mobile-modal-close" onClick={() => setMobileDetailModal(null)}>×</button>
            </div>
            <div className="mobile-modal-body">
              {mobileDetailModal.type === "person" && mobilePerson ? <PersonDetailView person={mobilePerson} qualifications={mobilePersonQualifications} compact /> : null}
              {mobileDetailModal.type === "station" && mobileStation ? <StationDetailView station={mobileStation} team={stationTeamFilter} day={stationDayFilter} attendance={stationAttendance} qualifications={mobileStationQualifications} people={data.people} compact /> : null}
              {mobileDetailModal.type === "review" && mobileReviewPerson ? (
                <ReviewDetailView
                  person={mobileReviewPerson}
                  permission={String(getSystemPermission(mobileReviewPerson) || "-")}
                  qualifications={mobileReviewQualifications}
                  stationId={reviewStationId}
                  reviewStatus={reviewStatus}
                  setStationId={setReviewStationId}
                  setReviewStatus={setReviewStatus}
                  stations={data.stations}
                  onSave={() => handleSaveQualification()}
                  onDelete={handleDeleteQualification}
                  compact
                />
              ) : null}
            </div>
            <button type="button" className="mobile-modal-fab-close" onClick={() => setMobileDetailModal(null)}>關閉</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ConfirmTextInput({ value, onCommit, disabled = false }: { value: string; onCommit: (value: string) => void; disabled?: boolean }) {
  return <input className="cell-input" defaultValue={value} disabled={disabled} onBlur={(e) => { const next = e.target.value; if (next !== value) onCommit(next); }} />;
}

function ConfirmNumberInput({ value, onCommit, disabled = false }: { value: number; onCommit: (value: number) => void; disabled?: boolean }) {
  return <input className="cell-input" type="number" defaultValue={value} disabled={disabled} onBlur={(e) => { const next = Number(e.target.value); if (next !== value) onCommit(next); }} />;
}

function ConfirmSelect({ value, options, onCommit, disabled = false }: { value: string; options: Array<{ label: string; value: string }>; onCommit: (value: string) => void; disabled?: boolean }) {
  return <select className="cell-input" defaultValue={value} disabled={disabled} onChange={(e) => { if (e.target.value !== value) onCommit(e.target.value); }}>{options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>;
}

function StatCard({ title, value, note }: { title: string; value: string; note: string }) {
  return <div className="stat-card"><span>{title}</span><strong>{value}</strong><small>{note}</small></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
