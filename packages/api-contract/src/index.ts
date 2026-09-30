import { z } from "zod";

// REST API の入出力。サーバは入力の検証に、Web は型付けに使う。

/** 状態を変える要求に必須のヘッダ。CSRF 対策として、フォームの送信やリンクからの要求を弾く（設計書 11 章） */
export const CSRF_HEADER = "x-wifi-planner";

export const Username = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.-]+$/, "ユーザー名は英数字と _ . - だけで指定してください");
export const Password = z.string().min(8, "パスワードは 8 文字以上にしてください").max(256);

export const User = z.object({
  id: z.string(),
  username: z.string(),
  isAdmin: z.boolean(),
  disabled: z.boolean(),
});
export type User = z.infer<typeof User>;

export const LoginRequest = z.object({ username: z.string(), password: z.string() });
export type LoginRequest = z.infer<typeof LoginRequest>;

export const CreateUserRequest = z.object({
  username: Username,
  password: Password,
  isAdmin: z.boolean().default(false),
});
export type CreateUserRequest = z.input<typeof CreateUserRequest>;

export const UpdateUserRequest = z.object({
  password: Password.optional(),
  isAdmin: z.boolean().optional(),
  disabled: z.boolean().optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequest>;

/** 共有相手を選ぶための、ほかのユーザーの一覧 */
export const UserSummary = z.object({ id: z.string(), username: z.string() });
export type UserSummary = z.infer<typeof UserSummary>;

export const ProjectRole = z.enum(["owner", "editor", "viewer"]);
export type ProjectRole = z.infer<typeof ProjectRole>;

export const MemberRole = z.enum(["editor", "viewer"]);
export type MemberRole = z.infer<typeof MemberRole>;

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  owner: UserSummary,
  role: ProjectRole,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Project = z.infer<typeof Project>;

export const ProjectName = z.string().trim().min(1, "名前を入力してください").max(200);

export const CreateProjectRequest = z.object({ name: ProjectName });
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

export const UpdateProjectRequest = z.object({ name: ProjectName });
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequest>;

export const DuplicateProjectRequest = z.object({ name: ProjectName });
export type DuplicateProjectRequest = z.infer<typeof DuplicateProjectRequest>;

export const Member = z.object({ user: UserSummary, role: MemberRole });
export type Member = z.infer<typeof Member>;

export const SetMemberRequest = z.object({ role: MemberRole });
export type SetMemberRequest = z.infer<typeof SetMemberRequest>;

export const ApiError = z.object({ error: z.string() });
export type ApiError = z.infer<typeof ApiError>;

/** ラスタ化した図面の画像。フロアの plan に書く値の一部 */
export const PlanImageInfo = z.object({
  sourceSha256: z.string(),
  imageSha256: z.string(),
  widthPx: z.number().int(),
  heightPx: z.number().int(),
  unitsPerPx: z.number(),
  page: z.number().int().optional(),
  dpi: z.number().optional(),
});
export type PlanImageInfo = z.infer<typeof PlanImageInfo>;

/** 図面のアップロードの結果。PDF はページを選んでからラスタ化する（FR-2.2） */
export const PlanUploadResult = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pdf"),
    sourceSha256: z.string(),
    pages: z.array(z.object({ widthPt: z.number(), heightPt: z.number() })),
  }),
  z.object({ kind: z.literal("image"), plan: PlanImageInfo }),
]);
export type PlanUploadResult = z.infer<typeof PlanUploadResult>;

export const RasterizeRequest = z.object({
  page: z.number().int().min(1),
  dpi: z.number().min(36).max(600),
});
export type RasterizeRequest = z.infer<typeof RasterizeRequest>;

/** 図面の画像の長辺の上限（ピクセル）。WebGL のテクスチャの上限を考えて決めた（設計書 8 章） */
export const MAX_PLAN_EDGE_PX = 8192;

/** ライブラリの AP モデル。definition は @wifi-planner/domain の ApModel（source を除く）の形 */
export const ApModelEntry = z.object({
  id: z.string(),
  definition: z.unknown(),
  createdBy: UserSummary,
  updatedAt: z.number(),
  canEdit: z.boolean(),
});
export type ApModelEntry = z.infer<typeof ApModelEntry>;
