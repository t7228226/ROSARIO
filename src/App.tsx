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
  getStationCoverage,
  groupQualificationsByEmployee,
  groupQualificationsByStation,
  isPersonActiveInMode,
  qualificationBadge,
  searchText,
} from "./lib/selectors";
import type {
  AppBootstrap,
  Person,
  Qualification,
  QualificationStatus,
  ShiftMode,
  Station,
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

const roleRank: Record<UserRole, number> = {
  技術員: 1,
  領班: 2,
  組長: 3,
  主任: 4,
};

const emptyBootstrap: AppBootstrap = {
  people: [],
  stations: [],
  qualifications: [],
};

const qualificationOptions: QualificationStatus[] = ["合格", "訓練中", "不可排", ""];
const shiftModeOptions: ShiftMode[] = ["全部在職", "第一天", "第二天"];

function getShiftOptions(people: Person[]) {
  const values = Array.from(new Set(people.map((person) => person.shift).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "zh-Hant")
  );
  return ["全部班別", ...values];
}

function getStationLabel(stations: Station[], stationId: string) {
  return stations.find((station) => station.id === stationId)?.name || stationId;
}

export default function App() {
  const [data, setData] = useState<AppBootstrap>(emptyBootstrap);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<PageKey>("home");
  const [currentRole] = useState<UserRole | null>(null);
  const [loginForm, setLoginForm] = useState({ account: "", password: "" });

  const [personKeyword, setPersonKeyword] = useState("");
  const [stationKeyword, setStationKeyword] = useState("");
  const [analysisMode, setAnalysisMode] = useState<ShiftMode>("全部在職");
  const [gapShift, setGapShift] = useState("全部班別");
  const [gapDay, setGapDay] = useState<ShiftMode>("全部在職");

  const [reviewKeyword, setReviewKeyword] = useState("");
  const [reviewShift, setReviewShift] = useState("全部班別");
  const [reviewForm, setReviewForm] = useState<Qualification>({
    employeeId: "",
    stationId: "",
    status: "合格",
  });

  const [selectedStationId, setSelectedStationId] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [message, setMessage] = useState("");

  const [newPersonForm, setNewPersonForm] = useState<Person>({
    id: "",
    name: "",
    shift: "",
    role: "技術員",
    nationality: "",
    day1: "Y",
    day2: "Y",
    employmentStatus: "在職",
    note: "",
  });

  const [manualSelectedStationId, setManualSelectedStationId] = useState("");
  const [manualAssignments, setManualAssignments] = useState<Record<string, string[]>>({});
  const [smartAssignmentsDraft, setSmartAssignmentsDraft] = useState<Record<string, string[]>>({});

  useEffect(() => {
    fetchBootstrapData()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const shiftOptions = useMemo(() => getShiftOptions(data.people), [data.people]);

  const qualificationByEmployee = useMemo(
    () => groupQualificationsByEmployee(data.qualifications),
    [data.qualifications]
  );

  const qualificationByStation = useMemo(
    () => groupQualificationsByStation(data.qualifications),
    [data.qualifications]
  );

  const filteredPeople = useMemo(() => {
    return data.people.filter((person) =>
      searchText([person.id, person.name, person.shift, person.role, person.nationality], personKeyword)
    );
  }, [data.people, personKeyword]);

  const filteredStations = useMemo(() => {
    return data.stations.filter((station) =>
      searchText([station.name, station.description, station.note], stationKeyword)
    );
  }, [data.stations, stationKeyword]);

  const selectedEmployee = useMemo(
    () => data.people.find((person) => person.id === selectedEmployeeId) || filteredPeople[0],
    [data.people, filteredPeople, selectedEmployeeId]
  );

  const selectedStation = useMemo(
    () => data.stations.find((station) => station.id === selectedStationId) || filteredStations[0],
    [data.stations, filteredStations, selectedStationId]
  );

  const smartAssignments = useMemo(
    () => buildSmartAssignments(data.stations, data.people, data.qualifications, analysisMode),
    [data.stations, data.people, data.qualifications, analysisMode]
  );

  const reviewCandidates = useMemo(() => {
    return data.people.filter((person) => {
      const matchShift = reviewShift === "全部班別" || person.shift === reviewShift;
      const matchKeyword = searchText([person.id, person.name], reviewKeyword);
      return matchShift && matchKeyword;
    });
  }, [data.people, reviewKeyword, reviewShift]);

  const manualSelectedStation = useMemo(
    () => data.stations.find((station) => station.id === manualSelectedStationId) || data.stations[0],
    [data.stations, manualSelectedStationId]
  );

  const manualCandidates = useMemo(() => {
    if (!manualSelectedStation) return [];
    return data.people.filter(
      (person) =>
        isPersonActiveInMode(person, analysisMode) &&
        data.qualifications.some(
          (qualification) =>
            qualification.employeeId === person.id &&
            qualification.stationId === manualSelectedStation.id &&
            qualification.status === "合格"
        )
    );
  }, [analysisMode, data.people, data.qualifications, manualSelectedStation]);

  function hasAccess(minRole?: UserRole) {
    if (!minRole) return true;
    if (!currentRole) return false;
    return roleRank[currentRole] >= roleRank[minRole];
  }

  function setFlash(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2500);
  }

  function getPeopleForGap() {
    return data.people.filter((person) => {
      if (gapShift !== "全部班別" && person.shift !== gapShift) return false;
      return isPersonActiveInMode(person, gapDay);
    });
  }

  function getCandidatesForStation(stationId: string, mode: ShiftMode) {
    return data.people.filter(
      (person) =>
        isPersonActiveInMode(person, mode) &&
        data.qualifications.some(
          (qualification) =>
            qualification.employeeId === person.id &&
            qualification.stationId === stationId &&
            qualification.status === "合格"
        )
    );
  }

  async function handleSaveQualification() {
    const employee = data.people.find((person) => person.id === reviewForm.employeeId);
    const station = data.stations.find((item) => item.id === reviewForm.stationId);

    if (!employee) {
      setFlash("找不到人員，請先輸入正確工號或姓名後選取。");
      return;
    }
    if (!station) {
      setFlash("找不到站點，請先選擇正確站點。");
      return;
    }

    const duplicate = data.qualifications.find(
      (item) => item.employeeId === reviewForm.employeeId && item.stationId === reviewForm.stationId
    );

    const payload: Qualification = {
      employeeId: reviewForm.employeeId,
      employeeName: employee.name,
      stationId: reviewForm.stationId,
      status: reviewForm.status,
    };

    await upsertQualification(payload);

    setData((current) => ({
      ...current,
      qualifications: duplicate
        ? current.qualifications.map((item) =>
            item.employeeId === payload.employeeId && item.stationId === payload.stationId ? payload : item
          )
        : [...current.qualifications, payload],
    }));

    setFlash(duplicate ? "站點考核已更新。" : "站點考核已新增。");
  }

  async function handleDeleteQualification(employeeId: string, stationId: string) {
    await deleteQualification({ employeeId, stationId });
    setData((current) => ({
      ...current,
      qualifications: current.qualifications.filter(
        (item) => !(item.employeeId === employeeId && item.stationId === stationId)
      ),
    }));
    setFlash("站點考核已刪除。");
  }

  async function handleUpdateStation(station: Station, patch: Partial<Station>) {
    const next = { ...station, ...patch };
    await updateStationRule(next);
    setData((current) => ({
      ...current,
      stations: current.stations.map((item) => (item.id === station.id ? next : item)),
    }));
    setFlash(`站點 ${station.name} 已更新。`);
  }

  async function handleUpdatePerson(person: Person, patch: Partial<Person>) {
    const next = { ...person, ...patch };
    await updatePerson(next);
    setData((current) => ({
      ...current,
      people: current.people.map((item) => (item.id === person.id ? next : item)),
    }));
    setFlash(`人員 ${person.name} 已更新。`);
  }

  async function handleCreatePerson() {
    if (!newPersonForm.id || !newPersonForm.name) {
      setFlash("新增人員至少要填工號與姓名。");
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
      shift: "",
      role: "技術員",
      nationality: "",
      day1: "Y",
      day2: "Y",
      employmentStatus: "在職",
      note: "",
    });
    setFlash("人員已新增。若 API 端尚未支援新增，仍需補後端 upsert 機制。");
  }

  function toggleManualAssignment(stationId: string, employeeId: string) {
    setManualAssignments((current) => {
      const existing = current[stationId] || [];
      const next = existing.includes(employeeId)
        ? existing.filter((id) => id !== employeeId)
        : [...existing, employeeId];
      return { ...current, [stationId]: next };
    });
  }

  function randomizeSingleStation(stationId: string) {
    const station = data.stations.find((item) => item.id === stationId);
    if (!station) return;
    const shuffled = [...getCandidatesForStation(stationId, analysisMode)].sort(() => Math.random() - 0.5);
    setSmartAssignmentsDraft((current) => ({
      ...current,
      [stationId]: shuffled.slice(0, station.normalMin).map((person) => person.id),
    }));
  }

  function randomizeAllStations() {
    const used = new Set<string>();
    const next: Record<string, string[]> = {};
    for (const station of [...data.stations].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))) {
      const pool = getCandidatesForStation(station.id, analysisMode)
        .filter((person) => !used.has(person.id))
        .sort(() => Math.random() - 0.5)
        .slice(0, station.normalMin);
      next[station.id] = pool.map((person) => person.id);
      pool.forEach((person) => used.add(person.id));
    }
    setSmartAssignmentsDraft(next);
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
          <h1>通用型檢測系統</h1>
          <p>給幹部查詢與管理站點資格，整合首頁、查詢功能、管理功能與登入權限規劃。</p>
        </div>

        <div className="control-card">
          <label>登入系統</label>
          <input
            placeholder="帳號"
            value={loginForm.account}
            onChange={(e) => setLoginForm((current) => ({ ...current, account: e.target.value }))}
          />
          <input
            type="password"
            placeholder="密碼"
            value={loginForm.password}
            onChange={(e) => setLoginForm((current) => ({ ...current, password: e.target.value }))}
          />
          <button
            className="primary"
            type="button"
            onClick={() =>
              setFlash("目前尚未串接真正登入驗證。下一步需由 API 對接 05_角色權限 表並回傳角色。")
            }
          >
            登入
          </button>
          <small className="muted">未登入只能看首頁。登入後才應出現對應權限選項，前端不再提供手動切角色。</small>
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
        {message ? <div className="flash">{message}</div> : null}

        {page === "home" ? (
          <Layout title="首頁" subtitle="首頁第一塊放系統說明，第二塊放登入，未登入不顯示查詢與管理功能。">
            <div className="grid three">
              <StatCard title="人員總數" value={String(data.people.length)} note="主檔人數" />
              <StatCard title="站點總數" value={String(data.stations.length)} note="站點主檔" />
              <StatCard title="資格筆數" value={String(data.qualifications.length)} note="資格資料" />
            </div>

            <div className="panel">
              <h3>權限規則</h3>
              <ul>
                <li>未登入：只能看首頁。</li>
                <li>技術員：查詢人員資格、查詢站點人選。</li>
                <li>領班：可進行站點考核修改申請。</li>
                <li>組長：可做考核審核批閱、站點試排、站點缺口分析。</li>
                <li>主任：可做站點規則設定、人員名單管理、站點缺口、站點試排、智能試排。</li>
              </ul>
            </div>
          </Layout>
        ) : null}

        {!currentRole && page !== "home" ? (
          <Layout title="尚未登入" subtitle="請先完成登入驗證後，再開放對應功能。">
            <Empty text="目前已移除前端手動切角色。下一步要由 05_角色權限 + API 登入驗證回傳角色。" />
          </Layout>
        ) : null}
      </main>
    </div>
  );
}

function StatCard({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="stat-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-item">
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
