import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const compiler = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
for (const project of ["tsconfig.app.json", "tsconfig.node.json", "tsconfig.tests.json"]) {
  console.log(`Type checking ${project}`);
  const result = spawnSync(process.execPath, [compiler, "--project", project, "--noEmit"], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
