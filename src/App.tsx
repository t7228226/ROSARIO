import { useEffect, useMemo, useState } from "react";
import Layout from "./components/Layout";
import {
  deleteQualification,
  fetchBootstrapData,
  updatePerson,
  updateStationRule,
  upsertQualification,
} from "./lib/api";
import {
  buildSmartAssignments,
  DAY_OPTIONS,
  getApplicableRules,
  getAttendanceForTeam,
  getDutyCode,
  getPersonDutyDisplay,
  getQualifiedPeopleForStation,
  getQualificationCountMap,
  getStationCoverage,
  getTeamOfPerson,
  qualificationBadge,
  REVIEW_TEAM_OPTIONS,
  SMART_MODE_OPTIONS,
  searchText,
  TEAM_OPTIONS,
} from "./lib/selectors";
import type {
  AppBootstrap,
  Person,
  Qualification,
  QualificationStatus,
  ShiftMode,
  SmartScheduleMode,
  Station,
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
  | "gap-analysis"
  | "manual-schedule"
  | "smart-schedule";

const emptyBootstrap: AppBootstrap = {
  people: [],
  stations: [],
  qualifications: [],
  stationRules: [],
};

const qualificationOptions: QualificationStatus[] = ["合格", "訓練中", "不可排", ""];
const dayOptions: Array<Exclude<ShiftMode, "全部在職">> = DAY_OPTIONS;

const roleRank: Record<UserRole, number> = {
  技術員: 1,
  領班: 2,
  組長: 3,
  主任: 4,
  總權限管理員: 5,
};

function normalizeRole(raw?: string): UserRole {
  if (raw === "總權限管理員") return "總權限管理員";
  if (raw === "主任") return "主任";
  if (raw === "組長") return "組長";
  if (raw === "領班") return "領班";
  return "技術員";
}

function getEmployeeLabel(person?: Person) {
  if (!person) return "";
  return `${person.id}｜${person.name}`;
}

function getStationLabel(station?: Station) {
  if (!station) return "";
  return `${station.id}｜${station.name}`;
}

function buildCandidateMap(people: Person[], qualifications: Qualification[], allowTraining = false) {
  const allowedIds = new Set(people.map((person) => person.id));
  const allowedStatus = allowTraining ? new Set(["合格", "訓練中"]) : new Set(["合格"]);
  const map = new Map<string, Person[]>();

  for (const q of qualifications) {
    if (!allowedStatus.has(q.status)) continue;
    if (!allowedIds.has(q.employeeId)) continue;
    const person = people.find((item) => item.id === q.employeeId);
    if (!person) continue;
    if (!map.has(q.stationId)) map.set(q.stationId, []);
    const bucket = map.get(q.stationId)!;
    if (!bucket.some((item) => item.id === person.id)) {
      bucket.push(person);
    }
  }

  for (const [, list] of map) {
    list.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  }

  return map;
}

function countAssigned(idsMap: Record<string, string[]>) {
  return Object.values(idsMap).reduce((sum, ids) => sum + ids.length, 0);
}

function findDuplicates(idsMap: Record<string, string[]>) {
  const count = new Map<string, number>();
  Object.values(idsMap).flat().forEach((id) => count.set(id, (count.get(id) || 0) + 1));
  return [...count.entries()].filter(([, n]) => n > 1).map(([id]) => id);
}

export default function App() {
  const [data, setData] = useState<AppBootstrap>(emptyBootstrap);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<PageKey>("home");

  const [loginForm, setLoginForm] = useState({ account: "", password: "" });
  const [currentUser, setCurrentUser] = useState<Person | null>(null);
  const currentRole = currentUser ? normalizeRole(currentUser.role) : null;

  const [flash, setFlash] = useState("");

  const [personKeyword, setPersonKeyword] = useState("");
  const [personTeamFilter, setPersonTeamFilter] = useState<string>("全部班別");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");

  const [stationKeyword, setStationKeyword] = useState("");
  const [stationTeamFilter, setStationTeamFilter] = useState<TeamName>("翊展班");
  const [stationDayFilter, setStationDayFilter] = useState<Exclude<ShiftMode, "全部在職">>("當班");
  const [selectedStationId, setSelectedStationId] = useState("");

  const [reviewShift, setReviewShift] = useState<(typeof REVIEW_TEAM_OPTIONS)[number]>("全部班別");
  const [reviewKeyword, setReviewKeyword] = useState("");
  const [reviewEmployeeId, setReviewEmployeeId] = useState("");
  const [reviewStationId, setReviewStationId] = useState("");
  const [reviewStatus, setReviewStatus] = useState<QualificationStatus>("合格");

  const [gapShift, setGapShift] = useState<TeamName>("翊展班");
  const [gapDay, setGapDay] = useState<Exclude<ShiftMode, "全部在職">>("當班");

  const [manualShift, setManualShift] = useState<TeamName>("翊展班");
  const [manualDay, setManualDay] = useState<Exclude<ShiftMode, "全部在職">>("當班");
  const [manualAssignments, setManualAssignments] = useState<Record<string, string[]>>({});

  const [smartShift, setSmartShift] = useState<TeamName>("翊展班");
  const [smartDay, setSmartDay] = useState<Exclude<ShiftMode, "全部在職">>("當班");
  const [smartMode, setSmartMode] = useState<SmartScheduleMode>("當班優先");
  const [smartAssignments, setSmartAssignments] = useState<Record<string, string[]>>({});

  const [rulesTeam, setRulesTeam] = useState<TeamName>("翊展班");
  const [rulesDay, setRulesDay] = useState<Exclude<ShiftMode, "全部在職">>("當班");

  const [peopleSearchKeyword, setPeopleSearchKeyword] = useState("");

  const [newPersonForm, setNewPersonForm] = useState<Person>({
    id: "",
    name: "",
    shift: TEAM_OPTIONS[0],
    role: "技術員",
    nationality: "本國",
    day1: "",
    day2: "",
    employmentStatus: "在職",
    note: "",
    aDay1: "",
    aDay2: "",
    bDay1: "",
    bDay2: "",
  });

  useEffect(() => {
    fetchBootstrapData()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setReviewKeyword("");
    setReviewEmployeeId("");
  }, [reviewShift]);

  useEffect(() => {
    setManualAssignments({});
  }, [manualShift, manualDay]);

  useEffect(() => {
    setSmartAssignments({});
  }, [smartShift, smartDay, smartMode]);

  const filteredPeople = useMemo(() => {
    return data.people.filter((person) => {
      const matchTeam = personTeamFilter === "全部班別" || getTeamOfPerson(person) === personTeamFilter;
      const matchKeyword = searchText([person.id, person.name, getTeamOfPerson(person), person.role, person.nationality], personKeyword);
      return matchTeam && matchKeyword;
    });
  }, [data.people, personKeyword, personTeamFilter]);

  const selectedEmployee = useMemo(() => {
    return data.people.find((person) => person.id === selectedEmployeeId) || filteredPeople[0] || null;
  }, [data.people, filteredPeople, selectedEmployeeId]);

  const stationAttendance = useMemo(
    () => getAttendanceForTeam(data.people, stationTeamFilter, stationDayFilter),
    [data.people, stationTeamFilter, stationDayFilter]
  );

  const filteredStations = useMemo(() => {
    return data.stations.filter((station) => {
      const matchKeyword = searchText([station.id, station.name, station.description, station.note], stationKeyword);
      const qualifiedPool = getQualifiedPeopleForStation(station.id, stationAttendance.all, data.qualifications, true);
      return matchKeyword && qualifiedPool.length > 0;
    });
  }, [data.stations, stationKeyword, stationAttendance, data.qualifications]);

  const selectedStation = useMemo(() => {
    return data.stations.find((station) => station.id === selectedStationId) || filteredStations[0] || null;
  }, [data.stations, filteredStations, selectedStationId]);

  const reviewPeople = useMemo(() => {
    return data.people.filter((person) => {
      const matchShift = reviewShift === "全部班別" || getTeamOfPerson(person) === reviewShift;
      const matchKeyword = searchText([person.id, person.name], reviewKeyword);
      return matchShift && matchKeyword;
    });
  }, [data.people, reviewKeyword, reviewShift]);

  const reviewSelectedPerson = useMemo(() => {
    return data.people.find((person) => person.id === reviewEmployeeId) || reviewPeople[0] || null;
  }, [data.people, reviewEmployeeId, reviewPeople]);

  useEffect(() => {
    if (reviewSelectedPerson && !reviewEmployeeId) {
      setReviewEmployeeId(reviewSelectedPerson.id);
    }
  }, [reviewSelectedPerson, reviewEmployeeId]);

  const employeeQualifications = useMemo(() => {
    if (!selectedEmployee) return [];
    return data.qualifications.filter((q) => q.employeeId === selectedEmployee.id);
  }, [data.qualifications, selectedEmployee]);

  const stationQualifications = useMemo(() => {
    if (!selectedStation) return [];
    return data.qualifications.filter((q) => q.stationId === selectedStation.id);
  }, [data.qualifications, selectedStation]);

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
  const gapRules = useMemo(
    () => getApplicableRules(gapShift, gapDay, data.stationRules || [], data.stations),
    [data.stationRules, data.stations, gapShift, gapDay]
  );

  const manualAttendance = useMemo(
    () => getAttendanceForTeam(data.people, manualShift, manualDay),
    [data.people, manualShift, manualDay]
  );
  const manualRules = useMemo(
    () => getApplicableRules(manualShift, manualDay, data.stationRules || [], data.stations),
    [data.stationRules, data.stations, manualShift, manualDay]
  );
  const manualCandidateMap = useMemo(
    () => buildCandidateMap(manualAttendance.all, data.qualifications, true),
    [manualAttendance, data.qualifications]
  );

  const smartAttendance = useMemo(
    () => getAttendanceForTeam(data.people, smartShift, smartDay),
    [data.people, smartShift, smartDay]
  );
  const smartRules = useMemo(
    () => getApplicableRules(smartShift, smartDay, data.stationRules || [], data.stations),
    [data.stationRules, data.stations, smartShift, smartDay]
  );
  const smartCandidateMap = useMemo(
    () => buildCandidateMap(smartAttendance.all, data.qualifications, false),
    [smartAttendance, data.qualifications]
  );

  const stationRuleRows = useMemo(
    () => getApplicableRules(rulesTeam, rulesDay, data.stationRules || [], data.stations),
    [rulesTeam, rulesDay, data.stationRules, data.stations]
  );

  const manualDuplicateIds = useMemo(() => findDuplicates(manualAssignments), [manualAssignments]);
  const smartDuplicateIds = useMemo(() => findDuplicates(smartAssignments), [smartAssignments]);

  function hasAccess(minRole?: UserRole) {
    if (!minRole) return true;
    if (!currentRole) return false;
    return roleRank[currentRole] >= roleRank[minRole];
  }

  function canEditRulesForTeam(team: TeamName) {
    if (!currentUser) return false;
    const role = normalizeRole(currentUser.role);
    if (role === "總權限管理員") return true;
    return role === "主任" && getTeamOfPerson(currentUser) === team;
  }

  function setFlashMessage(text: string) {
    setFlash(text);
  }

  function logout() {
    setCurrentUser(null);
    setPage("home");
    setLoginForm({ account: "", password: "" });
    setFlashMessage("已登出。");
  }

  function confirmAction(message: string) {
    return window.confirm(message);
  }

  function handleLogin() {
    const normalized = loginForm.account.trim().toLowerCase();
    if (!normalized) {
      setFlashMessage("請輸入帳號。");
      return;
    }

    const matched = data.people.find(
      (person) => person.id.toLowerCase() === normalized || person.name.toLowerCase() === normalized
    );

    if (!matched) {
      setFlashMessage("查無此帳號。請先輸入工號或姓名。");
      return;
    }

    setCurrentUser(matched);
    setPage("home");
    setFlashMessage(`登入成功：${matched.name}（${normalizeRole(matched.role)}）`);
  }

  async function handleSaveQualification(statusOverride?: QualificationStatus) {
    const employee = data.people.find((person) => person.id === reviewEmployeeId);
    const station = data.stations.find((item) => item.id === reviewStationId);
    const targetStatus = statusOverride ?? reviewStatus;

    if (!employee) {
      setFlashMessage("請先選擇人員。");
      return;
    }
    if (!station) {
      setFlashMessage("請先選擇站點。");
      return;
    }

    const payload: Qualification = {
      employeeId: employee.id,
      employeeName: employee.name,
      stationId: station.id,
      status: targetStatus,
    };

    if (!confirmAction(`確認修改 ${employee.name} 的 ${station.name} 為「${targetStatus || "空白"}」？`)) {
      setFlashMessage("已取消修改。");
      return;
    }

    await upsertQualification(payload);
    setData((current) => {
      const exists = current.qualifications.some(
        (item) => item.employeeId === payload.employeeId && item.stationId === payload.stationId
      );
      return {
        ...current,
        qualifications: exists
          ? current.qualifications.map((item) =>
              item.employeeId === payload.employeeId && item.stationId === payload.stationId ? payload : item
            )
          : [...current.qualifications, payload],
      };
    });
    setFlashMessage("站點考核已確認並儲存。切換班別時，工號/姓名輸入框會自動清空。" );
  }

  async function handleDeleteQualification(employeeId: string, stationId: string) {
    const person = data.people.find((item) => item.id === employeeId);
    const station = data.stations.find((item) => item.id === stationId);
    if (!confirmAction(`確認刪除 ${person?.name || employeeId} 的 ${station?.name || stationId} 資格？`)) {
      setFlashMessage("已取消刪除。");
      return;
    }
    await deleteQualification({ employeeId, stationId });
    setData((current) => ({
      ...current,
      qualifications: current.qualifications.filter(
        (item) => !(item.employeeId === employeeId && item.stationId === stationId)
      ),
    }));
    setFlashMessage("站點考核已刪除。");
  }

  async function handleUpdateStation(station: Station, patch: Partial<Station>) {
    const next = { ...station, ...patch };
    if (!confirmAction(`確認修改站點 ${station.name} 的規則？`)) {
      setFlashMessage("已取消修改。");
      return;
    }
    await updateStationRule(next);
    setData((current) => ({
      ...current,
      stations: current.stations.map((item) => (item.id === station.id ? next : item)),
    }));
    setFlashMessage(`站點 ${station.name} 已確認更新。`);
  }

  async function handleUpdatePerson(person: Person, patch: Partial<Person>) {
    const next = { ...person, ...patch };
    if (!confirmAction(`確認修改人員 ${person.name}（${person.id}）資料？`)) {
      setFlashMessage("已取消修改。");
      return;
    }
    await updatePerson(next);
    setData((current) => ({
      ...current,
      people: current.people.map((item) => (item.id === person.id ? next : item)),
    }));
    setFlashMessage(`人員 ${person.name} 已確認更新。`);
  }

  async function handleCreatePerson() {
    if (!newPersonForm.id.trim() || !newPersonForm.name.trim()) {
      setFlashMessage("新增人員至少要輸入工號與姓名。");
      return;
    }

    if (!confirmAction(`確認新增/覆寫人員 ${newPersonForm.name}（${newPersonForm.id}）？`)) {
      setFlashMessage("已取消新增。");
      return;
    }

    await updatePerson(newPersonForm);
    setData((current) => {
      const exists = current.people.some((person) => person.id === newPersonForm.id);
      return {
        ...current,
        people: exists
          ? current.people.map((person) => (person.id === newPersonForm.id ? newPersonForm : person))
          : [...current.people, newPersonForm],
      };
    });

    setNewPersonForm({
      id: "",
      name: "",
      shift: TEAM_OPTIONS[0],
      role: "技術員",
      nationality: "本國",
      day1: "",
      day2: "",
      employmentStatus: "在職",
      note: "",
      aDay1: "",
      aDay2: "",
      bDay1: "",
      bDay2: "",
    });
    setFlashMessage("人員已確認新增。" );
  }

  function toggleManualAssignment(stationId: string, employeeId: string) {
    setManualAssignments((current) => {
      const existing = current[stationId] || [];
      const next = existing.includes(employeeId)
        ? existing.filter((item) => item !== employeeId)
        : [...existing, employeeId];
      return { ...current, [stationId]: next };
    });
  }

  async function assignCustomPersonToStation(stationId: string, raw: string, target: "manual" | "smart") {
    const value = raw.trim();
    if (!value) return;
    const station = data.stations.find((item) => item.id === stationId);
    const attendance = target === "manual" ? manualAttendance : smartAttendance;
    const person = attendance.all.find(
      (item) => item.id.toLowerCase() === value.toLowerCase() || item.name.toLowerCase() === value.toLowerCase()
    );
    if (!person || !station) {
      setFlashMessage("找不到該人員，請確認工號或姓名是否存在於本次出勤池。" );
      return;
    }

    const isQualified = data.qualifications.some(
      (item) => item.employeeId === person.id && item.stationId === station.id && item.status === "合格"
    );

    if (!isQualified) {
      const training = confirmAction(`${person.name} 目前不符合 ${station.name} 資格。是否標記為訓練人力？`);
      if (training) {
        setReviewEmployeeId(person.id);
        setReviewStationId(station.id);
        await handleSaveQualification("訓練中");
      } else {
        const finished = confirmAction(`是否直接標記 ${person.name} 為 ${station.name} 訓練完成？`);
        if (!finished) {
          setFlashMessage("已取消自訂安插。" );
          return;
        }
        setReviewEmployeeId(person.id);
        setReviewStationId(station.id);
        await handleSaveQualification("合格");
      }
    }

    const setter = target === "manual" ? setManualAssignments : setSmartAssignments;
    setter((current) => {
      const existing = current[stationId] || [];
      if (existing.includes(person.id)) return current;
      return { ...current, [stationId]: [...existing, person.id] };
    });
    setFlashMessage(`${person.name} 已加入 ${station.name}。`);
  }

  function runSmartPlan() {
    const rows = buildSmartAssignments(
      smartShift,
      smartDay,
      data.stations,
      data.stationRules || [],
      data.people,
      data.qualifications,
      smartMode
    );
    const next: Record<string, string[]> = {};
    rows.forEach((row) => {
      next[row.stationId] = row.assigned.map((person) => person.id);
    });
    setSmartAssignments(next);
    const message =
      smartMode === "當班優先"
        ? "一鍵試排已完成：先排當班合格人力，不足再補支援，並避免同人重複佔站。"
        : smartMode === "支援優先"
        ? "一鍵試排已完成：先排支援合格人力，不足再補當班，並避免同人重複佔站。"
        : "一鍵試排已完成：先保留資格少的人，優先支援，再補當班，並避免同人重複佔站。";
    setFlashMessage(message);
  }

  function runRandomForStation(stationId: string, target: "manual" | "smart") {
    const attendance = target === "manual" ? manualAttendance : smartAttendance;
    const assignments = target === "manual" ? manualAssignments : smartAssignments;
    const rules = target === "manual" ? manualRules : smartRules;
    const rule = rules.find((item) => item.stationId === stationId);
    if (!rule) return;
    const pool = getQualifiedPeopleForStation(stationId, attendance.all, data.qualifications);
    const used = new Set(Object.values(assignments).flat());
    const available = pool.filter((person) => !used.has(person.id));
    if (!available.length) {
      setFlashMessage("此站點目前沒有可隨機安排的合格人選。" );
      return;
    }
    const pick = available[Math.floor(Math.random() * available.length)];
    const setter = target === "manual" ? setManualAssignments : setSmartAssignments;
    setter((current) => {
      const existing = current[stationId] || [];
      if (existing.length >= rule.minRequired) return current;
      return { ...current, [stationId]: [...existing, pick.id] };
    });
    setFlashMessage(`${pick.name} 已隨機安排到 ${stationId}。`);
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
  ];

  const allowedNav = currentRole
    ? navItems.filter((item) => hasAccess(item.minRole))
    : navItems.filter((item) => item.key === "home");

  if (loading) {
    return <div className="app-shell loading">資料載入中...</div>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <div className="brand-kicker">通用型檢測系統</div>
          <h1>站點資格管理</h1>
          <p>給幹部查詢與管理站點資格，未登入只能看首頁內容，登入後才顯示對應權限功能。</p>
        </div>

        <div className="control-card">
          <label>登入系統</label>
          {currentUser ? (
            <div className="logged-user">
              <strong>{currentUser.name}</strong>
              <span>
                {currentUser.id}｜{normalizeRole(currentUser.role)}
              </span>
              <button className="ghost" type="button" onClick={logout}>
                登出
              </button>
            </div>
          ) : (
            <>
              <input
                placeholder="工號或姓名"
                value={loginForm.account}
                onChange={(e) => setLoginForm((c) => ({ ...c, account: e.target.value }))}
              />
              <input
                type="password"
                placeholder="密碼（前端暫為占位）"
                value={loginForm.password}
                onChange={(e) => setLoginForm((c) => ({ ...c, password: e.target.value }))}
              />
              <button className="primary" type="button" onClick={handleLogin}>
                登入
              </button>
            </>
          )}
        </div>

        <nav className="nav-list">
          {allowedNav.map((item) => (
            <button
              key={item.key}
              className={page === item.key ? "nav-item active" : "nav-item"}
              onClick={() => setPage(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="content">
        {flash ? (
          <div className="flash">
            <span>{flash}</span>
            <button type="button" className="flash-close" onClick={() => setFlash("")}>×</button>
          </div>
        ) : null}

        {page === "home" ? (
          <Layout title="首頁" subtitle="第一塊為系統說明，第二塊為登入。未登入不顯示查詢與管理功能。">
            <div className="grid three">
              <StatCard title="人員總數" value={String(data.people.length)} note="人員主檔" />
              <StatCard title="站點總數" value={String(data.stations.length)} note="站點主檔" />
              <StatCard title="資格筆數" value={String(data.qualifications.length)} note="站點資格" />
            </div>
            <div className="panel"><h3>系統定位</h3><p>這是通用型檢測系統，提供幹部進行站點資格查詢、考核維護、缺口分析、站點試排與智能試排。</p></div>
            <div className="panel"><h3>權限規則</h3><ul><li>未登入：只能看首頁。</li><li>技術員：查詢人員資格、查詢站點人選。</li><li>領班：可進行站點考核修改申請。</li><li>組長：可進行站點缺口分析、站點試排。</li><li>主任：可進行站點規則設定、人員名單管理、站點缺口、智能試排、站點試排。</li><li>總權限管理員：全功能可用。</li></ul></div>
          </Layout>
        ) : null}

        {!currentRole && page !== "home" ? (
          <Layout title="尚未登入" subtitle="請先登入後開啟對應功能。"><Empty text="系統已禁止手動切換角色，需先登入後才顯示查詢與管理選單。" /></Layout>
        ) : null}

        {currentRole && page === "person-query" ? (
          <Layout title="查詢人員資格" subtitle="可用工號、姓名、班別、角色與國籍查詢。">
            <div className="grid two">
              <div className="panel">
                <div className="toolbar">
                  <select value={personTeamFilter} onChange={(e) => setPersonTeamFilter(e.target.value)}>
                    <option value="全部班別">全部班別</option>
                    {TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <input placeholder="輸入工號、姓名、班別、角色、國籍" value={personKeyword} onChange={(e) => setPersonKeyword(e.target.value)} />
                </div>
                <div className="list-scroll">
                  {filteredPeople.map((person) => (
                    <button key={person.id} className={selectedEmployee?.id === person.id ? "list-row active" : "list-row"} onClick={() => setSelectedEmployeeId(person.id)}>
                      <strong>{person.name}</strong>
                      <span>{person.id}｜{getTeamOfPerson(person)}｜{person.role}｜{person.nationality}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="panel">
                {selectedEmployee ? (
                  <>
                    {(() => {
                      const duty = getPersonDutyDisplay(selectedEmployee);
                      return (
                        <div className="detail-grid">
                          <Info label="工號" value={selectedEmployee.id} />
                          <Info label="班別" value={String(getTeamOfPerson(selectedEmployee))} />
                          <Info label="角色" value={selectedEmployee.role} />
                          <Info label="國籍" value={selectedEmployee.nationality} />
                          <Info label="(A)第一天" value={duty.aDay1} />
                          <Info label="(A)第二天" value={duty.aDay2} />
                          <Info label="(B)第一天" value={duty.bDay1} />
                          <Info label="(B)第二天" value={duty.bDay2} />
                        </div>
                      );
                    })()}
                    <table className="table"><thead><tr><th>站點</th><th>狀態</th></tr></thead><tbody>{employeeQualifications.map((item) => <tr key={`${item.employeeId}-${item.stationId}`}><td>{item.stationId}</td><td><span className={qualificationBadge(item.status)}>{item.status || "空白"}</span></td></tr>)}</tbody></table>
                  </>
                ) : <Empty text="找不到符合條件的人員。" />}
              </div>
            </div>
          </Layout>
        ) : null}

        {currentRole && page === "station-query" ? (
          <Layout title="查詢站點人選" subtitle="可依班別與日別查看各站符合資格或訓練中人員。">
            <div className="grid two">
              <div className="panel">
                <div className="toolbar">
                  <select value={stationTeamFilter} onChange={(e) => setStationTeamFilter(e.target.value as TeamName)}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select>
                  <select value={stationDayFilter} onChange={(e) => setStationDayFilter(e.target.value as Exclude<ShiftMode, "全部在職">)}>{dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select>
                  <input placeholder="輸入站點代碼、名稱、說明" value={stationKeyword} onChange={(e) => setStationKeyword(e.target.value)} />
                </div>
                <div className="list-scroll">{filteredStations.map((station) => <button key={station.id} className={selectedStation?.id === station.id ? "list-row active" : "list-row"} onClick={() => setSelectedStationId(station.id)}><strong>{station.name}</strong><span>最低人數 {station.normalMin}｜優先序 {station.priority ?? "-"}</span></button>)}</div>
              </div>
              <div className="panel">{selectedStation ? <><div className="detail-grid"><Info label="站點代碼" value={selectedStation.id} /><Info label="站點名稱" value={selectedStation.name} /><Info label="班別" value={stationTeamFilter} /><Info label="日別" value={stationDayFilter} /><Info label="總出勤" value={String(stationAttendance.totalCount)} /><Info label="支援人力" value={String(stationAttendance.support.length)} /></div><table className="table"><thead><tr><th>工號</th><th>姓名</th><th>班別</th><th>來源</th><th>資格</th></tr></thead><tbody>{stationQualifications.filter((item) => stationAttendance.all.some((person) => person.id === item.employeeId)).map((item) => { const person = data.people.find((person) => person.id === item.employeeId); return <tr key={`${item.employeeId}-${item.stationId}`}><td>{item.employeeId}</td><td>{person?.name || item.employeeName || "-"}</td><td>{person ? String(getTeamOfPerson(person)) : "-"}</td><td>{stationAttendance.own.some((person) => person.id === item.employeeId) ? "當班" : "支援"}</td><td><span className={qualificationBadge(item.status)}>{item.status || "空白"}</span></td></tr>; })}</tbody></table></> : <Empty text="找不到符合條件的站點。" />}</div>
            </div>
          </Layout>
        ) : null}

        {currentRole && page === "qualification-review" && hasAccess("領班") ? (
          <Layout title="站點考核" subtitle="班別改為 全部班別 / 婷芬班 / 美香班 / 俊志班 / 翊展班；切換班別會重置工號姓名輸入框。">
            <div className="grid two">
              <div className="panel"><div className="toolbar"><select value={reviewShift} onChange={(e) => setReviewShift(e.target.value as (typeof REVIEW_TEAM_OPTIONS)[number])}>{REVIEW_TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><input placeholder="輸入工號或姓名" value={reviewKeyword} onChange={(e) => setReviewKeyword(e.target.value)} /></div><div className="list-scroll">{reviewPeople.map((person) => <button key={person.id} className={reviewSelectedPerson?.id === person.id ? "list-row active" : "list-row"} onClick={() => { setReviewEmployeeId(person.id); setReviewKeyword(""); }}><strong>{person.name}</strong><span>{person.id}｜{getTeamOfPerson(person)}｜{person.role}</span></button>)}</div></div>
              <div className="panel">{reviewSelectedPerson ? <><div className="detail-grid">{(() => { const duty = getPersonDutyDisplay(reviewSelectedPerson); return <><Info label="工號" value={reviewSelectedPerson.id} /><Info label="姓名" value={reviewSelectedPerson.name} /><Info label="班別" value={String(getTeamOfPerson(reviewSelectedPerson))} /><Info label="角色" value={reviewSelectedPerson.role} /><Info label="(A)第一天" value={duty.aDay1} /><Info label="(A)第二天" value={duty.aDay2} /><Info label="(B)第一天" value={duty.bDay1} /><Info label="(B)第二天" value={duty.bDay2} /></>; })()}</div><div className="form-grid compact-form"><div><label className="field-label">站點</label><select value={reviewStationId} onChange={(e) => setReviewStationId(e.target.value)}><option value="">請選擇站點</option>{data.stations.map((station) => <option key={station.id} value={station.id}>{getStationLabel(station)}</option>)}</select></div><div><label className="field-label">狀態</label><select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value as QualificationStatus)}>{qualificationOptions.map((item) => <option key={item || "blank"} value={item}>{item || "空白"}</option>)}</select></div></div><div className="toolbar"><button className="primary" type="button" onClick={() => handleSaveQualification()}>確認並儲存站點考核</button></div><table className="table"><thead><tr><th>站點</th><th>狀態</th><th>操作</th></tr></thead><tbody>{data.qualifications.filter((item) => item.employeeId === reviewSelectedPerson?.id).map((item) => <tr key={`${item.employeeId}-${item.stationId}`}><td>{item.stationId}</td><td><span className={qualificationBadge(item.status)}>{item.status || "空白"}</span></td><td><button className="danger" type="button" onClick={() => handleDeleteQualification(item.employeeId, item.stationId)}>刪除</button></td></tr>)}</tbody></table></> : <Empty text="請先選取人員。" />}</div>
            </div>
            <div className="panel"><h3>班別人員總攬</h3><table className="table"><thead><tr><th>工號</th><th>姓名</th><th>職務</th><th>國籍</th><th>合格</th><th>訓練中</th><th>不可排</th></tr></thead><tbody>{reviewOverviewRows.map((row) => <tr key={row.id}><td>{row.id}</td><td>{row.name}</td><td>{row.role}</td><td>{row.nationality}</td><td>{row.qualified}</td><td>{row.training}</td><td>{row.blocked}</td></tr>)}</tbody></table></div>
          </Layout>
        ) : null}

        {currentRole && page === "gap-analysis" && hasAccess("組長") ? (
          <Layout title="站點缺口分析" subtitle="當班 = 本班在職人員；第一天/第二天 = 本班出勤 + 對班支援出勤；主任不列入人力。">
            <div className="panel"><div className="toolbar"><select value={gapShift} onChange={(e) => setGapShift(e.target.value as TeamName)}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={gapDay} onChange={(e) => setGapDay(e.target.value as Exclude<ShiftMode, "全部在職">)}>{dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><div className="detail-grid"><Info label="本籍出勤" value={String(gapAttendance.localCount)} /><Info label="菲籍出勤" value={String(gapAttendance.filipinoCount)} /><Info label="越籍出勤" value={String(gapAttendance.vietnamCount)} /><Info label="總出勤" value={String(gapAttendance.totalCount)} /><Info label="當班人力" value={String(gapAttendance.own.length)} /><Info label="支援人力" value={String(gapAttendance.support.length)} /></div><table className="table"><thead><tr><th>站點</th><th>最低需求</th><th>合格</th><th>訓練中</th><th>不可排</th><th>缺口</th><th>支援可補</th></tr></thead><tbody>{gapRules.map((rule) => { const station = data.stations.find((item) => item.id === rule.stationId); const coverage = getStationCoverage(rule.stationId, rule.minRequired, gapAttendance.all, gapAttendance.support, data.qualifications); const supportNames = coverage.supportQualifiedIds.map((id) => data.people.find((person) => person.id === id)?.name || id); return <tr key={`${rule.team}-${rule.dayKey}-${rule.stationId}`}><td>{station?.name || rule.stationId}</td><td>{rule.minRequired}</td><td>{coverage.qualified}</td><td>{coverage.training}</td><td>{coverage.blocked}</td><td>{coverage.shortage}</td><td>{supportNames.join("、") || "-"}</td></tr>; })}</tbody></table></div>
          </Layout>
        ) : null}

        {currentRole && page === "manual-schedule" && hasAccess("組長") ? (
          <Layout title="站點試排" subtitle="已導入四班 + 當班/第一天/第二天，並顯示出勤人數、幹部站位、缺口與重複安排提醒。">
            <div className="panel"><div className="toolbar"><select value={manualShift} onChange={(e) => setManualShift(e.target.value as TeamName)}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={manualDay} onChange={(e) => setManualDay(e.target.value as Exclude<ShiftMode, "全部在職">)}>{dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><div className="detail-grid"><Info label="本籍出勤" value={String(manualAttendance.localCount)} /><Info label="菲籍出勤" value={String(manualAttendance.filipinoCount)} /><Info label="越籍出勤" value={String(manualAttendance.vietnamCount)} /><Info label="總出勤" value={String(manualAttendance.totalCount)} /></div></div>
            <div className="panel"><h3>幹部站位</h3><div className="chips"><span className="chip">主任 × 1</span><span className="chip">組長 × 1</span><span className="chip">領班 × 3</span></div></div>
            <div className="panel floating-summary"><h3>試排浮動資訊</h3><div className="detail-grid"><Info label="需排總人數" value={String(manualRules.reduce((sum, rule) => sum + rule.minRequired, 0))} /><Info label="已排總人數" value={String(countAssigned(manualAssignments))} /><Info label="重複安排" value={String(manualDuplicateIds.length)} /><Info label="缺口總數" value={String(manualRules.reduce((sum, rule) => sum + Math.max(0, rule.minRequired - (manualAssignments[rule.stationId]?.length || 0)), 0))} /></div></div>
            <div className="grid two">{manualRules.map((rule) => { const station = data.stations.find((item) => item.id === rule.stationId); const selectedIds = manualAssignments[rule.stationId] || []; const candidates = manualCandidateMap.get(rule.stationId) || []; return <div className="panel" key={rule.stationId}><div className="panel-header"><h3>{station?.name || rule.stationId}</h3><span>需求 {rule.minRequired}</span></div><div className="toolbar"><select defaultValue="" onChange={(e) => { if (e.target.value) toggleManualAssignment(rule.stationId, e.target.value); e.currentTarget.value = ""; }}><option value="">下拉指派人選</option>{candidates.map((person) => <option key={person.id} value={person.id}>{getEmployeeLabel(person)}</option>)}</select><button type="button" className="ghost" onClick={() => { const raw = window.prompt(`請輸入 ${station?.name || rule.stationId} 的自訂人選（工號或姓名）`); if (raw) assignCustomPersonToStation(rule.stationId, raw, "manual"); }}>自訂人選</button><button type="button" className="ghost" onClick={() => runRandomForStation(rule.stationId, "manual")}>隨機合格</button></div><div className="chips">{selectedIds.length ? selectedIds.map((id) => { const person = data.people.find((item) => item.id === id); return <span className="chip" key={id}>{person?.name || id}</span>; }) : <span className="muted">尚未安排</span>}</div><div className="list-scroll short">{candidates.map((person) => { const active = selectedIds.includes(person.id); return <button key={person.id} className={active ? "list-row active" : "list-row"} onClick={() => toggleManualAssignment(rule.stationId, person.id)}><strong>{person.name}</strong><span>{person.id}｜{getTeamOfPerson(person)}｜{person.nationality}</span></button>; })}</div></div>; })}</div><div className="panel"><h3>安排後總站點樣式</h3><table className="table"><thead><tr><th>站點</th><th>已安排人數</th><th>缺口</th><th>安排名單</th></tr></thead><tbody>{manualRules.map((rule) => { const station = data.stations.find((item) => item.id === rule.stationId); const ids = manualAssignments[rule.stationId] || []; const names = ids.map((id) => data.people.find((person) => person.id === id)?.name || id); return <tr key={rule.stationId}><td>{station?.name || rule.stationId}</td><td>{ids.length}</td><td>{Math.max(0, rule.minRequired - ids.length)}</td><td>{names.join("、") || "-"}</td></tr>; })}</tbody></table></div>
          </Layout>
        ) : null}

        {currentRole && page === "station-rules" && hasAccess("主任") ? (
          <Layout title="站點規則設定" subtitle="規則改為各班自行設定；所有修改需先確認，僅當班主任或總權限管理員可改。"><div className="panel"><div className="toolbar"><select value={rulesTeam} onChange={(e) => setRulesTeam(e.target.value as TeamName)}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={rulesDay} onChange={(e) => setRulesDay(e.target.value as Exclude<ShiftMode, "全部在職">)}>{dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select><span className="muted">系統代號：{getDutyCode(rulesTeam, rulesDay)}</span></div><table className="table"><thead><tr><th>站點</th><th>正班最低</th><th>輪休單批最低</th><th>優先序</th><th>必站</th><th>備援目標</th></tr></thead><tbody>{stationRuleRows.map((rule) => { const station = data.stations.find((item) => item.id === rule.stationId); return <tr key={rule.stationId}><td>{station?.name || rule.stationId}</td><td><ConfirmNumberInput value={station?.normalMin ?? 0} disabled={!canEditRulesForTeam(rulesTeam)} onCommit={(value) => station && handleUpdateStation(station, { normalMin: value })} /></td><td><ConfirmNumberInput value={station?.reliefMinPerBatch ?? 0} disabled={!canEditRulesForTeam(rulesTeam)} onCommit={(value) => station && handleUpdateStation(station, { reliefMinPerBatch: value })} /></td><td><ConfirmNumberInput value={station?.priority ?? 0} disabled={!canEditRulesForTeam(rulesTeam)} onCommit={(value) => station && handleUpdateStation(station, { priority: value })} /></td><td><ConfirmSelect value={station?.isMandatory ? "Y" : "N"} disabled={!canEditRulesForTeam(rulesTeam)} options={[{label:"Y", value:"Y"},{label:"N", value:"N"}]} onCommit={(value) => station && handleUpdateStation(station, { isMandatory: value === "Y" })} /></td><td><ConfirmNumberInput value={station?.backupTarget ?? 0} disabled={!canEditRulesForTeam(rulesTeam)} onCommit={(value) => station && handleUpdateStation(station, { backupTarget: value })} /></td></tr>; })}</tbody></table></div></Layout>
        ) : null}

        {currentRole && page === "people-management" && hasAccess("主任") ? (
          <Layout title="人員名單管理" subtitle="已新增搜尋框，所有修改需先確認後才套用。"><div className="panel"><h3>新增人員</h3><div className="form-grid compact-form"><div><label className="field-label">工號</label><input value={newPersonForm.id} onChange={(e) => setNewPersonForm((c) => ({ ...c, id: e.target.value }))} /></div><div><label className="field-label">姓名</label><input value={newPersonForm.name} onChange={(e) => setNewPersonForm((c) => ({ ...c, name: e.target.value }))} /></div><div><label className="field-label">班別</label><select value={newPersonForm.shift} onChange={(e) => setNewPersonForm((c) => ({ ...c, shift: e.target.value }))}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><div><label className="field-label">角色</label><input value={newPersonForm.role} onChange={(e) => setNewPersonForm((c) => ({ ...c, role: e.target.value }))} /></div><div><label className="field-label">國籍</label><input value={newPersonForm.nationality} onChange={(e) => setNewPersonForm((c) => ({ ...c, nationality: e.target.value }))} /></div><div><label className="field-label">在職狀態</label><input value={newPersonForm.employmentStatus} onChange={(e) => setNewPersonForm((c) => ({ ...c, employmentStatus: e.target.value }))} /></div></div><div className="toolbar"><button className="primary" type="button" onClick={handleCreatePerson}>確認新增人員</button></div></div><div className="panel"><div className="toolbar"><input placeholder="快速搜尋工號、姓名、班別、職務" value={peopleSearchKeyword} onChange={(e) => setPeopleSearchKeyword(e.target.value)} /></div><table className="table"><thead><tr><th>工號</th><th>姓名</th><th>班別</th><th>角色</th><th>國籍</th><th>A1</th><th>A2</th><th>B1</th><th>B2</th><th>在職</th></tr></thead><tbody>{data.people.filter((person) => searchText([person.id, person.name, String(getTeamOfPerson(person)), person.role], peopleSearchKeyword)).map((person) => <tr key={person.id}><td>{person.id}</td><td><ConfirmTextInput value={person.name} onCommit={(value) => handleUpdatePerson(person, { name: value })} /></td><td><ConfirmSelect value={String(getTeamOfPerson(person))} options={TEAM_OPTIONS.map((item) => ({ label: item, value: item }))} onCommit={(value) => handleUpdatePerson(person, { shift: value })} /></td><td><ConfirmTextInput value={person.role} onCommit={(value) => handleUpdatePerson(person, { role: value })} /></td><td><ConfirmTextInput value={person.nationality} onCommit={(value) => handleUpdatePerson(person, { nationality: value })} /></td><td><ConfirmTextInput value={person.aDay1 || ""} onCommit={(value) => handleUpdatePerson(person, { aDay1: value, day1: value })} /></td><td><ConfirmTextInput value={person.aDay2 || ""} onCommit={(value) => handleUpdatePerson(person, { aDay2: value, day2: value })} /></td><td><ConfirmTextInput value={person.bDay1 || ""} onCommit={(value) => handleUpdatePerson(person, { bDay1: value })} /></td><td><ConfirmTextInput value={person.bDay2 || ""} onCommit={(value) => handleUpdatePerson(person, { bDay2: value })} /></td><td><ConfirmTextInput value={person.employmentStatus} onCommit={(value) => handleUpdatePerson(person, { employmentStatus: value })} /></td></tr>)}</tbody></table></div></Layout>
        ) : null}

        {currentRole && page === "smart-schedule" && hasAccess("主任") ? (
          <Layout title="智能試排" subtitle="提供當班優先、支援優先、資格優先三種模式；站點亦可單獨隨機與自訂。"><div className="panel"><div className="toolbar"><select value={smartShift} onChange={(e) => setSmartShift(e.target.value as TeamName)}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={smartDay} onChange={(e) => setSmartDay(e.target.value as Exclude<ShiftMode, "全部在職">)}>{dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={smartMode} onChange={(e) => setSmartMode(e.target.value as SmartScheduleMode)}>{SMART_MODE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><button className="primary" type="button" onClick={runSmartPlan}>一鍵試排</button></div><div className="detail-grid"><Info label="本籍出勤" value={String(smartAttendance.localCount)} /><Info label="菲籍出勤" value={String(smartAttendance.filipinoCount)} /><Info label="越籍出勤" value={String(smartAttendance.vietnamCount)} /><Info label="總出勤" value={String(smartAttendance.totalCount)} /></div><div className="panel"><p>模式說明：當班優先＝先排當班合格；支援優先＝先排支援合格；資格優先＝先保留資格少的人，避免少技能人力被浪費。</p></div></div><div className="grid two">{smartRules.map((rule) => { const station = data.stations.find((item) => item.id === rule.stationId); const selectedIds = smartAssignments[rule.stationId] || []; const candidates = smartCandidateMap.get(rule.stationId) || []; return <div className="panel" key={rule.stationId}><div className="panel-header"><h3>{station?.name || rule.stationId}</h3><span>需求 {rule.minRequired}</span></div><div className="toolbar"><button type="button" className="ghost" onClick={() => runRandomForStation(rule.stationId, "smart")}>隨機合格</button><button type="button" className="ghost" onClick={() => { const raw = window.prompt(`請輸入 ${station?.name || rule.stationId} 的自訂人選（工號或姓名）`); if (raw) assignCustomPersonToStation(rule.stationId, raw, "smart"); }}>自訂人選</button></div><div className="chips">{selectedIds.length ? selectedIds.map((id) => { const person = data.people.find((item) => item.id === id); return <span className="chip" key={id}>{person?.name || id}</span>; }) : <span className="muted">尚未安排</span>}</div><div className="list-scroll short">{candidates.map((person) => { const active = selectedIds.includes(person.id); return <button key={person.id} className={active ? "list-row active" : "list-row"} onClick={() => setSmartAssignments((current) => { const existing = current[rule.stationId] || []; const next = existing.includes(person.id) ? existing.filter((item) => item !== person.id) : [...existing, person.id]; return { ...current, [rule.stationId]: next }; })}><strong>{person.name}</strong><span>{person.id}｜{String(getTeamOfPerson(person))}｜{person.nationality}</span></button>; })}</div></div>; })}</div><div className="panel"><div className="detail-grid"><Info label="需排總人數" value={String(smartRules.reduce((sum, rule) => sum + rule.minRequired, 0))} /><Info label="已排總人數" value={String(countAssigned(smartAssignments))} /><Info label="重複安排" value={String(smartDuplicateIds.length)} /><Info label="缺口總數" value={String(smartRules.reduce((sum, rule) => sum + Math.max(0, rule.minRequired - (smartAssignments[rule.stationId]?.length || 0)), 0))} /></div><h3>安排後總站點樣式</h3><table className="table"><thead><tr><th>站點</th><th>需求</th><th>已安排</th><th>缺口</th><th>名單</th></tr></thead><tbody>{smartRules.map((rule) => { const station = data.stations.find((item) => item.id === rule.stationId); const ids = smartAssignments[rule.stationId] || []; const names = ids.map((id) => data.people.find((person) => person.id === id)?.name || id); return <tr key={rule.stationId}><td>{station?.name || rule.stationId}</td><td>{rule.minRequired}</td><td>{ids.length}</td><td>{Math.max(0, rule.minRequired - ids.length)}</td><td>{names.join("、") || "-"}</td></tr>; })}</tbody></table></div></Layout>
        ) : null}
      </main>
    </div>
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

function Info({ label, value }: { label: string; value: string }) {
  return <div className="info-item"><span>{label}</span><strong>{value || "-"}</strong></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
