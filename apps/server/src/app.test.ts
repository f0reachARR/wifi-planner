import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { openDb } from "./db/client.js";

describe("GET /api/health", () => {
  it("DB に接続できれば ok を返す", async () => {
    const app = createApp({ db: await openDb(":memory:") });
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
