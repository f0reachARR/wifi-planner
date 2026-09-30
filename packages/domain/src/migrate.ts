import { ProjectDoc, SCHEMA_VERSION } from "./schema.js";

// 文書のスキーマのマイグレーション（設計書 2.2 節）。
// 版 n から n + 1 への変換を MIGRATIONS[n] に並べる。今は版が 1 つだけなので、変換はまだない。

type RawDoc = Record<string, unknown> & { meta?: { schemaVersion?: number } };
export type Migration = (doc: RawDoc) => RawDoc;

export const MIGRATIONS: Record<number, Migration> = {};

export class UnsupportedSchemaError extends Error {}

/** 古い版の文書を今の版に変換し、スキーマで検証する。新しすぎる版は読めない */
export function migrateDoc(
  raw: unknown,
  migrations: Record<number, Migration> = MIGRATIONS,
  target = SCHEMA_VERSION,
): ProjectDoc {
  let doc = raw as RawDoc;
  let version = doc?.meta?.schemaVersion ?? 1;
  if (version > target) {
    throw new UnsupportedSchemaError(
      `この版（${version}）の文書は、このバージョンのアプリでは読めません`,
    );
  }
  while (version < target) {
    const step = migrations[version];
    if (!step) throw new UnsupportedSchemaError(`版 ${version} から変換する方法がありません`);
    doc = step(doc);
    version++;
    doc = { ...doc, meta: { ...doc.meta, schemaVersion: version } };
  }
  return ProjectDoc.parse(doc);
}

/** 文書が参照するファイル（図面の元ファイルと画像、写真と縮小画像） */
export function referencedFiles(doc: ProjectDoc) {
  const files = new Map<string, "plan_source" | "plan_image" | "photo" | "thumbnail">();
  for (const floor of Object.values(doc.floors)) {
    if (floor.plan) {
      files.set(floor.plan.sourceSha256, "plan_source");
      files.set(floor.plan.imageSha256, "plan_image");
    }
    for (const pin of Object.values(floor.photoPins)) {
      for (const p of pin.photos) {
        files.set(p.sha256, "photo");
        files.set(p.thumbSha256, "thumbnail");
      }
    }
  }
  return files;
}
