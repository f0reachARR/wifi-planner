import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type ExtractionJob, ExtractionRequest } from "@wifi-planner/api-contract";
import { type Context, Hono } from "hono";
import type { AppDeps, AppEnv } from "../app.js";
import { requireUser } from "../auth/session.js";
import { forbidden, notFound, readBody } from "../http.js";
import { canEdit, projectRole } from "../repo/projects.js";

/** 抽出の時間の上限（NFR-2） */
const TIMEOUT_MS = 60_000;
/** 終わったジョブを覚えておく時間 */
const KEEP_MS = 10 * 60_000;

type Job = ExtractionJob & { projectId: string; finishedAt?: number };

/**
 * 壁の自動抽出のジョブ（FR-4.1〜4.3）。抽出は worker thread で動かし、クライアントは結果を取りに来る。
 * サーバは 1 プロセスで動かす前提なので、ジョブはメモリに持つ。
 */
export function extractionRoutes({ db, blobs, raster }: AppDeps) {
  const app = new Hono<AppEnv>();
  const jobs = new Map<string, Job>();

  const forget = () => {
    const now = Date.now();
    for (const [id, job] of jobs)
      if (job.finishedAt && now - job.finishedAt > KEEP_MS) jobs.delete(id);
  };

  const access = async (c: Context<AppEnv>, needEdit: boolean) => {
    const user = requireUser(c);
    const projectId = c.req.param("id")!;
    const role = await projectRole(db, projectId, user.id);
    if (!role) throw notFound("プロジェクト");
    if (needEdit && !canEdit(role)) throw forbidden();
    return projectId;
  };

  app.post("/:id/extractions", async (c) => {
    const projectId = await access(c, true);
    const req = ExtractionRequest.parse(await readBody(c, ExtractionRequest));
    const file = await blobs.find(projectId, req.imageSha256);
    if (file?.kind !== "plan_image") throw notFound("図面の画像");
    forget();
    const id = randomUUID();
    const job: Job = { id, projectId, status: "running" };
    jobs.set(id, job);
    const start = Date.now();
    const image = new Uint8Array(await readFile(blobs.pathOf(req.imageSha256)));
    raster
      .extract(image, { ...req.params, region: req.region }, AbortSignal.timeout(TIMEOUT_MS))
      .then((polylines) => Object.assign(job, { status: "done", polylines }))
      .catch((e: unknown) =>
        Object.assign(job, {
          status: "failed",
          error:
            e instanceof Error && e.name === "AbortError"
              ? `${TIMEOUT_MS / 1000} 秒以内に終わらなかったため中止しました`
              : "抽出に失敗しました",
        }),
      )
      .finally(() => Object.assign(job, { elapsedMs: Date.now() - start, finishedAt: Date.now() }));
    return c.json({ id, status: "running" } satisfies ExtractionJob, 202);
  });

  app.get("/:id/extractions/:jobId", async (c) => {
    const projectId = await access(c, false);
    const job = jobs.get(c.req.param("jobId"));
    if (!job || job.projectId !== projectId) throw notFound("ジョブ");
    const { projectId: _, finishedAt: __, ...body } = job;
    return c.json(body satisfies ExtractionJob);
  });

  return app;
}
