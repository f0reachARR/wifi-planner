import { blob, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// 日時は UNIX 時刻（ミリ秒）の整数で持つ（設計書 2.5 節）

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  disabledAt: integer("disabled_at"),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    /** Cookie の値そのものではなく、その SHA-256 を持つ。DB が漏れてもセッションを乗っ取られないようにする */
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
});

export const projectMembers = sqliteTable(
  "project_members",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["editor", "viewer"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);

export const yjsDocuments = sqliteTable("yjs_documents", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  state: blob("state", { mode: "buffer" }).notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** アップロードしたファイルの実体。SHA-256 をファイル名にしてアップロード領域に置く（設計書 2 章） */
export const blobs = sqliteTable("blobs", {
  sha256: text("sha256").primaryKey(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** プロジェクトとファイルの対応。ファイルを返すときの権限の確認に使う */
export const projectFiles = sqliteTable(
  "project_files",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sha256: text("sha256")
      .notNull()
      .references(() => blobs.sha256),
    kind: text("kind", { enum: ["plan_source", "plan_image", "photo", "thumbnail"] }).notNull(),
    originalName: text("original_name"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.sha256] })],
);

/** 全ユーザーで共有する AP モデルのライブラリ（FR-5.4）。定義は JSON の文字列で持つ */
export const apModels = sqliteTable("ap_models", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  vendor: text("vendor"),
  definition: text("definition").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
