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
  getApplicableRules,
  getAttendanceForTeam,
  getStationCoverage,
  getTeamOfPerson,
  qualificationBadge,
  REVIEW_TEAM_OPTIONS,
  searchText,
  TEAM_OPTIONS,
} from "./lib/selectors";
import type {
  AppBootstrap,
  Person,
  Qualification,
  QualificationStatus,
  ShiftMode,
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
const dayOptions: ShiftMode[] = ["當班", "第一天", "第二天"];

const roleRank: Record<UserRole, number> = {
  技術員: 1,
  領班: 2,
  組長: 3,
  主任: 4,
};

function normalizeRole(raw?: string): UserRole {
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

function buildCandidateMap(people: Person[], qualifications: Qualification[]) {
  const allowedIds = new Set(people.map((person) => person.id));
  const map = new Map<string, Person[]>();

  for (const q of qualifications) {
    if (q.status !== "合格") continue;
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

export default function App() {
  const [data, setData] = useState<AppBootstrap>(emptyBootstrap);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<PageKey>("home");

  const [loginForm, setLoginForm] = useState({ account: "", password: "" });
  const [currentUser, setCurrentUser] = useState<Person | null>(null);
  const currentRole = currentUser ? normalizeRole(currentUser.role) : null;

  const [flash, setFlash] = useState("");

  const [personKeyword, setPersonKeyword] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");

  const [stationKeyword, setStationKeyword] = useState("");
  const [selectedStationId, setSelectedStationId] = useState("");

  const [reviewShift, setReviewShift] = useState<(typeof REVIEW_TEAM_OPTIONS)[number]>("全部班別");
  const [reviewKeyword, setReviewKeyword] = useState("");
  const [reviewEmployeeId, setReviewEmployeeId] = useState("");
  const [reviewStationId, setReviewStationId] = useState("");
  const [reviewStatus, setReviewStatus] = useState<QualificationStatus>("合格");

  const [gapShift, setGapShift] = useState<TeamName>("翊展班");
  const [gapDay, setGapDay] = useState<ShiftMode>("當班");

  const [manualShift, setManualShift] = useState<TeamName>("翊展班");
  const [manualDay, setManualDay] = useState<ShiftMode>("當班");
  const [manualAssignments, setManualAssignments] = useState<Record<string, string[]>>({});

  const [smartShift, setSmartShift] = useState<TeamName>("翊展班");
  const [smartDay, setSmartDay] = useState<ShiftMode>("當班");
  const [smartAssignments, setSmartAssignments] = useState<Record<string, string[]>>({});

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

  const filteredPeople = useMemo(() => {
    return data.people.filter((person) =>
      searchText([person.id, person.name, getTeamOfPerson(person), person.role, person.nationality], personKeyword)
    );
  }, [data.people, personKeyword]);

  const selectedEmployee = useMemo(() => {
    return data.people.find((person) => person.id === selectedEmployeeId) || filteredPeople[0] || null;
  }, [data.people, filteredPeople, selectedEmployeeId]);

  const filteredStations = useMemo(() => {
    return data.stations.filter((station) =>
      searchText([station.id, station.name, station.description, station.note], stationKeyword)
    );
  }, [data.stations, stationKeyword]);

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
    () => buildCandidateMap(manualAttendance.all, data.qualifications),
    [manualAttendance, data.qualifications]
  );

  const smartRules = useMemo(
    () => getApplicableRules(smartShift, smartDay, data.stationRules || [], data.stations),
    [data.stationRules, data.stations, smartShift, smartDay]
  );

  function hasAccess(minRole?: UserRole) {
    if (!minRole) return true;
    if (!currentRole) return false;
    return roleRank[currentRole] >= roleRank[minRole];
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

  async function handleSaveQualification() {
    const employee = data.people.find((person) => person.id === reviewEmployeeId);
    const station = data.stations.find((item) => item.id === reviewStationId);

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
      status: reviewStatus,
    };

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
    setFlashMessage("站點考核已儲存。切換班別時，工號/姓名輸入框會自動清空。" );
  }

  async function handleDeleteQualification(employeeId: string, stationId: string) {
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
    await updateStationRule(next);
    setData((current) => ({
      ...current,
      stations: current.stations.map((item) => (item.id === station.id ? next : item)),
    }));
    setFlashMessage(`站點 ${station.name} 已更新，目前是立即存取，不需要手動另存。`);
  }

  async function handleUpdatePerson(person: Person, patch: Partial<Person>) {
    const next = { ...person, ...patch };
    await updatePerson(next);
    setData((current) => ({
      ...current,
      people: current.people.map((item) => (item.id === person.id ? next : item)),
    }));
    setFlashMessage(`人員 ${person.name} 已更新，目前是立即存取，不需要手動另存。`);
  }

  async function handleCreatePerson() {
    if (!newPersonForm.id.trim() || !newPersonForm.name.trim()) {
      setFlashMessage("新增人員至少要輸入工號與姓名。");
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
    setFlashMessage("人員已新增。人員名單管理已補搜尋框，可快速定位後直接修改。" );
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

  function runSmartPlan() {
    const rows = buildSmartAssignments(
      smartShift,
      smartDay,
      data.stations,
      data.stationRules || [],
      data.people,
      data.qualifications
    );
    const next: Record<string, string[]> = {};
    rows.forEach((row) => {
      next[row.stationId] = row.assigned.map((person) => person.id);
    });
    setSmartAssignments(next);
    setFlashMessage(
      "一鍵邏輯：依班別與日別建立當班+支援候選池，按站點規則優先序試排，優先用當班合格人力，不足再補支援，且同一人不重複佔站。"
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
            <div className="panel"><h3>權限規則</h3><ul><li>未登入：只能看首頁。</li><li>技術員：查詢人員資格、查詢站點人選。</li><li>領班：可進行站點考核修改申請。</li><li>組長：可進行站點缺口分析、站點試排。</li><li>主任：可進行站點規則設定、人員名單管理、站點缺口、智能試排、站點試排。</li></ul></div>
          </Layout>
        ) : null}

        {!currentRole && page !== "home" ? (
          <Layout title="尚未登入" subtitle="請先登入後開啟對應功能。"><Empty text="系統已禁止手動切換角色，需先登入後才顯示查詢與管理選單。" /></Layout>
        ) : null}

        {currentRole && page === "person-query" ? (
          <Layout title="查詢人員資格" subtitle="可用工號、姓名、班別、角色與國籍查詢。">
            <div className="grid two">
              <div className="panel"><div className="toolbar"><input placeholder="輸入工號、姓名、班別、角色、國籍" value={personKeyword} onChange={(e) => setPersonKeyword(e.target.value)} /></div><div className="list-scroll">{filteredPeople.map((person) => <button key={person.id} className={selectedEmployee?.id === person.id ? "list-row active" : "list-row"} onClick={() => setSelectedEmployeeId(person.id)}><strong>{person.name}</strong><span>{person.id}｜{getTeamOfPerson(person)}｜{person.role}｜{person.nationality}</span></button>)}</div></div>
              <div className="panel">{selectedEmployee ? <><div className="detail-grid"><Info label="工號" value={selectedEmployee.id} /><Info label="班別" value={getTeamOfPerson(selectedEmployee)} /><Info label="角色" value={selectedEmployee.role} /><Info label="國籍" value={selectedEmployee.nationality} /><Info label="(A)第一天" value={selectedEmployee.aDay1 || selectedEmployee.day1} /><Info label="(B)第一天" value={selectedEmployee.bDay1 || ""} /></div><table className="table"><thead><tr><th>站點</th><th>狀態</th></tr></thead><tbody>{employeeQualifications.map((item) => <tr key={`${item.employeeId}-${item.stationId}`}><td>{item.stationId}</td><td><span className={qualificationBadge(item.status)}>{item.status || "空白"}</span></td></tr>)}</tbody></table></> : <Empty text="找不到符合條件的人員。" />}</div>
            </div>
          </Layout>
        ) : null}

        {currentRole && page === "station-query" ? (
          <Layout title="查詢站點人選" subtitle="可查看各站符合資格的人員。">
            <div className="grid two">
              <div className="panel"><div className="toolbar"><input placeholder="輸入站點代碼、名稱、說明" value={stationKeyword} onChange={(e) => setStationKeyword(e.target.value)} /></div><div className="list-scroll">{filteredStations.map((station) => <button key={station.id} className={selectedStation?.id === station.id ? "list-row active" : "list-row"} onClick={() => setSelectedStationId(station.id)}><strong>{station.name}</strong><span>最低人數 {station.normalMin}｜優先序 {station.priority ?? "-"}</span></button>)}</div></div>
              <div className="panel">{selectedStation ? <><div className="detail-grid"><Info label="站點代碼" value={selectedStation.id} /><Info label="站點名稱" value={selectedStation.name} /><Info label="正班最低" value={String(selectedStation.normalMin)} /><Info label="輪休單批最低" value={String(selectedStation.reliefMinPerBatch)} /><Info label="優先序" value={String(selectedStation.priority ?? "")} /><Info label="備援目標" value={String(selectedStation.backupTarget ?? "")} /></div><table className="table"><thead><tr><th>工號</th><th>姓名</th><th>班別</th><th>資格</th></tr></thead><tbody>{stationQualifications.map((item) => { const person = data.people.find((person) => person.id === item.employeeId); return <tr key={`${item.employeeId}-${item.stationId}`}><td>{item.employeeId}</td><td>{person?.name || item.employeeName || "-"}</td><td>{person ? getTeamOfPerson(person) : "-"}</td><td><span className={qualificationBadge(item.status)}>{item.status || "空白"}</span></td></tr>; })}</tbody></table></> : <Empty text="找不到符合條件的站點。" />}</div>
            </div>
          </Layout>
        ) : null}

        {currentRole && page === "qualification-review" && hasAccess("領班") ? (
          <Layout title="站點考核" subtitle="班別改為 全部班別 / 婷芬班 / 美香班 / 俊志班 / 翊展班；切換班別會重置工號姓名輸入框。">
            <div className="grid two">
              <div className="panel"><div className="toolbar"><select value={reviewShift} onChange={(e) => setReviewShift(e.target.value as (typeof REVIEW_TEAM_OPTIONS)[number])}>{REVIEW_TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><input placeholder="輸入工號或姓名" value={reviewKeyword} onChange={(e) => setReviewKeyword(e.target.value)} /></div><div className="list-scroll">{reviewPeople.map((person) => <button key={person.id} className={reviewSelectedPerson?.id === person.id ? "list-row active" : "list-row"} onClick={() => { setReviewEmployeeId(person.id); setReviewKeyword(getEmployeeLabel(person)); }}><strong>{person.name}</strong><span>{person.id}｜{getTeamOfPerson(person)}｜{person.role}</span></button>)}</div></div>
              <div className="panel"><div className="detail-grid"><Info label="工號" value={reviewSelectedPerson?.id || ""} /><Info label="姓名" value={reviewSelectedPerson?.name || ""} /><Info label="班別" value={reviewSelectedPerson ? getTeamOfPerson(reviewSelectedPerson) : ""} /><Info label="角色" value={reviewSelectedPerson?.role || ""} /><Info label="(A)第一天" value={reviewSelectedPerson?.aDay1 || reviewSelectedPerson?.day1 || ""} /><Info label="(B)第一天" value={reviewSelectedPerson?.bDay1 || ""} /></div><div className="form-grid compact-form"><div><label className="field-label">人員</label><input value={reviewKeyword} placeholder="輸入工號或姓名" onChange={(e) => { const value = e.target.value; setReviewKeyword(value); const matched = data.people.find((person) => person.id.toLowerCase() === value.trim().toLowerCase() || person.name.toLowerCase() === value.trim().toLowerCase()); if (matched) setReviewEmployeeId(matched.id); }} /></div><div><label className="field-label">站點</label><select value={reviewStationId} onChange={(e) => setReviewStationId(e.target.value)}><option value="">請選擇站點</option>{data.stations.map((station) => <option key={station.id} value={station.id}>{getStationLabel(station)}</option>)}</select></div><div><label className="field-label">狀態</label><select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value as QualificationStatus)}>{qualificationOptions.map((item) => <option key={item || "blank"} value={item}>{item || "空白"}</option>)}</select></div></div><div className="toolbar"><button className="primary" type="button" onClick={handleSaveQualification}>儲存站點考核</button></div><table className="table"><thead><tr><th>站點</th><th>狀態</th><th>操作</th></tr></thead><tbody>{data.qualifications.filter((item) => item.employeeId === reviewSelectedPerson?.id).map((item) => <tr key={`${item.employeeId}-${item.stationId}`}><td>{item.stationId}</td><td><span className={qualificationBadge(item.status)}>{item.status || "空白"}</span></td><td><button className="danger" type="button" onClick={() => handleDeleteQualification(item.employeeId, item.stationId)}>刪除</button></td></tr>)}</tbody></table></div>
            </div>
            <div className="panel"><h3>班別人員總攬</h3><table className="table"><thead><tr><th>工號</th><th>姓名</th><th>職務</th><th>國籍</th><th>合格</th><th>訓練中</th><th>不可排</th></tr></thead><tbody>{reviewOverviewRows.map((row) => <tr key={row.id}><td>{row.id}</td><td>{row.name}</td><td>{row.role}</td><td>{row.nationality}</td><td>{row.qualified}</td><td>{row.training}</td><td>{row.blocked}</td></tr>)}</tbody></table></div>
          </Layout>
        ) : null}

        {currentRole && page === "gap-analysis" && hasAccess("組長") ? (
          <Layout title="站點缺口分析" subtitle="缺口分析理解：依班別與日別先取得本班出勤，再在第一天/第二天納入對班支援，最後對照站點規則與資格狀態，檢查各站缺口並標示支援可補站點。">
            <div className="panel"><div className="toolbar"><select value={gapShift} onChange={(e) => setGapShift(e.target.value as TeamName)}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={gapDay} onChange={(e) => setGapDay(e.target.value as ShiftMode)}>{dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><div className="detail-grid"><Info label="當班人力" value={String(gapAttendance.own.length)} /><Info label="支援人力" value={String(gapAttendance.support.length)} /><Info label="總出勤" value={String(gapAttendance.all.length)} /></div><table className="table"><thead><tr><th>站點</th><th>最低需求</th><th>合格</th><th>訓練中</th><th>不可排</th><th>缺口</th><th>支援可補</th></tr></thead><tbody>{gapRules.map((rule) => { const station = data.stations.find((item) => item.id === rule.stationId); const coverage = getStationCoverage(rule.stationId, rule.minRequired, gapAttendance.all, gapAttendance.support, data.qualifications); const supportNames = coverage.supportQualifiedIds.map((id) => data.people.find((person) => person.id === id)?.name || id); return <tr key={`${rule.team}-${rule.dayKey}-${rule.stationId}`}><td>{station?.name || rule.stationId}</td><td>{rule.minRequired}</td><td>{coverage.qualified}</td><td>{coverage.training}</td><td>{coverage.blocked}</td><td>{coverage.shortage}</td><td>{supportNames.join("、") || "-"}</td></tr>; })}</tbody></table></div>
          </Layout>
        ) : null}

        {currentRole && page === "manual-schedule" && hasAccess("組長") ? (
          <Layout title="站點試排" subtitle="班別與日別已改成四班/三日別，候選池依當班+支援邏輯切換。">
            <div className="panel"><div className="toolbar"><select value={manualShift} onChange={(e) => setManualShift(e.target.value as TeamName)}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={manualDay} onChange={(e) => setManualDay(e.target.value as ShiftMode)}>{dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></div></div><div className="grid two">{manualRules.map((rule) => { const station = data.stations.find((item) => item.id === rule.stationId); const selectedIds = manualAssignments[rule.stationId] || []; const candidates = manualCandidateMap.get(rule.stationId) || []; return <div className="panel" key={rule.stationId}><div className="panel-header"><h3>{station?.name || rule.stationId}</h3><span>需求 {rule.minRequired}</span></div><div className="chips">{selectedIds.length ? selectedIds.map((id) => { const person = data.people.find((item) => item.id === id); return <span className="chip" key={id}>{person?.name || id}</span>; }) : <span className="muted">尚未安排</span>}</div><div className="list-scroll short">{candidates.map((person) => { const active = selectedIds.includes(person.id); return <button key={person.id} className={active ? "list-row active" : "list-row"} onClick={() => toggleManualAssignment(rule.stationId, person.id)}><strong>{person.name}</strong><span>{person.id}｜{getTeamOfPerson(person)}｜{person.nationality}</span></button>; })}</div></div>; })}</div><div className="panel"><h3>安排後總站點樣式</h3><table className="table"><thead><tr><th>站點</th><th>已安排人數</th><th>缺口</th><th>安排名單</th></tr></thead><tbody>{manualRules.map((rule) => { const station = data.stations.find((item) => item.id === rule.stationId); const ids = manualAssignments[rule.stationId] || []; const names = ids.map((id) => data.people.find((person) => person.id === id)?.name || id); return <tr key={rule.stationId}><td>{station?.name || rule.stationId}</td><td>{ids.length}</td><td>{Math.max(0, rule.minRequired - ids.length)}</td><td>{names.join("、") || "-"}</td></tr>; })}</tbody></table></div>
          </Layout>
        ) : null}

        {currentRole && page === "station-rules" && hasAccess("主任") ? (
          <Layout title="站點規則設定" subtitle="修改後立即存取，不需要手動按儲存。"><div className="panel"><table className="table"><thead><tr><th>站點</th><th>正班最低</th><th>輪休單批最低</th><th>優先序</th><th>必站</th><th>備援目標</th></tr></thead><tbody>{data.stations.map((station) => <tr key={station.id}><td>{station.name}</td><td><input className="cell-input" type="number" value={station.normalMin} onChange={(e) => handleUpdateStation(station, { normalMin: Number(e.target.value) })} /></td><td><input className="cell-input" type="number" value={station.reliefMinPerBatch} onChange={(e) => handleUpdateStation(station, { reliefMinPerBatch: Number(e.target.value) })} /></td><td><input className="cell-input" type="number" value={station.priority ?? 0} onChange={(e) => handleUpdateStation(station, { priority: Number(e.target.value) })} /></td><td><select className="cell-input" value={station.isMandatory ? "Y" : "N"} onChange={(e) => handleUpdateStation(station, { isMandatory: e.target.value === "Y" })}><option value="Y">Y</option><option value="N">N</option></select></td><td><input className="cell-input" type="number" value={station.backupTarget ?? 0} onChange={(e) => handleUpdateStation(station, { backupTarget: Number(e.target.value) })} /></td></tr>)}</tbody></table></div></Layout>
        ) : null}

        {currentRole && page === "people-management" && hasAccess("主任") ? (
          <Layout title="人員名單管理" subtitle="已新增搜尋框，修改後立即存取，不需要手動另存。"><div className="panel"><h3>新增人員</h3><div className="form-grid compact-form"><div><label className="field-label">工號</label><input value={newPersonForm.id} onChange={(e) => setNewPersonForm((c) => ({ ...c, id: e.target.value }))} /></div><div><label className="field-label">姓名</label><input value={newPersonForm.name} onChange={(e) => setNewPersonForm((c) => ({ ...c, name: e.target.value }))} /></div><div><label className="field-label">班別</label><select value={newPersonForm.shift} onChange={(e) => setNewPersonForm((c) => ({ ...c, shift: e.target.value }))}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><div><label className="field-label">角色</label><input value={newPersonForm.role} onChange={(e) => setNewPersonForm((c) => ({ ...c, role: e.target.value }))} /></div><div><label className="field-label">國籍</label><input value={newPersonForm.nationality} onChange={(e) => setNewPersonForm((c) => ({ ...c, nationality: e.target.value }))} /></div><div><label className="field-label">在職狀態</label><input value={newPersonForm.employmentStatus} onChange={(e) => setNewPersonForm((c) => ({ ...c, employmentStatus: e.target.value }))} /></div></div><div className="toolbar"><button className="primary" type="button" onClick={handleCreatePerson}>新增人員</button></div></div><div className="panel"><div className="toolbar"><input placeholder="快速搜尋工號、姓名、班別、職務" value={peopleSearchKeyword} onChange={(e) => setPeopleSearchKeyword(e.target.value)} /></div><table className="table"><thead><tr><th>工號</th><th>姓名</th><th>班別</th><th>角色</th><th>國籍</th><th>A1</th><th>A2</th><th>B1</th><th>B2</th><th>在職</th></tr></thead><tbody>{data.people.filter((person) => searchText([person.id, person.name, getTeamOfPerson(person), person.role], peopleSearchKeyword)).map((person) => <tr key={person.id}><td>{person.id}</td><td><input className="cell-input" value={person.name} onChange={(e) => handleUpdatePerson(person, { name: e.target.value })} /></td><td><input className="cell-input" value={getTeamOfPerson(person)} onChange={(e) => handleUpdatePerson(person, { shift: e.target.value })} /></td><td><input className="cell-input" value={person.role} onChange={(e) => handleUpdatePerson(person, { role: e.target.value })} /></td><td><input className="cell-input" value={person.nationality} onChange={(e) => handleUpdatePerson(person, { nationality: e.target.value })} /></td><td><input className="cell-input" value={person.aDay1 || ""} onChange={(e) => handleUpdatePerson(person, { aDay1: e.target.value, day1: e.target.value })} /></td><td><input className="cell-input" value={person.aDay2 || ""} onChange={(e) => handleUpdatePerson(person, { aDay2: e.target.value, day2: e.target.value })} /></td><td><input className="cell-input" value={person.bDay1 || ""} onChange={(e) => handleUpdatePerson(person, { bDay1: e.target.value })} /></td><td><input className="cell-input" value={person.bDay2 || ""} onChange={(e) => handleUpdatePerson(person, { bDay2: e.target.value })} /></td><td><input className="cell-input" value={person.employmentStatus} onChange={(e) => handleUpdatePerson(person, { employmentStatus: e.target.value })} /></td></tr>)}</tbody></table></div></Layout>
        ) : null}

        {currentRole && page === "smart-schedule" && hasAccess("主任") ? (
          <Layout title="智能試排" subtitle="一鍵邏輯：依班別/日別取得當班+支援候選池，依規則優先序排序站點，優先用當班人力，再用支援人力，並避免同人重複佔站。"><div className="panel"><div className="toolbar"><select value={smartShift} onChange={(e) => setSmartShift(e.target.value as TeamName)}>{TEAM_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><select value={smartDay} onChange={(e) => setSmartDay(e.target.value as ShiftMode)}>{dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select><button className="primary" type="button" onClick={runSmartPlan}>一鍵試排</button></div></div><div className="panel"><h3>安排後總站點樣式</h3><table className="table"><thead><tr><th>站點</th><th>需求</th><th>已安排</th><th>缺口</th><th>名單</th></tr></thead><tbody>{smartRules.map((rule) => { const station = data.stations.find((item) => item.id === rule.stationId); const ids = smartAssignments[rule.stationId] || []; const names = ids.map((id) => data.people.find((person) => person.id === id)?.name || id); return <tr key={rule.stationId}><td>{station?.name || rule.stationId}</td><td>{rule.minRequired}</td><td>{ids.length}</td><td>{Math.max(0, rule.minRequired - ids.length)}</td><td>{names.join("、") || "-"}</td></tr>; })}</tbody></table></div></Layout>
        ) : null}
      </main>
    </div>
  );
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
