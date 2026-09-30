import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../app.js";
import type { Db } from "../db/client.js";
import { sessions, users } from "../db/schema.js";

export const SESSION_COOKIE = "wp_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthUser = { id: string; username: string; isAdmin: boolean };

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(
  db: Db,
  userId: string,
): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** セッションのトークンから、有効なユーザーを引く。無効化されたユーザーと期限切れのセッションは弾く */
export async function userFromToken(
  db: Db,
  token: string | undefined,
): Promise<AuthUser | undefined> {
  if (!token) return undefined;
  const rows = await db
    .select({ id: users.id, username: users.username, isAdmin: users.isAdmin })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, Date.now()),
        isNull(users.disabledAt),
      ),
    )
    .limit(1);
  return rows[0];
}

/** Cookie ヘッダの文字列からセッションのトークンを取り出す。WebSocket の接続時に使う */
export function tokenFromCookieHeader(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function setSessionCookie(c: Context, token: string, expiresAt: number, secure: boolean) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure,
    path: "/",
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export function sessionMiddleware(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("user", await userFromToken(db, getCookie(c, SESSION_COOKIE)));
    await next();
  };
}

export function requireUser(c: Context<AppEnv>): AuthUser {
  const user = c.get("user");
  if (!user) throw new HTTPException(401, { message: "ログインしてください" });
  return user;
}

export function requireAdmin(c: Context<AppEnv>): AuthUser {
  const user = requireUser(c);
  if (!user.isAdmin) throw new HTTPException(403, { message: "管理者だけが使える操作です" });
  return user;
}
