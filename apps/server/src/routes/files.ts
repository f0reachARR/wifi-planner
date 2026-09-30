import { readFile } from "node:fs/promises";
import {
  MAX_PLAN_EDGE_PX,
  type PlanUploadResult,
  RasterizeRequest,
} from "@wifi-planner/api-contract";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import sharp from "sharp";
import type { AppDeps, AppEnv } from "../app.js";
import { requireUser } from "../auth/session.js";
import { sniffMime } from "../files/blobstore.js";
import { forbidden, notFound, readBody } from "../http.js";
import { canEdit, projectRole } from "../repo/projects.js";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const POINTS_PER_INCH = 72;

export function fileRoutes({ db, blobs, raster }: AppDeps) {
  const app = new Hono<AppEnv>();

  const access = async (c: Context<AppEnv>, needEdit: boolean) => {
    const user = requireUser(c);
    const projectId = c.req.param("id")!;
    const role = await projectRole(db, projectId, user.id);
    if (!role) throw notFound("プロジェクト");
    if (needEdit && !canEdit(role)) throw forbidden();
    return projectId;
  };

  const readUpload = async (c: Context<AppEnv>) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File))
      throw new HTTPException(400, { message: "ファイルを指定してください" });
    return { data: new Uint8Array(await file.arrayBuffer()), name: file.name };
  };

  /** 画像を図面にする。長辺が上限を超えるときだけ縮小し、図面座標は元の画像のピクセルのままにする */
  const imageToPlan = async (projectId: string, sourceSha256: string, data: Uint8Array) => {
    // EXIF の向きを反映した画像を図面にする
    const image = sharp(data).rotate();
    const meta = await image.metadata();
    const width = meta.autoOrient?.width ?? meta.width;
    const height = meta.autoOrient?.height ?? meta.height;
    if (!width || !height) throw new HTTPException(400, { message: "画像の大きさを読めません" });
    const scale = Math.min(1, MAX_PLAN_EDGE_PX / Math.max(width, height));
    const png = await image
      .resize(Math.round(width * scale), Math.round(height * scale))
      .png()
      .toBuffer({ resolveWithObject: true });
    const imageSha256 = await blobs.put(png.data, "image/png");
    await blobs.link(projectId, imageSha256, "plan_image");
    return {
      sourceSha256,
      imageSha256,
      widthPx: png.info.width,
      heightPx: png.info.height,
      unitsPerPx: width / png.info.width,
    };
  };

  // 図面の取り込み（FR-2.1）
  app.post("/:id/plans", bodyLimit({ maxSize: MAX_UPLOAD_BYTES }), async (c) => {
    const projectId = await access(c, true);
    const { data, name } = await readUpload(c);
    const mime = sniffMime(data);
    if (!mime)
      throw new HTTPException(400, { message: "PDF、PNG、JPEG のいずれかを指定してください" });
    const sourceSha256 = await blobs.put(data, mime);
    await blobs.link(projectId, sourceSha256, "plan_source", name);

    let result: PlanUploadResult;
    if (mime === "application/pdf") {
      const pages = await raster.pdfInfo(data).catch(() => {
        throw new HTTPException(400, { message: "PDF を読めません" });
      });
      result = { kind: "pdf", sourceSha256, pages };
    } else {
      result = { kind: "image", plan: await imageToPlan(projectId, sourceSha256, data) };
    }
    return c.json(result, 201);
  });

  // PDF の 1 ページを指定した解像度でラスタ化する（FR-2.2）
  app.post("/:id/plans/:sha/rasterize", async (c) => {
    const projectId = await access(c, true);
    const sha = c.req.param("sha");
    const file = await blobs.find(projectId, sha);
    if (!file || file.mime !== "application/pdf") throw notFound("PDF");
    const { page, dpi } = await readBody(c, RasterizeRequest);
    const data = new Uint8Array(await readFile(blobs.pathOf(sha)));
    const pages = await raster.pdfInfo(data);
    const info = pages[page - 1];
    if (!info) throw new HTTPException(400, { message: "ページがありません" });
    // 長辺が上限を超えないよう解像度を下げる
    const maxDpi = (MAX_PLAN_EDGE_PX * POINTS_PER_INCH) / Math.max(info.widthPt, info.heightPt);
    const effectiveDpi = Math.min(dpi, Math.floor(maxDpi));
    const r = await raster.rasterize(data, page, effectiveDpi);
    const imageSha256 = await blobs.put(r.png, "image/png");
    await blobs.link(projectId, imageSha256, "plan_image");
    return c.json({
      sourceSha256: sha,
      imageSha256,
      widthPx: r.width,
      heightPx: r.height,
      unitsPerPx: r.unitsPerPx,
      page,
      dpi: effectiveDpi,
    });
  });

  // ページ選択用の縮小画像
  app.get("/:id/plans/:sha/pages/:page/thumbnail", async (c) => {
    const projectId = await access(c, false);
    const sha = c.req.param("sha");
    const file = await blobs.find(projectId, sha);
    if (!file || file.mime !== "application/pdf") throw notFound("PDF");
    const data = new Uint8Array(await readFile(blobs.pathOf(sha)));
    const r = await raster.rasterize(data, Number(c.req.param("page")), 24);
    return c.body(r.png as Uint8Array<ArrayBuffer>, 200, {
      "content-type": "image/png",
      "cache-control": "private, max-age=86400",
    });
  });

  // ファイルの取得。プロジェクトに紐づいたファイルだけを返す（設計書 11 章）
  app.get("/:id/files/:sha", async (c) => {
    const projectId = await access(c, false);
    const sha = c.req.param("sha");
    const file = await blobs.find(projectId, sha);
    if (!file) throw notFound("ファイル");
    const data = await readFile(blobs.pathOf(sha));
    return c.body(new Uint8Array(data), 200, {
      "content-type": file.mime,
      // 内容アドレスなので中身は変わらない
      "cache-control": "private, max-age=31536000, immutable",
    });
  });

  return app;
}
