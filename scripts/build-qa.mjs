import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const result = spawnSync(process.execPath, [vite, "build", "--mode", "preview", "--outDir", "dist-qa"], {
  stdio: "inherit", env: { ...process.env, VITE_APP_ENV: "preview", VITE_ENABLE_WRITES: "true", VITE_GAS_API_URL: "/__qa/gas" },
});
if (result.error) throw result.error;
process.exitCode = result.status || 0;
