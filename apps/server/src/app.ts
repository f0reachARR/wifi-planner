import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "./db/client.js";

export function createApp({ db }: { db: Db }) {
  const app = new Hono();

  app.get("/api/health", async (c) => {
    await db.run(sql`select 1`);
    return c.json({ ok: true });
  });

  return app;
}
