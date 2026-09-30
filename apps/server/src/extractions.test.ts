import type {
  ExtractionJob,
  PlanImageInfo,
  PlanUploadResult,
  Project,
} from "@wifi-planner/api-contract";
import { makeSyntheticPlanPdf } from "@wifi-planner/wall-extraction/fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./test/harness.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeEach(async () => {
  t = await createTestApp();
});

describe("壁の自動抽出のジョブ（FR-4.1）", () => {
  it("図面の画像から壁の候補を返し、閲覧者はジョブを作れない", async () => {
    const alice = await t.addUser("alice");
    const bob = await t.addUser("bob");
    const project = (await (
      await alice.api.post("/api/projects", { name: "p" })
    ).json()) as Project;
    await alice.api.put(`/api/projects/${project.id}/members/${bob.user.id}`, { role: "viewer" });

    const { pdf } = await makeSyntheticPlanPdf();
    const uploaded = (await (
      await alice.api.upload(`/api/projects/${project.id}/plans`, pdf, "p.pdf")
    ).json()) as PlanUploadResult;
    if (uploaded.kind !== "pdf") throw new Error();
    const plan = (await (
      await alice.api.post(`/api/projects/${project.id}/plans/${uploaded.sourceSha256}/rasterize`, {
        page: 1,
        dpi: 100,
      })
    ).json()) as PlanImageInfo;

    const body = {
      imageSha256: plan.imageSha256,
      params: { minThicknessPx: 3, minLineLengthPx: 20 },
    };
    expect((await bob.api.post(`/api/projects/${project.id}/extractions`, body)).status).toBe(403);
    const created = await alice.api.post(`/api/projects/${project.id}/extractions`, body);
    expect(created.status).toBe(202);
    const { id } = (await created.json()) as ExtractionJob;

    let job: ExtractionJob = { id, status: "running" };
    const start = Date.now();
    while (job.status === "running" && Date.now() - start < 20_000) {
      await new Promise((r) => setTimeout(r, 100));
      job = (await (
        await bob.api.get(`/api/projects/${project.id}/extractions/${id}`)
      ).json()) as ExtractionJob;
    }
    expect(job.status).toBe("done");
    expect(job.polylines!.length).toBeGreaterThan(10);
  }, 30_000);

  it("プロジェクトの図面ではない画像は受け付けない", async () => {
    const alice = await t.addUser("alice");
    const project = (await (
      await alice.api.post("/api/projects", { name: "p" })
    ).json()) as Project;
    const res = await alice.api.post(`/api/projects/${project.id}/extractions`, {
      imageSha256: "0".repeat(64),
    });
    expect(res.status).toBe(404);
  });
});
