import { LoginRequest } from "@wifi-planner/api-contract";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { AppDeps, AppEnv } from "../app.js";
import { burnPasswordCheck, verifyPassword } from "../auth/password.js";
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  requireUser,
  SESSION_COOKIE,
  setSessionCookie,
} from "../auth/session.js";
import { readBody } from "../http.js";
import { findUserById, findUserByUsername, toUser } from "../repo/users.js";

export function authRoutes({ db, config }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.post("/login", async (c) => {
    const { username, password } = await readBody(c, LoginRequest);
    const row = await findUserByUsername(db, username);
    if (!row) {
      await burnPasswordCheck(password);
    }
    // 存在しないユーザー、誤ったパスワード、無効化されたユーザーを区別せずに同じ応答を返す
    if (!row || !(await verifyPassword(row.passwordHash, password)) || row.disabledAt !== null) {
      throw new HTTPException(401, { message: "ユーザー名かパスワードが違います" });
    }
    const session = await createSession(db, row.id);
    setSessionCookie(c, session.token, session.expiresAt, config.cookieSecure);
    return c.json(toUser(row));
  });

  app.post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await deleteSession(db, token);
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  app.get("/me", async (c) => {
    const user = requireUser(c);
    const row = await findUserById(db, user.id);
    if (!row) throw new HTTPException(401, { message: "ログインしてください" });
    return c.json(toUser(row));
  });

  return app;
}
