import type { ApModelEntry } from "@wifi-planner/api-contract";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./test/harness.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeEach(async () => {
  t = await createTestApp();
});

const model = {
  name: "AP-X",
  vendor: "Example",
  radios: [
    { key: "r0", bands: ["5"], maxTxPowerDbm: { "5": 23 }, pattern: { kind: "omni", gainDbi: 4 } },
  ],
};

describe("AP モデルのライブラリ（FR-5.4）", () => {
  it("誰でも作れ、全員に見え、編集と削除は作った人と管理者に限る", async () => {
    const { api: alice } = await t.addUser("alice");
    const { api: bob } = await t.addUser("bob");
    const { api: admin } = await t.addUser("admin", true);
    const created = (await (await alice.post("/api/ap-models", model)).json()) as ApModelEntry;
    expect(created.canEdit).toBe(true);

    const seen = (await (await bob.get("/api/ap-models")).json()) as ApModelEntry[];
    expect(seen.map((m) => [m.createdBy.username, m.canEdit])).toEqual([["alice", false]]);
    expect((await bob.put(`/api/ap-models/${created.id}`, { ...model, name: "x" })).status).toBe(
      403,
    );
    expect((await bob.delete(`/api/ap-models/${created.id}`)).status).toBe(403);

    const renamed = (await (
      await admin.put(`/api/ap-models/${created.id}`, { ...model, name: "AP-Y" })
    ).json()) as ApModelEntry;
    expect(renamed.definition).toMatchObject({ name: "AP-Y" });
    expect((await alice.delete(`/api/ap-models/${created.id}`)).status).toBe(204);
  });

  it("定義はスキーマで検証する", async () => {
    const { api } = await t.addUser("alice");
    const res = await api.post("/api/ap-models", { ...model, radios: [] });
    expect(res.status).toBe(400);
  });
});
