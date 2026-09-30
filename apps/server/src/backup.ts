// バックアップ（NFR-6）。コンテナの中で動かし、DB の写しとアップロード領域を tar.gz にして標準出力に書く。
//   docker compose exec -T app node dist/backup.js > backup.tar.gz
// DB はサーバを止めずに VACUUM INTO で一貫した写しを作る。書き込み中のファイルをそのまま写すと壊れた写しになりうるため。
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { loadConfig } from "./config.js";

const config = loadConfig();
const work = mkdtempSync(path.join(tmpdir(), "wifi-planner-backup-"));
// まだ何もアップロードしていなくても固められるよう、アップロード領域を作っておく
mkdirSync(path.join(config.dataDir, "uploads"), { recursive: true });
try {
  const snapshot = path.join(work, "app.db");
  const client = createClient({ url: `file:${path.join(config.dataDir, "app.db")}` });
  await client.execute({ sql: "VACUUM INTO ?", args: [snapshot] });
  client.close();
  const code = await new Promise<number>((resolve, reject) => {
    const tar = spawn("tar", ["-czf", "-", "-C", work, "app.db", "-C", config.dataDir, "uploads"], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    tar.on("error", reject);
    tar.on("close", (c) => resolve(c ?? 1));
  });
  process.exitCode = code;
} finally {
  rmSync(work, { recursive: true, force: true });
}
