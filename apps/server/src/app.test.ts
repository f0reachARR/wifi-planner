import type { Member, Project, User } from "@wifi-planner/api-contract";
import { readProjectDoc } from "@wifi-planner/domain/ydoc";
import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { ensureInitialAdmin } from "./bootstrap.js";
import { countUsers } from "./repo/users.js";
import { createTestApp } from "./test/harness.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeEach(async () => {
  t = await createTestApp();
});

describe("API の基本", () => {
  it("ヘルスチェック", async () => {
    const res = await t.client().get("/api/health");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("未知の API には JSON の 404 を返す", async () => {
    const res = await t.client().get("/api/nothing");
    expect(res.status).toBe(404);
    expect(await res.json()).toHaveProperty("error");
  });

  it("独自ヘッダのない状態変更の要求を拒否する", async () => {
    const res = await t.app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "a", password: "b" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("認証（FR-1.1、FR-1.2）", () => {
  it("最初の管理者はユーザーがいないときだけ作る", async () => {
    await ensureInitialAdmin(t.db, "admin", "password123");
    await ensureInitialAdmin(t.db, "admin2", "password123");
    expect(await countUsers(t.db)).toBe(1);
  });

  it("ログインして自分の情報を取れ、ログアウトすると取れなくなる", async () => {
    const { api } = await t.addUser("alice");
    const me = (await (await api.get("/api/auth/me")).json()) as User;
    expect(me.username).toBe("alice");
    await api.post("/api/auth/logout");
    expect((await api.get("/api/auth/me")).status).toBe(401);
  });

  it("誤ったパスワードでは入れない", async () => {
    await t.addUser("alice");
    const res = await t
      .client()
      .post("/api/auth/login", { username: "alice", password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("管理者はユーザーを作成、無効化でき、無効化したユーザーのセッションは切れる", async () => {
    const { api: admin } = await t.addUser("admin", true);
    const created = await admin.post("/api/admin/users", {
      username: "bob",
      password: "password123",
    });
    expect(created.status).toBe(201);
    const bob = (await created.json()) as User;
    const bobApi = await t.login("bob", "password123");

    const disabled: string[] = [];
    t.events.on("userDisabled", (id) => disabled.push(id));
    await admin.patch(`/api/admin/users/${bob.id}`, { disabled: true });
    expect(disabled).toEqual([bob.id]);
    expect((await bobApi.get("/api/auth/me")).status).toBe(401);
    expect(
      (await t.client().post("/api/auth/login", { username: "bob", password: "password123" }))
        .status,
    ).toBe(401);
  });

  it("管理者でなければユーザーを作れない", async () => {
    const { api } = await t.addUser("alice");
    expect(
      (await api.post("/api/admin/users", { username: "x", password: "password123" })).status,
    ).toBe(403);
  });

  it("管理者は自分を無効化できない", async () => {
    const { user, api } = await t.addUser("admin", true);
    expect((await api.patch(`/api/admin/users/${user.id}`, { disabled: true })).status).toBe(400);
  });
});

describe("プロジェクトと権限（FR-1.3、FR-1.4）", () => {
  const create = async (api: Awaited<ReturnType<typeof t.addUser>>["api"], name = "本社") =>
    (await (await api.post("/api/projects", { name })).json()) as Project;

  it("作成したプロジェクトは初期状態の文書を持つ", async () => {
    const { api } = await t.addUser("alice");
    const project = await create(api);
    expect(project.role).toBe("owner");
    const state = await t.docs.getState(project.id);
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, state!);
    expect(Object.keys(readProjectDoc(ydoc).materials)).toContain("concrete");
  });

  it("権限のないユーザーには見えず、存在も知らせない", async () => {
    const { api: alice } = await t.addUser("alice");
    const { api: bob } = await t.addUser("bob");
    const project = await create(alice);
    expect((await bob.get(`/api/projects/${project.id}`)).status).toBe(404);
    expect((await bob.get("/api/projects")).status).toBe(200);
    expect(await (await bob.get("/api/projects")).json()).toEqual([]);
  });

  it("閲覧権限では見えるが編集できず、編集権限では名前を変えられる", async () => {
    const { api: alice } = await t.addUser("alice");
    const { user: bob, api: bobApi } = await t.addUser("bob");
    const project = await create(alice);

    await alice.put(`/api/projects/${project.id}/members/${bob.id}`, { role: "viewer" });
    const seen = (await (await bobApi.get(`/api/projects/${project.id}`)).json()) as Project;
    expect(seen.role).toBe("viewer");
    expect((await bobApi.patch(`/api/projects/${project.id}`, { name: "x" })).status).toBe(403);

    await alice.put(`/api/projects/${project.id}/members/${bob.id}`, { role: "editor" });
    expect((await bobApi.patch(`/api/projects/${project.id}`, { name: "x" })).status).toBe(200);
    // 編集者でも削除と共有の設定はできない
    expect((await bobApi.delete(`/api/projects/${project.id}`)).status).toBe(403);
    expect(
      (await bobApi.put(`/api/projects/${project.id}/members/${bob.id}`, { role: "editor" }))
        .status,
    ).toBe(403);
  });

  it("権限の変更と削除を通知する", async () => {
    const { api: alice } = await t.addUser("alice");
    const { user: bob } = await t.addUser("bob");
    const project = await create(alice);
    const changes: unknown[] = [];
    t.events.on("projectAccessChanged", (...args) => changes.push(args));
    t.events.on("projectDeleted", (id) => changes.push(id));
    await alice.put(`/api/projects/${project.id}/members/${bob.id}`, { role: "viewer" });
    await alice.delete(`/api/projects/${project.id}/members/${bob.id}`);
    await alice.delete(`/api/projects/${project.id}`);
    expect(changes).toEqual([[project.id, bob.id], [project.id, bob.id], project.id]);
    expect((await alice.get(`/api/projects/${project.id}`)).status).toBe(404);
  });

  it("メンバーは自分でプロジェクトから抜けられる", async () => {
    const { api: alice } = await t.addUser("alice");
    const { user: bob, api: bobApi } = await t.addUser("bob");
    const { user: carol } = await t.addUser("carol");
    const project = await create(alice);
    await alice.put(`/api/projects/${project.id}/members/${bob.id}`, { role: "editor" });
    await alice.put(`/api/projects/${project.id}/members/${carol.id}`, { role: "viewer" });
    expect((await bobApi.delete(`/api/projects/${project.id}/members/${carol.id}`)).status).toBe(
      403,
    );
    expect((await bobApi.delete(`/api/projects/${project.id}/members/${bob.id}`)).status).toBe(204);
    const members = (await (
      await alice.get(`/api/projects/${project.id}/members`)
    ).json()) as Member[];
    expect(members.map((m) => m.user.username)).toEqual(["carol"]);
  });

  it("閲覧者も複製でき、複製は複製した人が所有する", async () => {
    const { api: alice } = await t.addUser("alice");
    const { user: bob, api: bobApi } = await t.addUser("bob");
    const project = await create(alice);
    await alice.put(`/api/projects/${project.id}/members/${bob.id}`, { role: "viewer" });
    const res = await bobApi.post(`/api/projects/${project.id}/duplicate`, {
      name: "本社（コピー）",
    });
    expect(res.status).toBe(201);
    const copy = (await res.json()) as Project;
    expect(copy.owner.username).toBe("bob");
    expect(await t.docs.getState(copy.id)).toEqual(await t.docs.getState(project.id));
  });
});
