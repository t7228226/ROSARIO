import { useEffect, useMemo, useState } from "react";
import Layout from "./components/Layout";
import { PersonDetailView, ReviewDetailView, StationDetailView } from "./components/detailViews";
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

const emptyBootstrap: AppBootstrap = {
  people: [],
  stations: [],
  qualifications: [],
  stationRules: [],
};

const dayOptions: ShiftMode[] = DAY_OPTIONS;
const permissionOptions: UserRole[] = ["技術員", "領班", "組長", "主任", "站長", "最高權限"];
const permissionEligibleJobs = new Set(["領班", "組長", "主任", "站長"]);

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
  return normalizePermission(String(person.systemPermission ?? person.permissionLevel ?? "").trim());
}

function canAppearInPermissionAdmin(person: Person) {
  return permissionEligibleJobs.has(String(person.role || "").trim()) || roleRank[getSystemPermission(person) || "技術員"] >= roleRank["領班"];
}

function countAssigned(assignments: Record<string, string[]>) {
  return Object.values(assignments).reduce((sum, list) => sum + list.length, 0);
}

function appendUniqueAssignment(current: Record<string, string[]>, stationId: string, employeeId: string) {
  const currentIds = current[stationId] || [];
  if (currentIds.includes(employeeId)) return current;
  return { ...current, [stationId]: [...currentIds, employeeId] };
}

function findAssignedStation(assignments: Record<string, string[]>, employeeId: string) {
  return Object.entries(assignments).find(([, ids]) => ids.includes(employeeId))?.[0] || null;
}

function getAssignmentSummary(assignments: Record<string, string[]>, rules: StationRule[]) {
  const required = rules.reduce((sum, rule) => sum + rule.minRequired, 0);
  const assigned = countAssigned(assignments);
  const shortage = rules.reduce((sum, rule) => sum + Math.max(0, rule.minRequired - (assignments[rule.stationId]?.length || 0)), 0);
  return { required, assigned, shortage };
}

function pendingByAttendance(totalAttendance: number, assigned: number) {
  return Math.max(0, totalAttendance - assigned);
}

function getVisibleSelection<T extends { id: string }>(list: T[], selectedId: string) {
  return list.find((item) => item.id === selectedId) || list[0] || null;
}

function CandidateCard({ person, active, onClick }: { person: Person; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={active ? "candidate-card active" : "candidate-card"} onClick={onClick}>
      <strong>{person.name}</strong>
      <span>{person.id}</span>
      <small>{String(getTeamOfPerson(person))}</small>
    </button>
  );
}

export default function App() {
  const [data, setData] = useState<AppBootstrap>(emptyBootstrap);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<PageKey>("home");
  const [flash, setFlash] = useState("");

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
  const [manualAssignments, setManualAssignments] = useState<Record<string, string[]>>({});

  const [rulesTeam, setRulesTeam] = useState<TeamName>("婷芬班");
  const [peopleSearchKeyword, setPeopleSearchKeyword] = useState("");
  const [permissionSearchKeyword, setPermissionSearchKeyword] = useState("");

  const [smartShift, setSmartShift] = useState<TeamName>("婷芬班");
  const [smartDay, setSmartDay] = useState<ShiftMode>("當班");
  const [smartMode, setSmartMode] = useState<SmartScheduleMode>("當班優先");
  const [smartAssignments, setSmartAssignments] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let active = true;
    async function loadBootstrap() {
      try {
        const next = await fetchBootstrapData();
        if (active) setData(next);
      } catch {
        if (active) setFlash("系統資料載入失敗，請確認 GAS bootstrap 與試算表資料。");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadBootstrap();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => setManualAssignments({}), [manualShift, manualDay]);
  useEffect(() => setSmartAssignments({}), [smartShift, smartDay, smartMode]);
  useEffect(() => {
    setReviewKeyword("");
    setReviewEmployeeId("");
  }, [reviewShift]);

  const filteredPeople = useMemo(() => data.people.filter((person) => {
    const matchTeam = personTeamFilter === "全部班別" || getTeamOfPerson(person) === personTeamFilter;
    return matchTeam && searchText([person.id, person.name, String(getTeamOfPerson(person)), person.role, person.nationality], personKeyword);
  }), [data.people, personTeamFilter, personKeyword]);

  const selectedEmployee = useMemo(() => getVisibleSelection(filteredPeople, selectedEmployeeId), [filteredPeople, selectedEmployeeId]);
  const selectedEmployeeQualifications = useMemo(() => data.qualifications.filter((item) => item.employeeId === selectedEmployee?.id), [data.qualifications, selectedEmployee]);

  const stationAttendance = useMemo(() => getAttendanceForTeam(data.people, stationTeamFilter, stationDayFilter), [data.people, stationTeamFilter, stationDayFilter]);
  const stationScopedQualifications = useMemo(() => {
    const availableIds = new Set(stationAttendance.all.map((person) => person.id));
    return data.qualifications.filter((item) => availableIds.has(item.employeeId));
  }, [data.qualifications, stationAttendance]);
  const filteredStations = useMemo(() => data.stations.filter((station) => {
    const matchKeyword = searchText([station.id, station.name, station.description, station.note], stationKeyword);
    const hasVisibleCandidate = stationScopedQualifications.some((item) => item.stationId === station.id);
    return matchKeyword && hasVisibleCandidate;
  }), [data.stations, stationKeyword, stationScopedQualifications]);
  const selectedStation = useMemo(() => getVisibleSelection(filteredStations, selectedStationId), [filteredStations, selectedStationId]);
  const selectedStationQualifications = useMemo(() => stationScopedQualifications.filter((item) => item.stationId === selectedStation?.id), [stationScopedQualifications, selectedStation]);

  const reviewPeople = useMemo(() => data.people.filter((person) => {
    const matchShift = reviewShift === "全部班別" || getTeamOfPerson(person) === reviewShift;
    return matchShift && searchText([person.id, person.name], reviewKeyword);
  }), [data.people, reviewShift, reviewKeyword]);
  const reviewSelectedPerson = useMemo(() => getVisibleSelection(reviewPeople, reviewEmployeeId), [reviewPeople, reviewEmployeeId]);
  const reviewSelectedQualifications = useMemo(() => data.qualifications.filter((item) => item.employeeId === reviewSelectedPerson?.id), [data.qualifications, reviewSelectedPerson]);
  const reviewOverviewRows = useMemo(() => reviewPeople.map((person) => {
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
  }), [data.qualifications, reviewPeople]);

  const gapAttendance = useMemo(() => getAttendanceForTeam(data.people, gapShift, gapDay), [data.people, gapShift, gapDay]);
  const gapRules = useMemo(() => getApplicableRules(gapShift, gapDay, data.stationRules || []), [data.stationRules, gapShift, gapDay]);

  const manualAttendance = useMemo(() => getAttendanceForTeam(data.people, manualShift, manualDay), [data.people, manualShift, manualDay]);
  const manualRules = useMemo(() => getApplicableRules(manualShift, manualDay, data.stationRules || []), [data.stationRules, manualShift, manualDay]);
  const manualSummary = useMemo(() => getAssignmentSummary(manualAssignments, manualRules), [manualAssignments, manualRules]);
  const manualPending = pendingByAttendance(manualAttendance.totalCount, manualSummary.assigned);

  const smartAttendance = useMemo(() => getAttendanceForTeam(data.people, smartShift, smartDay), [data.people, smartShift, smartDay]);
  const smartRules = useMemo(() => getApplicableRules(smartShift, smartDay, data.stationRules || []), [data.stationRules, smartShift, smartDay]);
  const smartSummary = useMemo(() => getAssignmentSummary(smartAssignments, smartRules), [smartAssignments, smartRules]);
  const smartPending = pendingByAttendance(smartAttendance.totalCount, smartSummary.assigned);

  const stationRuleRows = useMemo(() => getApplicableRules(rulesTeam, "當班", data.stationRules || []), [rulesTeam, data.stationRules]);
  const permissionRows = useMemo(() => data.people.filter((person) => {
    if (!canAppearInPermissionAdmin(person) && person.id !== "P0033") return false;
    return searchText([person.id, person.name, person.role, String(getSystemPermission(person) || ""), String(getTeamOfPerson(person))], permissionSearchKeyword);
  }), [data.people, permissionSearchKeyword]);

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

  async function handleLogin() {
    const account = loginForm.account.trim();
    const password = loginForm.password.trim();
    if (!account || !password) {
      setFlash("請輸入登入帳號與密碼。");
      return;
    }
    try {
      const result = await loginWithAccount({ account, password });
      if (!result.ok || !result.user) {
        setFlash(result.message || "登入失敗。");
        return;
      }
      const bootstrapUser = data.people.find((person) => person.id === result.user?.id);
      const mergedUser = bootstrapUser ? { ...bootstrapUser, ...result.user } : result.user;
      setCurrentUser(mergedUser);
      setLoginForm({ account: "", password: "" });
      setPage("home");
      setFlash(`登入成功：${mergedUser.name}`);
    } catch {
      setFlash("登入失敗，請確認 GAS login 已重新部署。");
    }
  }

  function logout() {
    setCurrentUser(null);
    setPage("home");
    setFlash("已登出。");
  }

  async function persistQualification(employee: Person, stationId: string, status: QualificationStatus) {
    const station = data.stations.find((item) => item.id === stationId);
    if (!station) {
      setFlash("找不到指定站點。");
      return false;
    }
    if (!confirmAction(`確認修改 ${employee.name} 的 ${station.name} 為「${status || "空白"}」？`)) {
      setFlash("已取消修改。");
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
    const employee = reviewSelectedPerson;
    const nextStatus = statusOverride ?? reviewStatus;
    if (!employee || !reviewStationId) {
      setFlash("請先選擇人員與站點。");
      return;
    }
    if (await persistQualification(employee, reviewStationId, nextStatus)) setFlash("站點考核已確認並儲存。");
  }

  async function handleDeleteQualification(employeeId: string, stationId: string) {
    const person = data.people.find((item) => item.id === employeeId);
    const station = data.stations.find((item) => item.id === stationId);
    if (!confirmAction(`確認刪除 ${person?.name || employeeId} 的 ${station?.name || stationId} 資格？`)) return;
    await deleteQualification({ employeeId, stationId });
    setData((current) => ({ ...current, qualifications: current.qualifications.filter((item) => !(item.employeeId === employeeId && item.stationId === stationId)) }));
    setFlash("站點考核已刪除。");
  }

  async function handleUpdatePerson(person: Person, patch: Partial<Person>) {
    const next = { ...person, ...patch };
    if (!confirmAction(`確認修改人員 ${person.name}（${person.id}）？`)) return;
    await updatePerson(next);
    setData((current) => ({ ...current, people: current.people.map((item) => (item.id === person.id ? next : item)) }));
    if (currentUser?.id === person.id) setCurrentUser(next);
    setFlash(`人員 ${person.name} 已確認更新。`);
  }

  async function handleUpdatePermission(person: Person, permission: UserRole) {
    if (currentRole !== "最高權限") {
      setFlash("只有最高權限可調整系統權限。");
      return;
    }
    if (person.id === "P0033" && permission !== "最高權限") {
      setFlash("P0033 已鎖定為最高權限，不可降級。");
      return;
    }
    await handleUpdatePerson(person, {
      systemPermission: permission,
      permissionLevel: permission,
      isSuperAdmin: permission === "最高權限" || person.id === "P0033",
    });
  }

  async function handleUpdateRule(rule: StationRule, patch: Partial<StationRule>) {
    const next = { ...rule, ...patch };
    const station = data.stations.find((item) => item.id === rule.stationId);
    if (!confirmAction(`確認修改 ${rule.team} 的 ${station?.name || rule.stationId} 規則？`)) return;
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
    setFlash("站點規則已確認更新。");
  }

  function toggleManualAssignment(stationId: string, employeeId: string) {
    setManualAssignments((current) => {
      const currentIds = current[stationId] || [];
      if (currentIds.includes(employeeId)) return { ...current, [stationId]: currentIds.filter((id) => id !== employeeId) };
      const assignedStationId = findAssignedStation(current, employeeId);
      if (assignedStationId && assignedStationId !== stationId) {
        const assignedStation = data.stations.find((item) => item.id === assignedStationId);
        setFlash(`${data.people.find((item) => item.id === employeeId)?.name || employeeId} 已安排在 ${assignedStation?.name || assignedStationId}，不可重複佔站。`);
        return current;
      }
      return { ...current, [stationId]: [...currentIds, employeeId] };
    });
  }

  async function handleCustomAssign(target: "manual" | "smart", stationId: string) {
    const raw = window.prompt("請輸入工號或姓名");
    if (!raw) return;
    const attendance = target === "manual" ? manualAttendance : smartAttendance;
    const assignments = target === "manual" ? manualAssignments : smartAssignments;
    const person = attendance.all.find((item) => item.id === raw.trim() || item.name === raw.trim());
    const station = data.stations.find((item) => item.id === stationId);
    if (!person || !station) {
      setFlash("找不到可用人員，請確認該人員存在於本次出勤池。");
      return;
    }
    const assignedStationId = findAssignedStation(assignments, person.id);
    if (assignedStationId && assignedStationId !== stationId) {
      const assignedStation = data.stations.find((item) => item.id === assignedStationId);
      setFlash(`${person.name} 已安排在 ${assignedStation?.name || assignedStationId}，不可重複佔站。`);
      return;
    }
    const qualified = data.qualifications.some((item) => item.employeeId === person.id && item.stationId === stationId && item.status === "合格");
    if (!qualified) {
      setFlash(`${person.name} 尚未具備 ${station.name} 合格資格，已取消自訂安排。`);
      return;
    }
    const setter = target === "manual" ? setManualAssignments : setSmartAssignments;
    setter((current) => appendUniqueAssignment(current, stationId, person.id));
    setFlash(`${person.name} 已加入 ${station.name}。`);
  }

  function runSmartPlan() {
    const rows = buildSmartAssignments(smartShift, smartDay, data.stationRules || [], data.people, data.qualifications, smartMode);
    const next: Record<string, string[]> = {};
    rows.forEach((row) => {
      next[row.stationId] = row.assigned.map((person) => person.id);
    });
    setSmartAssignments(next);
    setFlash(`一鍵試排已完成：${smartMode}`);
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

  if (loading) return <div className="app-shell loading">資料載入中...</div>;

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand-card"><div className="brand-kicker">通用型檢測系統</div><h1>站點資格管理</h1><p>提供幹部查詢站點資格、維護考核、分析缺口與執行試排。</p></div>
          <div className="control-card">
            <label>登入系統</label>
            {currentUser ? <div className="logged-user"><strong>{currentUser.name}</strong><span>{currentUser.id}｜權限 {currentRole || "-"}</span><button className="ghost" type="button" onClick={logout}>登出</button></div> : <><input placeholder="登入帳號" value={loginForm.account} onChange={(e) => setLoginForm((c) => ({ ...c, account: e.target.value }))} /><input type="password" placeholder="登入密碼" value={loginForm.password} onChange={(e) => setLoginForm((c) => ({ ...c, password: e.target.value }))} /><button className="primary" type="button" onClick={handleLogin}>登入</button></>}
          </div>
          <nav className="nav-list">{allowedNav.map((item) => <button key={item.key} className={page === item.key ? "nav-item active" : "nav-item"} onClick={() => setPage(item.key)}>{item.label}</button>)}</nav>
        </aside>
        <main className="content">
          {flash ? <div className="flash"><span>{flash}</span><button type="button" className="flash-close" onClick={() => setFlash("")}>×</button></div> : null}
          {page === "home" ? <Layout title="首頁" subtitle="系統說明與功能總覽。未登入不顯示其他功能。"><div className="grid three compact-home-stats"><StatCard title="人員總數" value={String(data.people.length)} note="人員主檔" /><StatCard title="站點總數" value={String(data.stations.length)} note="站點主檔" /><StatCard title="資格筆數" value={String(data.qualifications.length)} note="站點資格" /></div><div className="panel intro-panel"><h3>系統說明</h3><p>這是通用型站點資格管理系統，提供查詢、考核、規則、缺口、試排與智能試排。</p></div></Layout> : null}
          {!currentRole && page !== "home" ? <Layout title="尚未登入" subtitle="請先登入後開啟對應功能。"><Empty text="請先登入。" /></Layout> : null}

          {currentRole && page === "person-query" ? <Layout title="查詢人員資格" subtitle="依班別與關鍵字查詢人員資格。"><div className="grid two"><div className="panel"><div className="toolbar"><select value={personTeamFilter} onChange={(e) => setPersonTeamFilter(e.target.value)}><option value="全部班別">全部班別</option>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><input placeholder="輸入工號、姓名、角色、國籍" value={personKeyword} onChange={(e) => setPersonKeyword(e.target.value)} /></div><div className="list-scroll">{filteredPeople.map((person) => <button key={person.id} className={selectedEmployee?.id === person.id ? "list-row active" : "list-row"} onClick={() => setSelectedEmployeeId(person.id)}><strong>{person.name}</strong><span>{person.id}｜{String(getTeamOfPerson(person))}｜{person.role}</span></button>)}</div></div><div className="panel">{selectedEmployee ? <PersonDetailView person={selectedEmployee} qualifications={selectedEmployeeQualifications} /> : <Empty text="此班別目前沒有可顯示人員。" />}</div></div></Layout> : null}

          {currentRole && page === "station-query" ? <Layout title="查詢站點人選" subtitle="切換班別與日別查詢站點合格人選。"><div className="grid two"><div className="panel"><div className="toolbar"><select value={stationTeamFilter} onChange={(e) => setStationTeamFilter(e.target.value as TeamName)}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={stationDayFilter} onChange={(e) => setStationDayFilter(e.target.value as ShiftMode)}>{dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select><input placeholder="搜尋站點" value={stationKeyword} onChange={(e) => setStationKeyword(e.target.value)} /></div><div className="list-scroll">{filteredStations.map((station) => <button key={station.id} className={selectedStation?.id === station.id ? "list-row active" : "list-row"} onClick={() => setSelectedStationId(station.id)}><strong>{station.name}</strong><span>{station.id}</span></button>)}</div></div><div className="panel">{selectedStation ? <StationDetailView station={selectedStation} team={stationTeamFilter} day={stationDayFilter} attendance={stationAttendance} qualifications={selectedStationQualifications} people={data.people} /> : <Empty text="找不到符合條件的站點。" />}</div></div></Layout> : null}

          {currentRole && page === "qualification-review" && hasAccess("領班") ? <Layout title="站點考核" subtitle="維護人員站點資格。"><div className="grid two"><div className="panel"><div className="toolbar"><select value={reviewShift} onChange={(e) => setReviewShift(e.target.value as (typeof REVIEW_TEAM_OPTIONS)[number])}>{REVIEW_TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><input placeholder="輸入工號或姓名" value={reviewKeyword} onChange={(e) => setReviewKeyword(e.target.value)} /></div><div className="list-scroll">{reviewPeople.map((person) => <button key={person.id} className={reviewSelectedPerson?.id === person.id ? "list-row active" : "list-row"} onClick={() => setReviewEmployeeId(person.id)}><strong>{person.name}</strong><span>{person.id}｜{String(getTeamOfPerson(person))}｜{person.role}</span></button>)}</div></div><div className="panel">{reviewSelectedPerson ? <ReviewDetailView person={reviewSelectedPerson} permission={String(getSystemPermission(reviewSelectedPerson) || "-")} qualifications={reviewSelectedQualifications} stationId={reviewStationId} reviewStatus={reviewStatus} setStationId={setReviewStationId} setReviewStatus={setReviewStatus} stations={data.stations} onSave={() => handleSaveQualification()} onDelete={handleDeleteQualification} /> : <Empty text="請先選取人員。" />}</div></div><div className="panel"><h3>班別人員總攬</h3><table className="table"><thead><tr><th>工號</th><th>姓名</th><th>職務</th><th>系統權限</th><th>國籍</th><th>合格</th><th>訓練中</th><th>不可排</th></tr></thead><tbody>{reviewOverviewRows.map((row) => <tr key={row.id}><td>{row.id}</td><td>{row.name}</td><td>{row.role}</td><td>{String(getSystemPermission(data.people.find((p) => p.id === row.id) || null) || "-")}</td><td>{row.nationality}</td><td>{row.qualified}</td><td>{row.training}</td><td>{row.blocked}</td></tr>)}</tbody></table></div></Layout> : null}

          {currentRole && page === "gap-analysis" && hasAccess("組長") ? <Layout title="站點缺口分析" subtitle="切換班別與日別時即時刷新。"><div className="panel"><AttendanceSummary attendance={gapAttendance} day={gapDay} /><div className="toolbar"><select value={gapShift} onChange={(e) => setGapShift(e.target.value as TeamName)}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={gapDay} onChange={(e) => setGapDay(e.target.value as ShiftMode)}>{dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>{gapRules.length ? <table className="table"><thead><tr><th>站點</th><th>最低需求</th><th>本班合格</th><th>支援合格</th><th>總合格</th><th>訓練中</th><th>不可排</th><th>缺口</th><th>支援可補</th></tr></thead><tbody>{gapRules.map((rule) => { const station = data.stations.find((item) => item.id === rule.stationId); const coverage = getStationCoverage(rule.stationId, rule.minRequired, gapAttendance.all, gapAttendance.support, data.qualifications); const supportNames = coverage.supportQualifiedIds.map((id) => `${data.people.find((p) => p.id === id)?.name || id}（${gapAttendance.supportTeam}）`); return <tr key={`${rule.team}-${rule.stationId}`}><td>{station?.name || rule.stationId}</td><td>{rule.minRequired}</td><td>{coverage.ownQualified}</td><td>{coverage.supportQualified}</td><td>{coverage.qualified}</td><td>{coverage.training}</td><td>{coverage.blocked}</td><td>{coverage.shortage}</td><td>{supportNames.join("、") || "-"}</td></tr>; })}</tbody></table> : <Empty text="找不到此班別的正式站點規則，無法進行缺口分析。" />}</div></Layout> : null}

          {currentRole && page === "manual-schedule" && hasAccess("組長") ? <Layout title="站點試排" subtitle="人員候選以橫向小方塊顯示，僅顯示姓名、工號、班別。"><div className="panel"><div className="toolbar"><select value={manualShift} onChange={(e) => setManualShift(e.target.value as TeamName)}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={manualDay} onChange={(e) => setManualDay(e.target.value as ShiftMode)}>{dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><AttendanceSummary attendance={manualAttendance} day={manualDay} /></div>{manualRules.length ? <><div className="panel sticky-summary-panel"><div className="summary-strip"><SummaryCard label="出勤總人數" value={String(manualAttendance.totalCount)} /><SummaryCard label="已排總人數" value={String(manualSummary.assigned)} /><SummaryCard label="尚未安排人數" value={String(manualPending)} /><SummaryCard label="支援人數" value={String(manualAttendance.support.length)} /><SummaryCard label="缺口總數" value={String(manualSummary.shortage)} /></div></div><div className="grid two">{manualRules.map((rule) => { const station = data.stations.find((item) => item.id === rule.stationId); const selectedIds = manualAssignments[rule.stationId] || []; const candidates = getQualifiedPeopleForStation(rule.stationId, manualAttendance.all, data.qualifications).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true })); return <div className="panel" key={rule.stationId}><div className="panel-header"><h3>{station?.name || rule.stationId}</h3><span>需求 {rule.minRequired}</span></div><div className="toolbar"><button type="button" className="ghost" onClick={() => handleCustomAssign("manual", rule.stationId)}>自訂人選</button></div><div className="chips">{selectedIds.length ? selectedIds.map((id) => { const person = data.people.find((item) => item.id === id); return <span className="chip" key={id}>{person?.name || id}</span>; }) : <span className="muted">尚未安排</span>}</div><div className="candidate-card-grid">{candidates.map((person) => <CandidateCard key={person.id} person={person} active={selectedIds.includes(person.id)} onClick={() => toggleManualAssignment(rule.stationId, person.id)} />)}</div></div>; })}</div><ScheduleResult title="試排班表" rules={manualRules} assignments={manualAssignments} people={data.people} stations={data.stations} /></> : <Empty text="找不到此班別的正式站點規則，無法進行站點試排。" />}</Layout> : null}

          {currentRole && page === "station-rules" && hasAccess("主任") ? <Layout title="站點規則設定" subtitle="依班別設定規則。"><div className="panel"><div className="toolbar"><select value={rulesTeam} onChange={(e) => setRulesTeam(e.target.value as TeamName)}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>{stationRuleRows.length ? <table className="table"><thead><tr><th>站點</th><th>最低需求</th><th>輪休需求(單批)</th><th>優先序</th><th>必站</th><th>訓練中</th><th>備援目標</th><th>支援補位</th></tr></thead><tbody>{stationRuleRows.map((rule) => { const station = data.stations.find((item) => item.id === rule.stationId); const disabled = !canEditRulesForTeam(rulesTeam); return <tr key={`${rule.team}-${rule.stationId}`}><td>{station?.name || rule.stationId}</td><td><ConfirmNumberInput value={rule.minRequired} disabled={disabled} onCommit={(value) => handleUpdateRule(rule, { minRequired: value })} /></td><td><ConfirmNumberInput value={rule.reliefMinPerBatch ?? 0} disabled={disabled} onCommit={(value) => handleUpdateRule(rule, { reliefMinPerBatch: value })} /></td><td><ConfirmNumberInput value={rule.priority ?? 0} disabled={disabled} onCommit={(value) => handleUpdateRule(rule, { priority: value })} /></td><td><ConfirmSelect value={rule.isMandatory ? "Y" : "N"} disabled={disabled} options={[{ label: "Y", value: "Y" }, { label: "N", value: "N" }]} onCommit={(value) => handleUpdateRule(rule, { isMandatory: value === "Y" })} /></td><td><ConfirmSelect value={rule.trainingCanFill ? "Y" : "N"} disabled={disabled} options={[{ label: "Y", value: "Y" }, { label: "N", value: "N" }]} onCommit={(value) => handleUpdateRule(rule, { trainingCanFill: value === "Y" })} /></td><td><ConfirmNumberInput value={rule.backupTarget ?? 0} disabled={disabled} onCommit={(value) => handleUpdateRule(rule, { backupTarget: value })} /></td><td><ConfirmSelect value={rule.canShare ? "Y" : "N"} disabled={disabled} options={[{ label: "Y", value: "Y" }, { label: "N", value: "N" }]} onCommit={(value) => handleUpdateRule(rule, { canShare: value === "Y" })} /></td></tr>; })}</tbody></table> : <Empty text="找不到此班別的正式站點規則，請先至資料端補齊。" />}</div></Layout> : null}

          {currentRole && page === "people-management" && hasAccess("主任") ? <Layout title="人員名單管理" subtitle="維護人員資料。"><div className="panel"><div className="toolbar"><input placeholder="快速搜尋工號、姓名、班別、職務、權限" value={peopleSearchKeyword} onChange={(e) => setPeopleSearchKeyword(e.target.value)} /></div><table className="table"><thead><tr><th>工號</th><th>姓名</th><th>班別</th><th>職務</th><th>系統權限</th><th>國籍</th><th>在職</th></tr></thead><tbody>{data.people.filter((person) => searchText([person.id, person.name, String(getTeamOfPerson(person)), person.role, String(getSystemPermission(person) || "")], peopleSearchKeyword)).map((person) => <tr key={person.id}><td>{person.id}</td><td><ConfirmTextInput value={person.name} onCommit={(value) => handleUpdatePerson(person, { name: value })} /></td><td><ConfirmSelect value={String(getTeamOfPerson(person))} options={TEAM_OPTIONS.map((item) => ({ label: item, value: item }))} onCommit={(value) => handleUpdatePerson(person, { shift: value })} /></td><td><ConfirmTextInput value={person.role} onCommit={(value) => handleUpdatePerson(person, { role: value })} /></td><td>{String(getSystemPermission(person) || "技術員")}{person.id === "P0033" ? "（鎖定）" : ""}</td><td><ConfirmTextInput value={person.nationality} onCommit={(value) => handleUpdatePerson(person, { nationality: value })} /></td><td><ConfirmTextInput value={person.employmentStatus} onCommit={(value) => handleUpdatePerson(person, { employmentStatus: value })} /></td></tr>)}</tbody></table></div></Layout> : null}

          {currentRole && page === "permission-admin" && hasAccess("最高權限") ? <Layout title="權限管理" subtitle="只有最高權限可見。"><div className="panel"><div className="toolbar"><input placeholder="搜尋工號、姓名、班別、職務、權限" value={permissionSearchKeyword} onChange={(e) => setPermissionSearchKeyword(e.target.value)} /></div><table className="table"><thead><tr><th>工號</th><th>姓名</th><th>班別</th><th>職務</th><th>目前權限</th><th>調整權限</th><th>狀態</th></tr></thead><tbody>{permissionRows.map((person) => <tr key={person.id}><td>{person.id}</td><td>{person.name}</td><td>{String(getTeamOfPerson(person))}</td><td>{person.role}</td><td>{String(getSystemPermission(person) || "技術員")}</td><td>{person.id === "P0033" ? <span>最高權限（鎖定）</span> : <ConfirmSelect value={String(getSystemPermission(person) || "技術員")} options={permissionOptions.map((item) => ({ label: item, value: item }))} onCommit={(value) => handleUpdatePermission(person, value as UserRole)} />}</td><td>{person.employmentStatus || "-"}</td></tr>)}</tbody></table></div></Layout> : null}

          {currentRole && page === "smart-schedule" && hasAccess("主任") ? <Layout title="智能試排" subtitle="一鍵依規則試排。"><div className="panel"><div className="toolbar"><select value={smartShift} onChange={(e) => setSmartShift(e.target.value as TeamName)}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={smartDay} onChange={(e) => setSmartDay(e.target.value as ShiftMode)}>{dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={smartMode} onChange={(e) => setSmartMode(e.target.value as SmartScheduleMode)}>{SMART_MODE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><button className="primary" type="button" onClick={runSmartPlan}>一鍵試排</button></div><AttendanceSummary attendance={smartAttendance} day={smartDay} /></div>{smartRules.length ? <><div className="panel sticky-summary-panel"><div className="summary-strip"><SummaryCard label="出勤總人數" value={String(smartAttendance.totalCount)} /><SummaryCard label="已排總人數" value={String(smartSummary.assigned)} /><SummaryCard label="尚未安排人數" value={String(smartPending)} /><SummaryCard label="支援人數" value={String(smartAttendance.support.length)} /><SummaryCard label="缺口總數" value={String(smartSummary.shortage)} /></div></div><div className="grid two">{smartRules.map((rule) => { const station = data.stations.find((item) => item.id === rule.stationId); const selectedIds = smartAssignments[rule.stationId] || []; return <div className="panel" key={rule.stationId}><div className="panel-header"><h3>{station?.name || rule.stationId}</h3><span>需求 {rule.minRequired}</span></div><div className="toolbar"><button type="button" className="ghost" onClick={() => handleCustomAssign("smart", rule.stationId)}>自訂人選</button></div><div className="chips">{selectedIds.length ? selectedIds.map((id) => { const person = data.people.find((item) => item.id === id); return <span className="chip" key={id}>{person?.name || id}</span>; }) : <span className="muted">尚未安排</span>}</div></div>; })}</div><ScheduleResult title="智能試排班表" rules={smartRules} assignments={smartAssignments} people={data.people} stations={data.stations} /></> : <Empty text="找不到此班別的正式站點規則，無法執行智能試排。" />}</Layout> : null}
        </main>
      </div>
      {page === "manual-schedule" && manualSummary.assigned > 0 ? <FloatingScheduleStatus assigned={manualSummary.assigned} pending={manualPending} /> : null}
      {page === "smart-schedule" && smartSummary.assigned > 0 ? <FloatingScheduleStatus assigned={smartSummary.assigned} pending={smartPending} /> : null}
    </>
  );
}

function AttendanceSummary({ attendance, day }: { attendance: ReturnType<typeof getAttendanceForTeam>; day: ShiftMode }) {
  return <div className="summary-strip"><SummaryCard label="本籍出勤" value={String(attendance.localCount)} /><SummaryCard label="菲籍出勤" value={String(attendance.filipinoCount)} /><SummaryCard label="越籍出勤" value={String(attendance.vietnamCount)} /><SummaryCard label="總出勤" value={String(attendance.totalCount)} /><SummaryCard label={day === "當班" ? "本班人力" : "本班出勤"} value={String(attendance.own.length)} /><SummaryCard label="支援人力" value={String(attendance.support.length)} /><SummaryCard label="支援對班" value={day === "當班" ? "-" : attendance.supportTeam} /></div>;
}

function ScheduleResult({ title, rules, assignments, people, stations }: { title: string; rules: StationRule[]; assignments: Record<string, string[]>; people: Person[]; stations: Array<{ id: string; name: string }>; }) {
  return <div className="panel"><h3>{title}</h3><table className="table"><thead><tr><th>站點</th><th>需求</th><th>已排</th><th>缺口</th><th>名單</th></tr></thead><tbody>{rules.map((rule) => { const station = stations.find((item) => item.id === rule.stationId); const selectedIds = assignments[rule.stationId] || []; const names = selectedIds.map((id) => people.find((person) => person.id === id)?.name || id); return <tr key={rule.stationId}><td>{station?.name || rule.stationId}</td><td>{rule.minRequired}</td><td>{selectedIds.length}</td><td>{Math.max(0, rule.minRequired - selectedIds.length)}</td><td>{names.join("、") || "-"}</td></tr>; })}</tbody></table></div>;
}

function FloatingScheduleStatus({ assigned, pending }: { assigned: number; pending: number }) {
  return <div className="schedule-floating-status"><div>已排:{assigned}</div><div>待排:{pending}</div></div>;
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

function SummaryCard({ label, value }: { label: string; value: string }) {
  return <div className="summary-card"><span>{label}</span><strong>{value}</strong></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
