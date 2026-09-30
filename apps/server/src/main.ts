import { mkdirSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { ensureInitialAdmin } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { dbDocStore } from "./docstore.js";
import { AccessEvents } from "./events.js";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const db = await openDb(`file:${path.join(config.dataDir, "app.db")}`);
await ensureInitialAdmin(db, config.adminUsername, config.adminPassword);

const events = new AccessEvents();
const docs = dbDocStore(db);
const app = createApp({ db, docs, events, config });

if (config.webDist) {
  const root = config.webDist;
  app.use("/*", serveStatic({ root }));
  // SPA のルーティングのため、API 以外の未知のパスには index.html を返す
  app.get("*", serveStatic({ root, path: "index.html" }));
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`listening on http://localhost:${info.port}`);
});
