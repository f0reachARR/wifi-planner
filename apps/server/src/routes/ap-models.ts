import { randomUUID } from "node:crypto";
import type { ApModelEntry } from "@wifi-planner/api-contract";
import { ApModel } from "@wifi-planner/domain";
import { asc, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import type { AppDeps, AppEnv } from "../app.js";
import { type AuthUser, requireUser } from "../auth/session.js";
import { apModels, users } from "../db/schema.js";
import { forbidden, notFound, readBody } from "../http.js";

/** ライブラリに保存する定義。写したときの元の情報（source）はプロジェクト側だけが持つ */
const Definition = ApModel.omit({ source: true });

/** AP モデルのライブラリ（FR-5.1、FR-5.4）。作成は誰でもでき、編集と削除は作った人か管理者に限る */
export function apModelRoutes({ db }: AppDeps) {
  const app = new Hono<AppEnv>();

  const toEntry = (
    row: typeof apModels.$inferSelect & { creatorName: string },
    user: AuthUser,
  ): ApModelEntry => ({
    id: row.id,
    definition: JSON.parse(row.definition),
    createdBy: { id: row.createdBy, username: row.creatorName },
    updatedAt: row.updatedAt,
    canEdit: user.isAdmin || row.createdBy === user.id,
  });

  const select = () =>
    db
      .select({
        id: apModels.id,
        name: apModels.name,
        vendor: apModels.vendor,
        definition: apModels.definition,
        createdBy: apModels.createdBy,
        createdAt: apModels.createdAt,
        updatedAt: apModels.updatedAt,
        creatorName: users.username,
      })
      .from(apModels)
      .innerJoin(users, eq(users.id, apModels.createdBy));

  const findEditable = async (c: Context<AppEnv>) => {
    const user = requireUser(c);
    const [row] = await select()
      .where(eq(apModels.id, c.req.param("id")!))
      .limit(1);
    if (!row) throw notFound("AP モデル");
    if (!user.isAdmin && row.createdBy !== user.id) throw forbidden();
    return { user, row };
  };

  app.get("/", async (c) => {
    const user = requireUser(c);
    const rows = await select().orderBy(asc(apModels.name));
    return c.json(rows.map((r) => toEntry(r, user)));
  });

  app.get("/:id", async (c) => {
    const user = requireUser(c);
    const [row] = await select()
      .where(eq(apModels.id, c.req.param("id")))
      .limit(1);
    if (!row) throw notFound("AP モデル");
    return c.json(toEntry(row, user));
  });

  app.post("/", async (c) => {
    const user = requireUser(c);
    const definition = await readBody(c, Definition);
    const now = Date.now();
    const id = randomUUID();
    await db.insert(apModels).values({
      id,
      name: definition.name,
      vendor: definition.vendor,
      definition: JSON.stringify(definition),
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    });
    const [row] = await select().where(eq(apModels.id, id));
    return c.json(toEntry(row!, user), 201);
  });

  app.put("/:id", async (c) => {
    const { user, row } = await findEditable(c);
    const definition = await readBody(c, Definition);
    const updatedAt = Date.now();
    await db
      .update(apModels)
      .set({
        name: definition.name,
        vendor: definition.vendor,
        definition: JSON.stringify(definition),
        updatedAt,
      })
      .where(eq(apModels.id, row.id));
    return c.json(
      toEntry(
        { ...row, name: definition.name, definition: JSON.stringify(definition), updatedAt },
        user,
      ),
    );
  });

  app.delete("/:id", async (c) => {
    const { row } = await findEditable(c);
    await db.delete(apModels).where(eq(apModels.id, row.id));
    return c.body(null, 204);
  });

  return app;
}
