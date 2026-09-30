import { mkdirSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebSocketServer } from "ws";
import { createApp } from "./app.js";
import { ensureInitialAdmin } from "./bootstrap.js";
import { createCollab } from "./collab.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { dbDocStore } from "./docstore.js";
import { AccessEvents } from "./events.js";
import { BlobStore } from "./files/blobstore.js";
import { createRasterPool } from "./workers.js";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const db = await openDb(`file:${path.join(config.dataDir, "app.db")}`);
await ensureInitialAdmin(db, config.adminUsername, config.adminPassword);

const events = new AccessEvents();
const collab = createCollab({ db, docs: dbDocStore(db), events });
const blobs = new BlobStore(db, path.join(config.dataDir, "uploads"));
const raster = createRasterPool();
const app = createApp({ db, docs: collab.liveDocs, events, blobs, raster, config });
collab.mount(app);

if (config.webDist) {
  const root = config.webDist;
  app.use("/*", serveStatic({ root }));
  // SPA のルーティングのため、API 以外の未知のパスには index.html を返す
  app.get("*", serveStatic({ root, path: "index.html" }));
}

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
    websocket: { server: new WebSocketServer({ noServer: true }) },
  },
  (info) => console.log(`listening on http://localhost:${info.port}`),
);

// 停止時に、編集中の文書を保存してから終わる
const shutdown = async () => {
  await collab.storeAll();
  await raster.destroy();
  server.close();
  process.exit(0);
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
