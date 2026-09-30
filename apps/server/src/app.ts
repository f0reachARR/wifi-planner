import { CSRF_HEADER } from "@wifi-planner/api-contract";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type AuthUser, sessionMiddleware } from "./auth/session.js";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import type { DocStore } from "./docstore.js";
import type { AccessEvents } from "./events.js";
import type { BlobStore } from "./files/blobstore.js";
import { adminRoutes } from "./routes/admin.js";
import { apModelRoutes } from "./routes/ap-models.js";
import { authRoutes } from "./routes/auth.js";
import { extractionRoutes } from "./routes/extractions.js";
import { fileRoutes } from "./routes/files.js";
import { photoRoutes } from "./routes/photos.js";
import { projectRoutes } from "./routes/projects.js";
import { transferRoutes } from "./routes/transfer.js";
import { userRoutes } from "./routes/users.js";
import type { RasterPool } from "./workers.js";

export type AppEnv = { Variables: { user: AuthUser | undefined } };

export type AppDeps = {
  db: Db;
  docs: DocStore;
  events: AccessEvents;
  blobs: BlobStore;
  raster: RasterPool;
  config: Pick<Config, "cookieSecure">;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: "サーバでエラーが起きました" }, 500);
  });

  const api = new Hono<AppEnv>();

  // 状態を変える要求には独自ヘッダを必須にする。ブラウザは別オリジンから独自ヘッダを付けた要求を送れない
  api.use(async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && !c.req.header(CSRF_HEADER)) {
      throw new HTTPException(403, { message: "要求の形式が正しくありません" });
    }
    await next();
  });
  api.use(sessionMiddleware(deps.db));

  api.get("/health", async (c) => {
    await deps.db.run(sql`select 1`);
    return c.json({ ok: true });
  });
  api.route("/auth", authRoutes(deps));
  api.route("/admin", adminRoutes(deps));
  api.route("/users", userRoutes(deps));
  api.route("/projects", projectRoutes(deps));
  api.route("/projects", fileRoutes(deps));
  api.route("/ap-models", apModelRoutes(deps));
  api.route("/projects", extractionRoutes(deps));
  api.route("/projects", photoRoutes(deps));
  api.route("/projects", transferRoutes(deps));

  // 未知の API には JSON の 404 を返し、SPA の index.html に落とさない
  api.all("*", (c) => c.json({ error: "見つかりません" }, 404));

  app.route("/api", api);
  return app;
}
