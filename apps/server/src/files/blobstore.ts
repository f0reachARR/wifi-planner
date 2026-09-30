import { createHash, randomBytes } from "node:crypto";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { blobs, projectFiles } from "../db/schema.js";

export type FileKind = (typeof projectFiles.$inferInsert)["kind"];

/** アップロード領域。ファイルは SHA-256 をファイル名にして置き、同じ内容は一つだけ持つ */
export class BlobStore {
  constructor(
    private readonly db: Db,
    private readonly dir: string,
  ) {}

  pathOf(sha256: string): string {
    return path.join(this.dir, sha256.slice(0, 2), sha256);
  }

  async put(data: Uint8Array, mime: string): Promise<string> {
    const sha256 = createHash("sha256").update(data).digest("hex");
    const target = this.pathOf(sha256);
    const exists = await stat(target).then(
      () => true,
      () => false,
    );
    if (!exists) {
      await mkdir(path.dirname(target), { recursive: true });
      // 書きかけのファイルを読まれないよう、一時ファイルに書いてから名前を変える
      const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
      await writeFile(tmp, data);
      await rename(tmp, target);
    }
    await this.db
      .insert(blobs)
      .values({ sha256, mime, size: data.byteLength, createdAt: Date.now() })
      .onConflictDoNothing();
    return sha256;
  }

  async link(projectId: string, sha256: string, kind: FileKind, originalName?: string) {
    await this.db
      .insert(projectFiles)
      .values({ projectId, sha256, kind, originalName, createdAt: Date.now() })
      .onConflictDoNothing();
  }

  /** プロジェクトに紐づいたファイルのメタデータ。紐づいていなければ undefined */
  async find(projectId: string, sha256: string) {
    const rows = await this.db
      .select({ mime: blobs.mime, size: blobs.size, kind: projectFiles.kind })
      .from(projectFiles)
      .innerJoin(blobs, eq(blobs.sha256, projectFiles.sha256))
      .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.sha256, sha256)))
      .limit(1);
    return rows[0];
  }

  /** プロジェクトの複製で、ファイルの対応だけを写す。実体は共有する */
  async copyLinks(fromProjectId: string, toProjectId: string) {
    const rows = await this.db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.projectId, fromProjectId));
    if (rows.length === 0) return;
    await this.db
      .insert(projectFiles)
      .values(rows.map((r) => ({ ...r, projectId: toProjectId })))
      .onConflictDoNothing();
  }
}

/** 中身の先頭の数バイトから形式を判定する。クライアントが申告した MIME 型は信用しない */
export function sniffMime(
  data: Uint8Array,
): "application/pdf" | "image/png" | "image/jpeg" | undefined {
  const b = data;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return undefined;
}
