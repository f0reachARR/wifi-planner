import type { PhotoUploadResult } from "@wifi-planner/api-contract";
import exifReader from "exif-reader";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import sharp, { type Metadata } from "sharp";
import type { AppDeps, AppEnv } from "../app.js";
import { requireUser } from "../auth/session.js";
import { forbidden, notFound } from "../http.js";
import { canEdit, projectRole } from "../repo/projects.js";

const MAX_PHOTO_BYTES = 30 * 1024 * 1024;
/** 保存する写真の長辺。現場の記録には十分で、容量を抑えられる */
const MAX_EDGE_PX = 2560;
const THUMB_EDGE_PX = 320;

/** EXIF の日時は現地時刻だが、exif-reader は UTC として Date にするので、UTC の値をそのまま書き出す */
function formatTakenAt(date: Date | undefined, offset: string | undefined): string | undefined {
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return (
    date.toISOString().slice(0, 19) + (offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : "")
  );
}

/** 現場写真（FR-9.1〜9.4）。位置情報は使わないうえ保存する理由もないので、作り直した画像にはメタデータを残さない */
export function photoRoutes({ db, blobs }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.post("/:id/photos", bodyLimit({ maxSize: MAX_PHOTO_BYTES }), async (c) => {
    const user = requireUser(c);
    const projectId = c.req.param("id");
    const role = await projectRole(db, projectId, user.id);
    if (!role) throw notFound("プロジェクト");
    if (!canEdit(role)) throw forbidden();
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File))
      throw new HTTPException(400, { message: "ファイルを指定してください" });
    const data = new Uint8Array(await file.arrayBuffer());

    let meta: Metadata;
    try {
      meta = await sharp(data).metadata();
    } catch {
      throw new HTTPException(400, { message: "画像を読めません" });
    }
    let takenAt: string | undefined;
    if (meta.exif) {
      try {
        const exif = exifReader(meta.exif);
        takenAt = formatTakenAt(exif.Photo?.DateTimeOriginal, exif.Photo?.OffsetTimeOriginal);
      } catch {
        // EXIF が壊れていても写真は受け付ける
      }
    }
    // EXIF の向きを反映してから縮小し、メタデータ（位置情報を含む）を取り除いた JPEG にする
    const photo = await sharp(data)
      .rotate()
      .resize(MAX_EDGE_PX, MAX_EDGE_PX, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const thumb = await sharp(photo)
      .resize(THUMB_EDGE_PX, THUMB_EDGE_PX, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    const sha256 = await blobs.put(photo, "image/jpeg");
    const thumbSha256 = await blobs.put(thumb, "image/jpeg");
    await blobs.link(projectId, sha256, "photo", file.name);
    await blobs.link(projectId, thumbSha256, "thumbnail");
    return c.json({ sha256, thumbSha256, takenAt } satisfies PhotoUploadResult, 201);
  });

  return app;
}
