import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function findTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? findTests(path) : /\.test\.(ts|mjs)$/.test(entry.name) ? [path] : [];
  });
}
const tests = [...findTests("src"), ...findTests("scripts")].sort();
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...process.argv.slice(2), ...tests], { stdio: "inherit" });
process.exit(result.status ?? 1);
