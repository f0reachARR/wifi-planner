import { rm } from "node:fs/promises";
import { and, eq, isNotNull, lt, notExists } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { blobs, projectFiles, projects } from "./db/schema.js";
import type { BlobStore } from "./files/blobstore.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 保守の処理（設計書 2.4 節）。
 * 削除から猶予期間がたったプロジェクトを消し、どのプロジェクトからも参照されないファイルを消す。
 * アップロードの直後でまだプロジェクトに紐づけていないファイルを消さないよう、作ってから少したったファイルに限る。
 */
export async function runMaintenance(
  db: Db,
  store: BlobStore,
  opts: { now?: number; deletedGraceMs?: number; blobGraceMs?: number } = {},
) {
  const now = opts.now ?? Date.now();
  const purged = await db
    .delete(projects)
    .where(
      and(
        isNotNull(projects.deletedAt),
        lt(projects.deletedAt, now - (opts.deletedGraceMs ?? 7 * DAY_MS)),
      ),
    )
    .returning({ id: projects.id });

  const orphans = await db
    .select({ sha256: blobs.sha256 })
    .from(blobs)
    .where(
      and(
        lt(blobs.createdAt, now - (opts.blobGraceMs ?? 60 * 60 * 1000)),
        notExists(db.select().from(projectFiles).where(eq(projectFiles.sha256, blobs.sha256))),
      ),
    );
  for (const { sha256 } of orphans) {
    await rm(store.pathOf(sha256), { force: true });
    await db.delete(blobs).where(eq(blobs.sha256, sha256));
  }
  return { purgedProjects: purged.length, removedBlobs: orphans.length };
}
