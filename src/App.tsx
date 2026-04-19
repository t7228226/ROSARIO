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
  "一般幹部": 1,
  "領班": 2,
  "組長": 3,
};

const emptyBootstrap: AppBootstrap = {
  people: [],
  stations: [],
  qualifications: [],
};

const qualificationOptions: QualificationStatus[] = ["合格", "訓練中", "不可排", ""];

export default function App() {
  const [data, setData] = useState<AppBootstrap>(emptyBootstrap);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<PageKey>("home");
  const [role, setRole] = useState<UserRole>("組長");
  const [mode, setMode] = useState<ShiftMode>("第一天");

  const [personKeyword, setPersonKeyword] = useState("");
  const [stationKeyword, setStationKeyword] = useState("");

  const [reviewForm, setReviewForm] = useState<Qualification>({
    employeeId: "",
    stationId: "",
    status: "合格",
  });

  const [selectedStationId, setSelectedStationId] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchBootstrapData()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

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
      searchText([station.id, station.name, station.description], stationKeyword)
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
    () => buildSmartAssignments(data.stations, data.people, data.qualifications, mode),
    [data.stations, data.people, data.qualifications, mode]
  );

  function setFlash(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2500);
  }

  async function handleSaveQualification() {
    const employee = data.people.find((person) => person.id === reviewForm.employeeId);
    const station = data.stations.find((item) => item.id === reviewForm.stationId);

    if (!employee) {
      setFlash("找不到人員，請先選擇正確工號。");
      return;
    }
    if (!station) {
      setFlash("找不到站點，請先選擇正確站點。");
      return;
    }

    const duplicate = data.qualifications.find(
      (item) =>
        item.employeeId === reviewForm.employeeId &&
        item.stationId === reviewForm.stationId
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

    setFlash(duplicate ? "資格已更新。" : "資格已新增。");
  }

  async function handleDeleteQualification(employeeId: string, stationId: string) {
    await deleteQualification({ employeeId, stationId });
    setData((current) => ({
      ...current,
      qualifications: current.qualifications.filter(
        (item) => !(item.employeeId === employeeId && item.stationId === stationId)
      ),
    }));
    setFlash("資格已刪除。");
  }

  async function handleUpdateStation(station: Station, patch: Partial<Station>) {
    const next = { ...station, ...patch };
    await updateStationRule(next);
    setData((current) => ({
      ...current,
      stations: current.stations.map((item) => (item.id === station.id ? next : item)),
    }));
    setFlash(`站點 ${station.id} 已更新。`);
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

  const navItems: Array<{ key: PageKey; label: string; minRole: UserRole }> = [
    { key: "home", label: "首頁", minRole: "一般幹部" },
    { key: "person-query", label: "查詢人員資格", minRole: "一般幹部" },
    { key: "station-query", label: "查詢站點人選", minRole: "一般幹部" },
    { key: "qualification-review", label: "考核確認", minRole: "領班" },
    { key: "station-rules", label: "站點規則設定", minRole: "組長" },
    { key: "people-management", label: "人員名單管理", minRole: "組長" },
    { key: "gap-analysis", label: "站點缺口分析", minRole: "組長" },
    { key: "manual-schedule", label: "站點試排", minRole: "組長" },
    { key: "smart-schedule", label: "智能試排", minRole: "組長" },
  ];

  const allowedNav = navItems.filter((item) => roleRank[role] >= roleRank[item.minRole]);

  if (loading) {
    return <div className="app-shell loading">資料載入中...</div>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <div className="brand-kicker">通用型站點資格系統</div>
          <h1>站點資格管理 App</h1>
          <p>從 B 班 Excel 升級成可供其他班共用的網頁版。</p>
        </div>

        <div className="control-card">
          <label>目前角色</label>
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="一般幹部">一般幹部</option>
            <option value="領班">領班</option>
            <option value="組長">組長</option>
          </select>

          <label>分析模式</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as ShiftMode)}>
            <option value="B班">B班</option>
            <option value="第一天">第一天</option>
            <option value="第二天">第二天</option>
          </select>
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
          <Layout
            title="首頁"
            subtitle="只放幹部常用功能，管理功能另外收斂到管理區，避免首頁越做越亂。"
          >
            <div className="grid three">
              <StatCard title="人員總數" value={String(data.people.length)} note="主檔人數" />
              <StatCard title="站點總數" value={String(data.stations.length)} note="站點主檔" />
              <StatCard title="資格筆數" value={String(data.qualifications.length)} note="人員站點資格" />
            </div>

            <div className="grid three">
              <ActionCard title="查詢人員資格" desc="查某人會哪些站點、看班別、職務、第一天與第二天。" onClick={() => setPage("person-query")} />
              <ActionCard title="查詢站點人選" desc="查某站有哪些相關人員，區分合格、訓練中、不可排。" onClick={() => setPage("station-query")} />
              <ActionCard title="考核確認" desc="新增、修改、刪除資格紀錄，並防止重複新增。" onClick={() => setPage("qualification-review")} />
            </div>
          </Layout>
        ) : null}

        {page === "person-query" ? (
          <Layout title="查詢人員資格" subtitle="先找人，再看此人目前會哪些站點與資格狀態。">
            <div className="toolbar">
              <input
                placeholder="輸入工號、姓名、班別、職務"
                value={personKeyword}
                onChange={(e) => setPersonKeyword(e.target.value)}
              />
            </div>

            <div className="grid two">
              <div className="panel">
                <h3>人員清單</h3>
                <div className="list-scroll">
                  {filteredPeople.map((person) => (
                    <button
                      key={person.id}
                      className={selectedEmployee?.id === person.id ? "list-row active" : "list-row"}
                      onClick={() => setSelectedEmployeeId(person.id)}
                    >
                      <strong>{person.name}</strong>
                      <span>{person.id} · {person.shift} · {person.role}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel">
                {selectedEmployee ? (
                  <>
                    <h3>{selectedEmployee.name}</h3>
                    <div className="detail-grid">
                      <Info label="工號" value={selectedEmployee.id} />
                      <Info label="班別" value={selectedEmployee.shift} />
                      <Info label="職務" value={selectedEmployee.role} />
                      <Info label="國籍" value={selectedEmployee.nationality} />
                      <Info label="第一天" value={selectedEmployee.day1} />
                      <Info label="第二天" value={selectedEmployee.day2} />
                      <Info label="在職" value={selectedEmployee.employmentStatus} />
                    </div>

                    <h4>資格清單</h4>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>站點</th>
                          <th>狀態</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(qualificationByEmployee[selectedEmployee.id] || [])
                          .sort((a, b) => a.stationId.localeCompare(b.stationId, "zh-Hant"))
                          .map((item) => (
                            <tr key={`${item.employeeId}-${item.stationId}`}>
                              <td>{item.stationId}</td>
                              <td><span className={qualificationBadge(item.status)}>{item.status || "留白"}</span></td>
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

        {page === "station-query" ? (
          <Layout title="查詢站點人選" subtitle="站點頁要像管理查詢頁，不是原始資料附帶頁。">
            <div className="toolbar">
              <input
                placeholder="輸入站點名稱"
                value={stationKeyword}
                onChange={(e) => setStationKeyword(e.target.value)}
              />
            </div>

            <div className="grid two">
              <div className="panel">
                <h3>站點清單</h3>
                <div className="list-scroll">
                  {filteredStations.map((station) => (
                    <button
                      key={station.id}
                      className={selectedStation?.id === station.id ? "list-row active" : "list-row"}
                      onClick={() => setSelectedStationId(station.id)}
                    >
                      <strong>{station.name}</strong>
                      <span>正班最低 {station.normalMin} / 輪休單批 {station.reliefMinPerBatch}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel">
                {selectedStation ? (
                  <>
                    <h3>{selectedStation.name}</h3>
                    <div className="detail-grid">
                      <Info label="正班最低" value={String(selectedStation.normalMin)} />
                      <Info label="輪休單批最低" value={String(selectedStation.reliefMinPerBatch)} />
                      <Info label="排班優先序" value={String(selectedStation.priority ?? "-")} />
                      <Info label="是否必站" value={selectedStation.isMandatory ? "Y" : "N"} />
                    </div>

                    <table className="table">
                      <thead>
                        <tr>
                          <th>姓名</th>
                          <th>班別</th>
                          <th>職務</th>
                          <th>狀態</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(qualificationByStation[selectedStation.id] || [])
                          .map((q) => {
                            const person = data.people.find((item) => item.id === q.employeeId);
                            return { q, person };
                          })
                          .filter((row) => row.person)
                          .sort((a, b) => a.person!.name.localeCompare(b.person!.name, "zh-Hant"))
                          .map(({ q, person }) => (
                            <tr key={`${q.employeeId}-${q.stationId}`}>
                              <td>{person!.name}</td>
                              <td>{person!.shift}</td>
                              <td>{person!.role}</td>
                              <td><span className={qualificationBadge(q.status)}>{q.status || "留白"}</span></td>
                            </tr>
                          ))}
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

        {page === "qualification-review" ? (
          <Layout title="考核確認" subtitle="維護人員站點資格，可新增、修改、刪除資格。">
            {roleRank[role] < roleRank["領班"] ? (
              <Empty text="目前角色無法使用考核確認。" />
            ) : (
              <>
                <div className="panel">
                  <h3>新增或修改資格</h3>
                  <div className="form-grid">
                    <div>
                      <label>人員</label>
                      <select
                        value={reviewForm.employeeId}
                        onChange={(e) => setReviewForm((current) => ({ ...current, employeeId: e.target.value }))}
                      >
                        <option value="">請選擇</option>
                        {data.people.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name} ({person.id})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label>站點</label>
                      <select
                        value={reviewForm.stationId}
                        onChange={(e) => setReviewForm((current) => ({ ...current, stationId: e.target.value }))}
                      >
                        <option value="">請選擇</option>
                        {data.stations.map((station) => (
                          <option key={station.id} value={station.id}>
                            {station.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label>資格狀態</label>
                      <select
                        value={reviewForm.status}
                        onChange={(e) => setReviewForm((current) => ({ ...current, status: e.target.value as QualificationStatus }))}
                      >
                        {qualificationOptions.map((status) => (
                          <option key={status || "blank"} value={status}>
                            {status || "留白"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="toolbar">
                    <button className="primary" onClick={handleSaveQualification}>儲存資格</button>
                  </div>
                </div>

                <div className="panel">
                  <h3>資格明細</h3>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>工號</th>
                        <th>姓名</th>
                        <th>站點</th>
                        <th>狀態</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.qualifications
                        .slice()
                        .sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.stationId.localeCompare(b.stationId, "zh-Hant"))
                        .map((item) => (
                          <tr key={`${item.employeeId}-${item.stationId}`}>
                            <td>{item.employeeId}</td>
                            <td>{item.employeeName || data.people.find((person) => person.id === item.employeeId)?.name || "-"}</td>
                            <td>{item.stationId}</td>
                            <td><span className={qualificationBadge(item.status)}>{item.status || "留白"}</span></td>
                            <td>
                              <button
                                className="danger ghost"
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
              </>
            )}
          </Layout>
        ) : null}

        {page === "station-rules" ? (
          <Layout title="站點規則設定" subtitle="缺口分析、試排、智能試排的底層規則來源。">
            {roleRank[role] < roleRank["組長"] ? (
              <Empty text="目前角色無法使用管理功能。" />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>站點</th>
                    <th>正班最低</th>
                    <th>輪休單批最低</th>
                    <th>排班優先序</th>
                    <th>是否必站</th>
                    <th>備援目標</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stations.map((station) => (
                    <tr key={station.id}>
                      <td>{station.id}</td>
                      <td><input type="number" value={station.normalMin} onChange={(e) => handleUpdateStation(station, { normalMin: Number(e.target.value) })} /></td>
                      <td><input type="number" value={station.reliefMinPerBatch} onChange={(e) => handleUpdateStation(station, { reliefMinPerBatch: Number(e.target.value) })} /></td>
                      <td><input type="number" value={station.priority ?? 0} onChange={(e) => handleUpdateStation(station, { priority: Number(e.target.value) })} /></td>
                      <td>
                        <select value={station.isMandatory ? "Y" : "N"} onChange={(e) => handleUpdateStation(station, { isMandatory: e.target.value === "Y" })}>
                          <option value="Y">Y</option>
                          <option value="N">N</option>
                        </select>
                      </td>
                      <td><input type="number" value={station.backupTarget ?? 0} onChange={(e) => handleUpdateStation(station, { backupTarget: Number(e.target.value) })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Layout>
        ) : null}

        {page === "people-management" ? (
          <Layout title="人員名單管理" subtitle="處理在職、班別、職務、日別與基本資料。">
            {roleRank[role] < roleRank["組長"] ? (
              <Empty text="目前角色無法使用管理功能。" />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>工號</th>
                    <th>姓名</th>
                    <th>班別</th>
                    <th>職務</th>
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
                      <td>{person.name}</td>
                      <td><input value={person.shift} onChange={(e) => handleUpdatePerson(person, { shift: e.target.value })} /></td>
                      <td><input value={person.role} onChange={(e) => handleUpdatePerson(person, { role: e.target.value })} /></td>
                      <td><input value={person.nationality} onChange={(e) => handleUpdatePerson(person, { nationality: e.target.value })} /></td>
                      <td>
                        <select value={person.day1} onChange={(e) => handleUpdatePerson(person, { day1: e.target.value })}>
                          <option value="Y">Y</option>
                          <option value="N">N</option>
                        </select>
                      </td>
                      <td>
                        <select value={person.day2} onChange={(e) => handleUpdatePerson(person, { day2: e.target.value })}>
                          <option value="Y">Y</option>
                          <option value="N">N</option>
                        </select>
                      </td>
                      <td>
                        <select value={person.employmentStatus} onChange={(e) => handleUpdatePerson(person, { employmentStatus: e.target.value })}>
                          <option value="在職">在職</option>
                          <option value="離職">離職</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Layout>
        ) : null}

        {page === "gap-analysis" ? (
          <Layout title="站點缺口分析" subtitle="不綁死 B 班，改成可選 B班 / 第一天 / 第二天。">
            {roleRank[role] < roleRank["組長"] ? (
              <Empty text="目前角色無法使用管理功能。" />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>站點</th>
                    <th>合格</th>
                    <th>訓練中</th>
                    <th>不可排</th>
                    <th>正班缺口</th>
                    <th>輪休安全需求</th>
                    <th>輪休缺口</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stations.map((station) => {
                    const coverage = getStationCoverage(station, data.people, data.qualifications, mode);
                    return (
                      <tr key={station.id}>
                        <td>{station.id}</td>
                        <td>{coverage.qualified}</td>
                        <td>{coverage.training}</td>
                        <td>{coverage.blocked}</td>
                        <td>{coverage.normalGap}</td>
                        <td>{coverage.reliefSafeNeed}</td>
                        <td>{coverage.reliefGap}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Layout>
        ) : null}

        {page === "manual-schedule" ? (
          <Layout title="站點試排" subtitle="先做手動模擬排站，再進一步升級智能建議。">
            {roleRank[role] < roleRank["組長"] ? (
              <Empty text="目前角色無法使用管理功能。" />
            ) : (
              <div className="grid two">
                {data.stations.map((station) => {
                  const qualifiedPeople = data.people.filter((person) =>
                    isPersonActiveInMode(person, mode) &&
                    data.qualifications.some(
                      (q) => q.employeeId === person.id && q.stationId === station.id && q.status === "合格"
                    )
                  );
                  return (
                    <div key={station.id} className="panel">
                      <h3>{station.id}</h3>
                      <p>需求 {station.normalMin} 人</p>
                      <div className="chips">
                        {qualifiedPeople.map((person) => (
                          <span key={person.id} className="chip">{person.name}</span>
                        ))}
                        {qualifiedPeople.length === 0 ? <span className="muted">目前無合格人員</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Layout>
        ) : null}

        {page === "smart-schedule" ? (
          <Layout title="智能試排" subtitle="依資格、班別、限制邏輯，先用排班優先序進行去重分派建議。">
            {roleRank[role] < roleRank["組長"] ? (
              <Empty text="目前角色無法使用管理功能。" />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>站點</th>
                    <th>需求</th>
                    <th>建議分派</th>
                    <th>缺口</th>
                  </tr>
                </thead>
                <tbody>
                  {smartAssignments.map((row) => (
                    <tr key={row.stationId}>
                      <td>{row.stationId}</td>
                      <td>{data.stations.find((station) => station.id === row.stationId)?.normalMin ?? 0}</td>
                      <td>{row.assigned.map((person) => person.name).join("、") || "—"}</td>
                      <td>{row.shortage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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

function ActionCard({ title, desc, onClick }: { title: string; desc: string; onClick: () => void }) {
  return (
    <button className="action-card" onClick={onClick}>
      <strong>{title}</strong>
      <p>{desc}</p>
    </button>
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
