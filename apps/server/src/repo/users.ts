import { randomUUID } from "node:crypto";
import type { User } from "@wifi-planner/api-contract";
import { asc, count, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { hashPassword } from "../auth/password.js";
import type { Db } from "../db/client.js";
import { sessions, users } from "../db/schema.js";

type UserRow = typeof users.$inferSelect;

export const toUser = (row: UserRow): User => ({
  id: row.id,
  username: row.username,
  isAdmin: row.isAdmin,
  disabled: row.disabledAt !== null,
});

export async function findUserByUsername(db: Db, username: string) {
  return db.query.users.findFirst({ where: eq(users.username, username) });
}

export async function findUserById(db: Db, id: string) {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

export async function listUsers(db: Db): Promise<User[]> {
  const rows = await db.select().from(users).orderBy(asc(users.username));
  return rows.map(toUser);
}

export async function listActiveUserSummaries(db: Db) {
  return db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(isNull(users.disabledAt))
    .orderBy(asc(users.username));
}

export async function createUser(
  db: Db,
  input: { username: string; password: string; isAdmin: boolean },
): Promise<User> {
  if (await findUserByUsername(db, input.username)) {
    throw new HTTPException(409, { message: "そのユーザー名はすでに使われています" });
  }
  const row: UserRow = {
    id: randomUUID(),
    username: input.username,
    passwordHash: await hashPassword(input.password),
    isAdmin: input.isAdmin,
    disabledAt: null,
    createdAt: Date.now(),
  };
  await db.insert(users).values(row);
  return toUser(row);
}

export async function updateUser(
  db: Db,
  id: string,
  input: { password?: string; isAdmin?: boolean; disabled?: boolean },
): Promise<User | undefined> {
  const current = await findUserById(db, id);
  if (!current) return undefined;
  const patch: Partial<UserRow> = {};
  if (input.password !== undefined) patch.passwordHash = await hashPassword(input.password);
  if (input.isAdmin !== undefined) patch.isAdmin = input.isAdmin;
  if (input.disabled !== undefined) {
    patch.disabledAt = input.disabled ? (current.disabledAt ?? Date.now()) : null;
  }
  if (Object.keys(patch).length > 0) await db.update(users).set(patch).where(eq(users.id, id));
  // 無効化したユーザーと、パスワードを変えたユーザーのセッションは消す
  if (input.disabled || input.password !== undefined) {
    await db.delete(sessions).where(eq(sessions.userId, id));
  }
  return toUser({ ...current, ...patch });
}

export async function countUsers(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users);
  return row?.n ?? 0;
}
