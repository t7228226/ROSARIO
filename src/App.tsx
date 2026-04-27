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
type SchedulePreviewStyle = "card" | "table" | "share" | "section";
type ManualExtraWork = { id: string; workName: string; personIds: string[] };


const schedulePreviewStyleOptions: Array<{ key: SchedulePreviewStyle; label: string }> = [
  { key: "card", label: "卡片版" },
  { key: "table", label: "表格版" },
  { key: "share", label: "可愛圖卡" },
  { key: "section", label: "海報版" },
];

const initialManualExtraWorks: ManualExtraWork[] = [
  { id: "manual-extra-work-1", workName: "", personIds: [] },
  { id: "manual-extra-work-2", workName: "", personIds: [] },
];

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
  const [flash, setFlash] = useState("");
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => getViewportMode());
  const [mobileDetailModal, setMobileDetailModal] = useState<MobileDetailModal>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const personDetailRef = useRef<HTMLDivElement | null>(null);
  const stationDetailRef = useRef<HTMLDivElement | null>(null);
  const reviewDetailRef = useRef<HTMLDivElement | null>(null);

  const [loginForm, setLoginForm] = useState({ account: "", password: "" });
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

  const [smartShift, setSmartShift] = useState<TeamName>("婷芬班");
  const [smartDay, setSmartDay] = useState<ShiftMode>("當班");
  const [smartMode, setSmartMode] = useState<SmartScheduleMode>("當班優先");
  const [smartAssignments, setSmartAssignments] = useState<Record<string, string[]>>({});

  const isMobileView = viewMode === "mobile";

  function setFlashMessage(text: string) {
    setFlash(text);
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
  }, [manualShift, manualDay]);

  useEffect(() => {
    setSmartAssignments({});
  }, [smartShift, smartDay, smartMode]);

  const filteredPeople = useMemo(() => {
    return data.people.filter((person) => {
      const matchTeam = personTeamFilter === "全部班別" || getTeamOfPerson(person) === personTeamFilter;
      const matchKeyword = searchText([person.id, person.name, String(getTeamOfPerson(person)), person.role, person.nationality], personKeyword);
      return matchTeam && matchKeyword;
    });
  }, [data.people, personTeamFilter, personKeyword]);

  const permissionRows = useMemo(() => {
    return data.people.filter((person) => {
      if (!canAppearInPermissionAdmin(person) && person.id !== "P0033") return false;
      return searchText([person.id, person.name, person.role, String(getSystemPermission(person) || ""), String(getTeamOfPerson(person))], permissionSearchKeyword);
    });
  }, [data.people, permissionSearchKeyword]);

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
  const manualOfficerIds = useMemo(() => new Set(manualOfficerPeople.map((person) => person.id)), [manualOfficerPeople]);
  const manualCountedOfficerCount = useMemo(() => {
    return manualOfficerPeople.filter((person) => normalizeOfficerRole(person.role) !== "主任").length;
  }, [manualOfficerPeople]);
  const manualDirectorCount = manualOfficerGroups.主任.length;

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
    const activeTeamPeople = data.people.filter((person) => {
      const employment = String(person.employmentStatus || "").trim();
      const isInactive = employment.includes("離職") || employment.includes("停用") || employment.toUpperCase() === "N";
      return !isInactive && getTeamOfPerson(person) === manualShift;
    });
    const officerNamesByRole = (role: OfficerRole) => uniqueNames(
      activeTeamPeople
        .filter((person) => normalizeOfficerRole(person.role) === role)
        .map((person) => person.name)
    );
    const stationOrder = new Map(data.stations.map((station, index) => [station.id, index]));
    const orderedManualRules = [...manualRules].sort((a, b) => {
      const orderA = stationOrder.get(a.stationId) ?? 9999;
      const orderB = stationOrder.get(b.stationId) ?? 9999;
      if (orderA !== orderB) return orderA - orderB;
      return String(a.stationId).localeCompare(String(b.stationId), "zh-Hant", { numeric: true });
    });
    return {
      team: manualShift,
      officers: {
        主任: officerNamesByRole("主任"),
        組長: officerNamesByRole("組長"),
        領班: officerNamesByRole("領班"),
      },
      rows: [
        ...orderedManualRules.map((rule) => {
          const station = data.stations.find((item) => item.id === rule.stationId);
          const assignedNames = (manualAssignments[rule.stationId] || [])
            .map((id) => peopleById.get(id)?.name || "")
            .filter(Boolean);
          const selectedOfficerNames = manualOfficerPeople
            .filter((person) => manualOfficerStations[person.id] === rule.stationId)
            .map((person) => person.name);
          return {
            stationId: rule.stationId,
            stationName: getScheduleStationDisplayName(station),
            people: uniqueNames([...assignedNames, ...selectedOfficerNames]),
          };
        }),
        ...manualExtraWorks
          .map((item, index) => {
            const stationName = item.workName.trim() || `自訂工作 ${index + 1}`;
            const people = item.personIds.map((id) => peopleById.get(id)?.name || "").filter(Boolean);
            return {
              stationId: item.id,
              stationName,
              people: uniqueNames(people),
            };
          })
          .filter((row) => row.stationName || row.people.length > 0),
      ],
    };
  }, [data.people, data.stations, manualAssignments, manualOfficerPeople, manualOfficerStations, manualRules, manualShift, manualExtraWorks]);
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

  function logout() {
    setCurrentUser(null);
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
      setLoginForm({ account: "", password: "" });
      setPage("home");
      setFlashMessage(`登入成功：${mergedUser.name}`);
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
      lines.push(row.people.join("、") || "-");
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

  function downloadManualSchedulePreviewImage() {
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
      const lines = wrapCanvasText(ctx, row.people.join("、") || "-", width - padding * 2 - 36);
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

      ctx.fillStyle = isPoster ? "#e2e8f0" : "#334155";
      ctx.font = "700 28px 'Noto Sans TC', 'PingFang TC', sans-serif";
      const lines = wrapCanvasText(ctx, row.people.join("、") || "-", w - 56);
      lines.forEach((line, lineIndex) => {
        ctx.fillText(line, x + 28, y + 82 + lineIndex * 36);
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

  const navItems: Array<{ key: PageKey; label: string; minRole?: UserRole }> = [
    { key: "home", label: "首頁" },
    { key: "person-query", label: "查詢人員資格", minRole: "技術員" },
    { key: "station-query", label: "查詢站點人選", minRole: "技術員" },
    { key: "qualification-review", label: "站點考核", minRole: "領班" },
    { key: "gap-analysis", label: "站點缺口分析", minRole: "組長" },
    { key: "manual-schedule", label: "站點試排", minRole: "組長" },
    { key: "station-rules", label: "站點規則設定", minRole: "主任" },
    { key: "people-management", label: "人員名單管理", minRole: "主任" },
    { key: "smart-schedule", label: "智能試排", minRole: "主任" },
    { key: "permission-admin", label: "權限管理", minRole: "最高權限" },
  ];

  const allowedNav = currentRole ? navItems.filter((item) => hasAccess(item.minRole)) : navItems.filter((item) => item.key === "home");

  if (loading) return <div className="app-shell loading" translate="no">資料載入中...</div>;

  return (
    <>
      <div className="app-shell" translate="no">
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
                <input placeholder="登入帳號" value={loginForm.account} onChange={(e) => setLoginForm((c) => ({ ...c, account: e.target.value }))} />
                <input type="password" placeholder="登入密碼" value={loginForm.password} onChange={(e) => setLoginForm((c) => ({ ...c, password: e.target.value }))} />
                <button className="primary" type="button" onClick={handleLogin}>登入</button>
              </>
            )}
          </div>
          <nav className="nav-list">
            {allowedNav.map((item) => <button key={item.key} className={page === item.key ? "nav-item active" : "nav-item"} onClick={() => navigateToPage(item.key)}>{item.label}</button>)}
          </nav>
        </aside>
        <main className="content" ref={contentRef}>
          {flash ? <div className="flash"><span>{flash}</span><button type="button" className="flash-close" onClick={() => setFlash("")}>×</button></div> : null}
          {page === "home" ? <Layout title="首頁" subtitle="系統說明與功能總覽。未登入不顯示其他功能。"><div className="grid three compact-home-stats"><StatCard title="人員總數" value={String(data.people.length)} note="人員主檔" /><StatCard title="站點總數" value={String(data.stations.length)} note="站點主檔" /><StatCard title="資格筆數" value={String(data.qualifications.length)} note="站點資格" /></div><div className="panel intro-panel"><h3>系統說明</h3><p>這是通用型站點資格管理系統，提供查詢人員資格、查詢站點人選、站點考核、缺口分析、站點試排與智能試排。</p><p>未登入只能看首頁；登入後，系統會依帳號權限顯示可用功能。</p></div></Layout> : null}
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
                .manual-officer-chip { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; min-width: 76px; padding: 8px 16px; border-radius: 999px; border: 1px solid #bfdbfe; background: #eff6ff; color: #1d4ed8; font-size: 18px; font-weight: 900; white-space: nowrap; }
                .manual-officer-station { display: inline-flex; align-items: center; gap: 8px; padding: 6px; border-radius: 18px; background: #f8fafc; border: 1px solid #e2e8f0; }
                .manual-officer-station select { width: auto; min-width: 126px; min-height: 42px; border-radius: 14px; padding: 6px 10px; font-size: 16px; }
                .manual-officer-note { margin: 10px 0 0; color: #64748b; font-weight: 800; line-height: 1.6; }
                .manual-extra-work-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
                .manual-extra-work-card { border: 1px dashed #93c5fd; border-radius: 20px; background: linear-gradient(135deg, #f8fbff, #eff6ff); padding: 14px; }
                .manual-extra-work-card h3 { margin: 0 0 10px; color: #0f172a; font-size: 20px; font-weight: 950; }
                .manual-extra-work-card label { display: grid; gap: 6px; color: #475569; font-weight: 900; margin-bottom: 10px; }
                .manual-extra-work-card input, .manual-extra-work-card select { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 14px; min-height: 44px; padding: 9px 12px; font-size: 16px; background: #fff; }
                .manual-extra-selected { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
                .manual-extra-selected button { border: 0; border-radius: 999px; padding: 8px 12px; background: #dbeafe; color: #1d4ed8; font-weight: 950; cursor: pointer; }
                .manual-extra-note { color: #64748b; font-weight: 800; line-height: 1.6; margin: 10px 0 0; }
                .manual-floating-tip-react { position: fixed; right: 18px; bottom: 18px; z-index: 260; border-radius: 18px; background: #0ea5e9; color: #fff; padding: 16px; box-shadow: 0 18px 48px rgba(2, 132, 199, .28); font-size: 20px; font-weight: 950; text-align: center; min-width: 128px; }
                .manual-floating-tip-react button { display: block; width: 100%; margin-top: 10px; border: 0; border-radius: 14px; background: #fff; color: #075985; padding: 10px 16px; font-weight: 950; cursor: pointer; }
                .manual-modal-backdrop { position: fixed; inset: 0; z-index: 500; display: grid; place-items: center; padding: 18px; background: rgba(15, 23, 42, .44); }
                .manual-modal-backdrop-top { z-index: 900 !important; background: rgba(15, 23, 42, .58); }
                .manual-modal-backdrop-top .manual-modal { box-shadow: 0 30px 80px rgba(15, 23, 42, .42); }
                .manual-modal { width: min(460px, 100%); max-height: 86vh; overflow: auto; border-radius: 20px; background: #fff; padding: 18px; box-shadow: 0 22px 60px rgba(15, 23, 42, .3); color: #0f172a; overscroll-behavior: contain; }
                .manual-modal h3 { position: sticky; top: -18px; z-index: 3; margin: -18px -18px 12px; padding: 18px 18px 12px; font-size: 22px; font-weight: 950; background: #fff; border-bottom: 1px solid rgba(226, 232, 240, .85); }
                .manual-modal p { line-height: 1.7; color: #334155; font-weight: 800; }
                .manual-modal input { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 14px; padding: 13px 14px; font-size: 18px; }
                .manual-modal-actions { position: sticky; bottom: -18px; z-index: 4; display: flex; justify-content: flex-end; gap: 10px; margin: 16px -18px -18px; padding: 14px 18px 18px; background: rgba(255,255,255,.96); border-top: 1px solid rgba(226, 232, 240, .95); box-shadow: 0 -12px 28px rgba(15, 23, 42, .08); backdrop-filter: blur(10px); }
                .manual-modal-actions button, .manual-custom-result button { border: 0; border-radius: 14px; padding: 11px 15px; font-weight: 950; cursor: pointer; }
                .manual-modal-actions .primary, .manual-custom-result button { background: #2563eb; color: #fff; }
                .manual-modal-actions .ghost { background: #e2e8f0; color: #0f172a; }
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
                .mobile-modal-header { position: sticky; top: 0; z-index: 5; background: #fff; border-bottom: 1px solid rgba(226, 232, 240, .95); }
                .mobile-modal-close { position: sticky; top: 8px; z-index: 6; }
                .mobile-modal-fab-close { position: sticky; bottom: 14px; z-index: 6; }
                @media (max-width: 900px) {
                  .manual-floating-tip-react { right: 10px; bottom: 12px; font-size: 18px; }
                  .manual-schedule-station .manual-schedule-group h4 { font-size: 20px; }
                  .manual-officer-row { grid-template-columns: 1fr; gap: 6px; }
                  .manual-officer-title { font-size: 20px; padding-top: 0; }
                  .manual-officer-chip { min-height: 46px; font-size: 17px; }
                  .manual-officer-station { width: 100%; justify-content: space-between; box-sizing: border-box; }
                  .manual-officer-station select { flex: 1; min-width: 0; }
                  .manual-extra-work-grid { grid-template-columns: 1fr; }
                  .manual-modal { width: calc(100vw - 24px); max-height: 84dvh; padding: 16px; }
                  .manual-modal h3 { top: -16px; margin: -16px -16px 12px; padding: 16px 16px 12px; }
                  .manual-modal-actions { bottom: -16px; margin: 16px -16px -16px; padding: 12px 16px calc(16px + env(safe-area-inset-bottom)); flex-direction: column-reverse; }
                  .manual-modal-actions button { width: 100%; min-height: 52px; font-size: 17px; }
                  .manual-preview-modal { max-height: 88dvh; }
                  .manual-preview-title-row h3 { font-size: 22px; }
                  .schedule-paper { padding: 12px; border-radius: 20px; }
                  .schedule-paper h4 { font-size: 24px; }
                  .schedule-poster-row { grid-template-columns: 1fr; gap: 4px; }
                  .schedule-table-preview { min-width: 520px; }
                  .schedule-table-wrap { overflow-x: auto; }
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
                    const people = manualOfficerGroups[role];
                    return (
                      <div className="manual-officer-row" key={role}>
                        <div className="manual-officer-title">{role}</div>
                        <div className="manual-officer-list">
                          {people.length ? people.map((person) => role === "站長" ? (
                            <label className="manual-officer-station" key={person.id}>
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
                              <span className="manual-officer-chip">{person.name}</span>
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

              <div className="panel manual-extra-work-panel">
                <h3>自訂工作</h3>
                <p className="manual-extra-note">提供 2 個臨時空白欄位，適合安排不屬於固定站點的額外工作；只會進入本次班表與圖片，不會寫入主檔站點。</p>
                <div className="manual-extra-work-grid">
                  {manualExtraWorks.map((extra, index) => {
                    const selectedPeople = extra.personIds.map((id) => data.people.find((person) => person.id === id)).filter(Boolean) as Person[];
                    const usedAssignedIds = new Set([
                      ...Object.values(manualAssignments).flat(),
                      ...manualOfficerPeople.map((person) => person.id),
                    ]);
                    const availablePeople = manualAttendance.all
                      .filter((person) => !usedAssignedIds.has(person.id) || extra.personIds.includes(person.id))
                      .filter((person) => !isPersonUsedInManualExtra(person.id, extra.id) || extra.personIds.includes(person.id))
                      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true }));
                    return (
                      <div className="manual-extra-work-card" key={extra.id}>
                        <h3>自訂欄位 {index + 1}</h3>
                        <label>
                          自訂工作
                          <input
                            value={extra.workName}
                            placeholder="例如：搬料、清潔、支援外務"
                            onChange={(event) => updateManualExtraWork(extra.id, { workName: event.target.value })}
                          />
                        </label>
                        <label>
                          自訂人員
                          <select value="" onChange={(event) => addManualExtraPerson(extra.id, event.target.value)}>
                            <option value="">選擇人員加入</option>
                            {availablePeople.map((person) => (
                              <option key={person.id} value={person.id}>{person.name}</option>
                            ))}
                          </select>
                        </label>
                        <div className="manual-extra-selected">
                          {selectedPeople.length ? selectedPeople.map((person) => (
                            <button key={person.id} type="button" onClick={() => removeManualExtraPerson(extra.id, person.id)} title="點擊移除">
                              {person.name} ×
                            </button>
                          )) : <span className="muted">尚未加入人員</span>}
                        </div>
                      </div>
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
                              <div className="schedule-name-line">{row.people.join("、") || "-"}</div>
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
                                <tr key={row.stationId}><td>{row.stationName}</td><td>{row.people.join("、") || "-"}</td></tr>
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
                              <div className="schedule-name-line">{row.people.join("　") || "-"}</div>
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
                              <span>{row.people.join("、") || "-"}</span>
                            </div>
                          ))}
                        </div>
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
          {currentRole && page === "permission-admin" && hasAccess("最高權限") ? <Layout title="權限管理" subtitle="只有最高權限可見。此頁連動人員名單，僅顯示符合資格之幹部候選；P0033 固定為最高權限。"><div className="panel"><div className="toolbar"><input placeholder="搜尋工號、姓名、班別、職務、權限" value={permissionSearchKeyword} onChange={(e) => setPermissionSearchKeyword(e.target.value)} /></div><table className="table"><thead><tr><th>工號</th><th>姓名</th><th>班別</th><th>職務</th><th>目前權限</th><th>調整權限</th><th>狀態</th></tr></thead><tbody>{permissionRows.map((person) => <tr key={person.id}><td>{person.id}</td><td>{person.name}</td><td>{String(getTeamOfPerson(person))}</td><td>{person.role}</td><td>{String(getSystemPermission(person) || "技術員")}</td><td>{person.id === "P0033" ? <span>最高權限（鎖定）</span> : <ConfirmSelect value={String(getSystemPermission(person) || "技術員")} options={permissionOptions.map((item) => ({ label: item, value: item }))} onCommit={(value) => handleUpdatePermission(person, value as UserRole)} />}</td><td>{person.employmentStatus || "-"}</td></tr>)}</tbody></table></div></Layout> : null}
          {currentRole && page === "smart-schedule" && hasAccess("主任") ? <Layout title="智能試排" subtitle="提供當班優先、支援優先、資格優先三種模式，依四班 / 三日別運作。"><div className="panel"><div className="toolbar"><select value={smartShift} onPointerDown={releaseActiveControl} onChange={(e) => setSmartShift(e.target.value as TeamName)}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={smartDay} onPointerDown={releaseActiveControl} onChange={(e) => setSmartDay(e.target.value as ShiftMode)}>{dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={smartMode} onPointerDown={releaseActiveControl} onChange={(e) => setSmartMode(e.target.value as SmartScheduleMode)}>{SMART_MODE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><button className="primary" type="button" onPointerUp={(e) => e.currentTarget.blur()} onClick={runSmartPlan}>一鍵試排</button></div><div className="detail-grid"><Info label="本籍出勤" value={String(smartAttendance.localCount)} /><Info label="菲籍出勤" value={String(smartAttendance.filipinoCount)} /><Info label="越籍出勤" value={String(smartAttendance.vietnamCount)} /><Info label="總出勤" value={String(smartAttendance.totalCount)} /><Info label={smartDay === "當班" ? "本班人力" : "本班出勤"} value={String(smartAttendance.own.length)} /><Info label="支援人力" value={String(smartAttendance.support.length)} /><Info label="支援對班" value={smartDay === "當班" ? "-" : smartAttendance.supportTeam} /></div></div>{smartRules.length ? <><div className="panel floating-summary"><div className="detail-grid"><Info label="需排總人數" value={String(smartSummary.required)} /><Info label="已排總人數" value={String(smartSummary.assigned)} /><Info label="唯一人數" value={String(smartSummary.uniqueAssigned)} /><Info label="重複安排" value={String(smartSummary.duplicates)} /><Info label="缺口總數" value={String(smartSummary.shortage)} /></div></div><div className="grid two">{smartRules.map((rule) => { const station = data.stations.find((item) => item.id === rule.stationId); const selectedIds = smartAssignments[rule.stationId] || []; return <div className="panel" key={rule.stationId}><div className="panel-header"><h3>{station?.name || rule.stationId}</h3><span>需求 {rule.minRequired}</span></div><div className="toolbar"><button type="button" className="ghost" onClick={() => handleCustomAssign("smart", rule.stationId)}>自訂人選</button></div><div className="chips">{selectedIds.length ? selectedIds.map((id) => { const person = data.people.find((item) => item.id === id); return <span className="chip" key={id}>{person?.name || id}</span>; }) : <span className="muted">尚未安排</span>}</div></div>; })}</div></> : <Empty text="找不到此班別的正式站點規則，無法執行智能試排。" />}</Layout> : null}
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
