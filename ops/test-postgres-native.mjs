import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
const bin = process.env.PG_TEST_BIN;
if (!bin)
  throw new Error(
    "Set PG_TEST_BIN to a PostgreSQL bin directory; a new isolated cluster will be created.",
  );
const command = (name) =>
  path.join(bin, name + (process.platform === "win32" ? ".exe" : ""));
const control = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command("pg_ctl"), args, {
      windowsHide: true,
      stdio: "ignore",
    });
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("pg_ctl failed with exit " + code)),
    );
    child.on("error", reject);
  });
const root = path.resolve("scratch");
fs.mkdirSync(root, { recursive: true });
const directory = fs.mkdtempSync(path.join(root, "native-postgres-"));
const passwordFile = directory + ".password",
  password = crypto.randomBytes(24).toString("hex");
fs.writeFileSync(passwordFile, password, { mode: 0o600 });
const port = await new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    const value = server.address().port;
    server.close(() => resolve(value));
  });
});
let started = false,
  code = 1;
try {
  await promisify(execFile)(
    command("initdb"),
    [
      "-D",
      directory,
      "-U",
      "postgres",
      "--pwfile=" + passwordFile,
      "--encoding=UTF8",
      "--locale=C",
      "--auth=scram-sha-256",
    ],
    { windowsHide: true },
  );
  await control([
    "-D",
    directory,
    "-l",
    path.join(directory, "server.log"),
    "-o",
    "-h 127.0.0.1 -p " + port,
    "-w",
    "start",
  ]);
  started = true;
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("CREATE DATABASE helpdesk_test");
  await client.end();
  const testUrl = new URL(url);
  testUrl.pathname = "/helpdesk_test";
  code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "tests/postgres.integration.test.ts",
      ],
      {
        env: { ...process.env, TEST_DATABASE_URL: testUrl.toString() },
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", reject);
  });
} finally {
  if (started) await control(["-D", directory, "-m", "fast", "-w", "stop"]);
  fs.unlinkSync(passwordFile);
  // Only the fresh directory captured above can be removed.
  if (path.dirname(path.resolve(directory)) !== root)
    throw new Error("Invalid cleanup target");
  fs.rmSync(directory, { recursive: true, force: true });
}
process.exit(code);
