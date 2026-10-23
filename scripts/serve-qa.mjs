import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

// Loopback-only synthetic UI harness. Never a deployment backend or security test.
const root = resolve("dist-qa");
const team = "翊展班";
const people = [
  ["QA001", "測試甲", "技術員"], ["QA002", "測試乙", "技術員"],
  ["QA003", "同名人員", "技術員"], ["QA004", "測試丁", "技術員"],
  ["QA005", "同名人員", "技術員"], ["QA006", "測試站長", "站長"],
  ["QA007", "測試領班", "領班"], ["QA008", "本機驗證", "主任"],
].map(([id, name, role]) => ({ id, name, role, shift: team, nationality: "本籍", employmentStatus: "在職", bDay1: "夜B", bDay2: "夜B" }));
const user = { ...people[7], isSuperAdmin: true, systemPermission: "最高權限" };
const qualifications = [
  ["QA001", "A"], ["QA002", "A"], ["QA003", "B"], ["QA004", "B"],
  ["QA006", "A"], ["QA007", "A"],
].map(([employeeId, stationId]) => ({ employeeId, stationId, status: "合格" }));
qualifications.push({ employeeId: "QA005", stationId: "B", status: "訓練中" });
const stations = ["A", "B"].map((id) => ({ id, name: `測試站 ${id}`, normalMin: 2, reliefMinPerBatch: 1 }));
const stationRules = stations.map((s) => ({ id: s.id, team, stationId: s.id, minRequired: 2, reliefMinPerBatch: 1, trainingCanFill: true, enabled: true }));
const drafts = [], details = [], operations = new Map();
let revision = 0;
function action(body) {
  const payload = body.payload || {};
  if (body.action === "login" || body.action === "session") return { ok: true, user, sessionToken: "SYNTHETIC_LOCAL_ONLY", sessionExpiresAt: Date.now() + 3600000 };
  if (body.action === "logout") return { ok: true };
  if (body.action === "bootstrap") return { ok: true, revision, people, qualifications, stations, stationRules, managementStationRules: stationRules, viewableRuleTeams: [team], editableRuleTeams: [team] };
  if (body.action === "permissionConfig") return { ok: true, permissionItems: [], rolePermissionMaps: [], personalPermissionExceptions: [] };
  if (body.action === "loadScheduleDrafts") return { ok: true, drafts, details, revision };
  if (body.action === "saveScheduleDraft") {
    if (operations.has(body.operationId)) return operations.get(body.operationId);
    if (payload.expectedRevision !== revision) return { ok: false, code: "REVISION_CONFLICT", message: "隔離測試資料版本已變更", revision };
    const id = `QA-DRAFT-${drafts.length + 1}`;
    drafts.push({ ...payload, id, updatedAt: new Date().toISOString() });
    details.push(...(payload.details || []).map((item) => ({ ...item, draftId: id })));
    const result = { ok: true, revision: ++revision, id };
    operations.set(body.operationId, result);
    return result;
  }
  return { ok: false, message: "隔離測試未提供此動作" };
}
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1:5180");
    response.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/__qa/gas" && request.method === "POST") {
      let content = "";
      for await (const chunk of request) { content += chunk; if (content.length > 100000) throw new Error("Request too large"); }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(action(JSON.parse(content))));
      return;
    }
    const relative = decodeURIComponent(url.pathname).replace(/^\/ROSARIO\//, "");
    const path = resolve(root, relative || "index.html");
    if (!path.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
    response.setHeader("Content-Type", types[extname(path)] || "application/octet-stream");
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end("Not found"); }
}).listen(5180, "127.0.0.1", () => console.log("Synthetic UI QA only: http://127.0.0.1:5180/ROSARIO/"));
