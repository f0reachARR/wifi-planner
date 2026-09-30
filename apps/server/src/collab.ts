import { Database } from "@hocuspocus/extension-database";
import { type Connection, Hocuspocus } from "@hocuspocus/server";
import { upgradeWebSocket } from "@hono/node-server";
import type { ProjectRole } from "@wifi-planner/api-contract";
import { migrateDoc, SCHEMA_VERSION } from "@wifi-planner/domain";
import { encodeProjectDoc, fromY } from "@wifi-planner/domain/ydoc";
import { eq } from "drizzle-orm";
import type { Env, Hono } from "hono";
import * as Y from "yjs";
import { tokenFromCookieHeader, userFromToken } from "./auth/session.js";
import type { Db } from "./db/client.js";
import { projects } from "./db/schema.js";
import type { DocStore } from "./docstore.js";
import type { AccessEvents } from "./events.js";
import { projectRole } from "./repo/projects.js";

export type CollabContext = { userId: string; role: ProjectRole };

/** 権限の変更でサーバが WebSocket を閉じたときのコード */
export const ACCESS_CHANGED_CODE = 4001;

/**
 * Yjs の同期サーバ（設計書 10 章）。文書名はプロジェクト ID とする。
 * 権限は onConnect で確かめる。Hocuspocus v4 は文書ごとの認証メッセージを受けるたびに onConnect を呼ぶ。
 */
export function createCollab({
  db,
  docs,
  events,
}: {
  db: Db;
  docs: DocStore;
  events: AccessEvents;
}) {
  const hocuspocus = new Hocuspocus<CollabContext>({
    debounce: 2000,
    maxDebounce: 10_000,
    // 誰も接続していない文書はすぐにメモリから降ろす
    unloadImmediately: true,
    async onConnect({ documentName, requestHeaders, connectionConfig }) {
      const user = await userFromToken(db, tokenFromCookieHeader(requestHeaders.get("cookie")));
      if (!user) throw new Error("unauthenticated");
      const role = await projectRole(db, documentName, user.id);
      if (!role) throw new Error("forbidden");
      // 閲覧者の接続からの更新はサーバが受け付けない
      connectionConfig.readOnly = role === "viewer";
      return { userId: user.id, role } satisfies CollabContext;
    },
    extensions: [
      new Database({
        fetch: async ({ documentName }) => {
          const state = await docs.getState(documentName);
          return state ? migrateState(state) : null;
        },
        store: async ({ documentName, state }) => {
          await docs.putState(documentName, state);
          await db
            .update(projects)
            .set({ updatedAt: Date.now() })
            .where(eq(projects.id, documentName));
        },
      }),
    ],
  });

  const connectionsOf = (documentName: string): Connection<CollabContext>[] =>
    hocuspocus.documents.get(documentName)?.getConnections() ?? [];

  // 権限の変わった接続は WebSocket ごと閉じる。文書単位の接続を閉じるだけでは、クライアントは認証し直さない。
  // WebSocket を閉じればクライアントは自動で再接続し、その時点の権限で認証し直す（権限がなければ拒否される）
  const drop = (conn: Connection<CollabContext>) =>
    conn.webSocket.close(ACCESS_CHANGED_CODE, "access changed");
  events.on("userDisabled", (userId) => {
    for (const doc of hocuspocus.documents.values()) {
      for (const conn of doc.getConnections()) if (conn.context.userId === userId) drop(conn);
    }
  });
  events.on("projectAccessChanged", (projectId, userId) => {
    for (const conn of connectionsOf(projectId)) {
      if (userId === undefined || conn.context.userId === userId) drop(conn);
    }
  });
  events.on("projectDeleted", (projectId) => {
    for (const conn of connectionsOf(projectId)) drop(conn);
  });

  /** 開いている文書があればその最新の状態を、なければ DB の状態を返す */
  const liveDocs: DocStore = {
    async getState(projectId) {
      const live = hocuspocus.documents.get(projectId);
      return live ? Y.encodeStateAsUpdate(live) : docs.getState(projectId);
    },
    putState: (projectId, state) => docs.putState(projectId, state),
  };

  const mount = <E extends Env>(app: Hono<E>) => {
    app.get(
      "/collab",
      upgradeWebSocket((c) => {
        let connection: ReturnType<Hocuspocus["handleConnection"]> | undefined;
        return {
          onOpen(_event, ws) {
            // biome-ignore lint/suspicious/noExplicitAny: ws.raw は ws パッケージの WebSocket
            connection = hocuspocus.handleConnection(ws.raw as any, c.req.raw);
          },
          onMessage(event) {
            if (event.data instanceof ArrayBuffer)
              connection?.handleMessage(new Uint8Array(event.data));
          },
          onClose(event) {
            connection?.handleClose({ code: event.code, reason: event.reason });
          },
        };
      }),
    );
  };

  /** 開いている文書をすべて保存する。停止時に、デバウンス中の変更を失わないようにする */
  const storeAll = async () => {
    for (const [name, doc] of hocuspocus.documents) {
      await docs.putState(name, Y.encodeStateAsUpdate(doc));
    }
  };

  return { hocuspocus, liveDocs, mount, storeAll };
}

/**
 * 文書のスキーマが古ければ、今の版に変換した状態を返す（設計書 2.2 節）。
 * 変換では文書を作り直すので編集履歴は引き継がないが、版の変わり目は更新のときだけなので問題にならない。
 */
export function migrateState(state: Uint8Array): Uint8Array {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, state);
  const version = Number(ydoc.getMap("meta").get("schemaVersion") ?? 1);
  if (version >= SCHEMA_VERSION) return state;
  const raw: Record<string, unknown> = {};
  for (const key of ["meta", "settings", "materials", "apModels", "floors"])
    raw[key] = fromY(ydoc.getMap(key));
  return encodeProjectDoc(migrateDoc(raw));
}
