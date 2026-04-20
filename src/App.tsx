import { useEffect, useMemo, useState } from "react";
import Layout from "./components/Layout";
import {
  deleteQualification,
  fetchBootstrapData,
  updatePerson,
  updateStationRule,
  upsertQualification,
} from "./lib/api";
import { getStationCoverage, qualificationBadge, searchText } from "./lib/selectors";
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

const emptyBootstrap: AppBootstrap = {
  people: [],
  stations: [],
  qualifications: [],
};

const qualificationOptions: QualificationStatus[] = ["合格", "訓練中", "不可排", ""];
const dayOptions: ShiftMode[] = ["全部在職", "第一天", "第二天"];

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

function getShiftOptions(people: Person[]) {
  const values = Array.from(new Set(people.map((person) => person.shift).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "zh-Hant")
  );
  return ["全部班別", ...values];
}

function getEmployeeLabel(person?: Person) {
  if (!person) return "";
  return `${person.id}｜${person.name}`;
}

function getStationLabel(station?: Station) {
  if (!station) return "";
  return `${station.id}｜${station.name}`;
}

function buildQualifiedCandidateMap(
  qualifications: Qualification[],
  people: Person[],
  mode: ShiftMode,
  selectedShift: string
) {
  const activePeople = people.filter((person) => {
    if (person.employmentStatus !== "在職") return false;
    if (selectedShift !== "全部班別" && person.shift !== selectedShift) return false;
    if (mode === "第一天") return person.day1 === "Y";
    if (mode === "第二天") return person.day2 === "Y";
    return true;
  });

  const allowedIds = new Set(activePeople.map((person) => person.id));
  const map = new Map<string, Person[]>();

  for (const q of qualifications) {
    if (q.status !== "合格") continue;
    if (!allowedIds.has(q.employeeId)) continue;
    const person = activePeople.find((item) => item.id === q.employeeId);
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

function pickByLeastFlexibility(
  stations: Station[],
  people: Person[],
  qualifications: Qualification[],
  mode: ShiftMode,
  selectedShift: string
) {
  const activePeople = people.filter((person) => {
    if (person.employmentStatus !== "在職") return false;
    if (selectedShift !== "全部班別" && person.shift !== selectedShift) return false;
    if (mode === "第一天") return person.day1 === "Y";
    if (mode === "第二天") return person.day2 === "Y";
    return true;
  });

  const flexMap = new Map<string, number>();
  for (const person of activePeople) {
    const count = qualifications.filter(
      (q) => q.employeeId === person.id && q.status === "合格"
    ).length;
    flexMap.set(person.id, count);
  }

  const candidatesMap = buildQualifiedCandidateMap(qualifications, activePeople, "全部在職", "全部班別");
  const used = new Set<string>();
  const result: Record<string, string[]> = {};

  const orderedStations = [...stations].sort((a, b) => {
    const p = (a.priority ?? 999) - (b.priority ?? 999);
    return p || a.name.localeCompare(b.name, "zh-Hant");
  });

  for (const station of orderedStations) {
    const pool = [...(candidatesMap.get(station.id) || [])]
      .filter((person) => !used.has(person.id))
      .sort((a, b) => {
        const flex = (flexMap.get(a.id) || 0) - (flexMap.get(b.id) || 0);
        return flex || a.name.localeCompare(b.name, "zh-Hant");
      });

    const chosen = pool.slice(0, Math.max(0, station.normalMin));
    result[station.id] = chosen.map((person) => person.id);
    chosen.forEach((person) => used.add(person.id));
  }

  return result;
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

  const [reviewShift, setReviewShift] = useState("全部班別");
  const [reviewKeyword, setReviewKeyword] = useState("");
  const [reviewEmployeeId, setReviewEmployeeId] = useState("");
  const [reviewStationId, setReviewStationId] = useState("");
  const [reviewStatus, setReviewStatus] = useState<QualificationStatus>("合格");

  const [gapShift, setGapShift] = useState("全部班別");
  const [gapDay, setGapDay] = useState<ShiftMode>("全部在職");

  const [manualShift, setManualShift] = useState("全部班別");
  const [manualDay, setManualDay] = useState<ShiftMode>("全部在職");
  const [manualAssignments, setManualAssignments] = useState<Record<string, string[]>>({});

  const [smartShift, setSmartShift] = useState("全部班別");
  const [smartDay, setSmartDay] = useState<ShiftMode>("全部在職");
  const [smartAssignments, setSmartAssignments] = useState<Record<string, string[]>>({});

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

  useEffect(() => {
    fetchBootstrapData()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const shiftOptions = useMemo(() => getShiftOptions(data.people), [data.people]);

  const filteredPeople = useMemo(() => {
    return data.people.filter((person) =>
      searchText([person.id, person.name, person.shift, person.role, person.nationality], personKeyword)
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
      const matchShift = reviewShift === "全部班別" || person.shift === reviewShift;
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

  const candidateMapForManual = useMemo(
    () => buildQualifiedCandidateMap(data.qualifications, data.people, manualDay, manualShift),
    [data.people, data.qualifications, manualDay, manualShift]
  );

  const candidateMapForSmart = useMemo(
    () => buildQualifiedCandidateMap(data.qualifications, data.people, smartDay, smartShift),
    [data.people, data.qualifications, smartDay, smartShift]
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
      (person) =>
        person.id.toLowerCase() === normalized ||
        person.name.toLowerCase() === normalized
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

    setFlashMessage("站點考核已儲存。");
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
    setFlashMessage(`站點 ${station.name} 已更新。`);
  }

  async function handleUpdatePerson(person: Person, patch: Partial<Person>) {
    const next = { ...person, ...patch };
    await updatePerson(next);
    setData((current) => ({
      ...current,
      people: current.people.map((item) => (item.id === person.id ? next : item)),
    }));
    setFlashMessage(`人員 ${person.name} 已更新。`);
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
      shift: "",
      role: "技術員",
      nationality: "",
      day1: "Y",
      day2: "Y",
      employmentStatus: "在職",
      note: "",
    });
    setFlashMessage("人員已新增。");
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

  function randomizeSingleStation(stationId: string) {
    const station = data.stations.find((item) => item.id === stationId);
    if (!station) return;
    const pool = [...(candidateMapForSmart.get(stationId) || [])].sort(() => Math.random() - 0.5);
    setSmartAssignments((current) => ({
      ...current,
      [stationId]: pool.slice(0, Math.max(0, station.normalMin)).map((person) => person.id),
    }));
    setFlashMessage(`已隨機安排 ${station.name}。`);
  }

  function randomizeAllStations() {
    const used = new Set<string>();
    const next: Record<string, string[]> = {};
    const orderedStations = [...data.stations].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

    for (const station of orderedStations) {
      const pool = [...(candidateMapForSmart.get(station.id) || [])]
        .filter((person) => !used.has(person.id))
        .sort(() => Math.random() - 0.5);

      const chosen = pool.slice(0, Math.max(0, station.normalMin));
      next[station.id] = chosen.map((person) => person.id);
      chosen.forEach((person) => used.add(person.id));
    }

    setSmartAssignments(next);
    setFlashMessage("已完成一鍵智能試排。");
  }

  function leastFlexibilityAllStations() {
    setSmartAssignments(pickByLeastFlexibility(data.stations, data.people, data.qualifications, smartDay, smartShift));
    setFlashMessage("已完成低彈性優先試排。");
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
              <span>{currentUser.id}｜{normalizeRole(currentUser.role)}</span>
              <button className="ghost" type="button" onClick={logout}>
                登出
              </button>
            </div>
          ) : (
            <>
              <input
                placeholder="工號或姓名"
                value={loginForm.account}
                onChange={(e) => setLoginForm((current) => ({ ...current, account: e.target.value }))}
              />
              <input
                type="password"
                placeholder="密碼（前端暫為占位）"
                value={loginForm.password}
                onChange={(e) => setLoginForm((current) => ({ ...current, password: e.target.value }))}
              />
              <button className="primary" type="button" onClick={handleLogin}>
                登入
              </button>
              <small className="muted">
                已取消手動切角色。現階段用工號/姓名自動識別身分；正式版建議由後端驗證帳密與權限表。
              </small>
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
            <button type="button" className="flash-close" onClick={() => setFlash("")}>
              ×
            </button>
          </div>
        ) : null}

        {page === "home" ? (
          <Layout
            title="首頁"
            subtitle="第一塊為系統說明，第二塊為登入。未登入不顯示查詢與管理功能。"
          >
            <div className="grid three">
              <StatCard title="人員總數" value={String(data.people.length)} note="人員主檔" />
              <StatCard title="站點總數" value={String(data.stations.length)} note="站點主檔" />
              <StatCard title="資格筆數" value={String(data.qualifications.length)} note="站點資格" />
            </div>

            <div className="panel">
              <h3>系統定位</h3>
              <p>這是通用型檢測系統，提供幹部進行站點資格查詢、考核維護、缺口分析、站點試排與智能試排。</p>
            </div>

            <div className="panel">
              <h3>權限規則</h3>
              <ul>
                <li>未登入：只能看首頁。</li>
                <li>技術員：查詢人員資格、查詢站點人選。</li>
                <li>領班：可進行站點考核修改申請。</li>
                <li>組長：可進行站點缺口分析、站點試排。</li>
                <li>主任：可進行站點規則設定、人員名單管理、站點缺口、智能試排、站點試排。</li>
              </ul>
            </div>
          </Layout>
        ) : null}

        {!currentRole && page !== "home" ? (
          <Layout title="尚未登入" subtitle="請先登入後開啟對應功能。">
            <Empty text="系統已禁止手動切換角色，需先登入後才顯示查詢與管理選單。" />
          </Layout>
        ) : null}

        {currentRole && page === "person-query" ? (
          <Layout title="查詢人員資格" subtitle="可用工號、姓名、班別、角色與國籍查詢。已移除多餘的正式姓名清單。">
            <div className="grid two">
              <div className="panel">
                <div className="toolbar">
                  <input
                    placeholder="輸入工號、姓名、班別、角色、國籍"
                    value={personKeyword}
                    onChange={(e) => setPersonKeyword(e.target.value)}
                  />
                </div>
                <div className="list-scroll">
                  {filteredPeople.map((person) => (
                    <button
                      key={person.id}
                      className={selectedEmployee?.id === person.id ? "list-row active" : "list-row"}
                      onClick={() => setSelectedEmployeeId(person.id)}
                    >
                      <strong>{person.name}</strong>
                      <span>{person.id}｜{person.shift}｜{person.role}｜{person.nationality}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel">
                {selectedEmployee ? (
                  <>
                    <div className="detail-grid">
                      <Info label="工號" value={selectedEmployee.id} />
                      <Info label="班別" value={selectedEmployee.shift} />
                      <Info label="角色" value={selectedEmployee.role} />
                      <Info label="國籍" value={selectedEmployee.nationality} />
                      <Info label="第一天" value={selectedEmployee.day1} />
                      <Info label="第二天" value={selectedEmployee.day2} />
                    </div>

                    <table className="table">
                      <thead>
                        <tr>
                          <th>站點</th>
                          <th>狀態</th>
                        </tr>
                      </thead>
                      <tbody>
                        {employeeQualifications.map((item) => (
                          <tr key={`${item.employeeId}-${item.stationId}`}>
                            <td>{item.stationId}</td>
                            <td><span className={qualificationBadge(item.status)}>{item.status || "空白"}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <Empty text="找不到符合條件的人員。" />
                )}
              </div>
            </div>
          </Layout>
        ) : null}

        {currentRole && page === "station-query" ? (
          <Layout title="查詢站點人選" subtitle="可查看各站符合資格的人員，已移除多餘的唯一主鍵欄位。">
            <div className="grid two">
              <div className="panel">
                <div className="toolbar">
                  <input
                    placeholder="輸入站點代碼、名稱、說明"
                    value={stationKeyword}
                    onChange={(e) => setStationKeyword(e.target.value)}
                  />
                </div>
                <div className="list-scroll">
                  {filteredStations.map((station) => (
                    <button
                      key={station.id}
                      className={selectedStation?.id === station.id ? "list-row active" : "list-row"}
                      onClick={() => setSelectedStationId(station.id)}
                    >
                      <strong>{station.name}</strong>
                      <span>最低人數 {station.normalMin}｜優先序 {station.priority ?? "-"}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel">
                {selectedStation ? (
                  <>
                    <div className="detail-grid">
                      <Info label="站點代碼" value={selectedStation.id} />
                      <Info label="站點名稱" value={selectedStation.name} />
                      <Info label="正班最低" value={String(selectedStation.normalMin)} />
                      <Info label="輪休單批最低" value={String(selectedStation.reliefMinPerBatch)} />
                      <Info label="優先序" value={String(selectedStation.priority ?? "")} />
                      <Info label="備援目標" value={String(selectedStation.backupTarget ?? "")} />
                    </div>

                    <table className="table">
                      <thead>
                        <tr>
                          <th>工號</th>
                          <th>姓名</th>
                          <th>班別</th>
                          <th>資格</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stationQualifications.map((item) => {
                          const person = data.people.find((person) => person.id === item.employeeId);
                          return (
                            <tr key={`${item.employeeId}-${item.stationId}`}>
                              <td>{item.employeeId}</td>
                              <td>{person?.name || item.employeeName || "-"}</td>
                              <td>{person?.shift || "-"}</td>
                              <td><span className={qualificationBadge(item.status)}>{item.status || "空白"}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <Empty text="找不到符合條件的站點。" />
                )}
              </div>
            </div>
          </Layout>
        ) : null}

        {currentRole && page === "qualification-review" && hasAccess("領班") ? (
          <Layout
            title="站點考核"
            subtitle="人員可輸入工號或姓名搜尋，並可先以班別篩選後顯示該班人員站點。"
          >
            <div className="grid two">
              <div className="panel">
                <div className="toolbar">
                  <select value={reviewShift} onChange={(e) => setReviewShift(e.target.value)}>
                    {shiftOptions.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                  <input
                    placeholder="輸入工號或姓名"
                    value={reviewKeyword}
                    onChange={(e) => setReviewKeyword(e.target.value)}
                  />
                </div>

                <div className="list-scroll">
                  {reviewPeople.map((person) => (
                    <button
                      key={person.id}
                      className={reviewSelectedPerson?.id === person.id ? "list-row active" : "list-row"}
                      onClick={() => {
                        setReviewEmployeeId(person.id);
                        setReviewKeyword(getEmployeeLabel(person));
                      }}
                    >
                      <strong>{person.name}</strong>
                      <span>{person.id}｜{person.shift}｜{person.role}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel">
                <div className="detail-grid">
                  <Info label="工號" value={reviewSelectedPerson?.id || ""} />
                  <Info label="姓名" value={reviewSelectedPerson?.name || ""} />
                  <Info label="班別" value={reviewSelectedPerson?.shift || ""} />
                  <Info label="角色" value={reviewSelectedPerson?.role || ""} />
                  <Info label="第一天" value={reviewSelectedPerson?.day1 || ""} />
                  <Info label="第二天" value={reviewSelectedPerson?.day2 || ""} />
                </div>

                <div className="form-grid compact-form">
                  <div>
                    <label className="field-label">人員</label>
                    <input
                      value={reviewKeyword}
                      placeholder="輸入工號或姓名"
                      onChange={(e) => {
                        const value = e.target.value;
                        setReviewKeyword(value);
                        const matched = data.people.find(
                          (person) =>
                            person.id.toLowerCase() === value.trim().toLowerCase() ||
                            person.name.toLowerCase() === value.trim().toLowerCase()
                        );
                        if (matched) {
                          setReviewEmployeeId(matched.id);
                        }
                      }}
                    />
                  </div>
                  <div>
                    <label className="field-label">站點</label>
                    <select value={reviewStationId} onChange={(e) => setReviewStationId(e.target.value)}>
                      <option value="">請選擇站點</option>
                      {data.stations.map((station) => (
                        <option key={station.id} value={station.id}>{getStationLabel(station)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">狀態</label>
                    <select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value as QualificationStatus)}>
                      {qualificationOptions.map((item) => (
                        <option key={item || "blank"} value={item}>{item || "空白"}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="toolbar">
                  <button className="primary" type="button" onClick={handleSaveQualification}>儲存站點考核</button>
                </div>

                <table className="table">
                  <thead>
                    <tr>
                      <th>站點</th>
                      <th>狀態</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.qualifications
                      .filter((item) => item.employeeId === reviewSelectedPerson?.id)
                      .map((item) => (
                        <tr key={`${item.employeeId}-${item.stationId}`}>
                          <td>{item.stationId}</td>
                          <td><span className={qualificationBadge(item.status)}>{item.status || "空白"}</span></td>
                          <td>
                            <button
                              className="danger"
                              type="button"
                              onClick={() => handleDeleteQualification(item.employeeId, item.stationId)}
                            >
                              刪除
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Layout>
        ) : null}

        {currentRole && page === "station-rules" && hasAccess("主任") ? (
          <Layout title="站點規則設定" subtitle="已移除唯一主鍵欄位，並縮小欄位寬度避免壓縮。">
            <div className="panel">
              <table className="table">
                <thead>
                  <tr>
                    <th>站點</th>
                    <th>正班最低</th>
                    <th>輪休單批最低</th>
                    <th>優先序</th>
                    <th>必站</th>
                    <th>備援目標</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stations.map((station) => (
                    <tr key={station.id}>
                      <td>{station.name}</td>
                      <td><input className="cell-input" type="number" value={station.normalMin} onChange={(e) => handleUpdateStation(station, { normalMin: Number(e.target.value) })} /></td>
                      <td><input className="cell-input" type="number" value={station.reliefMinPerBatch} onChange={(e) => handleUpdateStation(station, { reliefMinPerBatch: Number(e.target.value) })} /></td>
                      <td><input className="cell-input" type="number" value={station.priority ?? 0} onChange={(e) => handleUpdateStation(station, { priority: Number(e.target.value) })} /></td>
                      <td>
                        <select className="cell-input" value={station.isMandatory ? "Y" : "N"} onChange={(e) => handleUpdateStation(station, { isMandatory: e.target.value === "Y" })}>
                          <option value="Y">Y</option>
                          <option value="N">N</option>
                        </select>
                      </td>
                      <td><input className="cell-input" type="number" value={station.backupTarget ?? 0} onChange={(e) => handleUpdateStation(station, { backupTarget: Number(e.target.value) })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Layout>
        ) : null}

        {currentRole && page === "people-management" && hasAccess("主任") ? (
          <Layout title="人員名單管理" subtitle="已移除唯一主鍵欄位，並補上新增人員功能。">
            <div className="panel">
              <h3>新增人員</h3>
              <div className="form-grid compact-form">
                <div><label className="field-label">工號</label><input value={newPersonForm.id} onChange={(e) => setNewPersonForm((current) => ({ ...current, id: e.target.value }))} /></div>
                <div><label className="field-label">姓名</label><input value={newPersonForm.name} onChange={(e) => setNewPersonForm((current) => ({ ...current, name: e.target.value }))} /></div>
                <div><label className="field-label">班別</label><input value={newPersonForm.shift} onChange={(e) => setNewPersonForm((current) => ({ ...current, shift: e.target.value }))} /></div>
                <div><label className="field-label">角色</label><input value={newPersonForm.role} onChange={(e) => setNewPersonForm((current) => ({ ...current, role: e.target.value }))} /></div>
                <div><label className="field-label">國籍</label><input value={newPersonForm.nationality} onChange={(e) => setNewPersonForm((current) => ({ ...current, nationality: e.target.value }))} /></div>
                <div><label className="field-label">在職狀態</label><input value={newPersonForm.employmentStatus} onChange={(e) => setNewPersonForm((current) => ({ ...current, employmentStatus: e.target.value }))} /></div>
                <div><label className="field-label">第一天</label><select value={newPersonForm.day1} onChange={(e) => setNewPersonForm((current) => ({ ...current, day1: e.target.value }))}><option value="Y">Y</option><option value="N">N</option></select></div>
                <div><label className="field-label">第二天</label><select value={newPersonForm.day2} onChange={(e) => setNewPersonForm((current) => ({ ...current, day2: e.target.value }))}><option value="Y">Y</option><option value="N">N</option></select></div>
                <div><label className="field-label">備註</label><input value={newPersonForm.note || ""} onChange={(e) => setNewPersonForm((current) => ({ ...current, note: e.target.value }))} /></div>
              </div>
              <div className="toolbar">
                <button className="primary" type="button" onClick={handleCreatePerson}>新增人員</button>
              </div>
            </div>

            <div className="panel">
              <table className="table">
                <thead>
                  <tr>
                    <th>工號</th>
                    <th>姓名</th>
                    <th>班別</th>
                    <th>角色</th>
                    <th>國籍</th>
                    <th>第一天</th>
                    <th>第二天</th>
                    <th>在職</th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((person) => (
                    <tr key={person.id}>
                      <td>{person.id}</td>
                      <td><input className="cell-input" value={person.name} onChange={(e) => handleUpdatePerson(person, { name: e.target.value })} /></td>
                      <td><input className="cell-input" value={person.shift} onChange={(e) => handleUpdatePerson(person, { shift: e.target.value })} /></td>
                      <td><input className="cell-input" value={person.role} onChange={(e) => handleUpdatePerson(person, { role: e.target.value })} /></td>
                      <td><input className="cell-input" value={person.nationality} onChange={(e) => handleUpdatePerson(person, { nationality: e.target.value })} /></td>
                      <td><select className="cell-input" value={person.day1} onChange={(e) => handleUpdatePerson(person, { day1: e.target.value })}><option value="Y">Y</option><option value="N">N</option></select></td>
                      <td><select className="cell-input" value={person.day2} onChange={(e) => handleUpdatePerson(person, { day2: e.target.value })}><option value="Y">Y</option><option value="N">N</option></select></td>
                      <td><input className="cell-input" value={person.employmentStatus} onChange={(e) => handleUpdatePerson(person, { employmentStatus: e.target.value })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Layout>
        ) : null}

        {currentRole && page === "gap-analysis" && hasAccess("組長") ? (
          <Layout title="站點缺口分析" subtitle="已加入班別清單 + 日別清單，依班別與日別分析人力缺口。">
            <div className="panel">
              <div className="toolbar">
                <select value={gapShift} onChange={(e) => setGapShift(e.target.value)}>
                  {shiftOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <select value={gapDay} onChange={(e) => setGapDay(e.target.value as ShiftMode)}>
                  {dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>

              <table className="table">
                <thead>
                  <tr>
                    <th>站點</th>
                    <th>合格</th>
                    <th>訓練中</th>
                    <th>不可排</th>
                    <th>正班最低</th>
                    <th>正班缺口</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stations.map((station) => {
                    const filteredPeopleForGap = data.people.filter((person) => {
                      if (gapShift !== "全部班別" && person.shift !== gapShift) return false;
                      return true;
                    });
                    const coverage = getStationCoverage(station, filteredPeopleForGap, data.qualifications, gapDay);
                    return (
                      <tr key={station.id}>
                        <td>{station.name}</td>
                        <td>{coverage.qualified}</td>
                        <td>{coverage.training}</td>
                        <td>{coverage.blocked}</td>
                        <td>{station.normalMin}</td>
                        <td>{coverage.normalGap}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Layout>
        ) : null}

        {currentRole && page === "manual-schedule" && hasAccess("組長") ? (
          <Layout title="站點試排" subtitle="可點選各站點符合資格名單，並同步展示安排結果總表。">
            <div className="panel">
              <div className="toolbar">
                <select value={manualShift} onChange={(e) => setManualShift(e.target.value)}>
                  {shiftOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <select value={manualDay} onChange={(e) => setManualDay(e.target.value as ShiftMode)}>
                  {dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
            </div>

            <div className="grid two">
              {data.stations.map((station) => {
                const selectedIds = manualAssignments[station.id] || [];
                const candidates = candidateMapForManual.get(station.id) || [];
                return (
                  <div className="panel" key={station.id}>
                    <div className="panel-header">
                      <h3>{station.name}</h3>
                      <span>需求 {station.normalMin}</span>
                    </div>
                    <div className="chips">
                      {selectedIds.length ? selectedIds.map((id) => {
                        const person = data.people.find((item) => item.id === id);
                        return <span className="chip" key={id}>{person?.name || id}</span>;
                      }) : <span className="muted">尚未安排</span>}
                    </div>
                    <div className="list-scroll short">
                      {candidates.map((person) => {
                        const active = selectedIds.includes(person.id);
                        return (
                          <button
                            key={person.id}
                            className={active ? "list-row active" : "list-row"}
                            onClick={() => toggleManualAssignment(station.id, person.id)}
                          >
                            <strong>{person.name}</strong>
                            <span>{person.id}｜{person.shift}｜{person.nationality}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="panel">
              <h3>安排後總站點樣式</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>站點</th>
                    <th>已安排人數</th>
                    <th>缺口</th>
                    <th>安排名單</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stations.map((station) => {
                    const ids = manualAssignments[station.id] || [];
                    const names = ids.map((id) => data.people.find((person) => person.id === id)?.name || id);
                    return (
                      <tr key={station.id}>
                        <td>{station.name}</td>
                        <td>{ids.length}</td>
                        <td>{Math.max(0, station.normalMin - ids.length)}</td>
                        <td>{names.join("、") || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Layout>
        ) : null}

        {currentRole && page === "smart-schedule" && hasAccess("主任") ? (
          <Layout title="智能試排" subtitle="可逐站隨機安排，也可一鍵試排，並展示安排後總表。">
            <div className="panel">
              <div className="toolbar">
                <select value={smartShift} onChange={(e) => setSmartShift(e.target.value)}>
                  {shiftOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <select value={smartDay} onChange={(e) => setSmartDay(e.target.value as ShiftMode)}>
                  {dayOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <button className="primary" type="button" onClick={randomizeAllStations}>一鍵隨機試排</button>
                <button className="ghost" type="button" onClick={leastFlexibilityAllStations}>一鍵低彈性優先</button>
              </div>
            </div>

            <div className="grid two">
              {data.stations.map((station) => {
                const ids = smartAssignments[station.id] || [];
                const names = ids.map((id) => data.people.find((person) => person.id === id)?.name || id);
                return (
                  <div className="panel" key={station.id}>
                    <div className="panel-header">
                      <h3>{station.name}</h3>
                      <button className="ghost" type="button" onClick={() => randomizeSingleStation(station.id)}>
                        隨機挑選
                      </button>
                    </div>
                    <div className="chips">
                      {names.length ? names.map((name) => <span className="chip" key={name}>{name}</span>) : <span className="muted">尚未安排</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="panel">
              <h3>安排後總站點樣式</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>站點</th>
                    <th>需求</th>
                    <th>已安排</th>
                    <th>缺口</th>
                    <th>名單</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stations.map((station) => {
                    const ids = smartAssignments[station.id] || [];
                    const names = ids.map((id) => data.people.find((person) => person.id === id)?.name || id);
                    return (
                      <tr key={station.id}>
                        <td>{station.name}</td>
                        <td>{station.normalMin}</td>
                        <td>{ids.length}</td>
                        <td>{Math.max(0, station.normalMin - ids.length)}</td>
                        <td>{names.join("、") || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
