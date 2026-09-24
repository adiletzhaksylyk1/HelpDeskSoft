import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
for (const file of fs.readdirSync("backend/src/public/js")) {
  if (!file.endsWith(".js")) continue;
  const result = spawnSync(
    process.execPath,
    ["--check", path.join("backend/src/public/js", file)],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
const html = fs.readFileSync("backend/src/public/index.html", "utf8");
if (
  /\son(?:click|change|submit|load|error|focus|blur|input|keydown)\s*=/i.test(
    html,
  )
)
  throw new Error(
    "Inline executable handlers violate the Content Security Policy",
  );
