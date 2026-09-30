import { CreateUserRequest, UpdateUserRequest } from "@wifi-planner/api-contract";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppDeps, AppEnv } from "../app.js";
import { requireAdmin } from "../auth/session.js";
import { notFound, readBody } from "../http.js";
import { createUser, listUsers, updateUser } from "../repo/users.js";

export function adminRoutes({ db, events }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.get("/users", async (c) => {
    requireAdmin(c);
    return c.json(await listUsers(db));
  });

  app.post("/users", async (c) => {
    requireAdmin(c);
    const input = await readBody(c, CreateUserRequest);
    return c.json(await createUser(db, input), 201);
  });

  app.patch("/users/:id", async (c) => {
    const admin = requireAdmin(c);
    const id = c.req.param("id");
    const input = await readBody(c, UpdateUserRequest);
    // 管理者が自分を締め出さないように、自分の無効化と管理者権限の解除は受け付けない
    if (id === admin.id && (input.disabled || input.isAdmin === false)) {
      throw new HTTPException(400, {
        message: "自分自身を無効化したり、管理者から外したりはできません",
      });
    }
    const user = await updateUser(db, id, input);
    if (!user) throw notFound("ユーザー");
    if (input.disabled) events.emit("userDisabled", id);
    return c.json(user);
  });

  return app;
}
