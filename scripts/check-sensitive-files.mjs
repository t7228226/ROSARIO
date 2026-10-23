import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const unsafe = tracked.filter((file) => existsSync(file) && /\.(xlsx|xlsm|xlsb|xls|pem|key|har)$/i.test(file));
if (unsafe.length) throw new Error(`Sensitive source artifacts must remain outside the repository: ${unsafe.join(", ")}`);
console.log("Sensitive artifact guard passed.");
