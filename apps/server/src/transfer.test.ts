import type { PlanUploadResult, Project } from "@wifi-planner/api-contract";
import { createEmptyProjectDoc } from "@wifi-planner/domain";
import { encodeProjectDoc, readProjectDoc } from "@wifi-planner/domain/ydoc";
import { strToU8, unzipSync, zipSync } from "fflate";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createTestApp } from "./test/harness.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeEach(async () => {
  t = await createTestApp();
});

async function projectWithPlan() {
  const alice = await t.addUser("alice");
  const project = (await (
    await alice.api.post("/api/projects", { name: "本社" })
  ).json()) as Project;
  const png = new Uint8Array(
    await sharp({ create: { width: 20, height: 10, channels: 3, background: "#fff" } })
      .png()
      .toBuffer(),
  );
  const uploaded = (await (
    await alice.api.upload(`/api/projects/${project.id}/plans`, png, "a.png")
  ).json()) as PlanUploadResult;
  if (uploaded.kind !== "image") throw new Error();
  const doc = createEmptyProjectDoc();
  doc.floors.f1 = {
    name: "1F",
    order: 0,
    elevationM: 0,
    heightM: 3,
    plan: { ...uploaded.plan, rotationDeg: 0 },
    scale: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, distanceM: 1 },
    walls: {
      w: {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        materialId: "concrete",
        openings: [],
      },
    },
    aps: {},
    photoPins: {},
    holes: {},
    areas: {},
  };
  await t.docs.putState(project.id, encodeProjectDoc(doc));
  return { alice: alice.api, project, doc, imageSha: uploaded.plan.imageSha256 };
}

const zipFile = async (res: Response) => new Uint8Array(await res.arrayBuffer());

describe("エクスポートとインポート（FR-1.5）", () => {
  it("書き出した ZIP を読み込むと、同じ内容のプロジェクトができ、ファイルも取り出せる", async () => {
    const { alice, project, doc, imageSha } = await projectWithPlan();
    const res = await alice.get(`/api/projects/${project.id}/export`);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const zip = await zipFile(res);
    // 元の画像と図面の画像が同じ内容なら、ファイルは 1 つにまとまる
    const expected = new Set([
      "manifest.json",
      "project.json",
      `files/${doc.floors.f1!.plan!.sourceSha256}`,
      `files/${imageSha}`,
    ]);
    expect(new Set(Object.keys(unzipSync(zip)))).toEqual(expected);

    const imported = await alice.upload("/api/projects/import", zip, "p.zip");
    expect(imported.status).toBe(201);
    const copy = (await imported.json()) as Project;
    expect(copy.name).toBe("本社");
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, (await t.docs.getState(copy.id))!);
    expect(readProjectDoc(ydoc)).toEqual(doc);
    expect((await alice.get(`/api/projects/${copy.id}/files/${imageSha}`)).status).toBe(200);
  });

  it("中身を書き換えたファイルや、形式の違う ZIP は受け付けない", async () => {
    const { alice, project, imageSha } = await projectWithPlan();
    const entries = unzipSync(await zipFile(await alice.get(`/api/projects/${project.id}/export`)));
    const tampered = {
      ...entries,
      [`files/${imageSha}`]: new Uint8Array(
        await sharp({ create: { width: 5, height: 5, channels: 3, background: "#000" } })
          .png()
          .toBuffer(),
      ),
    };
    const res = await alice.upload("/api/projects/import", zipSync(tampered), "p.zip");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/一致しません/);

    const wrong = zipSync({
      "manifest.json": strToU8(JSON.stringify({ format: "other", version: 1 })),
    });
    expect((await alice.upload("/api/projects/import", wrong, "p.zip")).status).toBe(400);
  });
});
