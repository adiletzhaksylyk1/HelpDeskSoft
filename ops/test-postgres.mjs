import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
// A full local installation supplies matching backup tools as well as the server.
if (process.env.PG_TEST_BIN) await import("./test-postgres-native.mjs");
// Disposable cluster under the workspace; no existing database is contacted.
const root = path.resolve("scratch");
fs.mkdirSync(root, { recursive: true });
const directory = fs.mkdtempSync(path.join(root, "postgres-"));
const port = await new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    const value = server.address().port;
    server.close(() => resolve(value));
  });
});
const password = crypto.randomBytes(24).toString("hex");
const server = new EmbeddedPostgres({
  databaseDir: directory,
  port,
  user: "postgres",
  password,
  persistent: true,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
let testExitCode = 1;
try {
  await server.initialise();
  await server.start();
  await server.createDatabase("helpdesk_test");
  const env = {
    ...process.env,
    PG_TEST_BIN:
      process.env.PG_TEST_BIN ||
      path.dirname(
        (
          await import(
            "@embedded-postgres/" +
              (process.platform === "win32" ? "windows" : process.platform) +
              "-" +
              process.arch
          )
        ).postgres,
      ),
    TEST_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/helpdesk_test`,
  };
  if (
    !fs.existsSync(
      path.join(
        env.PG_TEST_BIN,
        "pg_dump" + (process.platform === "win32" ? ".exe" : ""),
      ),
    )
  )
    env.PG_TEST_SKIP_BACKUP = "1";
  testExitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "tests/postgres.integration.test.ts",
      ],
      { env, stdio: "inherit" },
    );
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", reject);
  });
} finally {
  await server.stop();
}
process.exit(testExitCode);
