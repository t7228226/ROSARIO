import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import EntranceLayout from "./components/EntranceLayout";
import Layout from "./components/Layout";
import MobileCommandMenu from "./components/MobileCommandMenu";
import ThemePicker from "./components/ThemePicker";
import { Info, PersonDetailView, ReviewDetailView, StationDetailView } from "./components/detailViews";
import AppDialog, { DialogShell } from "./components/ui/AppDialog";
import { appEnvironment } from "./config/environment";
import { emptyBootstrap, sanitizeBootstrapData } from "./domain/bootstrap/sanitizeBootstrap";
import { buildPersonProfilePayload, createEmptyPersonDraft, prepareNewPerson } from "./domain/people/newPerson";
import {
  readStoredUiTheme,
  storeUiTheme,
  type UiThemeKey,
} from "./domain/preferences/uiTheme";
import {
  buildRolePermissionMapsFromSaved,
  databasePermissionItems,
  databaseRolePermissionMaps,
  mergePermissionItemsWithSaved,
  permissionOptions,
  type PermissionItemDefinition,
  type RolePermissionMapDefinition,
} from "./domain/permissions/config";
import {
  appendUniqueAssignment,
  findAssignedStation,
  getAssignmentSummary,
} from "./domain/workforce/assignmentState";
import type { CoverageResilienceResult } from "./domain/workforce/resilience";
import { auditScheduleSafety } from "./domain/workforce/scheduleSafety";
import CoverageConfigurationOverview, {
  type CoverageConfigurationRow,
} from "./features/gap-analysis/CoverageConfigurationOverview";
import {
  fetchGasBootstrapData,
  fetchGasPermissionConfig,
  fetchGasVersionStatus,
  postGasAction,
  setGasSessionToken,
  type GasResponse as GasWriteResponse,
  type GasSessionResponse,
} from "./lib/gasClient";
import {
  appVersionStorageKey,
  clearStoredLoginSession,
  compareAppVersion,
  fetchDeployedFrontendVersion,
  getLoginKeepMs,
  getStoredLoginKeep,
  loginKeepOptions,
  loginKeepStorageKey,
  readStoredLoginSession,
  saveStoredLoginSession,
  type LoginKeepKey,
} from "./lib/appLifecycle";
import {
  analyzeStationCoverage,
  buildSmartAssignments,
  DAY_OPTIONS,
  getApplicableRules,
  getAttendanceForTeam,
  getQualifiedPeopleForStation,
  getRuleNeed,
  getStationCoverage,
  getTeamOfPerson,
  REVIEW_TEAM_OPTIONS,
  searchText,
  SMART_MODE_OPTIONS,
  TEAM_OPTIONS,
} from "./lib/selectors";
import type {
  AppBootstrap,
  PageKey,
  Person,
  Qualification,
  QualificationStatus,
  ShiftMode,
  SmartScheduleMode,
  StationRule,
  TeamName,
  UserRole,
} from "./types";

const ResilienceInsights = lazy(() => import("./features/gap-analysis/ResilienceInsights"));
const WorkforceWorkbench = lazy(() => import("./features/workbench/WorkforceWorkbench"));

type MobileDetailModal =
  | { type: "person"; personId: string }
  | { type: "station"; stationId: string }
  | { type: "review"; personId: string }
  | null;

type ViewMode = "desktop" | "mobile";
const APP_VERSION = appEnvironment.version;

function getStationQualificationStatus(qualifications: Qualification[], employeeId: string, stationId: string) {
  const statuses = qualifications
    .filter((item) => item.employeeId === employeeId && item.stationId === stationId)
    .map((item) => item.status);
  if (statuses.includes("合格")) return "合格";
  if (statuses.includes("訓練中")) return "訓練中";
  if (statuses.includes("不可排")) return "不可排";
  return "";
}

const qualificationOptions: QualificationStatus[] = ["合格", "訓練中", "不可排", ""];
const dayOptions: ShiftMode[] = DAY_OPTIONS;
const permissionEligibleJobs = new Set(["領班", "組長", "主任", "站長"]);
const officerRoleOrder = ["主任", "組長", "領班", "站長"] as const;
type OfficerRole = (typeof officerRoleOrder)[number];
type SchedulePreviewStyle = "card" | "table" | "share" | "section" | "matrix";
type ManualExtraWork = { id: string; workName: string; personIds: string[] };
type SchedulePreviewPerson = { name: string; isOfficer?: boolean; isTraining?: boolean };


const schedulePreviewStyleOptions: Array<{ key: SchedulePreviewStyle; label: string }> = [
  { key: "card", label: "清單卡片" },
  { key: "table", label: "標準表格" },
  { key: "share", label: "分享圖卡" },
  { key: "section", label: "分區海報" },
  { key: "matrix", label: "橫向矩陣" },
];

const initialManualExtraWorks: ManualExtraWork[] = [
  { id: "manual-extra-work-1", workName: "", personIds: [] },
  { id: "manual-extra-work-2", workName: "", personIds: [] },
];

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

const pagePermissionIdMap: Partial<Record<PageKey, string>> = {
  home: "PERM_001",
  "person-query": "PERM_002",
  "station-query": "PERM_003",
  "qualification-review": "PERM_004",
  "gap-analysis": "PERM_006",
  "manual-schedule": "PERM_007",
  "smart-schedule": "PERM_009",
  "station-rules": "PERM_011",
  "people-management": "PERM_013",
  "permission-admin": "PERM_015",
};

function permissionSearchMatches(parts: unknown[], keyword: string) {
  return searchText(parts.map((item) => String(item ?? "")), keyword);
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

function isSupportOfficerPerson(person: Person) {
  const role = normalizeOfficerRole(person.role);
  return role === "領班" || role === "組長" || role === "主任";
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

function getViewportMode(): ViewMode {
  if (typeof window === "undefined") return "desktop";
  return window.innerWidth <= 900 ? "mobile" : "desktop";
}

export default function App() {
  const [data, setData] = useState<AppBootstrap>(emptyBootstrap);
  const [loading, setLoading] = useState(false);
  const [bootstrapError, setBootstrapError] = useState("");
  const [bootstrapRetryKey, setBootstrapRetryKey] = useState(0);
  const [page, setPage] = useState<PageKey>("home");
  const [flash, setFlash] = useState("");
  const [appVersionBlocked, setAppVersionBlocked] = useState(false);
  const [appVersionMessage, setAppVersionMessage] = useState("");
  const toastDurationMs = 5000;
  const toastStyleMode: "floating" | "banner" = "floating";
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => getViewportMode());
  const [mobileDetailModal, setMobileDetailModal] = useState<MobileDetailModal>(null);
  const [mobileCommandOpen, setMobileCommandOpen] = useState(false);
  const [uiTheme, setUiTheme] = useState<UiThemeKey>(() => readStoredUiTheme(typeof window === "undefined" ? undefined : window.localStorage));
  const contentRef = useRef<HTMLElement | null>(null);
  const personDetailRef = useRef<HTMLDivElement | null>(null);
  const stationDetailRef = useRef<HTMLDivElement | null>(null);
  const reviewDetailRef = useRef<HTMLDivElement | null>(null);

  const [loginForm, setLoginForm] = useState({ account: "", password: "" });
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [sessionRestoring, setSessionRestoring] = useState(true);
  const [loginKeep, setLoginKeep] = useState<LoginKeepKey>(() => getStoredLoginKeep());
  const [currentUser, setCurrentUser] = useState<Person | null>(null);
  const loginAccountRef = useRef<HTMLInputElement | null>(null);
  const loginPasswordRef = useRef<HTMLInputElement | null>(null);
  const loginAutoSubmittedRef = useRef(false);
  const loginManualInputRef = useRef(false);
  const loginSubmittingRef = useRef(false);
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
  const [gapHelpOpen, setGapHelpOpen] = useState(false);
  const [gapConfigurationDetailsOpen, setGapConfigurationDetailsOpen] = useState(false);
  const [gapAbsentIds, setGapAbsentIds] = useState<string[]>([]);
  const [gapAbsentDialogOpen, setGapAbsentDialogOpen] = useState(false);
  const [gapAbsentKeyword, setGapAbsentKeyword] = useState("");
  const [gapTrainingHelpOpen, setGapTrainingHelpOpen] = useState(false);
  const [gapTrainingDialogOpen, setGapTrainingDialogOpen] = useState(false);
  const [gapTrainingKeyword, setGapTrainingKeyword] = useState("");
  const [gapTrainingPicker, setGapTrainingPicker] = useState<null | { employeeId: string; recommendedStationId?: string; source: "recommendation" | "custom" }>(null);
  const [gapTrainingPickerStationId, setGapTrainingPickerStationId] = useState("");
  const [gapTrainingSimulations, setGapTrainingSimulations] = useState<Array<{ employeeId: string; stationId: string }>>([]);
  const [gapOfficerSimulations, setGapOfficerSimulations] = useState<Array<{ employeeId: string; stationId: string }>>([]);
  const [gapOfficerDialogOpen, setGapOfficerDialogOpen] = useState(false);
  const [gapOfficerKeyword, setGapOfficerKeyword] = useState("");
  const [gapOfficerPickerId, setGapOfficerPickerId] = useState("");
  const [gapOfficerPickerStationId, setGapOfficerPickerStationId] = useState("");
  const [gapStressMaxAbsences, setGapStressMaxAbsences] = useState(1);
  const [gapStressResult, setGapStressResult] = useState<CoverageResilienceResult | null>(null);
  const [gapStressRunning, setGapStressRunning] = useState(false);
  const [gapStressError, setGapStressError] = useState("");
  const gapStressWorkerRef = useRef<Worker | null>(null);

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
  const [manualSafetyOpen, setManualSafetyOpen] = useState(false);
  const [manualSafetyAcknowledged, setManualSafetyAcknowledged] = useState(false);
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
    setManualSafetyOpen(false);
    setManualSafetyAcknowledged(false);
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
  const [rulesPreviewOpen, setRulesPreviewOpen] = useState(false);
  const [rulesOverviewEditing, setRulesOverviewEditing] = useState(false);
  const [editingRuleKey, setEditingRuleKey] = useState("");

  const [peopleSearchKeyword, setPeopleSearchKeyword] = useState("");
  const [peopleTeamFilter, setPeopleTeamFilter] = useState<TeamName | "全部班別">("全部班別");
  const [editingPersonId, setEditingPersonId] = useState("");
  const [newPersonOpen, setNewPersonOpen] = useState(false);
  const [newPersonDraft, setNewPersonDraft] = useState<Person>(() => createEmptyPersonDraft());
  const [newPersonSubmitting, setNewPersonSubmitting] = useState(false);
  const [permissionSearchKeyword, setPermissionSearchKeyword] = useState("");
  const [permissionAdminTab, setPermissionAdminTab] = useState<PermissionAdminTab>("role");
  const [permissionSelectedRole, setPermissionSelectedRole] = useState<UserRole>("組長");
  const [permissionSelectedPersonId, setPermissionSelectedPersonId] = useState("");
  const [personalPermissionExceptions, setPersonalPermissionExceptions] = useState<PersonalPermissionExceptionDefinition[]>([]);
  const [permissionItemStates, setPermissionItemStates] = useState<PermissionItemDefinition[]>(() => databasePermissionItems.map((item) => ({ ...item })));
  const [rolePermissionMapStates, setRolePermissionMapStates] = useState<RolePermissionMapDefinition[]>(() => databaseRolePermissionMaps.map((item) => ({ ...item })));
  const [accountStatusById, setAccountStatusById] = useState<Record<string, string>>({});
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

  useEffect(() => {
    document.documentElement.dataset.uiTheme = uiTheme;
    storeUiTheme(uiTheme, window.localStorage);
  }, [uiTheme]);

  function changeUiTheme(nextTheme: UiThemeKey) {
    if (nextTheme === uiTheme) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const viewTransitionDocument = document as Document & {
      startViewTransition?: (update: () => void) => { finished: Promise<void> };
    };
    if (!reducedMotion && viewTransitionDocument.startViewTransition) {
      viewTransitionDocument.startViewTransition(() => setUiTheme(nextTheme));
      return;
    }
    setUiTheme(nextTheme);
  }

  useEffect(() => {
    const storedVersion = window.localStorage.getItem(appVersionStorageKey);
    if (!storedVersion) {
      window.localStorage.setItem(appVersionStorageKey, APP_VERSION);
      return;
    }
    if (storedVersion !== APP_VERSION) {
      window.localStorage.setItem(appVersionStorageKey, APP_VERSION);
    }
  }, []);

  useEffect(() => {
    if (appEnvironment.isPreview) return;
    let active = true;
    async function checkVersion() {
      try {
        const [status, deployedVersion] = await Promise.all([
          fetchGasVersionStatus().catch(() => null),
          fetchDeployedFrontendVersion().catch(() => null),
        ]);
        if (!active) return;
        if (deployedVersion && compareAppVersion(deployedVersion, APP_VERSION) > 0) {
          setAppVersionBlocked(true);
          setAppVersionMessage(`系統已有新版：${deployedVersion}。目前載入版本為 ${APP_VERSION}，請重新整理後繼續使用。`);
          return;
        }
        if (status?.outdated) {
          setAppVersionBlocked(true);
          setAppVersionMessage(status.message || "系統已有新版，請重新整理後繼續使用。");
        }
      } catch {
        // 版本檢查失敗時不阻斷讀取，存檔前仍會再檢查。
      }
    }
    checkVersion();
    const timer = window.setInterval(checkVersion, 3 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

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
    if (!currentUser) return;
    let active = true;
    async function loadBootstrap() {
      setLoading(true);
      setBootstrapError("");
      try {
        const next = sanitizeBootstrapData(await fetchGasBootstrapData());
        if (!active) return;
        if (!next.people.length && next.qualifications.length > 0) {
          throw new Error("人員主表讀取為 0 筆，請確認 GAS 已部署標題列自動偵測修正版。");
        }
        setData(next);
      } catch (error) {
        if (!active) return;
        setPage("home");
        const message = error instanceof Error ? error.message : "請確認 GAS 已重新部署且可回傳核心資料。";
        setBootstrapError(message);
        setFlashMessage(`系統資料載入失敗：${message}`);
      } finally {
        if (active) setLoading(false);
      }
    }
    loadBootstrap();
    return () => {
      active = false;
    };
  }, [bootstrapRetryKey, currentUser?.id]);

  useEffect(() => {
    if (!currentUser) return;
    let active = true;
    async function loadPermissionConfig() {
      try {
        const permissionConfig = await fetchGasPermissionConfig<{
          permissionItems?: PermissionItemDefinition[];
          rolePermissionMaps?: RolePermissionMapDefinition[];
          personalPermissionExceptions?: PersonalPermissionExceptionDefinition[];
        }>();
        if (!active) return;
        const nextPermissionItems = mergePermissionItemsWithSaved(permissionConfig.permissionItems);
        setPermissionItemStates(nextPermissionItems);
        setRolePermissionMapStates(buildRolePermissionMapsFromSaved(permissionConfig.rolePermissionMaps, nextPermissionItems));
        if (Array.isArray(permissionConfig.personalPermissionExceptions)) {
          setPersonalPermissionExceptions(permissionConfig.personalPermissionExceptions);
        }
      } catch (error) {
        console.warn("權限設定背景載入失敗，暫時沿用內建設定。", error);
      }
    }
    void loadPermissionConfig();
    return () => {
      active = false;
    };
  }, [bootstrapRetryKey, currentUser]);

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      const stored = readStoredLoginSession();
      if (!stored) {
        clearStoredLoginSession();
        if (active) setSessionRestoring(false);
        return;
      }

      setGasSessionToken(stored.sessionToken);
      try {
        const result = await postGasAction("session", {
          sessionDurationMs: getLoginKeepMs(loginKeep),
        }) as GasSessionResponse;
        if (!active) return;
        if (!result.user || !result.sessionExpiresAt) {
          throw new Error("登入工作階段回應不完整。");
        }
        setCurrentUser(result.user);
        saveStoredLoginSession({
          userId: result.user.id,
          sessionToken: stored.sessionToken,
          expiresAt: result.sessionExpiresAt,
        });
        setFlashMessage(`已恢復登入：${result.user.name}`);
      } catch (error) {
        clearStoredLoginSession();
        if (active) {
          const message = error instanceof Error ? error.message : "登入工作階段無法驗證。";
          setFlashMessage(`無法恢復登入：${message}`);
        }
      } finally {
        if (active) setSessionRestoring(false);
      }
    }
    void restoreSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleSessionExpired = () => {
      clearStoredLoginSession();
      setCurrentUser(null);
      setData(emptyBootstrap);
      setPermissionItemStates(databasePermissionItems.map((item) => ({ ...item })));
      setRolePermissionMapStates(databaseRolePermissionMaps.map((item) => ({ ...item })));
      setPersonalPermissionExceptions([]);
      setPage("home");
      setFlashMessage("登入已逾時，請重新登入後繼續操作。");
    };
    window.addEventListener("rosario:session-expired", handleSessionExpired);
    return () => window.removeEventListener("rosario:session-expired", handleSessionExpired);
  }, []);

  useEffect(() => {
    if (currentUser || loginSubmitting || sessionRestoring || loginAutoSubmittedRef.current || loginManualInputRef.current) return;

    const timer = window.setInterval(() => {
      const accountInput = loginAccountRef.current;
      const passwordInput = loginPasswordRef.current;
      if (!accountInput || !passwordInput) return;

      const account = accountInput.value.trim();
      const password = passwordInput.value.trim();
      if (!account || !password) return;

      let passwordAutofilled = false;
      try {
        passwordAutofilled =
          passwordInput.matches(":-webkit-autofill") ||
          passwordInput.matches(":autofill");
      } catch {
        // Some browsers do not support the autofill selectors.
      }

      if (passwordAutofilled && !loginManualInputRef.current) {
        loginAutoSubmittedRef.current = true;
        window.clearInterval(timer);
        setLoginForm({ account, password });
        void handleLogin({ account, password });
      }

    }, 400);

    return () => window.clearInterval(timer);
  }, [currentUser, loginSubmitting, sessionRestoring]);

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
  const gapCoverageAnalysis = useMemo(
    () => analyzeStationCoverage(gapShift, gapDay, data.stationRules || [], data.people, data.qualifications, new Set<string>(), new Map<string, string>(), { excludeOfficersFromCoverage: true }),
    [data.people, data.qualifications, data.stationRules, gapShift, gapDay]
  );
  const gapAbsentAnalysis = useMemo(
    () => analyzeStationCoverage(gapShift, gapDay, data.stationRules || [], data.people, data.qualifications, new Set(gapAbsentIds), new Map<string, string>(), { excludeOfficersFromCoverage: true }),
    [data.people, data.qualifications, data.stationRules, gapShift, gapDay, gapAbsentIds]
  );
  const gapActiveCoverageAnalysis = gapAbsentIds.length ? gapAbsentAnalysis : gapCoverageAnalysis;
  const gapCombinedTrainingSuggestions = useMemo(() => {
    const source = gapAbsentIds.length
      ? [
          ...gapAbsentAnalysis.trainingSuggestions,
          ...gapCoverageAnalysis.trainingSuggestions.filter((item) => !gapAbsentIds.includes(item.employeeId)),
        ]
      : gapCoverageAnalysis.trainingSuggestions;
    const used = new Set<string>();
    return source.filter((item) => {
      if (used.has(item.employeeId)) return false;
      used.add(item.employeeId);
      return true;
    }).slice(0, 10);
  }, [gapAbsentAnalysis.trainingSuggestions, gapCoverageAnalysis.trainingSuggestions, gapAbsentIds]);
  const gapAbsentCandidates = useMemo(() => {
    const keyword = gapAbsentKeyword.trim().toLowerCase();
    return gapAttendance.all
      .filter((person) => !gapAbsentIds.includes(person.id))
      .filter((person) => {
        if (!keyword) return true;
        return person.id.toLowerCase().includes(keyword) || person.name.toLowerCase().includes(keyword);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true }))
      .slice(0, 40);
  }, [gapAbsentIds, gapAbsentKeyword, gapAttendance.all]);
  const gapOfficerCandidates = useMemo(() => {
    const keyword = gapOfficerKeyword.trim().toLowerCase();
    return gapAttendance.all
      .filter((person) => isSupportOfficerPerson(person))
      .filter((person) => !gapAbsentIds.includes(person.id))
      .filter((person) => {
        if (!keyword) return true;
        return person.id.toLowerCase().includes(keyword) || person.name.toLowerCase().includes(keyword);
      })
      .sort((a, b) => {
        const roleA = normalizeOfficerRole(a.role);
        const roleB = normalizeOfficerRole(b.role);
        const orderA = roleA ? officerRoleOrder.indexOf(roleA) : 99;
        const orderB = roleB ? officerRoleOrder.indexOf(roleB) : 99;
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name, "zh-Hant", { numeric: true });
      })
      .slice(0, 40);
  }, [gapAbsentIds, gapAttendance.all, gapOfficerKeyword]);
  const gapTrainingCustomCandidates = useMemo(() => {
    const keyword = gapTrainingKeyword.trim().toLowerCase();
    return gapAttendance.all
      .filter((person) => !gapAbsentIds.includes(person.id))
      .filter((person) => {
        if (!keyword) return true;
        return person.id.toLowerCase().includes(keyword) || person.name.toLowerCase().includes(keyword);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true }))
      .slice(0, 50);
  }, [gapAbsentIds, gapAttendance.all, gapTrainingKeyword]);
  const gapTrainingPickerPerson = gapTrainingPicker ? data.people.find((person) => person.id === gapTrainingPicker.employeeId) || null : null;
  const gapTrainingPickerQualifiedStations = useMemo(() => {
    if (!gapTrainingPickerPerson) return [];
    const stationIds = new Set(
      data.qualifications
        .filter((item) => item.employeeId === gapTrainingPickerPerson.id && (item.status === "合格" || item.status === "訓練中"))
        .map((item) => item.stationId)
    );
    return gapRules.filter((rule) => stationIds.has(rule.stationId));
  }, [data.qualifications, gapRules, gapTrainingPickerPerson]);
  const gapTrainingPickerSelectedStationId = gapTrainingPickerStationId || gapTrainingPicker?.recommendedStationId || gapRules[0]?.stationId || "";
  const gapTrainingPickerSelectedQualification = gapTrainingPickerPerson && gapTrainingPickerSelectedStationId
    ? data.qualifications.find((item) => item.employeeId === gapTrainingPickerPerson.id && item.stationId === gapTrainingPickerSelectedStationId)
    : undefined;
  const gapTrainingPickerSelectedIsQualified = gapTrainingPickerSelectedQualification?.status === "合格";
  const gapSimulationModel = useMemo(() => {
    if (!gapTrainingSimulations.length && !gapOfficerSimulations.length) return null;
    const simulatedQualifications: Qualification[] = [...data.qualifications];
    const forcedAssignments = new Map<string, string>();
    gapTrainingSimulations.forEach((item) => {
      const person = data.people.find((personItem) => personItem.id === item.employeeId);
      if (!person) return;
      simulatedQualifications.push({
        employeeId: person.id,
        employeeName: person.name,
        stationId: item.stationId,
        status: "合格",
      });
      forcedAssignments.set(person.id, item.stationId);
    });
    gapOfficerSimulations.forEach((item) => {
      forcedAssignments.set(item.employeeId, item.stationId);
    });
    return { qualifications: simulatedQualifications, forcedAssignments };
  }, [data.people, data.qualifications, gapOfficerSimulations, gapTrainingSimulations]);
  const gapSimulationAnalysis = useMemo(() => {
    if (!gapSimulationModel) return null;
    return analyzeStationCoverage(
      gapShift,
      gapDay,
      data.stationRules || [],
      data.people,
      gapSimulationModel.qualifications,
      new Set(gapAbsentIds),
      gapSimulationModel.forcedAssignments,
      { excludeOfficersFromCoverage: true }
    );
  }, [data.people, data.stationRules, gapShift, gapDay, gapAbsentIds, gapSimulationModel]);
  const gapTrainingSimulationAnalysis = gapSimulationAnalysis;
  const gapSimulationCount = gapTrainingSimulations.length + gapOfficerSimulations.length;
  const gapDisplayCoverageAnalysis = gapSimulationAnalysis || gapActiveCoverageAnalysis;
  const gapDisplayQualifications = gapSimulationModel?.qualifications || data.qualifications;
  const gapDisplayAttendanceAll = useMemo(
    () => gapAbsentIds.length ? gapAttendance.all.filter((person) => !gapAbsentIds.includes(person.id)) : gapAttendance.all,
    [gapAbsentIds, gapAttendance.all]
  );
  const gapDisplayAttendanceSupport = useMemo(
    () => gapAbsentIds.length ? gapAttendance.support.filter((person) => !gapAbsentIds.includes(person.id)) : gapAttendance.support,
    [gapAbsentIds, gapAttendance.support]
  );
  const gapConfigurationRows = useMemo<CoverageConfigurationRow[]>(() => {
    const supportIds = new Set(gapDisplayAttendanceSupport.map((person) => person.id));
    return gapRules.map((rule) => {
      const required = getRuleNeed(rule, gapDay);
      const station = data.stations.find((item) => item.id === rule.stationId);
      const coverage = getStationCoverage(rule.stationId, required, gapDisplayAttendanceAll, gapDisplayAttendanceSupport, gapDisplayQualifications);
      const row = gapDisplayCoverageAnalysis.rows.find((item) => item.stationId === rule.stationId);
      const beforeRow = gapActiveCoverageAnalysis.rows.find((item) => item.stationId === rule.stationId);
      const assigned = (row?.assignedIds || []).map((id) => {
        const person = data.people.find((item) => item.id === id);
        return {
          id,
          name: person?.name || id,
          kind: person && isSupportOfficerPerson(person) ? "officer" as const : supportIds.has(id) ? "support" as const : "own" as const,
        };
      });
      return {
        stationId: rule.stationId,
        stationName: station?.name || rule.stationId,
        required,
        assigned,
        shortage: row?.shortage || 0,
        ownQualified: coverage.ownQualified,
        supportQualified: coverage.supportQualified,
        totalQualified: coverage.qualified,
        training: coverage.training,
        status: row?.shortage ? "缺口" as const : row?.bottleneck ? "瓶頸" as const : "穩定" as const,
        supportQualifiedNames: coverage.supportQualifiedIds.map((id) => data.people.find((person) => person.id === id)?.name || id),
        changedBySimulation: Boolean(gapTrainingSimulationAnalysis && row && row.shortage !== (beforeRow?.shortage || 0)),
      };
    });
  }, [
    data.people,
    data.stations,
    gapActiveCoverageAnalysis.rows,
    gapDay,
    gapDisplayAttendanceAll,
    gapDisplayAttendanceSupport,
    gapDisplayCoverageAnalysis.rows,
    gapDisplayQualifications,
    gapRules,
    gapTrainingSimulationAnalysis,
  ]);

  const manualAttendance = useMemo(() => getAttendanceForTeam(data.people, manualShift, manualDay), [data.people, manualShift, manualDay]);
  const manualRules = useMemo(() => getApplicableRules(manualShift, manualDay, data.stationRules || []), [data.stationRules, manualShift, manualDay]);
  // 站點試排畫面排列順序：依照 02_站點主表 / 原本站點清單順序顯示。
  // 規則 priority 只給排人員演算法參考，不可拿來改變畫面站點排列。
  const manualDisplayRules = useMemo(() => {
    const stationOrder = new Map<string, number>(data.stations.map((station, index) => [station.id, index]));
    return [...manualRules].sort((a, b) => {
      const orderA = stationOrder.get(a.stationId) ?? 9999;
      const orderB = stationOrder.get(b.stationId) ?? 9999;
      if (orderA !== orderB) return orderA - orderB;
      return String(a.stationId).localeCompare(String(b.stationId), "zh-Hant", { numeric: true });
    });
  }, [manualRules, data.stations]);
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
  const smartAttendance = useMemo(() => getAttendanceForTeam(data.people, smartShift, smartDay), [data.people, smartShift, smartDay]);
  const smartRules = useMemo(() => getApplicableRules(smartShift, smartDay, data.stationRules || []), [data.stationRules, smartShift, smartDay]);

  const stationRuleRows = useMemo(() => getApplicableRules(rulesTeam, "當班", data.stationRules || []), [rulesTeam, data.stationRules]);

  const manualCountableIds = useMemo(() => Array.from(new Set(
    manualAttendance.all
      .filter((person) => normalizeOfficerRole(person.role) !== "主任")
      .map((person) => person.id)
  )), [manualAttendance.all]);
  const manualCountableTotal = manualCountableIds.length;
  const manualTrainingAssignments = useMemo(() => {
    return Object.entries(manualAssignments).flatMap(([stationId, personIds]) =>
      personIds
        .filter((employeeId) => getStationQualificationStatus(data.qualifications, employeeId, stationId) === "訓練中")
        .map((employeeId) => ({ employeeId, stationId }))
    );
  }, [data.qualifications, manualAssignments]);
  const manualSafety = useMemo(() => auditScheduleSafety({
    assignments: manualAssignments,
    rules: manualRules,
    officerStations: manualOfficerStations,
    extraWorks: manualExtraWorks,
    trainingAssignments: manualTrainingAssignments,
    attendanceIds: manualCountableIds,
    reservedDutyIds: manualOfficerPeople
      .filter((person) => normalizeOfficerRole(person.role) !== "主任")
      .map((person) => person.id),
  }), [manualAssignments, manualCountableIds, manualExtraWorks, manualOfficerPeople, manualOfficerStations, manualRules, manualTrainingAssignments]);
  const manualPendingCount = manualSafety.unassignedIds.length;
  const manualEffectiveAssigned = Math.max(0, manualCountableTotal - manualPendingCount);
  const manualSchedulePreview = useMemo(() => {
    const peopleById = new Map(data.people.map((person) => [person.id, person]));
    const uniqueNames = (names: string[]) => Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
    const uniquePreviewPeople = (people: SchedulePreviewPerson[]) => {
      const map = new Map<string, SchedulePreviewPerson>();
      people.forEach((person) => {
        const name = person.name.trim();
        if (!name) return;
        const current = map.get(name);
        map.set(name, {
          name,
          isOfficer: Boolean(current?.isOfficer || person.isOfficer),
          isTraining: Boolean(current?.isTraining || person.isTraining),
        });
      });
      return Array.from(map.values());
    };
    const toPreviewPerson = (person?: Person | null, forceOfficer = false, isTraining = false): SchedulePreviewPerson | null => {
      if (!person?.name) return null;
      return { name: person.name, isOfficer: forceOfficer || normalizeOfficerRole(person.role) !== null, isTraining };
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
    const orderedManualRules = manualDisplayRules;
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
            .map((id) => toPreviewPerson(
              peopleById.get(id),
              false,
              getStationQualificationStatus(data.qualifications, id, rule.stationId) === "訓練中"
            ))
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
            const stationName = item.workName.trim() || `臨時勤務 ${index + 1}`;
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
  }, [data.people, data.qualifications, data.stations, manualAssignments, manualOfficerPeople, manualOfficerStations, manualRules, manualShift, manualExtraWorks, manualOfficerDisplayGroups]);
  const smartSummary = useMemo(() => getAssignmentSummary(smartAssignments, smartRules), [smartAssignments, smartRules]);
  const visibleRulesTeams = useMemo(() => {
    if (!currentUser) return [];
    if (currentRole === "最高權限") return TEAM_OPTIONS;
    const ownTeam = getTeamOfPerson(currentUser);
    const isDirector = currentRole === "主任" || normalizeOfficerRole(currentUser.role) === "主任";
    return isDirector && TEAM_OPTIONS.includes(ownTeam) ? [ownTeam] : [];
  }, [currentRole, currentUser]);

  useEffect(() => {
    if (!visibleRulesTeams.length) return;
    if (!visibleRulesTeams.includes(rulesTeam)) {
      setRulesTeam(visibleRulesTeams[0]);
      setEditingRuleKey("");
      setRulesOverviewEditing(false);
    }
  }, [rulesTeam, visibleRulesTeams]);

  useEffect(() => {
    gapStressWorkerRef.current?.terminate();
    gapStressWorkerRef.current = null;
    setGapStressResult(null);
    setGapStressRunning(false);
    setGapStressError("");
    return () => {
      gapStressWorkerRef.current?.terminate();
      gapStressWorkerRef.current = null;
    };
  }, [data.people, data.qualifications, data.stationRules, gapDay, gapShift]);

  function getRoleAllowedFromSaved(role: UserRole, permissionId: string) {
    if (role === "最高權限") return true;
    const match = rolePermissionMapStates.find((item) =>
      item.role === role &&
      item.permissionId === permissionId &&
      item.enabled === "啟用"
    );
    return match?.allowed === "Y";
  }

  function canUsePermission(permissionId: string, person: Person | null = currentUser) {
    if (!person) return false;
    const role = getSystemPermission(person) || "技術員";
    if (role === "最高權限") return true;
    const permissionItem = permissionItemStates.find((item) => item.id === permissionId);
    if (!permissionItem || permissionItem.enabled === "停用") return false;
    const exception = personalPermissionExceptions.find((item) =>
      item.employeeId === person.id &&
      item.permissionId === permissionId &&
      item.enabled !== "停用"
    );
    if (exception?.effect === "deny") return false;
    if (exception?.effect === "allow") return true;
    return getRoleAllowedFromSaved(role, permissionId);
  }

  function canUsePage(pageKey: PageKey) {
    if (!currentUser) return pageKey === "home";
    const role = getSystemPermission(currentUser);
    if (role === "最高權限") return true;
    if (pageKey === "permission-admin") return false;
    const permissionId = pagePermissionIdMap[pageKey];
    if (!permissionId) return false;
    return canUsePermission(permissionId, currentUser);
  }

  function canViewRulesForTeam(team: TeamName) {
    if (!canUsePermission("PERM_011")) return false;
    return visibleRulesTeams.includes(team);
  }

  function canEditRulesForTeam(team: TeamName) {
    if (!canUsePermission("PERM_012")) return false;
    return visibleRulesTeams.includes(team);
  }

  function runGapStressAnalysis() {
    if (!gapRules.length || gapStressRunning) return;
    gapStressWorkerRef.current?.terminate();
    setGapStressRunning(true);
    setGapStressError("");
    setGapStressResult(null);

    const worker = new Worker(
      new URL("./domain/workforce/resilience.worker.ts", import.meta.url),
      { type: "module" }
    );
    gapStressWorkerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: CoverageResilienceResult; message?: string }>) => {
      if (gapStressWorkerRef.current !== worker) return;
      if (event.data.ok && event.data.result) {
        setGapStressResult(event.data.result);
      } else {
        setGapStressError(event.data.message || "缺勤壓力測試失敗，請稍後再試。");
      }
      setGapStressRunning(false);
      worker.terminate();
      gapStressWorkerRef.current = null;
    };
    worker.onerror = (event) => {
      if (gapStressWorkerRef.current !== worker) return;
      setGapStressError(event.message || "缺勤壓力測試失敗，請稍後再試。");
      setGapStressRunning(false);
      worker.terminate();
      gapStressWorkerRef.current = null;
    };
    worker.postMessage({
      team: gapShift,
      mode: gapDay,
      stationRules: data.stationRules || [],
      people: data.people,
      qualifications: data.qualifications,
      maxAbsences: gapStressMaxAbsences,
    });
  }

  function toggleGapAbsentPerson(employeeId: string) {
    setGapAbsentIds((current) =>
      current.includes(employeeId)
        ? current.filter((id) => id !== employeeId)
        : [...current, employeeId]
    );
    setGapOfficerSimulations((current) => current.filter((item) => item.employeeId !== employeeId));
  }

  function toggleGapTrainingSimulation(employeeId: string, stationId: string) {
    setGapTrainingSimulations((current) => {
      const exists = current.some((item) => item.employeeId === employeeId && item.stationId === stationId);
      if (exists) return current.filter((item) => !(item.employeeId === employeeId && item.stationId === stationId));
      return [...current.filter((item) => item.employeeId !== employeeId), { employeeId, stationId }];
    });
  }

  function toggleGapOfficerSimulation(employeeId: string, stationId: string) {
    setGapOfficerSimulations((current) => {
      const exists = current.some((item) => item.employeeId === employeeId && item.stationId === stationId);
      if (exists) return current.filter((item) => !(item.employeeId === employeeId && item.stationId === stationId));
      return [...current.filter((item) => item.employeeId !== employeeId), { employeeId, stationId }];
    });
  }

  function openGapOfficerDialog() {
    setGapOfficerKeyword("");
    setGapOfficerPickerId("");
    setGapOfficerPickerStationId(gapActiveCoverageAnalysis.rows.find((row) => row.shortage > 0)?.stationId || gapRules[0]?.stationId || "");
    setGapOfficerDialogOpen(true);
  }

  function addGapOfficerCustomSimulation() {
    if (!gapOfficerPickerId || !gapOfficerPickerStationId) return;
    setGapOfficerSimulations((current) => [
      ...current.filter((item) => item.employeeId !== gapOfficerPickerId),
      { employeeId: gapOfficerPickerId, stationId: gapOfficerPickerStationId },
    ]);
    setGapOfficerDialogOpen(false);
    setGapOfficerKeyword("");
    setGapOfficerPickerId("");
  }

  function openGapTrainingDialog() {
    setGapTrainingKeyword("");
    setGapTrainingDialogOpen(true);
  }

  function openGapTrainingPicker(employeeId: string, recommendedStationId?: string, source: "recommendation" | "custom" = "recommendation") {
    setGapTrainingPicker({ employeeId, recommendedStationId, source });
    setGapTrainingPickerStationId(recommendedStationId || gapRules.find((rule) => {
      const row = gapActiveCoverageAnalysis.rows.find((item) => item.stationId === rule.stationId);
      return row?.shortage;
    })?.stationId || gapRules[0]?.stationId || "");
    setGapTrainingDialogOpen(false);
  }

  function addGapTrainingSimulationFromPicker(stationId = gapTrainingPickerSelectedStationId) {
    if (!gapTrainingPickerPerson || !stationId) return;
    setGapTrainingSimulations((current) => [
      ...current.filter((item) => item.employeeId !== gapTrainingPickerPerson.id),
      { employeeId: gapTrainingPickerPerson.id, stationId },
    ]);
    setGapTrainingPicker(null);
  }

  function openQualificationReviewForTraining() {
    if (!gapTrainingPickerPerson || !gapTrainingPickerSelectedStationId) return;
    setReviewShift(getTeamOfPerson(gapTrainingPickerPerson) as TeamName);
    setReviewEmployeeId(gapTrainingPickerPerson.id);
    setReviewStationId(gapTrainingPickerSelectedStationId);
    setReviewStatus("訓練中");
    setGapTrainingPicker(null);
    setGapTrainingDialogOpen(false);
    setPage("qualification-review");
    scrollToTop();
  }

  function confirmAction(message: string) {
    return window.confirm(message);
  }

  function updateLoginKeep(option: LoginKeepKey) {
    setLoginKeep(option);
    window.localStorage.setItem(loginKeepStorageKey, option);
    setFlashMessage(`重新整理保持登入時間已設定為：${loginKeepOptions.find((item) => item.key === option)?.label || option}`);
    const stored = readStoredLoginSession();
    if (currentUser && stored) {
      void postGasAction("session", { sessionDurationMs: getLoginKeepMs(option) })
        .then((result) => {
          const expiresAt = Number(result.sessionExpiresAt || 0);
          if (expiresAt) saveStoredLoginSession({ ...stored, expiresAt });
        })
        .catch((error) => setFlashMessage(`保持登入時間更新失敗：${error instanceof Error ? error.message : String(error)}`));
    }
  }

  function logout() {
    const request = postGasAction("logout", {});
    clearStoredLoginSession();
    setCurrentUser(null);
    setData(emptyBootstrap);
    setPermissionItemStates(databasePermissionItems.map((item) => ({ ...item })));
    setRolePermissionMapStates(databaseRolePermissionMaps.map((item) => ({ ...item })));
    setPersonalPermissionExceptions([]);
    loginAutoSubmittedRef.current = false;
    loginManualInputRef.current = false;
    void request.catch(() => undefined);
    setPage("home");
    setFlashMessage("已登出。");
    setMobileDetailModal(null);
    scrollToTop();
  }

  async function handleLogin(credentials?: { account: string; password: string }) {
    if (loginSubmittingRef.current) return;

    const account = (credentials?.account ?? loginAccountRef.current?.value ?? loginForm.account).trim();
    const password = (credentials?.password ?? loginPasswordRef.current?.value ?? loginForm.password).trim();

    if (!account) {
      setFlashMessage("請輸入登入帳號。");
      return;
    }
    if (!password) {
      setFlashMessage("請輸入登入密碼。");
      return;
    }

    loginSubmittingRef.current = true;
    setLoginSubmitting(true);
    setFlashMessage("正在驗證帳號，請稍候...");

    try {
      const result = await postGasAction("login", {
        account,
        password,
        sessionDurationMs: getLoginKeepMs(loginKeep),
      }) as GasSessionResponse;
      if (!result.ok || !result.user || !result.sessionToken || !result.sessionExpiresAt) {
        setFlashMessage(
          result.ok && result.user
            ? "登入服務尚未完成安全更新，請部署最新 GAS 後再試。"
            : result.message || "登入失敗。",
        );
        return;
      }

      const bootstrapUser = data.people.find((person) => person.id === result.user?.id);
      const mergedUser = bootstrapUser ? { ...bootstrapUser, ...result.user } : result.user;

      setGasSessionToken(result.sessionToken);
      setCurrentUser(mergedUser);
      saveStoredLoginSession({
        userId: mergedUser.id,
        sessionToken: result.sessionToken,
        expiresAt: result.sessionExpiresAt,
      });
      setLoginForm({ account: "", password: "" });
      setPage("home");
      setFlashMessage(`登入成功：${mergedUser.name}，重新整理仍會保留登入。`);
      scrollToTop();
    } catch (error) {
      const message = error instanceof Error ? error.message : "請確認 GAS login 已重新部署。";
      setFlashMessage(`登入失敗：${message}`);
      setPage("home");
      scrollToTop();
    } finally {
      loginSubmittingRef.current = false;
      setLoginSubmitting(false);
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
    await postGasAction("upsertQualification", payload as unknown as Record<string, unknown>);
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

  async function handleSaveQualification(statusOverride?: QualificationStatus, confirmBeforeSave = true) {
    const employee = reviewSelectedPerson || mobileReviewPerson;
    const nextStatus = statusOverride ?? reviewStatus;
    if (!employee || !reviewStationId) {
      setFlashMessage("請先選擇人員與站點。");
      return false;
    }

    try {
      const ok = await persistQualification(employee, reviewStationId, nextStatus, confirmBeforeSave);
      if (ok) {
        setFlashMessage("站點考核已確認並儲存。");
        return true;
      }
      return false;
    } catch (error) {
      setFlashMessage(`站點考核儲存失敗：${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async function handleDeleteQualification(employeeId: string, stationId: string) {
    const person = data.people.find((item) => item.id === employeeId);
    const station = data.stations.find((item) => item.id === stationId);
    if (!confirmAction(`確認刪除 ${person?.name || employeeId} 的 ${station?.name || stationId} 資格？`)) {
      setFlashMessage("已取消刪除。");
      return;
    }
    await postGasAction("deleteQualification", { employeeId, stationId });
    setData((current) => ({ ...current, qualifications: current.qualifications.filter((item) => !(item.employeeId === employeeId && item.stationId === stationId)) }));
    setFlashMessage("站點考核已刪除。");
  }

  async function handleUpdatePerson(person: Person, patch: Partial<Person>) {
    const next = { ...person, ...patch };
    if (!confirmAction(`確認修改人員 ${person.name}（${person.id}）？`)) {
      setFlashMessage("已取消修改。");
      return;
    }
    await postGasAction("updatePerson", buildPersonProfilePayload(next));
    setData((current) => ({ ...current, people: current.people.map((item) => (item.id === person.id ? next : item)) }));
    if (currentUser?.id === person.id) setCurrentUser(next);
    setFlashMessage(`人員 ${person.name} 已寫入試算表。`);
  }

  async function handleCreatePerson() {
    const { person: next, error } = prepareNewPerson(newPersonDraft, data.people);
    if (error) {
      setFlashMessage(error);
      return;
    }

    if (!appEnvironment.writesEnabled) {
      setNewPersonDraft(next);
      setFlashMessage(`新增資料檢查通過：${next.name}（${next.id}）。測試版唯讀，尚未寫入正式資料。`);
      return;
    }
    if (!confirmAction(`確認新增人員 ${next.name}（${next.id}）至 ${next.shift}？`)) {
      setFlashMessage("已取消新增人員。");
      return;
    }

    setNewPersonSubmitting(true);
    try {
      const result = await postGasAction("createPerson", next as unknown as Record<string, unknown>);
      const created = result.person && typeof result.person === "object"
        ? { ...next, ...(result.person as Person) }
        : next;
      setData((current) => ({ ...current, people: [...current.people, created] }));
      setPeopleTeamFilter(created.shift as TeamName);
      setPeopleSearchKeyword(created.id);
      setNewPersonOpen(false);
      setNewPersonDraft(createEmptyPersonDraft());
      setFlashMessage(`已新增 ${created.name}（${created.id}），並同步寫入人員主表與站點矩陣。`);
    } catch (error) {
      setFlashMessage(`新增人員失敗：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setNewPersonSubmitting(false);
    }
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
    if (!confirmAction(`確認將 ${person.name}（${person.id}）的系統權限調整為「${permission}」？`)) {
      setFlashMessage("已取消修改。");
      return;
    }
    await postGasAction("updatePerson", { id: person.id, ...patch });
    const next = { ...person, ...patch };
    setData((current) => ({ ...current, people: current.people.map((item) => (item.id === person.id ? next : item)) }));
    if (currentUser?.id === person.id) setCurrentUser(next);
    setFlashMessage(`已更新 ${person.name} 的系統權限。`);
  }

  async function handleUpdateRule(rule: StationRule, patch: Partial<StationRule>) {
    if (!canEditRulesForTeam(rule.team)) {
      setFlashMessage("你只能修改自己班的站點規則；最高權限才可修改全部班別。");
      return;
    }
    const next = { ...rule, ...patch };
    const station = data.stations.find((item) => item.id === rule.stationId);
    if (Number(next.maxAssignable || 0) > 0 && Number(next.maxAssignable || 0) < Number(next.minRequired || 0)) {
      setFlashMessage("可排滿人數不可小於最低需求；若不補人請填 0。");
      return;
    }
    if (!confirmAction(`確認修改 ${rule.team} 的 ${station?.name || rule.stationId} 規則？`)) {
      setFlashMessage("已取消修改。");
      return;
    }
    await postGasAction("updateStationRule", next as unknown as Record<string, unknown>);
    setData((current) => {
      const rules = current.stationRules || [];
      const sameRule = (item: StationRule) =>
        item.id === rule.id ||
        (item.team === rule.team && item.stationId === rule.stationId && String(item.dayKey || "當班") === String(rule.dayKey || "當班"));
      const exists = rules.some(sameRule);
      return {
        ...current,
        stationRules: exists
          ? rules.map((item) => (sameRule(item) ? next : item))
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
    const rows = buildSmartAssignments(manualShift, manualDay, data.stationRules || [], assignablePeople, data.qualifications, manualMode, { useMinRequired: true, randomize: true });
    const next: Record<string, string[]> = {};
    rows.forEach((row) => {
      next[row.stationId] = row.assigned.filter((person) => !manualOfficerIds.has(person.id)).map((person) => person.id);
    });
    setManualAssignments(next);
    setFlashMessage(`自動安排已完成：${manualMode}；幹部勤務與站長站位維持不變。`);
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

    const currentStatus = getStationQualificationStatus(data.qualifications, person.id, stationId);
    const isQualified = currentStatus === "合格";
    const isTraining = currentStatus === "訓練中";

    if (!isQualified && !isTraining) {
      setManualTrainingDialog({
        stationId,
        personId: person.id,
        currentStatus: currentStatus || "無站點資格",
      });
      return;
    }

    assignManualPerson(stationId, person.id, false);
    setFlashMessage(isTraining ? `${person.name} 已以訓練人員加入 ${station.name}。` : `${person.name} 已加入 ${station.name}。`);
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
    let ok = false;
    try {
      ok = await persistQualification(person, stationId, "訓練中", false);
    } catch (error) {
      setFlashMessage("訓練中考核資料儲存失敗：" + (error instanceof Error ? error.message : String(error)));
      return;
    }
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
      lines.push(row.people.map((person) => person.isTraining ? `${person.name}（訓練人員）` : person.name).join("、") || "-");
      lines.push("");
    });
    return lines.join("\n").trim();
  }

  function completeManualSchedule() {
    setManualSafetyAcknowledged(false);
    setManualSafetyOpen(true);
  }

  function confirmManualScheduleSafety() {
    if (!manualSafety.canPreview) return;
    if (manualSafety.requiresAcknowledgement && !manualSafetyAcknowledged) return;
    setManualSafetyOpen(false);
    setManualPreviewOpen(true);
  }

  async function saveManualScheduleDraft() {
    if (!hasManualAssignments) {
      setFlashMessage("目前沒有可儲存的站點試排內容。");
      return;
    }

    const details = [
      ...Object.entries(manualAssignments).flatMap(([stationId, personIds]) =>
        personIds.map((employeeId, index) => ({
          stationId,
          employeeId,
          type: "站點",
          order: index + 1,
          note: "手動站點試排",
        }))
      ),
      ...Object.entries(manualOfficerStations).map(([employeeId, stationId], index) => ({
        stationId,
        employeeId,
        type: "幹部",
        order: index + 1,
        note: "幹部站位",
      })),
      ...manualExtraWorks.flatMap((work, workIndex) =>
        work.personIds.map((employeeId, personIndex) => ({
          stationId: work.id,
          employeeId,
          type: "自訂",
          order: workIndex * 100 + personIndex + 1,
          note: work.workName.trim() || `臨時勤務 ${workIndex + 1}`,
        }))
      ),
    ];

    try {
      await postGasAction("saveScheduleDraft", {
        name: `${manualShift}_${manualDay}_${manualMode}_站點試排`,
        team: manualShift,
        dayKey: manualDay,
        mode: manualMode,
        status: "草稿",
        createdBy: currentUser?.name || currentUser?.id || "前端",
        note: "由站點試排頁面儲存",
        details,
      });
      setFlashMessage("站點試排草稿已儲存到試算表。");
    } catch (error) {
      setFlashMessage(`站點試排草稿儲存失敗：${error instanceof Error ? error.message : String(error)}`);
    }
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
    const hasTrainingPeople = rows.some((row) => row.people.some((person) => person.isTraining));
    const personRowHeight = hasTrainingPeople ? 58 : 46;
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
      const headerTop = y0 + 44;
      const headerBodyHeight = headerHeight - 44;
      const stationCenterX = x + colWidth / 2;
      const stationLineHeight = 25;
      const codeGap = label.code ? 12 : 0;
      const codeLineHeight = label.code ? 24 : 0;
      ctx.fillStyle = "#0f172a";
      ctx.font = "900 20px 'Noto Sans TC', 'PingFang TC', sans-serif";
      const nameLines = wrapCanvasText(ctx, label.name, colWidth - 18).slice(0, 3);
      const stationTextHeight = nameLines.length * stationLineHeight + codeGap + codeLineHeight;
      const stationStartY = headerTop + (headerBodyHeight - stationTextHeight) / 2 + 20;
      ctx.textAlign = "center";
      nameLines.forEach((line, idx) => ctx.fillText(line, stationCenterX, stationStartY + idx * stationLineHeight));
      if (label.code) {
        ctx.font = "900 18px 'Noto Sans TC', 'PingFang TC', sans-serif";
        ctx.fillStyle = "#1e3a8a";
        ctx.fillText(label.code, stationCenterX, stationStartY + nameLines.length * stationLineHeight + codeGap);
        ctx.fillStyle = "#0f172a";
      }
      ctx.textAlign = "start";
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
        const chipH = person.isTraining ? 44 : 32;
        ctx.beginPath();
        ctx.roundRect(chipX, chipY, chipW, chipH, 12);
        ctx.fillStyle = person.isTraining ? "#fef3c7" : person.isOfficer ? "#bbf7d0" : "#f1f5f9";
        ctx.fill();
        ctx.lineWidth = person.isOfficer || person.isTraining ? 2 : 1;
        ctx.strokeStyle = person.isTraining ? "#f59e0b" : person.isOfficer ? "#16a34a" : "#cbd5e1";
        ctx.stroke();
        ctx.fillStyle = person.isTraining ? "#92400e" : person.isOfficer ? "#166534" : "#334155";
        if (person.isTraining) {
          ctx.font = "900 16px 'Noto Sans TC', 'PingFang TC', sans-serif";
          ctx.fillText(person.name, chipX + 10, chipY + 18);
          ctx.font = "700 11px 'Noto Sans TC', 'PingFang TC', sans-serif";
          ctx.fillText("訓練人員", chipX + 10, chipY + 34);
          ctx.font = "900 18px 'Noto Sans TC', 'PingFang TC', sans-serif";
        } else {
          ctx.fillText(person.name, chipX + 10, chipY + 22);
        }
      });
    }

    ctx.fillStyle = "#64748b";
    ctx.font = "700 15px 'Noto Sans TC', 'PingFang TC', sans-serif";
    ctx.fillText("※ 綠色為站長站位；黃色為訓練人員。", x0, height - 16);

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
      const lines = wrapCanvasText(ctx, row.people.map((person) => person.isTraining ? `${person.name}（訓練）` : person.name).join("、") || "-", width - padding * 2 - 36);
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
        const text = person.isTraining ? `${person.name} 訓練` : person.name;
        const chipWidth = Math.min(Math.max(58, ctx.measureText(text).width + 24), chipMaxX - x - 56);
        if (chipX + chipWidth > chipMaxX && chipX > x + 28) {
          chipX = x + 28;
          chipY += chipHeight + 10;
        }
        ctx.beginPath();
        ctx.roundRect(chipX, chipY, chipWidth, chipHeight, 16);
        ctx.fillStyle = person.isTraining ? "#fef3c7" : person.isOfficer ? "#dcfce7" : (isPoster ? "rgba(255,255,255,.16)" : "#f1f5f9");
        ctx.fill();
        ctx.lineWidth = person.isOfficer || person.isTraining ? 2 : 1;
        ctx.strokeStyle = person.isTraining ? "#f59e0b" : person.isOfficer ? "#22c55e" : (isPoster ? "rgba(255,255,255,.24)" : "#e2e8f0");
        ctx.stroke();
        ctx.fillStyle = person.isTraining ? "#92400e" : person.isOfficer ? "#166534" : (isPoster ? "#e2e8f0" : "#334155");
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
          <span key={`${person.name}-${index}`} className={`schedule-person-tag${person.isOfficer ? " officer" : ""}${person.isTraining ? " training" : ""}`}>
            {person.name}
            {person.isTraining ? <small>訓練人員</small> : null}
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
    setFlashMessage(`自動試排已完成：${smartMode}`);
    window.setTimeout(releaseActiveControl, 0);
    window.setTimeout(releaseActiveControl, 120);
  }

  function renderPermissionAdmin() {
    const permissionItemMap = new Map(permissionItemStates.map((item) => [item.id, item]));
    const getAccountStatus = (person: Person) =>
      accountStatusById[person.id] || (String((person as Person & Record<string, unknown>).accountStatus || (person as Person & Record<string, unknown>).enabled || "啟用").includes("停") ? "停用" : "啟用");
    const enabledAccountCount = permissionRows.filter((person) => getAccountStatus(person) === "啟用").length;
    const visiblePermissions = permissionItemStates.filter((item) => permissionSearchMatches([item.id, item.name, item.category, item.page, item.action, item.enabled, item.note], permissionSearchKeyword));
    const availablePermissions = permissionItemStates.filter((item) => item.enabled !== "停用");
    const canEditPermissions = currentRole === "最高權限";
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

    async function setPersonalException(person: Person | null, permissionId: string, effect: PersonalPermissionEffect) {
      if (!person || currentRole !== "最高權限") return;
      const before = personalPermissionExceptions;
      const exists = before.find((item) => item.employeeId === person.id && item.permissionId === permissionId);
      const updatedBy = currentUser?.name || currentUser?.id || "前端";

      if (exists?.effect === effect && exists.enabled !== "停用") {
        const next = before.map((item) => item.id === exists.id ? { ...item, enabled: "停用" } : item);
        setPersonalPermissionExceptions(next);
        try {
          await postGasAction("deletePersonalPermissionException", {
            id: exists.id,
            employeeId: person.id,
            permissionId,
            updatedBy,
          });
          setFlashMessage("個人例外權限已取消並儲存。");
        } catch (error) {
          setPersonalPermissionExceptions(before);
          setFlashMessage(`個人例外權限取消失敗：${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }

      const nextItem: PersonalPermissionExceptionDefinition = exists
        ? { ...exists, effect, enabled: "啟用", note: effect === "allow" ? "個人額外開放" : "個人單獨禁止" }
        : {
            id: `EXC_${person.id}_${permissionId}`,
            employeeId: person.id,
            permissionId,
            effect,
            enabled: "啟用",
            note: effect === "allow" ? "個人額外開放" : "個人單獨禁止",
          };
      const next = exists
        ? before.map((item) => item.id === exists.id ? nextItem : item)
        : [...before, nextItem];
      setPersonalPermissionExceptions(next);

      try {
        await postGasAction("upsertPersonalPermissionException", { ...nextItem, updatedBy });
        setFlashMessage("個人例外權限已儲存到試算表。");
      } catch (error) {
        setPersonalPermissionExceptions(before);
        setFlashMessage(`個人例外權限儲存失敗：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    async function togglePermissionItemEnabled(permissionId: string) {
      if (!canEditPermissions) {
        setFlashMessage("只有最高權限可調整全站功能啟用狀態。");
        return;
      }
      const before = permissionItemStates;
      const target = before.find((item) => item.id === permissionId);
      if (!target) return;
      const nextItem = { ...target, enabled: target.enabled === "啟用" ? "停用" : "啟用" };
      setPermissionItemStates(before.map((item) => item.id === permissionId ? nextItem : item));
      try {
        await postGasAction("updatePermissionItem", {
          ...nextItem,
          updatedBy: currentUser?.name || currentUser?.id || "前端",
        });
        setFlashMessage(`權限項目已${nextItem.enabled}並儲存到試算表。`);
      } catch (error) {
        setPermissionItemStates(before);
        setFlashMessage(`權限項目儲存失敗：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    async function toggleRolePermission(role: UserRole, permissionId: string) {
      if (!canEditPermissions) {
        setFlashMessage("只有最高權限可調整角色開放項目。");
        return;
      }
      const before = rolePermissionMapStates;
      const mapId = `ROLEMAP_${role}_${permissionId}`;
      const exists = before.find((item) => item.role === role && item.permissionId === permissionId);
      if (role === "最高權限") {
        setFlashMessage("最高權限角色固定全功能開放，避免誤關後無法維護系統。");
        return;
      }
      const nextAllowed = exists?.allowed === "Y" && exists.enabled === "啟用" ? "N" : "Y";
      const nextItem: RolePermissionMapDefinition = exists
        ? { ...exists, allowed: nextAllowed, enabled: "啟用", note: nextAllowed === "Y" ? "角色已開放" : "角色已關閉" }
        : { id: mapId, role, permissionId, allowed: "Y", enabled: "啟用", note: "角色已開放" };
      const next = exists
        ? before.map((item) => item.id === exists.id ? nextItem : item)
        : [...before, nextItem];
      setRolePermissionMapStates(next);
      try {
        await postGasAction("updateRolePermission", {
          ...nextItem,
          mapId: nextItem.id,
          updatedBy: currentUser?.name || currentUser?.id || "前端",
        });
        setFlashMessage(`角色權限已${nextItem.allowed === "Y" ? "開放" : "關閉"}並儲存到試算表。`);
      } catch (error) {
        setRolePermissionMapStates(before);
        setFlashMessage(`角色權限儲存失敗：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    async function toggleAccountEnabled(person: Person) {
      if (currentRole !== "最高權限") return;
      const nextStatus = getAccountStatus(person) === "啟用" ? "停用" : "啟用";
      const beforeStatus = getAccountStatus(person);
      setAccountStatusById((current) => ({ ...current, [person.id]: nextStatus }));
      try {
        const payload = {
          id: person.id,
          accountStatus: nextStatus,
          accountEnabled: nextStatus,
          enabled: nextStatus === "啟用" ? "Y" : "N",
        } as Person & Record<string, unknown>;
        await postGasAction("updatePerson", payload);
        setData((current) => ({
          ...current,
          people: current.people.map((item) => item.id === person.id ? { ...item, ...payload } as Person : item),
        }));
        if (currentUser?.id === person.id) setCurrentUser((current) => current ? ({ ...current, ...payload } as Person) : current);
        setFlashMessage(`帳號 ${person.name} 已${nextStatus}並寫入試算表。`);
      } catch (error) {
        setAccountStatusById((current) => ({ ...current, [person.id]: beforeStatus }));
        setFlashMessage(`帳號狀態儲存失敗：${error instanceof Error ? error.message : String(error)}`);
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
        const payload = {
          id: person.id,
          password: nextPassword,
        } as Person & Record<string, unknown>;
        await postGasAction("updatePerson", payload);
        setAccountPasswordDrafts((current) => ({ ...current, [person.id]: "" }));
        setFlashMessage(`已重設 ${person.name} 的登入密碼。系統不會顯示或回傳密碼內容。`);
      } catch (error) {
        setFlashMessage(`密碼儲存失敗：${error instanceof Error ? error.message : String(error)}`);
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
      <EntranceLayout pageKey="permission-admin">
        <div className="grid three compact-home-stats">
          <StatCard title="07 帳號管理" value={String(permissionRows.length)} note={`啟用參考：${enabledAccountCount}`} />
          <StatCard title="08 權限項目" value={String(permissionItemStates.length)} note="可切換啟用/停用" />
          <StatCard title="個人例外權限" value={String(personalPermissionExceptions.filter((item) => item.enabled !== "停用").length)} note="已接 GAS 存檔" />
        </div>

        <div className="panel">
          <div className="toolbar" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[tabButton("role", "角色權限"), tabButton("account", "帳號管理"), tabButton("items", "權限項目"), tabButton("exceptions", "例外權限"), tabButton("check", "權限檢查")]}
          </div>
          <div className="toolbar">
            <input placeholder="搜尋工號、姓名、權限項目、角色、功能頁面" value={permissionSearchKeyword} onChange={(e) => setPermissionSearchKeyword(e.target.value)} />
          </div>
          <p className="muted">判斷順序：個人單獨禁止 ＞ 個人額外開放 ＞ 角色預設權限。只有最高權限可調整角色開放項目與全站功能啟用狀態，變更會寫入試算表保存。</p>
        </div>

        {permissionAdminTab === "role" ? (
          <>
            <div className="panel">
              <div className="panel-header"><h3>角色權限</h3><span>此頁管理「目前選取角色可以使用哪些功能」；只有最高權限可調整，並會寫入 09_角色權限設定。</span></div>
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
                        }, disabled ? "全站功能停用" : enabled ? "此角色可用" : "此角色不可用")}
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
            <div className="panel-header"><h3>帳號管理</h3><span>角色、密碼重設與啟用狀態</span></div>
            <div style={{ display: "grid", gap: 8 }}>
              {permissionRows.map((person) => {
                const permission = String(getSystemPermission(person) || "技術員");
                const accountStatus = getAccountStatus(person);
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
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 5 }}>
                      <input
                        type="password"
                        autoComplete="new-password"
                        placeholder="輸入新密碼"
                        aria-label={`重設 ${person.name} 的登入密碼`}
                        value={accountPasswordDrafts[person.id] || ""}
                        onChange={(e) => setAccountPasswordDrafts((current) => ({ ...current, [person.id]: e.target.value }))}
                        style={{ minHeight: 32, fontSize: 13 }}
                      />
                      <button className="primary" type="button" onClick={() => updateAccountPassword(person)} style={{ borderRadius: 12, minHeight: 32, padding: "0 9px", fontSize: 13 }}>重設</button>
                    </div>
                    {enabledToggleButton(accountStatus === "啟用", () => toggleAccountEnabled(person))}
                  </div>
                );
              })}
            </div>
            <p className="muted">基於帳號安全，系統不會讀回或顯示現有密碼；需要變更時請直接設定新密碼。</p>
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
            <p className="muted">此頁已接 GAS 寫入端點；個人例外權限會寫入 10_個人例外權限。</p>
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
      </EntranceLayout>
    );
  }

  const navItems: Array<{ key: PageKey; label: string }> = [
    { key: "home", label: "今日總覽" },
    { key: "person-query", label: "人員資格" },
    { key: "station-query", label: "站點人選" },
    { key: "qualification-review", label: "資格考核" },
    { key: "gap-analysis", label: "覆蓋分析" },
    { key: "manual-schedule", label: "班表試排" },
    { key: "station-rules", label: "站點規則" },
    { key: "people-management", label: "人員名單" },
    { key: "permission-admin", label: "權限設定" },
  ];

  const allowedNav = navItems.filter((item) => canUsePage(item.key));

  function renderStationRulesPage() {
    const canViewCurrentRulesTeam = canViewRulesForTeam(rulesTeam);
    const disabled = !canEditRulesForTeam(rulesTeam);
    const visibleStationRuleRows = canViewCurrentRulesTeam ? stationRuleRows : [];
    const editingRule = visibleStationRuleRows.find((rule) => `${rule.team}-${rule.stationId}` === editingRuleKey) || null;
    const editingRuleStation = editingRule ? data.stations.find((item) => item.id === editingRule.stationId) : null;
    const mandatoryCount = visibleStationRuleRows.filter((rule) => rule.isMandatory).length;
    const trainingCount = visibleStationRuleRows.filter((rule) => rule.trainingCanFill).length;
    const shareCount = visibleStationRuleRows.filter((rule) => rule.canShare).length;
    const totalMin = visibleStationRuleRows.reduce((sum, rule) => sum + Number(rule.minRequired || 0), 0);
    const totalMaxAssignable = visibleStationRuleRows.reduce((sum, rule) => sum + Number(rule.maxAssignable || 0), 0);

    if (!visibleRulesTeams.length) {
      return (
        <EntranceLayout pageKey="station-rules">
          <div className="panel">
            <Empty text="站點規則設定只開放當班主任查看自己班；最高權限可查看四個班。" />
          </div>
        </EntranceLayout>
      );
    }

    return (
      <EntranceLayout pageKey="station-rules">
        <div className="panel mobile-management-panel">
          <div className="mobile-management-toolbar">
            <select value={rulesTeam} onChange={(e) => setRulesTeam(e.target.value as TeamName)} disabled={visibleRulesTeams.length <= 1}>
              {visibleRulesTeams.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <span className="status-pill">{currentRole === "最高權限" ? "最高權限：可查看四班" : "主任：僅限自己班"}</span>
          </div>
          <button type="button" className="rules-summary-card" onClick={() => setRulesPreviewOpen(true)}>
            <strong>{rulesTeam} 規則總覽</strong>
            <span>站點 {visibleStationRuleRows.length}｜最低需求 {totalMin}｜可排滿 {totalMaxAssignable || "未設定"}｜必站 {mandatoryCount}｜訓練補位 {trainingCount}｜支援補位 {shareCount}</span>
            <small>點擊查看總表，可切換編輯模式一次核對修正</small>
          </button>
          {visibleStationRuleRows.length ? (
            <div className="mobile-rule-card-list">
              {visibleStationRuleRows.map((rule) => {
                const station = data.stations.find((item) => item.id === rule.stationId);
                const key = `${rule.team}-${rule.stationId}`;
                return (
                  <article className="mobile-rule-card" key={key}>
                    <div className="mobile-card-header">
                      <div>
                        <h3>{station?.name || rule.stationId}</h3>
                        <p>{rule.stationId}｜{rule.team}</p>
                      </div>
                      <span className={`status-pill ${disabled ? "muted-pill" : "green-pill"}`}>{disabled ? "唯讀" : "可編輯"}</span>
                    </div>
                    <div className="rule-metric-grid">
                      <div><span>最低需求</span><strong>{rule.minRequired ?? 0}</strong></div>
                      <div><span>輪休需求</span><strong>{rule.reliefMinPerBatch ?? 0}</strong></div>
                      <div><span>可排滿</span><strong>{rule.maxAssignable || "-"}</strong></div>
                      <div><span>優先順序</span><strong>{rule.priority ?? 0}</strong></div>
                    </div>
                    <div className="rule-chip-row">
                      <span className={rule.isMandatory ? "chip-on" : "chip-off"}>必站：{rule.isMandatory ? "Y" : "N"}</span>
                      <span className={rule.trainingCanFill ? "chip-on" : "chip-off"}>訓練中：{rule.trainingCanFill ? "Y" : "N"}</span>
                      <span className={rule.canShare ? "chip-on" : "chip-off"}>支援補位：{rule.canShare ? "Y" : "N"}</span>
                    </div>
                    <button type="button" className="primary full-width" disabled={disabled} onClick={() => setEditingRuleKey(key)}>編輯規則</button>
                  </article>
                );
              })}
            </div>
          ) : <Empty text="找不到此班別的正式站點規則，請先至資料端補齊。" />}
        </div>
        {rulesPreviewOpen ? (
          <DialogShell
            open={rulesPreviewOpen}
            title={`${rulesTeam} 規則總覽`}
            onClose={() => setRulesPreviewOpen(false)}
            backdropClassName="mobile-modal-backdrop upgraded-modal-backdrop"
            panelClassName="mobile-modal compact-preview-modal upgraded-modal-card rules-overview-modal"
            closeOnBackdrop
          >
              <button type="button" className="mobile-modal-floating-close" aria-label="關閉規則總覽" onClick={() => setRulesPreviewOpen(false)}>×</button>
              <div className="mobile-modal-header upgraded-modal-header">
                <div>
                  <strong>{rulesTeam} 規則總覽</strong>
                  <small>共 {visibleStationRuleRows.length} 個站點｜{rulesOverviewEditing ? "編輯模式：欄位失焦或切換時會要求確認儲存" : "檢查模式：集中核對全部規則"}</small>
                </div>
                <button type="button" className={rulesOverviewEditing ? "ghost" : "primary"} disabled={disabled} onClick={() => setRulesOverviewEditing((current) => !current)}>
                  {rulesOverviewEditing ? "完成編輯" : "編輯總覽"}
                </button>
              </div>
              <div className="mobile-modal-body upgraded-modal-body">
                <div className="rules-overview-scroll">
                  <table className="rules-overview-table">
                    <thead>
                      <tr>
                        <th>站點</th>
                        <th>最低</th>
                        <th>輪休</th>
                        <th>可排滿</th>
                        <th>備援</th>
                        <th>序</th>
                        <th>必站</th>
                        <th>訓練</th>
                        <th>支援</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleStationRuleRows.map((rule) => {
                        const station = data.stations.find((item) => item.id === rule.stationId);
                        const maxAssignableInvalid = Number(rule.maxAssignable || 0) > 0 && Number(rule.maxAssignable || 0) < Number(rule.minRequired || 0);
                        return (
                          <tr key={`${rule.team}-${rule.stationId}`} className={maxAssignableInvalid ? "danger-row" : ""}>
                            <td><strong>{station?.name || rule.stationId}</strong><span>{rule.stationId}</span></td>
                            <td>{rulesOverviewEditing ? <ConfirmNumberInput value={rule.minRequired ?? 0} disabled={disabled} onCommit={(value) => handleUpdateRule(rule, { minRequired: value })} /> : rule.minRequired ?? 0}</td>
                            <td>{rulesOverviewEditing ? <ConfirmNumberInput value={rule.reliefMinPerBatch ?? 0} disabled={disabled} onCommit={(value) => handleUpdateRule(rule, { reliefMinPerBatch: value })} /> : rule.reliefMinPerBatch ?? 0}</td>
                            <td>{rulesOverviewEditing ? <ConfirmNumberInput value={rule.maxAssignable ?? 0} disabled={disabled} onCommit={(value) => handleUpdateRule(rule, { maxAssignable: value })} /> : rule.maxAssignable || "-"}</td>
                            <td>{rulesOverviewEditing ? <ConfirmNumberInput value={rule.backupTarget ?? 0} disabled={disabled} onCommit={(value) => handleUpdateRule(rule, { backupTarget: value })} /> : rule.backupTarget ?? 0}</td>
                            <td>{rulesOverviewEditing ? <ConfirmNumberInput value={rule.priority ?? 0} disabled={disabled} onCommit={(value) => handleUpdateRule(rule, { priority: value })} /> : rule.priority ?? 0}</td>
                            <td>{rulesOverviewEditing ? <ConfirmSelect value={rule.isMandatory ? "Y" : "N"} disabled={disabled} options={[{ label: "Y", value: "Y" }, { label: "N", value: "N" }]} onCommit={(value) => handleUpdateRule(rule, { isMandatory: value === "Y" })} /> : rule.isMandatory ? "Y" : "N"}</td>
                            <td>{rulesOverviewEditing ? <ConfirmSelect value={rule.trainingCanFill ? "Y" : "N"} disabled={disabled} options={[{ label: "Y", value: "Y" }, { label: "N", value: "N" }]} onCommit={(value) => handleUpdateRule(rule, { trainingCanFill: value === "Y" })} /> : rule.trainingCanFill ? "Y" : "N"}</td>
                            <td>{rulesOverviewEditing ? <ConfirmSelect value={rule.canShare ? "Y" : "N"} disabled={disabled} options={[{ label: "Y", value: "Y" }, { label: "N", value: "N" }]} onCommit={(value) => handleUpdateRule(rule, { canShare: value === "Y" })} /> : rule.canShare ? "Y" : "N"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="muted compact-line">「可排滿」空白或 0 表示不補人；若低於最低需求，該列將以紅色標示。</p>
              </div>
          </DialogShell>
        ) : null}
        {editingRule ? (
          <DialogShell
            open={Boolean(editingRule)}
            title="編輯站點規則"
            onClose={() => setEditingRuleKey("")}
            backdropClassName="mobile-modal-backdrop upgraded-modal-backdrop"
            panelClassName="mobile-modal mobile-edit-sheet upgraded-modal-card"
            closeOnBackdrop
          >
              <button type="button" className="mobile-modal-floating-close" aria-label="關閉編輯視窗" onClick={() => setEditingRuleKey("")}>×</button>
              <div className="mobile-modal-header upgraded-modal-header">
                <div>
                  <strong>編輯站點規則</strong>
                  <small>{editingRuleStation?.name || editingRule.stationId}｜{editingRule.stationId}</small>
                </div>
              </div>
              <div className="mobile-modal-body upgraded-modal-body">
                <section className="mobile-form-section">
                  <div className="mobile-form-section-title">人數與排序</div>
                  <div className="mobile-edit-grid upgraded-edit-grid">
                    <label>最低需求<ConfirmNumberInput value={editingRule.minRequired} disabled={disabled} onCommit={(value) => handleUpdateRule(editingRule, { minRequired: value })} /></label>
                    <label>輪休需求<ConfirmNumberInput value={editingRule.reliefMinPerBatch ?? 0} disabled={disabled} onCommit={(value) => handleUpdateRule(editingRule, { reliefMinPerBatch: value })} /></label>
                    <label>可排滿<ConfirmNumberInput value={editingRule.maxAssignable ?? 0} disabled={disabled} onCommit={(value) => handleUpdateRule(editingRule, { maxAssignable: value })} /></label>
                    <label>備援目標<ConfirmNumberInput value={editingRule.backupTarget ?? 0} disabled={disabled} onCommit={(value) => handleUpdateRule(editingRule, { backupTarget: value })} /></label>
                    <label>優先順序<ConfirmNumberInput value={editingRule.priority ?? 0} disabled={disabled} onCommit={(value) => handleUpdateRule(editingRule, { priority: value })} /></label>
                  </div>
                </section>
                <section className="mobile-form-section">
                  <div className="mobile-form-section-title">站點屬性</div>
                  <div className="mobile-edit-grid upgraded-edit-grid">
                    <label>必站<ConfirmSelect value={editingRule.isMandatory ? "Y" : "N"} disabled={disabled} options={[{ label: "Y", value: "Y" }, { label: "N", value: "N" }]} onCommit={(value) => handleUpdateRule(editingRule, { isMandatory: value === "Y" })} /></label>
                    <label>訓練中可補位<ConfirmSelect value={editingRule.trainingCanFill ? "Y" : "N"} disabled={disabled} options={[{ label: "Y", value: "Y" }, { label: "N", value: "N" }]} onCommit={(value) => handleUpdateRule(editingRule, { trainingCanFill: value === "Y" })} /></label>
                    <label>支援補位<ConfirmSelect value={editingRule.canShare ? "Y" : "N"} disabled={disabled} options={[{ label: "Y", value: "Y" }, { label: "N", value: "N" }]} onCommit={(value) => handleUpdateRule(editingRule, { canShare: value === "Y" })} /></label>
                  </div>
                </section>
              </div>
              <div className="mobile-modal-footer upgraded-modal-footer">
                <button type="button" className="ghost full-width" onClick={() => setEditingRuleKey("")}>關閉</button>
              </div>
          </DialogShell>
        ) : null}
      </EntranceLayout>
    );
  }

  function renderPeopleManagementPage() {
    const peopleRows = data.people.filter((person) => {
      const team = getTeamOfPerson(person);
      const matchesTeam = peopleTeamFilter === "全部班別" || team === peopleTeamFilter;
      return matchesTeam && searchText([person.id, person.name, String(team), person.role, person.nationality, person.aDay1 || "", person.aDay2 || "", person.bDay1 || "", person.bDay2 || ""], peopleSearchKeyword);
    });
    const editingPerson = data.people.find((person) => person.id === editingPersonId) || null;
    return (
      <EntranceLayout pageKey="people-management">
        <div className="panel mobile-management-panel">
          <div className="mobile-management-toolbar people-management-toolbar">
            <select value={peopleTeamFilter} onChange={(e) => setPeopleTeamFilter(e.target.value as TeamName | "全部班別")} aria-label="篩選班別">
              <option value="全部班別">全部班別</option>
              {TEAM_OPTIONS.map((team) => (
                <option key={team} value={team}>{team}</option>
              ))}
            </select>
            <input placeholder="快速搜尋工號、姓名、班別、職務、國籍" value={peopleSearchKeyword} onChange={(e) => setPeopleSearchKeyword(e.target.value)} />
            <span className="status-pill people-count-pill">{peopleTeamFilter === "全部班別" ? `全部 ${peopleRows.length} 人` : `${peopleTeamFilter} ${peopleRows.length} 人`}</span>
            <button
              type="button"
              className="primary people-create-button"
              onClick={() => {
                setNewPersonDraft(createEmptyPersonDraft());
                setNewPersonOpen(true);
              }}
            >
              新增人員
            </button>
          </div>
          <div className="mobile-person-card-list">
            {peopleRows.map((person) => (
              <article className="mobile-person-card" key={person.id}>
                <div className="mobile-card-header">
                  <div><h3>{person.name || "未命名"}</h3><p>{person.id}</p></div>
                  <button type="button" className="primary" onClick={() => setEditingPersonId(person.id)}>編輯</button>
                </div>
                <div className="person-summary-grid">
                  <div><span>班別</span><strong>{String(getTeamOfPerson(person)) || "-"}</strong></div>
                  <div><span>職務</span><strong>{person.role || "-"}</strong></div>
                  <div><span>國籍</span><strong>{person.nationality || "-"}</strong></div>
                  <div><span>在職</span><strong>{person.employmentStatus || "-"}</strong></div>
                </div>
                <p className="muted compact-line">A1 {person.aDay1 || "-"}｜A2 {person.aDay2 || "-"}｜B1 {person.bDay1 || "-"}｜B2 {person.bDay2 || "-"}</p>
              </article>
            ))}
          </div>
        </div>
        {editingPerson ? (
          <DialogShell
            open={Boolean(editingPerson)}
            title="編輯人員資料"
            onClose={() => setEditingPersonId("")}
            backdropClassName="mobile-modal-backdrop upgraded-modal-backdrop"
            panelClassName="mobile-modal mobile-edit-sheet upgraded-modal-card person-edit-modal"
            closeOnBackdrop
          >
              <button type="button" className="mobile-modal-floating-close" aria-label="關閉編輯視窗" onClick={() => setEditingPersonId("")}>×</button>
              <div className="mobile-modal-header upgraded-modal-header">
                <div>
                  <strong>編輯人員資料</strong>
                  <small>{editingPerson.name || "未命名"}｜{editingPerson.id}</small>
                </div>
              </div>
              <div className="mobile-modal-body upgraded-modal-body">
                <section className="mobile-form-section">
                  <div className="mobile-form-section-title">基本資料</div>
                  <div className="mobile-edit-grid upgraded-edit-grid">
                    <label>姓名<ConfirmTextInput value={editingPerson.name} onCommit={(value) => handleUpdatePerson(editingPerson, { name: value })} /></label>
                    <label>班別<ConfirmSelect value={String(getTeamOfPerson(editingPerson))} options={TEAM_OPTIONS.map((item) => ({ label: item, value: item }))} onCommit={(value) => handleUpdatePerson(editingPerson, { shift: value })} /></label>
                    <label>職務<ConfirmTextInput value={editingPerson.role} onCommit={(value) => handleUpdatePerson(editingPerson, { role: value })} /></label>
                    <label>國籍<ConfirmTextInput value={editingPerson.nationality} onCommit={(value) => handleUpdatePerson(editingPerson, { nationality: value })} /></label>
                  </div>
                </section>
                <section className="mobile-form-section">
                  <div className="mobile-form-section-title">班組出勤欄位</div>
                  <div className="mobile-edit-grid upgraded-edit-grid">
                    <label>A1<ConfirmTextInput value={editingPerson.aDay1 || ""} onCommit={(value) => handleUpdatePerson(editingPerson, { aDay1: value })} /></label>
                    <label>A2<ConfirmTextInput value={editingPerson.aDay2 || ""} onCommit={(value) => handleUpdatePerson(editingPerson, { aDay2: value })} /></label>
                    <label>B1<ConfirmTextInput value={editingPerson.bDay1 || ""} onCommit={(value) => handleUpdatePerson(editingPerson, { bDay1: value })} /></label>
                    <label>B2<ConfirmTextInput value={editingPerson.bDay2 || ""} onCommit={(value) => handleUpdatePerson(editingPerson, { bDay2: value })} /></label>
                  </div>
                </section>
                <section className="mobile-form-section">
                  <div className="mobile-form-section-title">在職狀態</div>
                  <div className="mobile-edit-grid upgraded-edit-grid single-row">
                    <label>在職<ConfirmTextInput value={editingPerson.employmentStatus} onCommit={(value) => handleUpdatePerson(editingPerson, { employmentStatus: value })} /></label>
                  </div>
                </section>
              </div>
              <div className="mobile-modal-footer upgraded-modal-footer">
                <button type="button" className="ghost full-width" onClick={() => setEditingPersonId("")}>關閉</button>
              </div>
          </DialogShell>
        ) : null}
        {newPersonOpen ? (
          <DialogShell
            open={newPersonOpen}
            title="新增人員"
            onClose={() => setNewPersonOpen(false)}
            backdropClassName="mobile-modal-backdrop upgraded-modal-backdrop"
            panelClassName="mobile-modal mobile-edit-sheet upgraded-modal-card person-edit-modal new-person-modal"
            closeOnBackdrop
          >
              <button type="button" className="mobile-modal-floating-close" aria-label="關閉新增人員視窗" onClick={() => setNewPersonOpen(false)}>×</button>
              <div className="mobile-modal-header upgraded-modal-header">
                <div>
                  <strong id="new-person-title">新增人員</strong>
                  <small>{appEnvironment.writesEnabled ? "儲存後會同步新增至人員主表與站點矩陣" : "升級測試版僅檢查內容，不會寫入正式資料"}</small>
                </div>
              </div>
              <div className="mobile-modal-body upgraded-modal-body">
                <section className="mobile-form-section">
                  <div className="mobile-form-section-title">必要資料</div>
                  <div className="mobile-edit-grid upgraded-edit-grid">
                    <label>工號<input autoFocus value={newPersonDraft.id} onChange={(event) => setNewPersonDraft((current) => ({ ...current, id: event.target.value }))} placeholder="例如 P0123" /></label>
                    <label>姓名<input value={newPersonDraft.name} onChange={(event) => setNewPersonDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                    <label>班別<select value={newPersonDraft.shift} onChange={(event) => setNewPersonDraft((current) => ({ ...current, shift: event.target.value }))}>{TEAM_OPTIONS.map((team) => <option key={team} value={team}>{team}</option>)}</select></label>
                    <label>職務<input value={newPersonDraft.role} onChange={(event) => setNewPersonDraft((current) => ({ ...current, role: event.target.value }))} /></label>
                  </div>
                </section>
                <section className="mobile-form-section">
                  <div className="mobile-form-section-title">基本資料</div>
                  <div className="mobile-edit-grid upgraded-edit-grid">
                    <label>國籍<input value={newPersonDraft.nationality} onChange={(event) => setNewPersonDraft((current) => ({ ...current, nationality: event.target.value }))} /></label>
                    <label>在職狀態<input value={newPersonDraft.employmentStatus} onChange={(event) => setNewPersonDraft((current) => ({ ...current, employmentStatus: event.target.value }))} /></label>
                  </div>
                </section>
                <section className="mobile-form-section">
                  <div className="mobile-form-section-title">支援出勤欄位</div>
                  <div className="mobile-edit-grid upgraded-edit-grid">
                    <label>A1<input value={newPersonDraft.aDay1 || ""} onChange={(event) => setNewPersonDraft((current) => ({ ...current, aDay1: event.target.value }))} /></label>
                    <label>A2<input value={newPersonDraft.aDay2 || ""} onChange={(event) => setNewPersonDraft((current) => ({ ...current, aDay2: event.target.value }))} /></label>
                    <label>B1<input value={newPersonDraft.bDay1 || ""} onChange={(event) => setNewPersonDraft((current) => ({ ...current, bDay1: event.target.value }))} /></label>
                    <label>B2<input value={newPersonDraft.bDay2 || ""} onChange={(event) => setNewPersonDraft((current) => ({ ...current, bDay2: event.target.value }))} /></label>
                  </div>
                </section>
              </div>
              <div className="mobile-modal-footer upgraded-modal-footer new-person-actions">
                <button type="button" className="ghost" disabled={newPersonSubmitting} onClick={() => setNewPersonOpen(false)}>取消</button>
                <button type="button" className="primary" disabled={newPersonSubmitting} onClick={() => void handleCreatePerson()}>
                  {newPersonSubmitting ? "新增中..." : appEnvironment.writesEnabled ? "確認新增" : "檢查新增資料"}
                </button>
              </div>
          </DialogShell>
        ) : null}
      </EntranceLayout>
    );
  }

  return (
    <>
      <div className={`app-shell app-theme-${uiTheme} app-font-system app-operational-v3`} data-theme={uiTheme}>
        <aside className="sidebar">
          <div className="brand-card">
            <div className="brand-lockup" aria-label="TSEC 人力站點">
              <img className="brand-mark" src={`${import.meta.env.BASE_URL}icons/tsec-workforce-mark.svg`} alt="" aria-hidden="true" />
              <div className="brand-wordmark">
                <strong>TSEC</strong>
                <span>人力站點</span>
              </div>
            </div>
            <h1>現場人力與站點資格管理系統</h1>
            <p>整合人員資格、全站覆蓋、缺勤風險與班表試排。</p>
          </div>
          <div className="control-card">
            <div className="control-card-title">帳號登入</div>
            {currentUser ? (
              <div className="logged-user">
                <strong>{currentUser.name}</strong>
                <span>{currentUser.id}｜權限 {currentRole || "-"}</span>
                <span>版本 {APP_VERSION}</span>
                <button className="ghost" type="button" onClick={logout}>登出</button>
              </div>
            ) : (
              <form className="login-form" onSubmit={(event) => { event.preventDefault(); void handleLogin(); }}>
                <label className="login-field" htmlFor="login-account"><span>帳號</span><input id="login-account" ref={loginAccountRef} name="username" autoComplete="username" disabled={loginSubmitting || sessionRestoring} placeholder="請輸入帳號" value={loginForm.account} onKeyDown={() => { loginManualInputRef.current = true; }} onPaste={() => { loginManualInputRef.current = true; }} onChange={(e) => setLoginForm((c) => ({ ...c, account: e.target.value }))} /></label>
                <label className="login-field" htmlFor="login-password"><span>密碼</span><input id="login-password" ref={loginPasswordRef} name="password" type="password" autoComplete="current-password" disabled={loginSubmitting || sessionRestoring} placeholder="請輸入密碼" value={loginForm.password} onKeyDown={() => { loginManualInputRef.current = true; }} onPaste={() => { loginManualInputRef.current = true; }} onChange={(e) => setLoginForm((c) => ({ ...c, password: e.target.value }))} /></label>
                <label className="login-field" htmlFor="login-keep"><span>保持登入</span><select id="login-keep" value={loginKeep} onChange={(e) => updateLoginKeep(e.target.value as LoginKeepKey)}>
                  {loginKeepOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select></label>
                <button className="primary login-submit-button" type="submit" disabled={loginSubmitting || sessionRestoring} aria-busy={loginSubmitting || sessionRestoring}>
                  {loginSubmitting || sessionRestoring ? <span className="login-spinner" aria-hidden="true" /> : null}
                  <span>{sessionRestoring ? "確認登入狀態..." : loginSubmitting ? "登入中..." : "登入"}</span>
                </button>
              </form>
            )}
          </div>
          <div className="desktop-theme-picker">
            <ThemePicker value={uiTheme} onChange={changeUiTheme} />
          </div>
          <nav className="nav-list" aria-label="主要功能">
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
          {appEnvironment.isPreview ? (
            <div className="preview-environment-banner" role="status">
              <strong>升級測試版</strong>
              <span>{appEnvironment.writesEnabled ? "已連接測試資料，可進行寫入測試。" : "目前為唯讀模式，不會修改正式資料。"}</span>
              <span>版本 {APP_VERSION}</span>
            </div>
          ) : null}
          {bootstrapError ? (
            <div className="bootstrap-error-banner" role="alert">
              <div>
                <strong>系統資料尚未載入</strong>
                <span>{bootstrapError}</span>
                <small>目前不會用 0 筆資料取代既有內容，請稍後重新讀取。</small>
              </div>
              <button
                type="button"
                className="primary"
                disabled={loading}
                onClick={() => setBootstrapRetryKey((current) => current + 1)}
              >
                {loading ? "重新讀取中..." : "重新讀取"}
              </button>
            </div>
          ) : null}
          {page === "home" ? (
            currentUser ? (
              <Layout title="" subtitle="">
                <Suspense fallback={<Empty text="正在載入工作台..." />}>
                  <WorkforceWorkbench
                    data={data}
                    currentUser={currentUser}
                    loading={loading}
                    onNavigate={navigateToPage}
                  />
                </Suspense>
              </Layout>
            ) : (
              <EntranceLayout pageKey="home">
              <section className="home-flat-page">
                <div className="home-flat-stats">
                  <StatCard title="人員總數" value={!currentUser ? "-" : loading ? "..." : bootstrapError && !data.people.length ? "-" : String(data.people.length)} note={!currentUser ? "登入後載入" : "人員主檔"} />
                  <StatCard title="站點總數" value={!currentUser ? "-" : loading ? "..." : bootstrapError && !data.stations.length ? "-" : String(data.stations.length)} note={!currentUser ? "登入後載入" : "站點主檔"} />
                  <StatCard title="資格筆數" value={!currentUser ? "-" : loading ? "..." : bootstrapError && !data.qualifications.length ? "-" : String(data.qualifications.length)} note={!currentUser ? "登入後載入" : "站點資格"} />
                </div>

                <div className="home-flat-grid">
                  <div className="panel intro-panel home-flat-info">
                    <h3>系統用途</h3>
                    <p>整合人員資格、站點需求與出勤資料，用於查詢、考核、覆蓋分析及班表試排。</p>
                    <p>登入後將依帳號權限顯示可用班別與管理功能。</p>
                  </div>

                  <div className="panel compact-preference-panel home-flat-settings">
                    <div className="theme-selector-heading compact-selector-header">
                      <div>
                        <h3>介面標準</h3>
                        <p>全站採用統一的營運介面，固定以顏色與文字區分覆蓋、缺口、訓練及支援狀態。</p>
                      </div>
                      <span className="status-pill success">標準模式</span>
                    </div>
                    <div className="interface-legend" aria-label="狀態色彩說明">
                      <span className="legend-item success">完整覆蓋</span>
                      <span className="legend-item warning">瓶頸／訓練</span>
                      <span className="legend-item danger">實際缺口</span>
                      <span className="legend-item support">支援人力</span>
                    </div>
                  </div>
                </div>
              </section>
              </EntranceLayout>
            )
          ) : null}
          {!currentRole && page !== "home" ? <EntranceLayout pageKey="login-required"><Empty text="請先登入。" /></EntranceLayout> : null}

          {currentRole && page === "person-query" && canUsePage("person-query") ? (
            <EntranceLayout pageKey="person-query">
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
            </EntranceLayout>
          ) : null}

          {currentRole && page === "station-query" && canUsePage("station-query") ? (
            <EntranceLayout pageKey="station-query">
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
            </EntranceLayout>
          ) : null}

          {currentRole && page === "qualification-review" && canUsePage("qualification-review") ? (
            <EntranceLayout pageKey="qualification-review">
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
                <div className="panel review-detail-panel" ref={reviewDetailRef}>
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
                      onSave={() => { void handleSaveQualification(); }}
                      onDelete={handleDeleteQualification}
                    />
                  ) : <Empty text="請先選取人員。" />}
                </div>
              </div>
              <div className="panel">
                <h3>班別人員總覽</h3>
                <table className="table"><thead><tr><th>工號</th><th>姓名</th><th>職務</th><th>系統權限</th><th>國籍</th><th>合格</th><th>訓練中</th><th>不可排</th></tr></thead><tbody>{reviewOverviewRows.map((row) => <tr key={row.id}><td>{row.id}</td><td>{row.name}</td><td>{row.role}</td><td>{String(getSystemPermission(data.people.find((p) => p.id === row.id) || null) || "-")}</td><td>{row.nationality}</td><td>{row.qualified}</td><td>{row.training}</td><td>{row.blocked}</td></tr>)}</tbody></table>
              </div>
            </EntranceLayout>
          ) : null}

          {currentRole && page === "gap-analysis" && canUsePage("gap-analysis") ? (
            <EntranceLayout pageKey="gap-analysis">
              <div className="panel">
                <div className="toolbar">
                  <select aria-label="覆蓋分析班別" value={gapShift} onChange={(e) => { setGapShift(e.target.value as TeamName); setGapAbsentIds([]); setGapTrainingSimulations([]); setGapOfficerSimulations([]); }}>
                    {TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <select aria-label="覆蓋分析日別" value={gapDay} onChange={(e) => { setGapDay(e.target.value as ShiftMode); setGapAbsentIds([]); setGapTrainingSimulations([]); setGapOfficerSimulations([]); }}>
                    {dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </div>
                <div className="detail-grid">
                  <Info label="本籍出勤" value={String(gapAttendance.localCount)} />
                  <Info label="菲籍出勤" value={String(gapAttendance.filipinoCount)} />
                  <Info label="越籍出勤" value={String(gapAttendance.vietnamCount)} />
                  <Info label="總出勤" value={String(gapAttendance.totalCount)} />
                  <Info label={gapDay === "當班" ? "本班人力" : "本班出勤"} value={String(gapAttendance.own.length)} />
                  <Info label="支援人力" value={String(gapAttendance.support.length)} />
                  <Info label="支援對班" value={gapDay === "當班" ? "-" : gapAttendance.supportTeam} />
                </div>
              </div>

              {gapRules.length ? (
                <>
                  <div className={`panel coverage-summary-panel ${gapCoverageAnalysis.fullyCovered ? "is-covered" : "has-gap"}`}>
                    <div className="panel-header">
                      <h3>{gapDay === "當班" ? "全勤基準分析" : "支援優先基準分析"}</h3>
                      <span>
                        {gapCoverageAnalysis.fullyCovered
                          ? gapDay === "當班" ? "全員出勤時可全面覆蓋" : "支援先配置、本班補位後可全面覆蓋"
                          : gapDay === "當班" ? `全員出勤仍缺 ${gapCoverageAnalysis.shortage} 人` : `支援先配置、本班補位後仍缺 ${gapCoverageAnalysis.shortage} 人`}
                      </span>
                    </div>
                    <div className="detail-grid">
                      <Info label="全站需求" value={String(gapCoverageAnalysis.required)} />
                      {gapDay === "當班" ? (
                        <>
                          <Info label="可作業人力" value={String(gapCoverageAnalysis.ownAvailable + gapCoverageAnalysis.supportAvailable)} />
                          <Info label="已配置站點" value={`${gapCoverageAnalysis.assigned}/${gapCoverageAnalysis.required}`} />
                          <Info label="未配置備援" value={String(gapCoverageAnalysis.ownUnassigned + gapCoverageAnalysis.supportUnassigned)} />
                        </>
                      ) : (
                        <>
                          <Info label="分析出勤人力" value={String(gapCoverageAnalysis.ownAvailable + gapCoverageAnalysis.supportAvailable)} />
                          <Info label="支援已配置" value={`${gapCoverageAnalysis.supportAssigned}/${gapCoverageAnalysis.supportAvailable}`} />
                          <Info label="本班補位" value={String(gapCoverageAnalysis.ownAssigned)} />
                          <Info label="本班可備援" value={String(gapCoverageAnalysis.ownUnassigned)} />
                        </>
                      )}
                      <Info label="排除後缺口" value={String(gapCoverageAnalysis.shortage)} />
                      <Info label="瓶頸站點" value={String(gapCoverageAnalysis.rows.filter((row) => row.bottleneck).length)} />
                    </div>
                    {gapDay === "當班" && (
                      <p className="muted">可作業人力為排除領班、組長、主任後的人數；未配置者保留為備援，不代表人員遺失。</p>
                    )}
                    <p className="muted">
                      {gapDay === "當班"
                        ? "進入頁面即依目前班別計算全勤覆蓋。此區預設排除領班、組長、主任；下方會列出可緊急支援的缺口。"
                        : "第一天、第二天會先把對班支援人力配置到合格站點，再由本班人力補位；未被使用的本班人力保留為備援與訓練空間。此區預設排除領班、組長、主任。"}
                    </p>
                  </div>

                  <div className="panel officer-relief-panel">
                    <div className="panel-header">
                      <h3>幹部緊急支援評估</h3>
                      <div className="panel-header-actions">
                        <span className={gapOfficerSimulations.length ? "status-pill active" : "status-pill"}>{gapOfficerSimulations.length ? `已導入 ${gapOfficerSimulations.length} 人` : "未導入"}</span>
                        <button type="button" className="ghost" onClick={openGapOfficerDialog}>自訂支援</button>
                        <button type="button" className="ghost" onClick={() => setGapOfficerSimulations([])} disabled={!gapOfficerSimulations.length}>清除支援</button>
                      </div>
                    </div>
                    <p className="muted">領班、組長與主任以現場管理為主要勤務。僅在必要時列出可緊急支援的缺口，亦可自訂人員與站點進行情境檢核。</p>
                    {gapActiveCoverageAnalysis.officerSuggestions.length ? (
                      <div className="officer-relief-tags">
                        {gapActiveCoverageAnalysis.officerSuggestions.map((item) => {
                            const person = data.people.find((p) => p.id === item.employeeId);
                            const station = data.stations.find((stationItem) => stationItem.id === item.stationId);
                            const active = gapOfficerSimulations.some((selected) => selected.employeeId === item.employeeId && selected.stationId === item.stationId);
                            return (
                              <button
                                type="button"
                                key={`${item.employeeId}-${item.stationId}`}
                                className={`officer-relief-tag ${active ? "active" : ""}`}
                                onClick={() => toggleGapOfficerSimulation(item.employeeId, item.stationId)}
                              >
                                <strong>{person?.name || item.employeeId}</strong>
                                <span>{station?.name || item.stationId}</span>
                                <small>可減 {item.shortageReduced}</small>
                              </button>
                            );
                          })}
                      </div>
                    ) : <p className="muted">目前沒有自動判定需要領班/組長/主任支援的缺口；可按「自訂支援」手動選人與站點測試。</p>}
                  </div>

                  <div className="panel resilience-panel">
                    <div className="panel-header">
                      <div>
                        <h3>缺勤韌性分析</h3>
                        <p className="muted">交叉模擬指定人數內的缺勤組合，並重新配置全站，辨識無法由其他合格人員吸收的實際風險。</p>
                      </div>
                      <span className={gapStressRunning ? "status-pill active" : gapStressResult ? "status-pill success" : "status-pill"}>
                        {gapStressRunning ? "分析中" : gapStressResult ? "分析完成" : "尚未執行"}
                      </span>
                    </div>
                    <div className="resilience-control-bar">
                      <label>
                        分析人數上限
                        <input
                          type="number"
                          min={1}
                          max={5}
                          step={1}
                          value={gapStressMaxAbsences}
                          disabled={gapStressRunning}
                          onChange={(event) => setGapStressMaxAbsences(Math.max(1, Math.min(5, Number(event.target.value) || 1)))}
                        />
                      </label>
                      <button type="button" className="primary" disabled={gapStressRunning} onClick={runGapStressAnalysis}>
                        {gapStressRunning ? "正在執行分析…" : `執行 1 至 ${gapStressMaxAbsences} 人缺勤分析`}
                      </button>
                      <span>組合數在可完整計算範圍內會逐一驗證；超出範圍時採固定抽樣並標示為估算。</span>
                    </div>

                    {gapStressRunning ? (
                      <div className="resilience-progress" role="status" aria-live="polite">
                        <span />
                        <strong>正在重新配置並驗證所有站點，請勿重複操作。</strong>
                      </div>
                    ) : null}
                    {gapStressError ? <p className="resilience-error" role="alert">{gapStressError}</p> : null}

                    {gapStressResult ? (
                      <Suspense fallback={<Empty text="正在整理分析結果..." />}>
                        <ResilienceInsights result={gapStressResult} people={data.people} stations={data.stations} />
                      </Suspense>
                    ) : null}
                  </div>

                  <div className="grid two">
                    <div className="panel">
                      <div className="panel-header">
                        <h3>指定缺勤情境</h3>
                        <div className="panel-header-actions">
                          <span className={gapAbsentIds.length ? "status-pill danger" : "status-pill"}>{gapAbsentIds.length ? `已選 ${gapAbsentIds.length} 人缺勤` : "未模擬缺勤"}</span>
                          <button
                            type="button"
                            className="cute-help-button"
                            aria-label="查看缺勤韌性分析說明"
                            title="分析說明"
                            onClick={() => setGapHelpOpen(true)}
                          >?</button>
                        </div>
                      </div>
                      <div className="inline-action-bar compact-tabs">
                        <button type="button" className="action-tab primary" onClick={() => { setGapAbsentDialogOpen(true); setGapAbsentKeyword(""); }}>自訂缺勤</button>
                        <button type="button" className="action-tab ghost" onClick={() => { setGapAbsentIds([]); setGapOfficerSimulations([]); }} disabled={!gapAbsentIds.length}>清除缺勤</button>
                      </div>
                      {gapCoverageAnalysis.criticalPeople.length ? (
                        <div className="list-scroll short person-tag-list">
                          {gapCoverageAnalysis.criticalPeople.map((item) => {
                            const person = data.people.find((p) => p.id === item.employeeId);
                            const selected = gapAbsentIds.includes(item.employeeId);
                            const stations = item.affectedStationIds
                              .map((id) => data.stations.find((station) => station.id === id)?.name || id)
                              .join("、");
                            return (
                              <button type="button" className={`list-row absent-toggle ${selected ? "active danger" : ""}`} key={item.employeeId} onClick={() => toggleGapAbsentPerson(item.employeeId)}>
                                <strong>{person?.name || item.employeeId}</strong>
                                <span>{selected ? "人員缺勤｜" : ""}缺席後缺 {item.shortage} 人｜影響 {stations || "-"}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : <p className="muted">目前沒有偵測到單一人員缺席後會擴大缺口。</p>}
                    </div>

                    <div className="panel">
                      <div className="panel-header">
                        <h3>補訓效益建議</h3>
                        <div className="panel-header-actions">
                          <span>{gapStressResult ? "預防風險排序" : gapAbsentIds.length ? "全勤 + 指定缺勤" : "全勤基準"}</span>
                          <span className={gapSimulationCount ? "status-pill active" : "status-pill"}>{gapSimulationCount ? `已導入 ${gapSimulationCount} 項` : "未導入"}</span>
                          <button
                            type="button"
                            className="cute-help-button small"
                            aria-label="查看補訓效益建議說明"
                            title="補訓說明"
                            onClick={() => setGapTrainingHelpOpen(true)}
                          >?</button>
                        </div>
                      </div>
                      <div className="inline-action-bar compact-tabs">
                        <button type="button" className="action-tab primary" onClick={openGapTrainingDialog}>自訂補訓</button>
                        <button type="button" className="action-tab ghost" onClick={() => setGapTrainingSimulations([])} disabled={!gapTrainingSimulations.length}>清除補訓</button>
                      </div>
                      {gapStressResult ? gapStressResult.trainingSuggestions.length ? (
                        <div className="list-scroll short person-tag-list">
                          {gapStressResult.trainingSuggestions.map((item) => {
                            const person = data.people.find((p) => p.id === item.employeeId);
                            const station = data.stations.find((stationItem) => stationItem.id === item.stationId);
                            return (
                              <button
                                type="button"
                                className={`list-row training-suggestion ${item.priority === "當前缺口" ? "urgent" : ""} ${gapTrainingSimulations.some((selected) => selected.employeeId === item.employeeId && selected.stationId === item.stationId) ? "active" : ""}`}
                                key={`${item.employeeId}-${item.stationId}`}
                                onClick={() => openGapTrainingPicker(item.employeeId, item.stationId, "recommendation")}
                              >
                                <strong>{person?.name || item.employeeId}</strong>
                                <span>推薦：{station?.name || item.stationId}｜{item.priority}｜{item.reason}｜目前合格 {item.qualificationCount} 站{item.estimated ? "｜成效為抽樣估算" : ""}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : <p className="muted">本次壓力測試沒有找出能實際降低缺口的補訓組合。</p> : gapCombinedTrainingSuggestions.length ? (
                        <div className="list-scroll short person-tag-list">
                          {gapCombinedTrainingSuggestions.map((item) => {
                            const person = data.people.find((p) => p.id === item.employeeId);
                            const station = data.stations.find((stationItem) => stationItem.id === item.stationId);
                            return (
                              <button
                                type="button"
                                className={`list-row training-suggestion ${item.priority === "補缺口" ? "urgent" : ""} ${item.isOfficer ? "officer" : ""} ${gapTrainingSimulations.some((selected) => selected.employeeId === item.employeeId && selected.stationId === item.stationId) ? "active" : ""}`}
                                key={`${item.employeeId}-${item.stationId}`}
                                onClick={() => openGapTrainingPicker(item.employeeId, item.stationId, "recommendation")}
                              >
                                <strong>{person?.name || item.employeeId}</strong>
                                <span>點擊選擇補訓站點｜推薦：{station?.name || item.stationId}｜{item.priority}｜{item.reason}{item.isOfficer ? "｜領班/組長/主任非優先" : ""}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : <p className="muted">全勤基準沒有明顯補訓建議；可執行上方壓力測試，進一步找出預防性補強位置。</p>}
                    </div>
                  </div>

                  {gapSimulationCount && gapTrainingSimulationAnalysis ? (() => {
                    const reduced = Math.max(0, gapActiveCoverageAnalysis.shortage - gapTrainingSimulationAnalysis.shortage);
                    const selectedStationIds = new Set([...gapTrainingSimulations, ...gapOfficerSimulations].map((item) => item.stationId));
                    const trainingText = gapTrainingSimulations.map((item) => {
                      const person = data.people.find((personItem) => personItem.id === item.employeeId);
                      const station = data.stations.find((stationItem) => stationItem.id === item.stationId);
                      return `${person?.name || item.employeeId}補訓 -> ${station?.name || item.stationId}`;
                    });
                    const officerText = gapOfficerSimulations.map((item) => {
                      const person = data.people.find((personItem) => personItem.id === item.employeeId);
                      const station = data.stations.find((stationItem) => stationItem.id === item.stationId);
                      return `${person?.name || item.employeeId}（${person?.role || "幹部"}）支援 -> ${station?.name || item.stationId}`;
                    });
                    const selectedText = [...trainingText, ...officerText].join("、");
                    const assignedCountByPerson = new Map<string, number>();
                    gapTrainingSimulationAnalysis.rows.forEach((row) => {
                      row.assignedIds.forEach((id) => assignedCountByPerson.set(id, (assignedCountByPerson.get(id) || 0) + 1));
                    });
                    const duplicatedAssignedNames = [...assignedCountByPerson]
                      .filter(([, count]) => count > 1)
                      .map(([id]) => data.people.find((personItem) => personItem.id === id)?.name || id);
                    return (
                      <div className={`panel coverage-summary-panel ${reduced > 0 ? "is-covered" : "has-gap"}`}>
                        <div className="panel-header">
                          <h3>導入模擬結果</h3>
                          <button type="button" className="ghost compact-help-button" onClick={() => { setGapTrainingSimulations([]); setGapOfficerSimulations([]); }}>關閉</button>
                        </div>
                        <p className="muted">假設以下補訓或幹部支援直接導入指定站點，再重新檢查其他站是否出現缺口：{selectedText}</p>
                        <p className="muted">領班/組長/主任導入會特別標示，方便你確認是否真的要動用現場監督支援站點。</p>
                        <div className="detail-grid">
                          <Info label="目前缺口" value={String(gapActiveCoverageAnalysis.shortage)} />
                          <Info label="導入後缺口" value={String(gapTrainingSimulationAnalysis.shortage)} />
                          <Info label="可減少缺口" value={String(reduced)} />
                          <Info label="導入後覆蓋" value={`${gapTrainingSimulationAnalysis.assigned}/${gapTrainingSimulationAnalysis.required}`} />
                          <Info label="重複指派" value={duplicatedAssignedNames.length ? duplicatedAssignedNames.join("、") : "0"} />
                        </div>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>站點</th>
                              <th>需求</th>
                              <th>導入前指派</th>
                              <th>導入後指派</th>
                              <th>導入前缺口</th>
                              <th>缺口</th>
                              <th>狀態</th>
                            </tr>
                          </thead>
                          <tbody>
                            {gapTrainingSimulationAnalysis.rows.map((row) => {
                              const rowStation = data.stations.find((item) => item.id === row.stationId);
                              const assignedUniqueIds = [...new Set(row.assignedIds)];
                              const assignedPeople = assignedUniqueIds.map((id) => data.people.find((item) => item.id === id) || null);
                              const beforeRow = gapActiveCoverageAnalysis.rows.find((item) => item.stationId === row.stationId);
                              const beforeShortage = beforeRow?.shortage || 0;
                              const beforeAssignedNames = [...new Set(beforeRow?.assignedIds || [])].map((id) => data.people.find((item) => item.id === id)?.name || id);
                              const assignedChanged = beforeAssignedNames.join("|") !== assignedPeople.map((person, index) => person?.name || assignedUniqueIds[index]).join("|");
                              const status = row.shortage > beforeShortage
                                ? beforeShortage > 0 ? "缺口擴大" : "新增缺口"
                                : row.shortage < beforeShortage
                                  ? "缺口改善"
                                  : selectedStationIds.has(row.stationId)
                                    ? "補訓導入站"
                                    : assignedChanged
                                      ? "指派調整"
                                      : row.shortage ? "導入後仍有缺口" : "穩定";
                              return (
                                <tr key={row.stationId} className={row.shortage > beforeShortage ? "danger-row" : row.shortage < beforeShortage || selectedStationIds.has(row.stationId) || assignedChanged ? "warning-row" : ""}>
                                  <td>{rowStation?.name || row.stationId}</td>
                                  <td>{row.required}</td>
                                  <td>{beforeAssignedNames.join("、") || "-"}</td>
                                  <td>
                                    <span className="assigned-name-tags">
                                      {assignedPeople.length ? assignedPeople.map((person, index) => {
                                        const id = assignedUniqueIds[index];
                                        return <span key={id} className={person && isSupportOfficerPerson(person) ? "officer-support-name" : ""}>{person?.name || id}</span>;
                                      }) : "-"}
                                    </span>
                                  </td>
                                  <td>{beforeShortage}</td>
                                  <td>{row.shortage}</td>
                                  <td>{status}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })() : null}

                  {gapAbsentDialogOpen ? (
                    <DialogShell
                      open={gapAbsentDialogOpen}
                      title="選擇缺勤人員"
                      onClose={() => setGapAbsentDialogOpen(false)}
                      backdropClassName="manual-modal-backdrop coverage-help-backdrop"
                      panelClassName="manual-modal coverage-menu-modal"
                      closeOnBackdrop
                    >
                        <div className="manual-modal-title-row">
                          <h3>選擇缺勤人員</h3>
                          <button type="button" className="manual-modal-close-button" aria-label="關閉缺勤人員視窗" onClick={() => setGapAbsentDialogOpen(false)}>×</button>
                        </div>
                        <label className="manual-extra-dialog-field">
                          搜尋人員
                          <input value={gapAbsentKeyword} onChange={(event) => setGapAbsentKeyword(event.target.value)} placeholder="輸入姓名或工號" autoFocus />
                        </label>
                        <div className="manual-extra-selected">
                          {gapAbsentIds.length ? gapAbsentIds.map((id) => {
                            const person = data.people.find((item) => item.id === id);
                            return (
                              <button key={id} type="button" onClick={() => toggleGapAbsentPerson(id)} title="移除缺勤人員">
                                {person?.name || id} ×
                              </button>
                            );
                          }) : <span className="muted">尚未加入缺勤人員</span>}
                        </div>
                        <div className="menu-option-grid">
                          {gapAbsentCandidates.length ? gapAbsentCandidates.map((person) => (
                            <button type="button" className="menu-option" key={person.id} onClick={() => toggleGapAbsentPerson(person.id)}>
                              <strong>{person.name}</strong>
                              <span>{person.role || "-"}</span>
                            </button>
                          )) : <p className="muted">找不到可加入的出勤人員，或人員已在缺勤清單中。</p>}
                        </div>
                        <div className="manual-modal-actions">
                          <button type="button" className="ghost" onClick={() => { setGapAbsentIds([]); setGapOfficerSimulations([]); }}>清空缺勤</button>
                          <button type="button" className="primary" onClick={() => setGapAbsentDialogOpen(false)}>完成</button>
                        </div>
                    </DialogShell>
                  ) : null}

                  {gapOfficerDialogOpen ? (
                    <DialogShell
                      open={gapOfficerDialogOpen}
                      title="選擇幹部緊急支援"
                      onClose={() => setGapOfficerDialogOpen(false)}
                      backdropClassName="manual-modal-backdrop coverage-help-backdrop"
                      panelClassName="manual-modal coverage-menu-modal"
                      closeOnBackdrop
                    >
                        <div className="manual-modal-title-row">
                          <h3>自訂幹部支援</h3>
                          <button type="button" className="manual-modal-close-button" aria-label="關閉幹部支援視窗" onClick={() => setGapOfficerDialogOpen(false)}>×</button>
                        </div>
                        <label className="manual-extra-dialog-field">
                          搜尋領班 / 組長 / 主任
                          <input value={gapOfficerKeyword} onChange={(event) => setGapOfficerKeyword(event.target.value)} placeholder="輸入姓名或工號" autoFocus />
                        </label>
                        <div className="manual-extra-selected">
                          {gapOfficerSimulations.length ? gapOfficerSimulations.map((item) => {
                            const person = data.people.find((personItem) => personItem.id === item.employeeId);
                            const station = data.stations.find((stationItem) => stationItem.id === item.stationId);
                            return (
                              <button key={`${item.employeeId}-${item.stationId}`} type="button" onClick={() => toggleGapOfficerSimulation(item.employeeId, item.stationId)} title="移除幹部支援">
                                {person?.name || item.employeeId} → {station?.name || item.stationId} ×
                              </button>
                            );
                          }) : <span className="muted">尚未加入幹部支援</span>}
                        </div>
                        <div className="menu-option-grid officer-option-grid">
                          {gapOfficerCandidates.length ? gapOfficerCandidates.map((person) => (
                            <button
                              type="button"
                              className={`menu-option ${gapOfficerPickerId === person.id ? "active" : ""}`}
                              key={person.id}
                              onClick={() => setGapOfficerPickerId(person.id)}
                            >
                              <strong>{person.name}</strong>
                              <span>{person.role || "-"}</span>
                            </button>
                          )) : <p className="muted">找不到可加入的領班、組長或主任，或人員已在缺勤清單中。</p>}
                        </div>
                        <label className="manual-extra-dialog-field">
                          支援站點
                          <select value={gapOfficerPickerStationId} onChange={(event) => setGapOfficerPickerStationId(event.target.value)}>
                            {gapRules.map((rule) => {
                              const station = data.stations.find((item) => item.id === rule.stationId);
                              const row = gapActiveCoverageAnalysis.rows.find((item) => item.stationId === rule.stationId);
                              return (
                                <option key={rule.stationId} value={rule.stationId}>
                                  {station?.name || rule.stationId}{row?.shortage ? `（缺 ${row.shortage}）` : ""}
                                </option>
                              );
                            })}
                          </select>
                        </label>
                        <div className="manual-modal-actions">
                          <button type="button" className="ghost" onClick={() => setGapOfficerSimulations([])}>清空支援</button>
                          <button type="button" className="primary" onClick={addGapOfficerCustomSimulation} disabled={!gapOfficerPickerId || !gapOfficerPickerStationId}>導入模擬</button>
                        </div>
                    </DialogShell>
                  ) : null}

                  {gapTrainingDialogOpen ? (
                    <DialogShell
                      open={gapTrainingDialogOpen}
                      title="選擇補訓人員"
                      onClose={() => setGapTrainingDialogOpen(false)}
                      backdropClassName="manual-modal-backdrop coverage-help-backdrop"
                      panelClassName="manual-modal coverage-menu-modal"
                      closeOnBackdrop
                    >
                        <div className="manual-modal-title-row">
                          <h3>選擇補訓人員</h3>
                          <button type="button" className="manual-modal-close-button" aria-label="關閉補訓導入視窗" onClick={() => setGapTrainingDialogOpen(false)}>×</button>
                        </div>
                        <label className="manual-extra-dialog-field">
                          搜尋人員
                          <input value={gapTrainingKeyword} onChange={(event) => setGapTrainingKeyword(event.target.value)} placeholder="輸入姓名或工號" autoFocus />
                        </label>
                        <div className="manual-extra-selected">
                          {gapTrainingSimulations.length ? gapTrainingSimulations.map((item) => {
                            const person = data.people.find((personItem) => personItem.id === item.employeeId);
                            const station = data.stations.find((stationItem) => stationItem.id === item.stationId);
                            return (
                              <button key={`${item.employeeId}-${item.stationId}`} type="button" onClick={() => toggleGapTrainingSimulation(item.employeeId, item.stationId)} title="移除補訓模擬">
                                {person?.name || item.employeeId} → {station?.name || item.stationId} ×
                              </button>
                            );
                          }) : <span className="muted">尚未加入補訓導入</span>}
                        </div>
                        <div className="menu-option-grid">
                          {gapTrainingCustomCandidates.length ? gapTrainingCustomCandidates.map((person) => {
                            return (
                              <button type="button" className="menu-option" key={person.id} onClick={() => openGapTrainingPicker(person.id, undefined, "custom")}>
                                <strong>{person.name}</strong>
                                <span>{person.role || "-"}</span>
                              </button>
                            );
                          }) : <p className="muted">找不到可加入的人員，或人員已在缺勤清單中。</p>}
                        </div>
                        <div className="manual-modal-actions">
                          <button type="button" className="ghost" onClick={() => setGapTrainingSimulations([])}>清空補訓</button>
                          <button type="button" className="primary" onClick={() => setGapTrainingDialogOpen(false)}>完成</button>
                        </div>
                    </DialogShell>
                  ) : null}

                  {gapTrainingPicker && gapTrainingPickerPerson ? (() => {
                    const recommendedStation = gapTrainingPicker.recommendedStationId
                      ? data.stations.find((station) => station.id === gapTrainingPicker.recommendedStationId)
                      : null;
                    const selectedStation = data.stations.find((station) => station.id === gapTrainingPickerSelectedStationId);
                    return (
                      <DialogShell
                        open
                        title="選擇補訓站點"
                        onClose={() => setGapTrainingPicker(null)}
                        backdropClassName="manual-modal-backdrop coverage-help-backdrop"
                        panelClassName="manual-modal coverage-menu-modal"
                        closeOnBackdrop
                      >
                          <div className="manual-modal-title-row">
                            <h3>{gapTrainingPickerPerson.name} 補訓站點</h3>
                            <button type="button" className="manual-modal-close-button" aria-label="關閉補訓站點選單" onClick={() => setGapTrainingPicker(null)}>×</button>
                          </div>

                          <div className="picker-section">
                            <h4>推薦補訓</h4>
                            {gapTrainingPicker.recommendedStationId ? (
                              <button type="button" className="station-choice recommended" onClick={() => addGapTrainingSimulationFromPicker(gapTrainingPicker.recommendedStationId)}>
                                <strong>{recommendedStation?.name || gapTrainingPicker.recommendedStationId}</strong>
                                <span>依目前缺口與風險推薦</span>
                              </button>
                            ) : <p className="muted">此人不是從推薦名單開啟，請改用下方資格站點或自訂站點。</p>}
                          </div>

                          <div className="picker-section">
                            <h4>資格站點</h4>
                            {gapTrainingPickerQualifiedStations.length ? (
                              <div className="station-choice-grid">
                                {gapTrainingPickerQualifiedStations.map((rule) => {
                                  const station = data.stations.find((item) => item.id === rule.stationId);
                                  const qualification = data.qualifications.find((item) => item.employeeId === gapTrainingPickerPerson.id && item.stationId === rule.stationId);
                                  return (
                                    <button type="button" className="station-choice" key={rule.stationId} onClick={() => addGapTrainingSimulationFromPicker(rule.stationId)}>
                                      <strong>{station?.name || rule.stationId}</strong>
                                      <span>{qualification?.status || "已建檔"}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : <p className="muted">此人目前沒有本班規則內的合格或訓練中站點。</p>}
                          </div>

                          <div className="picker-section">
                            <h4>自訂</h4>
                            <select value={gapTrainingPickerSelectedStationId} onChange={(event) => setGapTrainingPickerStationId(event.target.value)}>
                              {gapRules.map((rule) => {
                                const station = data.stations.find((item) => item.id === rule.stationId);
                                const row = gapActiveCoverageAnalysis.rows.find((item) => item.stationId === rule.stationId);
                                return (
                                  <option key={rule.stationId} value={rule.stationId}>
                                    {station?.name || rule.stationId}{row?.shortage ? `（缺 ${row.shortage}）` : ""}
                                  </option>
                                );
                              })}
                            </select>
                            <div className={gapTrainingPickerSelectedIsQualified ? "training-warning is-ok" : "training-warning"}>
                              {gapTrainingPickerSelectedIsQualified
                                ? `${gapTrainingPickerPerson.name} 已具備 ${selectedStation?.name || gapTrainingPickerSelectedStationId} 合格資格，可直接納入模擬。`
                                : `${gapTrainingPickerPerson.name} 尚未具備 ${selectedStation?.name || gapTrainingPickerSelectedStationId} 合格資格；若要排入分析，代表要先安排補訓。`}
                            </div>
                            <div className="modal-button-row">
                              <button type="button" className="primary" onClick={() => addGapTrainingSimulationFromPicker()}>
                                {gapTrainingPickerSelectedIsQualified ? "加入模擬" : "確認補訓並模擬"}
                              </button>
                              {!gapTrainingPickerSelectedIsQualified ? (
                                <button type="button" className="ghost" onClick={openQualificationReviewForTraining}>前往考核標記訓練中</button>
                              ) : null}
                            </div>
                          </div>
                      </DialogShell>
                    );
                  })() : null}

                  {gapAbsentIds.length && !gapSimulationCount ? (
                    <div className={`panel coverage-summary-panel ${gapAbsentAnalysis.fullyCovered ? "is-covered" : "has-gap"}`}>
                      <div className="panel-header">
                        <h3>缺勤模擬結果</h3>
                        <span>{gapAbsentAnalysis.fullyCovered ? "缺勤後仍可覆蓋" : `缺勤後缺 ${gapAbsentAnalysis.shortage} 人`}</span>
                      </div>
                      <p className="muted">模擬缺勤：{gapAbsentIds.map((id) => data.people.find((person) => person.id === id)?.name || id).join("、")}</p>
                      <div className="detail-grid">
                        <Info label="原最佳覆蓋" value={`${gapCoverageAnalysis.assigned}/${gapCoverageAnalysis.required}`} />
                        <Info label="缺勤後覆蓋" value={`${gapAbsentAnalysis.assigned}/${gapAbsentAnalysis.required}`} />
                        <Info label="新增缺口" value={String(Math.max(0, gapAbsentAnalysis.shortage - gapCoverageAnalysis.shortage))} />
                        <Info label="受影響站點" value={String(gapAbsentAnalysis.rows.filter((row) => row.shortage > 0).length)} />
                      </div>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>站點</th>
                            <th>需求</th>
                            <th>缺勤後指派</th>
                            <th>缺口</th>
                            <th>狀態</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gapAbsentAnalysis.rows.filter((row) => row.shortage > 0 || row.bottleneck).map((row) => {
                            const station = data.stations.find((item) => item.id === row.stationId);
                            const assignedNames = row.assignedIds.map((id) => data.people.find((person) => person.id === id)?.name || id);
                            return (
                              <tr key={row.stationId} className={row.shortage ? "danger-row" : "warning-row"}>
                                <td>{station?.name || row.stationId}</td>
                                <td>{row.required}</td>
                                <td>{assignedNames.join("、") || "-"}</td>
                                <td>{row.shortage}</td>
                                <td>{row.shortage ? "缺口" : "瓶頸"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  <CoverageConfigurationOverview
                    title={gapTrainingSimulationAnalysis ? "情境模擬配置" : gapAbsentIds.length ? "缺勤後配置" : "全站配置"}
                    contextLabel={gapTrainingSimulationAnalysis ? "導入模擬後" : gapAbsentIds.length ? "缺勤模擬中" : "目前狀態"}
                    description={gapTrainingSimulationAnalysis
                      ? "已套用補訓、幹部導入與缺勤條件；摘要只顯示需要關注的站點。"
                      : gapAbsentIds.length
                        ? "已排除模擬缺勤人員；摘要只顯示缺口、瓶頸與配置變動。"
                        : "先查看全站結論與風險站點，需要核對人員來源時再開啟詳細資料。"}
                    assignmentLabel={gapTrainingSimulationAnalysis ? "模擬指派" : gapAbsentIds.length ? "缺勤後指派" : "最佳指派"}
                    shortageLabel={gapTrainingSimulationAnalysis ? "模擬缺口" : gapAbsentIds.length ? "缺勤後缺口" : "全站缺口"}
                    rows={gapConfigurationRows}
                    detailsOpen={gapConfigurationDetailsOpen}
                    onOpenDetails={() => setGapConfigurationDetailsOpen(true)}
                    onCloseDetails={() => setGapConfigurationDetailsOpen(false)}
                  />
                </>
              ) : <Empty text="找不到此班別的正式站點規則，無法進行缺口分析。" />}

              <AppDialog
                open={gapHelpOpen}
                title="缺勤韌性分析說明"
                description="說明分析範圍、計算方式與結果判讀原則。"
                onClose={() => setGapHelpOpen(false)}
                footer={<button type="button" className="primary" onClick={() => setGapHelpOpen(false)}>關閉說明</button>}
              >
                <div className="formal-explanation-list">
                  <p>系統會從單人缺勤逐步分析至指定人數上限。每一個情境都重新配置全站，並確認同一人不會重複指派。</p>
                  <p>第一天與第二天以本班及對班支援人力建立全勤基準，配置時優先使用支援人力，再由本班補位；另行檢核支援撤除後，本班是否仍能接手。</p>
                  <p>分析上限設為 1，代表驗證每位作業人員單獨缺勤；設為 2，則同時包含單人與雙人組合。組合數超出完整計算上限時，系統採固定抽樣並明確標示估算。</p>
                  <p>指定缺勤情境適用於實際請假名單，可直接查看該組合重新配置後的全站缺口。</p>
                  <p>若特定人員或組合反覆造成同一站點缺口，表示資格集中或共享人力不足，後續補訓建議會優先評估能實際降低風險的組合。</p>
                </div>
              </AppDialog>

              <AppDialog
                open={gapTrainingHelpOpen}
                title="補訓效益建議說明"
                description="補訓建議以降低全站缺口與缺勤風險為主要排序依據。"
                onClose={() => setGapTrainingHelpOpen(false)}
                footer={<button type="button" className="primary" onClick={() => setGapTrainingHelpOpen(false)}>關閉說明</button>}
              >
                <div className="formal-explanation-list">
                  <p>尚未執行缺勤韌性分析時，系統先依全勤基準缺口評估；完成分析後，改依可解除的風險組合數及可減少的缺口人次排序。</p>
                  <p>人員目前合格站點較少僅作為效益相同時的次要排序條件，不會因認證少而直接列為優先。領班、組長與主任不列入一般補訓候選。</p>
                  <p>選擇建議人員後，系統會先顯示推薦站點、既有資格站點與其他可選站點，不會立即變更配置。</p>
                  <p>若選擇尚未合格的站點，系統會要求確認訓練，並可同步建立「訓練中」考核狀態。</p>
                  <p>導入補訓情境後，全站配置明細會重新計算指派、缺口及其他站點影響，避免只補單一站點卻形成新的缺口。</p>
                </div>
              </AppDialog>
            </EntranceLayout>
          ) : null}
          {currentRole && page === "manual-schedule" && canUsePage("manual-schedule") ? (
            <EntranceLayout pageKey="manual-schedule">
              <div>

              <div className="panel">
                <div className="toolbar">
                  <select aria-label="班表試排班別" value={manualShift} onChange={(e) => handleManualShiftChange(e.target.value as TeamName)}>
                    {TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <select aria-label="班表試排日別" value={manualDay} onChange={(e) => handleManualDayChange(e.target.value as ShiftMode)}>
                    {dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <select aria-label="班表試排模式" value={manualMode} onChange={(e) => handleManualModeChange(e.target.value as SmartScheduleMode)}>
                    {SMART_MODE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <button className="primary" type="button" onClick={runManualPlan}>重新自動安排</button>
                  <button className="ghost" type="button" onClick={saveManualScheduleDraft}>儲存草稿</button>
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
                <h3>幹部勤務與站長站位</h3>
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
                                {manualDisplayRules.map((rule) => {
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
                <p className="manual-officer-note">領班、組長與主任列為現場管理勤務；站長可指定作業站點並計入該站人力。主任僅顯示姓名，不列入待排人力。</p>
              </div>

              <div className="panel manual-extra-work-panel compact">
                <div className="manual-extra-compact-header">
                  <div>
                    <h3>臨時勤務</h3>
                    <p>可設定兩項非站點勤務及執行人員，內容僅套用於本次試排與輸出。</p>
                  </div>
                </div>
                <div className="manual-extra-pill-row">
                  {manualExtraWorks.map((extra, index) => {
                    const selectedPeople = extra.personIds.map((id) => data.people.find((person) => person.id === id)).filter(Boolean) as Person[];
                    const title = extra.workName.trim() || `臨時勤務 ${index + 1}`;
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
                        <em>{selectedPeople.length ? selectedPeople.map((person) => person.name).join("、") : "尚未設定，請選擇"}</em>
                      </button>
                    );
                  })}
                </div>
              </div>

              {manualDisplayRules.length ? (
                <div className="grid two manual-schedule-station-grid">
                  {manualDisplayRules.map((rule) => {
                    const station = data.stations.find((item) => item.id === rule.stationId);
                    const selectedIds = manualAssignments[rule.stationId] || [];
                    const stationLeaderIds = Object.entries(manualOfficerStations)
                      .filter(([, stationId]) => stationId === rule.stationId)
                      .map(([employeeId]) => employeeId);
                    const coveredCount = new Set([...selectedIds, ...stationLeaderIds]).size;
                    const required = Number(rule.minRequired || 0);
                    const maxAssignable = Number(rule.maxAssignable || 0);
                    const stationStatusClass = required > 0
                      ? coveredCount >= required
                        ? maxAssignable > required && coveredCount >= maxAssignable
                          ? "is-overfilled"
                          : "is-filled"
                        : "is-short"
                      : coveredCount
                        ? "is-filled"
                        : "is-neutral";
                    const assignableAttendance = manualAttendance.all.filter((person) => !manualOfficerIds.has(person.id));
                    const candidates = getQualifiedPeopleForStation(rule.stationId, assignableAttendance, data.qualifications, true)
                      .sort((a, b) => {
                        const statusA = getStationQualificationStatus(data.qualifications, a.id, rule.stationId);
                        const statusB = getStationQualificationStatus(data.qualifications, b.id, rule.stationId);
                        if (statusA !== statusB) return statusA === "合格" ? -1 : 1;
                        return a.name.localeCompare(b.name, "zh-Hant", { numeric: true });
                      });
                    const assignedPeople = candidates.filter((person) => selectedIds.includes(person.id));
                    const pendingPeople = candidates.filter((person) => !selectedIds.includes(person.id));

                    return (
                      <div className={`panel manual-schedule-station ${stationStatusClass}`} key={rule.stationId}>
                        <div className="panel-header">
                          <h3>{station?.name || rule.stationId}</h3>
                          <span>需求 {required}{maxAssignable ? `｜可排滿 ${maxAssignable}` : ""}｜已排 {coveredCount}{stationLeaderIds.length ? `（含站長 ${stationLeaderIds.length}）` : ""}</span>
                        </div>

                        <div className="toolbar">
                          <button type="button" className="ghost" onClick={() => { setManualCustomDialog({ stationId: rule.stationId }); setManualCustomKeyword(""); }}>自訂人選</button>
                        </div>

                        <div className="manual-schedule-group">
                          <h4>已安排</h4>
                          <div className="list-scroll short manual-schedule-list">
                            {assignedPeople.length ? assignedPeople.map((person) => (
                              (() => {
                                const status = getStationQualificationStatus(data.qualifications, person.id, rule.stationId);
                                const isTraining = status === "訓練中";
                                return (
                                  <button
                                    key={person.id}
                                    type="button"
                                    className={`list-row active${isTraining ? " training-assigned" : ""}`}
                                    onClick={() => toggleManualAssignment(rule.stationId, person.id)}
                                    title={isTraining ? "訓練人員：僅限手動安排，不納入自動安排" : undefined}
                                  >
                                    <strong>{person.name}</strong>
                                    {isTraining ? <small className="training-badge-text">訓練人員</small> : null}
                                  </button>
                                );
                              })()
                            )) : <span className="muted">-</span>}
                          </div>
                        </div>

                        <div className="manual-schedule-group">
                          <h4>尚未安排</h4>
                          <div className="list-scroll short manual-schedule-list">
                            {pendingPeople.map((person) => {
                              const assignedStationId = findAssignedStation(manualAssignments, person.id);
                              const isConflict = Boolean(assignedStationId && assignedStationId !== rule.stationId);
                              const assignedStation = assignedStationId ? data.stations.find((item) => item.id === assignedStationId) : null;
                              const status = getStationQualificationStatus(data.qualifications, person.id, rule.stationId);
                              const isTraining = status === "訓練中";
                              return (
                                <button
                                  key={person.id}
                                  type="button"
                                  className={`list-row ${isConflict ? "conflict" : ""}${isTraining ? " training-candidate" : ""}`}
                                  onClick={() => toggleManualAssignment(rule.stationId, person.id)}
                                  title={isTraining ? "訓練人員：可手動補位，不納入自動安排" : undefined}
                                >
                                  <strong>{person.name}</strong>
                                  {isTraining ? <small className="training-badge-text">訓練人員</small> : null}
                                  {isConflict ? <span>已在 {assignedStation?.name || assignedStationId}</span> : null}
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
                  <div>已配置：{manualEffectiveAssigned}</div>
                  <div>未配置：{manualPendingCount}</div>
                  <button type="button" onClick={completeManualSchedule}>檢查並預覽</button>
                  <button type="button" onClick={() => scrollToTop()}>回到頂部</button>
                </div>
              ) : null}

              <AppDialog
                open={manualSafetyOpen}
                title="班表安全檢核"
                description="預覽與輸出前，重新核對全站需求、重複指派、訓練人員、站長站位及臨時勤務。"
                onClose={() => setManualSafetyOpen(false)}
                size="wide"
                footer={(
                  <>
                    <button type="button" className="ghost" onClick={() => setManualSafetyOpen(false)}>返回調整</button>
                    <button
                      type="button"
                      className="primary"
                      disabled={!manualSafety.canPreview || (manualSafety.requiresAcknowledgement && !manualSafetyAcknowledged)}
                      onClick={confirmManualScheduleSafety}
                    >
                      確認並開啟預覽
                    </button>
                  </>
                )}
              >
                <div className={`schedule-audit-status ${manualSafety.canPreview ? "is-ready" : "is-blocked"}`} role="status" aria-live="polite">
                  <strong>{manualSafety.canPreview ? "檢核通過" : "尚未通過"}</strong>
                  <span>{manualSafety.canPreview ? "站點需求已覆蓋，且未發現重複指派。" : "請先處理下列阻擋項目，再重新檢核。"}</span>
                </div>

                <dl className="schedule-audit-metrics">
                  <div><dt>站點需求</dt><dd>{manualSafety.requiredStationSlots}</dd></div>
                  <div><dt>站點已配置</dt><dd>{manualSafety.assignedStationSlots}</dd></div>
                  <div><dt>站點缺口</dt><dd>{manualSafety.totalShortage}</dd></div>
                  <div><dt>未配置備援</dt><dd>{manualSafety.unassignedIds.length}</dd></div>
                </dl>

                {manualSafety.blockingIssues.length ? (
                  <section className="schedule-audit-section is-danger" aria-labelledby="schedule-audit-blockers">
                    <h3 id="schedule-audit-blockers">必須處理</h3>
                    <ul>{manualSafety.blockingIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
                  </section>
                ) : null}

                {manualSafety.stationChecks.some((item) => item.shortage > 0) ? (
                  <section className="schedule-audit-section" aria-labelledby="schedule-audit-shortage">
                    <h3 id="schedule-audit-shortage">未覆蓋站點</h3>
                    <div className="schedule-audit-list">
                      {manualSafety.stationChecks.filter((item) => item.shortage > 0).map((item) => {
                        const station = data.stations.find((stationItem) => stationItem.id === item.stationId);
                        return <div key={item.stationId}><strong>{station?.name || item.stationId}</strong><span>{item.assigned}/{item.required}，仍缺 {item.shortage} 人</span></div>;
                      })}
                    </div>
                  </section>
                ) : null}

                {manualSafety.duplicatePeople.length ? (
                  <section className="schedule-audit-section" aria-labelledby="schedule-audit-duplicates">
                    <h3 id="schedule-audit-duplicates">重複指派人員</h3>
                    <div className="schedule-audit-list">
                      {manualSafety.duplicatePeople.map((item) => {
                        const person = data.people.find((personItem) => personItem.id === item.employeeId);
                        const placementText = item.placements.map((placement) => {
                          const separator = placement.indexOf(":");
                          const kind = separator >= 0 ? placement.slice(0, separator) : placement;
                          const id = separator >= 0 ? placement.slice(separator + 1) : "";
                          if (kind === "站點" || kind === "補充站位") {
                            const station = data.stations.find((stationItem) => stationItem.id === id);
                            return `${kind === "補充站位" ? "站長站位" : "站點"}：${station?.name || id}`;
                          }
                          return placement.replace(":", "：");
                        }).join("、");
                        return <div key={item.employeeId}><strong>{person?.name || item.employeeId}</strong><span>{placementText}</span></div>;
                      })}
                    </div>
                  </section>
                ) : null}

                {manualSafety.trainingAssignments.length ? (
                  <section className="schedule-audit-section is-warning" aria-labelledby="schedule-audit-training">
                    <h3 id="schedule-audit-training">訓練人員站位</h3>
                    <p>{manualSafety.trainingAssignments.map((item) => {
                      const person = data.people.find((personItem) => personItem.id === item.employeeId);
                      const station = data.stations.find((stationItem) => stationItem.id === item.stationId);
                      return `${person?.name || item.employeeId} → ${station?.name || item.stationId}`;
                    }).join("、")}</p>
                  </section>
                ) : null}

                {manualSafety.unassignedIds.length ? (
                  <section className="schedule-audit-section" aria-labelledby="schedule-audit-reserve">
                    <h3 id="schedule-audit-reserve">未配置備援人員</h3>
                    <p>{manualSafety.unassignedIds.map((id) => data.people.find((person) => person.id === id)?.name || id).join("、")}</p>
                    <small>未配置人員保留為備援，不等同於站點缺口。</small>
                  </section>
                ) : null}

                {manualSafety.canPreview && manualSafety.requiresAcknowledgement ? (
                  <label className="schedule-audit-confirmation">
                    <input
                      type="checkbox"
                      checked={manualSafetyAcknowledged}
                      onChange={(event) => setManualSafetyAcknowledged(event.target.checked)}
                    />
                    我已確認訓練人員或特殊支援安排，並了解其現場風險。
                  </label>
                ) : null}
              </AppDialog>

              {manualPreviewOpen ? (
                <DialogShell
                  open={manualPreviewOpen}
                  title="班表確認與輸出"
                  onClose={() => setManualPreviewOpen(false)}
                  backdropClassName="manual-modal-backdrop manual-modal-backdrop-top"
                  panelClassName="manual-modal manual-preview-modal"
                >
                    <div className="manual-preview-title-row">
                      <div>
                        <h3>班表確認與輸出</h3>
                        <p>安全檢核已完成。請確認班別、幹部勤務、站點與人員配置後，再進行分享或下載。</p>
                      </div>
                      <button type="button" className="manual-preview-close" aria-label="關閉班表確認與輸出" onClick={() => setManualPreviewOpen(false)}>×</button>
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
                                        {person ? (
                                          <span className={`schedule-matrix-person-chip${person.isOfficer ? " officer" : ""}${person.isTraining ? " training" : ""}`}>
                                            {person.name}
                                            {person.isTraining ? <small>訓練人員</small> : null}
                                          </span>
                                        ) : null}
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
                      <button type="button" className="ghost" onClick={saveManualScheduleDraft}>儲存草稿</button>
                      <button type="button" className="ghost" onClick={copyManualSchedulePreview}>複製文字</button>
                      <button type="button" className="primary" onClick={shareManualSchedulePreview}>系統分享</button>
                      <button type="button" className="primary" onClick={confirmManualSchedulePreview}>確認完成並下載圖片</button>
                    </div>
                </DialogShell>
              ) : null}

              {manualResetDialog ? (
                <DialogShell
                  open
                  title="重置班表試排"
                  onClose={() => setManualResetDialog(null)}
                  backdropClassName="manual-modal-backdrop"
                  panelClassName="manual-modal"
                >
                    <h3>重置目前站點試排？</h3>
                    <p>更換班別 / 日別 / 模式會清空目前已安排人員，是否繼續？</p>
                    <div className="manual-modal-actions">
                      <button type="button" className="ghost" onClick={() => setManualResetDialog(null)}>取消</button>
                      <button type="button" className="primary" onClick={() => applyManualSwitch(manualResetDialog.type, manualResetDialog.value)}>確認重置</button>
                    </div>
                </DialogShell>
              ) : null}

              {manualConflictDialog ? (() => {
                const person = data.people.find((item) => item.id === manualConflictDialog.employeeId);
                const oldStation = data.stations.find((item) => item.id === manualConflictDialog.assignedStationId);
                const nextStation = data.stations.find((item) => item.id === manualConflictDialog.stationId);
                const oldRule = manualRules.find((rule) => rule.stationId === manualConflictDialog.assignedStationId);
                const oldNeed = oldRule ? getRuleNeed(oldRule, manualDay) : 0;
                const oldCount = manualAssignments[manualConflictDialog.assignedStationId]?.length || 0;
                const oldNextCount = Math.max(0, oldCount - 1);
                const willCreateShortage = oldNeed > 0 && oldNextCount < oldNeed;
                return (
                  <DialogShell
                    open
                    title="更換人員站點"
                    onClose={() => setManualConflictDialog(null)}
                    backdropClassName="manual-modal-backdrop"
                    panelClassName="manual-modal"
                  >
                      <h3>更換站點？</h3>
                      <p>{person?.name || manualConflictDialog.employeeId} 已安排在「{oldStation?.name || manualConflictDialog.assignedStationId}」，是否更換到「{nextStation?.name || manualConflictDialog.stationId}」？</p>
                      <p className={willCreateShortage ? "manual-impact-warning" : "muted"}>
                        移動後影響：{oldStation?.name || manualConflictDialog.assignedStationId} 將從 {oldCount}/{oldNeed} 變成 {oldNextCount}/{oldNeed}
                        {willCreateShortage ? "，會產生缺口。" : "，不會低於需求。"}
                      </p>
                      <div className="manual-modal-actions">
                        <button type="button" className="ghost" onClick={() => setManualConflictDialog(null)}>取消</button>
                        <button type="button" className="primary" onClick={confirmManualConflictReplace}>確認更換</button>
                      </div>
                  </DialogShell>
                );
              })() : null}

              {manualTrainingDialog ? (() => {
                const person = data.people.find((item) => item.id === manualTrainingDialog.personId);
                const station = data.stations.find((item) => item.id === manualTrainingDialog.stationId);
                return (
                  <DialogShell
                    open
                    title="加入訓練人員"
                    onClose={() => setManualTrainingDialog(null)}
                    backdropClassName="manual-modal-backdrop manual-modal-backdrop-top"
                    panelClassName="manual-modal"
                  >
                      <h3>加入訓練人員？</h3>
                      <p><strong>{person?.name || manualTrainingDialog.personId}</strong> 目前在「{station?.name || manualTrainingDialog.stationId}」{manualTrainingDialog.currentStatus === "無站點資格" ? "沒有站點資格" : `狀態為「${manualTrainingDialog.currentStatus}」`}。</p>
                      <p>是否加入訓練並同步連動到考核資料，將此站點狀態設為「訓練中」？</p>
                      <div className="manual-modal-actions">
                        <button type="button" className="ghost" onClick={() => setManualTrainingDialog(null)}>取消</button>
                        <button type="button" className="primary" onClick={confirmManualTrainingPerson}>加入訓練</button>
                      </div>
                  </DialogShell>
                );
              })() : null}

              {manualExtraDialog && manualExtraDialogItem ? (() => {
                const selectedPeople = manualExtraDialogItem.personIds.map((id) => data.people.find((person) => person.id === id)).filter(Boolean) as Person[];
                return (
                  <DialogShell
                    open
                    title="設定臨時勤務"
                    onClose={closeManualExtraDialog}
                    backdropClassName="manual-modal-backdrop manual-modal-backdrop-top"
                    panelClassName="manual-modal"
                    closeOnBackdrop
                  >
                      <div className="manual-modal-title-row">
                        <h3>設定臨時勤務</h3>
                        <button type="button" className="manual-modal-close-button" aria-label="關閉臨時勤務視窗" onClick={closeManualExtraDialog}>×</button>
                      </div>
                      <label className="manual-extra-dialog-field">
                        勤務名稱
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
                          <button key={person.id} type="button" onClick={() => removeManualExtraPerson(manualExtraDialogItem.id, person.id)} title="移除人員">
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
                  </DialogShell>
                );
              })() : null}

              {manualCustomDialog ? (
                <DialogShell
                  open={Boolean(manualCustomDialog)}
                  title="自訂站點人選"
                  onClose={() => { setManualCustomDialog(null); setManualCustomKeyword(""); }}
                  backdropClassName="manual-modal-backdrop"
                  panelClassName="manual-modal"
                >
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
                </DialogShell>
              ) : null}
              </div>
            </EntranceLayout>
          ) : null}
          {currentRole && page === "station-rules" && canUsePage("station-rules") ? renderStationRulesPage() : null}
          {currentRole && page === "people-management" && canUsePage("people-management") ? renderPeopleManagementPage() : null}
                    {currentRole && page === "permission-admin" && canUsePage("permission-admin") ? renderPermissionAdmin() : null}
          {false && page === "smart-schedule" ? null : null}
          {showBackToTop ? <button type="button" className="back-to-top" onClick={() => scrollToTop()}>回到頂部</button> : null}
        </main>
        <MobileCommandMenu
          open={mobileCommandOpen}
          page={page}
          items={allowedNav}
          theme={uiTheme}
          onToggle={() => setMobileCommandOpen((current) => !current)}
          onNavigate={navigateToPage}
          onThemeChange={changeUiTheme}
          onTop={() => scrollToTop()}
        />
      </div>

      {appVersionBlocked ? (
        <DialogShell
          open={appVersionBlocked}
          title="系統已更新"
          onClose={() => window.location.reload()}
          backdropClassName="version-blocker"
          panelClassName="version-blocker-card"
        >
            <h2 id="version-blocker-title">系統已更新</h2>
            <p>{appVersionMessage || "為避免舊版資料覆蓋或權限判斷錯誤，請重新整理後繼續使用。"}</p>
            <button type="button" className="primary" onClick={() => window.location.reload()}>重新整理</button>
        </DialogShell>
      ) : null}

      {mobileDetailModal ? (
        <DialogShell
          open={Boolean(mobileDetailModal)}
          title={mobileDetailModal.type === "person" ? "人員資訊" : mobileDetailModal.type === "station" ? "站點資訊" : "站點考核"}
          onClose={() => setMobileDetailModal(null)}
          backdropClassName="mobile-modal-backdrop upgraded-modal-backdrop"
          panelClassName={`mobile-modal upgraded-modal-card ${mobileDetailModal.type === "review" ? "review-edit-modal" : ""}`}
          closeOnBackdrop
        >
            <button type="button" className="mobile-modal-floating-close" aria-label="關閉資訊視窗" onClick={() => setMobileDetailModal(null)}>×</button>
            <div className="mobile-modal-header upgraded-modal-header">
              <strong id="mobile-detail-title">{mobileDetailModal.type === "person" ? "人員資訊" : mobileDetailModal.type === "station" ? "站點資訊" : "站點考核"}</strong>
              <button type="button" className="mobile-modal-close" aria-label="關閉資訊視窗" onClick={() => setMobileDetailModal(null)}>×</button>
            </div>
            <div className="mobile-modal-body upgraded-modal-body">
              {mobileDetailModal.type === "person" && mobilePerson ? <PersonDetailView person={mobilePerson} qualifications={mobilePersonQualifications} compact /> : null}
              {mobileDetailModal.type === "station" && mobileStation ? <StationDetailView station={mobileStation} team={stationTeamFilter} day={stationDayFilter} attendance={stationAttendance} qualifications={mobileStationQualifications} people={data.people} compact /> : null}
              {mobileDetailModal.type === "review" && mobileReviewPerson ? (
                <div className="review-modal-content">
                  <section className="review-person-summary">
                    <div className="review-summary-title">
                      <strong>{mobileReviewPerson.name || "未命名"}</strong>
                      <span>{mobileReviewPerson.id}</span>
                    </div>
                    <div className="review-info-grid">
                      <div><span>班別</span><strong>{String(getTeamOfPerson(mobileReviewPerson)) || "-"}</strong></div>
                      <div><span>職務</span><strong>{mobileReviewPerson.role || "-"}</strong></div>
                      <div><span>國籍</span><strong>{mobileReviewPerson.nationality || "-"}</strong></div>
                      <div><span>資格數</span><strong>{mobileReviewQualifications.length}</strong></div>
                    </div>
                  </section>

                  <section className="review-edit-section">
                    <div className="review-section-heading">考核登記</div>
                    <label className="review-field">站點
                      <select value={reviewStationId} onChange={(event) => setReviewStationId(event.target.value)}>
                        {data.stations.map((station) => (
                          <option key={station.id} value={station.id}>{station.id}｜{station.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="review-field">狀態
                      <select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as QualificationStatus)}>
                        {qualificationOptions.map((status) => (
                          <option key={status || "empty"} value={status}>{status || "空白"}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="primary review-save-button"
                      onClick={async () => {
                        const ok = await handleSaveQualification(undefined, false);
                        if (ok) setMobileDetailModal(null);
                      }}
                    >
                      確認並儲存
                    </button>
                  </section>

                  <section className="review-existing-section">
                    <div className="review-section-heading">既有考核紀錄</div>
                    {mobileReviewQualifications.length ? (
                      <div className="review-record-list">
                        {mobileReviewQualifications.map((item) => {
                          const station = data.stations.find((stationItem) => stationItem.id === item.stationId);
                          return (
                            <div className="review-record-row" key={`${item.employeeId}-${item.stationId}`}>
                              <div>
                                <strong>{station?.name || item.stationId}</strong>
                                <span>{item.stationId}</span>
                              </div>
                              <span className={`review-status-badge status-${item.status || "empty"}`}>{item.status || "空白"}</span>
                              <button type="button" className="danger review-delete-button" onClick={() => handleDeleteQualification(item.employeeId, item.stationId)}>刪除</button>
                            </div>
                          );
                        })}
                      </div>
                    ) : <p className="muted">目前沒有既有考核紀錄。</p>}
                  </section>
                </div>
              ) : null}
            </div>
            <button type="button" className="mobile-modal-fab-close" onClick={() => setMobileDetailModal(null)}>關閉</button>
        </DialogShell>
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
