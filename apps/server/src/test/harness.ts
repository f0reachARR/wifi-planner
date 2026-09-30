import { CSRF_HEADER } from "@wifi-planner/api-contract";
import { createApp } from "../app.js";
import { openDb } from "../db/client.js";
import { dbDocStore } from "../docstore.js";
import { AccessEvents } from "../events.js";
import { createUser } from "../repo/users.js";

/** メモリ上の DB でアプリを作り、ユーザーごとの Cookie を持つクライアントを返す */
export async function createTestApp() {
  const db = await openDb(":memory:");
  const events = new AccessEvents();
  const docs = dbDocStore(db);
  const app = createApp({ db, docs, events, config: { cookieSecure: false } });

  const client = (cookie?: string) => {
    const request = (
      method: string,
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) =>
      app.request(path, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(method === "GET" ? {} : { [CSRF_HEADER]: "1" }),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return {
      get: (path: string) => request("GET", path),
      post: (path: string, body?: unknown) => request("POST", path, body ?? {}),
      patch: (path: string, body: unknown) => request("PATCH", path, body),
      put: (path: string, body: unknown) => request("PUT", path, body),
      delete: (path: string) => request("DELETE", path),
      raw: request,
    };
  };

  const login = async (username: string, password: string) => {
    const res = await client().post("/api/auth/login", { username, password });
    if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
    const setCookie = res.headers.get("set-cookie") ?? "";
    return client(setCookie.split(";")[0]);
  };

  const addUser = async (username: string, isAdmin = false) => {
    const user = await createUser(db, { username, password: "password123", isAdmin });
    return { user, api: await login(username, "password123") };
  };

  return { app, db, events, docs, client, login, addUser };
}
