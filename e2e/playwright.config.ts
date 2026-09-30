import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = 3100;
const dataDir = mkdtempSync(path.join(process.env.E2E_TMPDIR ?? tmpdir(), "wifi-planner-e2e-"));
const root = path.resolve(import.meta.dirname, "..");

export const ADMIN = { username: "admin", password: "admin-password" };

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    // システムに入っている Chrome を使う
    channel: "chrome",
    locale: "ja-JP",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "pnpm --filter @wifi-planner/web build && pnpm --filter @wifi-planner/server exec tsx src/main.ts",
    cwd: root,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      DATA_DIR: dataDir,
      WEB_DIST: path.join(root, "apps/web/dist"),
      ADMIN_USERNAME: ADMIN.username,
      ADMIN_PASSWORD: ADMIN.password,
    },
  },
});
