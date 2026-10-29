import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fixture } from "./helpers/gasFixture.mjs";

// Actual GAS source with synthetic, in-memory Google services. Never a cloud deployment.
const f = fixture();
const root = resolve("dist-qa");
const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex < 0 ? 5181 : process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid loopback QA port");
let clock = Date.now();
f.advance(clock - Date.UTC(2026, 9, 23));
f.people.rows = [
  ["工號", "姓名", "班別", "職務", "備註", "國籍", "離職日"],
  ["P1001", "測試甲", "翊展班", "技術員", "", "本籍", "2027-01-01"],
  ["ROOT", "隔離測試管理員", "婷芬班", "主任", "", "本籍"],
  ["P1002", "測試乙", "翊展班", "技術員", "", "本籍", "2027-02-01"],
  ["P1003", "同名人員", "翊展班", "技術員", "", "本籍"],
  ["P1004", "測試丁", "翊展班", "技術員", "", "本籍"],
  ["P1005", "同名人員", "翊展班", "技術員", "", "本籍"],
  ["P1006", "測試站長", "翊展班", "站長", "", "本籍"],
  ["P1007", "測試領班", "翊展班", "領班", "", "本籍"],
];
f.sheets.get("02_站點主表").rows = [["站點代碼", "站點名稱", "最低人數", "輪休最低人數"], ["ST01", "測試站一", 2, 1], ["ST02", "測試站二", 2, 1]];
f.rules.rows = [["規則ID", "班別", "站點代碼", "最低需求", "輪休需求(單批)", "訓練可補位"], ["QA_A", "翊展班", "ST01", 2, 1, "Y"], ["QA_B", "翊展班", "ST02", 2, 1, "Y"]];
f.sheets.get("03_站點矩陣").rows = [["工號", "姓名", "班別", "職務", "備註", "ST01", "ST02"],
  ...f.people.rows.slice(1).map(row => [...row.slice(0, 5), "", ""])];
f.sheets.get("03_資格明細").rows = [["工號", "站點代碼", "資格狀態"],
  ["P1001", "ST01", "合格"], ["P1002", "ST01", "合格"], ["P1003", "ST02", "合格"], ["P1004", "ST02", "合格"],
  ["P1005", "ST02", "訓練中"], ["P1006", "ST01", "合格"], ["P1007", "ST01", "合格"]];
for (const [id, station, status] of f.sheets.get("03_資格明細").rows.slice(1)) {
  const row = f.sheets.get("03_站點矩陣").rows.find(row => row[0] === id);
  row[station === "ST01" ? 5 : 6] = status;
}
const workbookIndex = process.argv.indexOf("--workbook");
if (workbookIndex >= 0) {
  const privateRoot = await realpath(resolve("private-backups"));
  const input = await realpath(resolve(process.argv[workbookIndex + 1] || ""));
  if (!input.startsWith(privateRoot + sep)) throw new Error("QA data must remain in private-backups/");
  const snapshot = JSON.parse(await readFile(input, "utf8"));
  for (const name of ["01_人員主表", "02_站點主表", "03_站點矩陣", "03_資格明細", "04_站點規則"]) {
    if (!Array.isArray(snapshot.sheets?.[name])) throw new Error("Incomplete private workbook snapshot");
    f.sheets.get(name).rows = snapshot.sheets[name];
  }
  const employee = f.people.rows.find((row, i) => i > 1 && row[0] && row[1]);
  if (!employee) throw new Error("No QA identity available");
  for (const row of f.accounts.rows.slice(1)) row[0] = String(employee[0]);
} else {
  const admin = f.login("root", "synthetic-admin-password").sessionToken;
  f.write(admin, "updatePerson", { id: "ROOT", note: "本機合成資料" });
  f.post("updatePerson", { id: "ROOT", note: "stale", expectedRevision: 0 }, { sessionToken: admin, operationId: "OP_seed_conflict_00000001" });
}
let fault = "none";
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const controls = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>隔離故障測試</title><h1>本機 GAS 隔離測試</h1><p>僅使用記憶體合成資料，不會連接 Google Sheets。</p><form method="post" action="/__qa/fault"><button name="fault" value="responseLoss">下一筆寫入丟失回應</button><button name="fault" value="partial">下一筆新增人員部分失敗</button><button name="fault" value="conflict">下一筆寫入前發生外部修改</button><button name="fault" value="none">清除故障設定</button></form><p><a href="/ROSARIO/">開啟測試網站</a></p></html>`;
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    response.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/__qa") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(controls); return; }
    if (request.method === "POST" && ["/__qa/gas", "/__qa/fault"].includes(url.pathname)) {
      let content = "";
      for await (const chunk of request) { content += chunk; if (content.length > 150000) throw new Error("Request too large"); }
      if (url.pathname === "/__qa/fault") {
        const value = new URLSearchParams(content).get("fault");
        if (!["none", "responseLoss", "partial", "conflict"].includes(value)) throw new Error("Unknown fault");
        fault = value; response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(`<p>已設定：${value}</p><a href="/__qa">返回測試控制台</a>`); return;
      }
      const body = JSON.parse(content);
      f.advance(Date.now() - clock); clock = Date.now();
      const writing = !!body.operationId && body.action !== "operationStatus";
      const mode = writing ? fault : "none";
      if (writing) fault = "none";
      if (mode === "conflict") f.people.rows[1][4] = `external-${Date.now()}`;
      const deleteRow = f.people.deleteRow;
      if (mode === "partial") {
        f.sheets.get("03_站點矩陣").failNextWrite = true;
        f.people.deleteRow = () => { throw new Error("Synthetic rollback failure"); };
      }
      let result;
      try { result = JSON.parse(f.context.doPost({ postData: { contents: JSON.stringify(body) } })); }
      finally { f.people.deleteRow = deleteRow; }
      if (mode === "responseLoss") { response.destroy(); return; }
      response.setHeader("Content-Type", "application/json; charset=utf-8"); response.end(JSON.stringify(result)); return;
    }
    const relative = decodeURIComponent(url.pathname).replace(/^\/ROSARIO\//, "");
    const path = resolve(root, relative || "index.html");
    if (!path.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
    response.setHeader("Content-Type", types[extname(path)] || "application/octet-stream");
    response.end(await readFile(path));
  } catch { response.writeHead(400); response.end("Isolated QA request failed"); }
}).listen(port, "127.0.0.1", () => console.log(`Isolated actual-source GAS QA: http://127.0.0.1:${port}/ROSARIO/ (${workbookIndex >= 0 ? "private workbook; memory only" : "synthetic"})`));
