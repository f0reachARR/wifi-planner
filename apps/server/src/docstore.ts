import { eq } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { yjsDocuments } from "./db/schema.js";

/**
 * プロジェクトの Yjs 文書の状態を読み書きする。
 * 同期サーバが文書を開いている間は、保存のデバウンスのため DB の状態が最新とは限らない。
 * 同期サーバはこのインターフェースを包み、開いている文書の状態を優先して返す。
 */
export interface DocStore {
  getState(projectId: string): Promise<Uint8Array | undefined>;
  putState(projectId: string, state: Uint8Array): Promise<void>;
}

export function dbDocStore(db: Db): DocStore {
  return {
    async getState(projectId) {
      const row = await db.query.yjsDocuments.findFirst({
        where: eq(yjsDocuments.projectId, projectId),
      });
      return row ? new Uint8Array(row.state) : undefined;
    },
    async putState(projectId, state) {
      const now = Date.now();
      await db
        .insert(yjsDocuments)
        .values({ projectId, state: Buffer.from(state), updatedAt: now })
        .onConflictDoUpdate({
          target: yjsDocuments.projectId,
          set: { state: Buffer.from(state), updatedAt: now },
        });
    },
  };
}
