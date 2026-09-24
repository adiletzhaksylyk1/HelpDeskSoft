import os from "node:os";
import path from "node:path";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.JWT_SECRET =
  "test-only-secret-for-isolated-regressions-0123456789abcdef";
process.env.SECRET_ENCRYPTION_KEY = "1".repeat(64);
process.env.STORAGE_DIR = path.join(
  os.tmpdir(),
  "helpdesk-test-storage-" + process.pid,
);
process.env.CORS_ORIGIN = "http://localhost:3000";
process.env.SMTP_HOST = "";
process.env.SMTP_USER = "";
