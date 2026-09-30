import { existsSync } from "node:fs";
import type { PlanUploadResult, Project } from "@wifi-planner/api-contract";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { runMaintenance } from "./maintenance.js";
import { createTestApp } from "./test/harness.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeEach(async () => {
  t = await createTestApp();
});

describe("保守の処理", () => {
  it("削除から猶予期間がたったプロジェクトと、参照されなくなったファイルを消す。複製が使うファイルは残す", async () => {
    const { api } = await t.addUser("alice");
    const a = (await (await api.post("/api/projects", { name: "a" })).json()) as Project;
    const png = async (color: string) =>
      new Uint8Array(
        await sharp({ create: { width: 8, height: 8, channels: 3, background: color } })
          .png()
          .toBuffer(),
      );
    const onlyA = (await (
      await api.upload(`/api/projects/${a.id}/plans`, await png("#f00"), "a.png")
    ).json()) as PlanUploadResult;
    if (onlyA.kind !== "image") throw new Error();
    const b = (await (
      await api.post(`/api/projects/${a.id}/duplicate`, { name: "b" })
    ).json()) as Project;
    const onlyAAfterCopy = (await (
      await api.upload(`/api/projects/${a.id}/plans`, await png("#0f0"), "c.png")
    ).json()) as PlanUploadResult;
    if (onlyAAfterCopy.kind !== "image") throw new Error();
    await api.delete(`/api/projects/${a.id}`);

    // 猶予期間の中では何も消さない
    expect(await runMaintenance(t.db, t.blobs, { blobGraceMs: 0 })).toEqual({
      purgedProjects: 0,
      removedBlobs: 0,
    });

    const later = Date.now() + 8 * 24 * 60 * 60 * 1000;
    expect(await runMaintenance(t.db, t.blobs, { now: later, blobGraceMs: 0 })).toEqual({
      purgedProjects: 1,
      removedBlobs: 1,
    });
    expect(existsSync(t.blobs.pathOf(onlyAAfterCopy.plan.imageSha256))).toBe(false);
    // 複製したプロジェクトが使っているファイルは残る
    expect((await api.get(`/api/projects/${b.id}/files/${onlyA.plan.imageSha256}`)).status).toBe(
      200,
    );
  });
});
