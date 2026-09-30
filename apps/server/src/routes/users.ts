import { Hono } from "hono";
import type { AppDeps, AppEnv } from "../app.js";
import { requireUser } from "../auth/session.js";
import { listActiveUserSummaries } from "../repo/users.js";

export function userRoutes({ db }: AppDeps) {
  const app = new Hono<AppEnv>();

  // プロジェクトの共有相手を選ぶための一覧
  app.get("/", async (c) => {
    requireUser(c);
    return c.json(await listActiveUserSummaries(db));
  });

  return app;
}
