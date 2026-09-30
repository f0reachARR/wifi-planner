import type { PlanImageInfo, PlanUploadResult, Project } from "@wifi-planner/api-contract";
import { makeSyntheticPlanPdf } from "@wifi-planner/wall-extraction/fixtures";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./test/harness.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeEach(async () => {
  t = await createTestApp();
});

async function setup() {
  const alice = await t.addUser("alice");
  const bob = await t.addUser("bob");
  const carol = await t.addUser("carol");
  const project = (await (await alice.api.post("/api/projects", { name: "p" })).json()) as Project;
  await alice.api.put(`/api/projects/${project.id}/members/${bob.user.id}`, { role: "viewer" });
  return { alice: alice.api, bob: bob.api, carol: carol.api, project };
}

describe("図面の取り込み（FR-2.1、FR-2.2）", () => {
  it("PDF はページの情報を返し、選んだページを指定した解像度でラスタ化する", async () => {
    const { alice, project } = await setup();
    const { pdf } = await makeSyntheticPlanPdf();
    const res = await alice.upload(`/api/projects/${project.id}/plans`, pdf, "plan.pdf");
    expect(res.status).toBe(201);
    const uploaded = (await res.json()) as PlanUploadResult;
    if (uploaded.kind !== "pdf") throw new Error("PDF として扱われていない");
    expect(uploaded.pages).toHaveLength(1);

    const raster = (await (
      await alice.post(`/api/projects/${project.id}/plans/${uploaded.sourceSha256}/rasterize`, {
        page: 1,
        dpi: 100,
      })
    ).json()) as PlanImageInfo;
    expect(raster.widthPx).toBe(1654);
    expect(raster.unitsPerPx).toBeCloseTo(0.72);

    const image = await alice.get(`/api/projects/${project.id}/files/${raster.imageSha256}`);
    expect(image.headers.get("content-type")).toBe("image/png");
    const meta = await sharp(new Uint8Array(await image.arrayBuffer())).metadata();
    expect(meta.width).toBe(1654);
  }, 30_000);

  it("画像はそのまま図面になり、図面座標は元の画像のピクセルとする", async () => {
    const { alice, project } = await setup();
    const png = await sharp({
      create: { width: 300, height: 200, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    const res = await alice.upload(
      `/api/projects/${project.id}/plans`,
      new Uint8Array(png),
      "a.png",
    );
    const uploaded = (await res.json()) as PlanUploadResult;
    expect(uploaded).toMatchObject({
      kind: "image",
      plan: { widthPx: 300, heightPx: 200, unitsPerPx: 1 },
    });
  });

  it("PDF と画像以外は受け付けない", async () => {
    const { alice, project } = await setup();
    const res = await alice.upload(
      `/api/projects/${project.id}/plans`,
      new TextEncoder().encode("hello"),
      "a.txt",
    );
    expect(res.status).toBe(400);
  });
});

describe("ファイルの権限", () => {
  it("閲覧者はアップロードできないが取得はでき、権限のないユーザーは取得できない", async () => {
    const { alice, bob, carol, project } = await setup();
    const png = new Uint8Array(
      await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } })
        .png()
        .toBuffer(),
    );
    expect((await bob.upload(`/api/projects/${project.id}/plans`, png, "a.png")).status).toBe(403);
    const uploaded = (await (
      await alice.upload(`/api/projects/${project.id}/plans`, png, "a.png")
    ).json()) as PlanUploadResult;
    if (uploaded.kind !== "image") throw new Error();
    const path = `/api/projects/${project.id}/files/${uploaded.plan.imageSha256}`;
    expect((await bob.get(path)).status).toBe(200);
    expect((await carol.get(path)).status).toBe(404);

    // 別のプロジェクトの ID を使っても、紐づいていないファイルは取れない
    const other = (await (await carol.post("/api/projects", { name: "other" })).json()) as Project;
    expect(
      (await carol.get(`/api/projects/${other.id}/files/${uploaded.plan.imageSha256}`)).status,
    ).toBe(404);
  });

  it("複製したプロジェクトからも元のファイルを取得できる", async () => {
    const { alice, project } = await setup();
    const png = new Uint8Array(
      await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } })
        .png()
        .toBuffer(),
    );
    const uploaded = (await (
      await alice.upload(`/api/projects/${project.id}/plans`, png, "a.png")
    ).json()) as PlanUploadResult;
    if (uploaded.kind !== "image") throw new Error();
    const copy = (await (
      await alice.post(`/api/projects/${project.id}/duplicate`, { name: "c" })
    ).json()) as Project;
    expect(
      (await alice.get(`/api/projects/${copy.id}/files/${uploaded.plan.imageSha256}`)).status,
    ).toBe(200);
  });
});
