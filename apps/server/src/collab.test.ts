import type { AddressInfo } from "node:net";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { serve } from "@hono/node-server";
import type { Project } from "@wifi-planner/api-contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import * as Y from "yjs";
import { createApp } from "./app.js";
import { createCollab } from "./collab.js";
import { openDb } from "./db/client.js";
import { dbDocStore } from "./docstore.js";
import { AccessEvents } from "./events.js";
import { createUser } from "./repo/users.js";

type Server = ReturnType<typeof serve>;

let server: Server;
let baseUrl: string;
const providers: HocuspocusProvider[] = [];
const sockets: HocuspocusProviderWebsocket[] = [];

beforeEach(async () => {
  const db = await openDb(":memory:");
  const events = new AccessEvents();
  const collab = createCollab({ db, docs: dbDocStore(db), events });
  const app = createApp({ db, docs: collab.liveDocs, events, config: { cookieSecure: false } });
  collab.mount(app);
  for (const name of ["alice", "bob", "carol"]) {
    await createUser(db, { username: name, password: "password123", isAdmin: false });
  }
  await new Promise<void>((resolve) => {
    server = serve(
      { fetch: app.fetch, port: 0, websocket: { server: new WebSocketServer({ noServer: true }) } },
      () => resolve(),
    );
  });
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const p of providers.splice(0)) p.destroy();
  for (const s of sockets.splice(0)) s.destroy();
  await new Promise((resolve) => server.close(resolve));
});

async function login(username: string) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-wifi-planner": "1" },
    body: JSON.stringify({ username, password: "password123" }),
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  const user = (await res.json()) as { id: string };
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { "content-type": "application/json", "x-wifi-planner": "1", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { cookie, id: user.id, call };
}

/** Cookie を付けて同期サーバに接続する */
function connect(projectId: string, cookie?: string) {
  const ydoc = new Y.Doc();
  const failures: string[] = [];
  const closes: number[] = [];
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: `${baseUrl.replace("http", "ws")}/collab`,
    WebSocketPolyfill: class extends WebSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols, { headers: cookie ? { cookie } : {} });
      }
    },
    delay: 50,
    minDelay: 50,
    maxDelay: 100,
  });
  const provider = new HocuspocusProvider({
    websocketProvider,
    name: projectId,
    document: ydoc,
    onAuthenticationFailed: ({ reason }) => failures.push(reason),
    onClose: ({ event }) => closes.push(event.code),
  });
  // 外から渡した WebSocket を使うときは、自分で文書を接続に載せる
  provider.attach();
  providers.push(provider);
  sockets.push(websocketProvider);
  return { ydoc, provider, failures, closes };
}

const until = async (cond: () => boolean, timeoutMs = 3000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("待ち時間を超えた");
    await new Promise((r) => setTimeout(r, 20));
  }
};

const settingsOf = (ydoc: Y.Doc) => ydoc.getMap("settings");

describe("同期サーバ（FR-10.1、FR-10.2）", () => {
  it("編集者どうしの変更が互いに反映され、初期状態も届く", async () => {
    const alice = await login("alice");
    const bob = await login("bob");
    const project = (await (
      await alice.call("POST", "/projects", { name: "p" })
    ).json()) as Project;
    await alice.call("PUT", `/projects/${project.id}/members/${bob.id}`, { role: "editor" });

    const a = connect(project.id, alice.cookie);
    const b = connect(project.id, bob.cookie);
    await until(() => a.provider.isSynced && b.provider.isSynced);
    expect(settingsOf(a.ydoc).get("receiverHeightM")).toBe(1);

    settingsOf(a.ydoc).set("receiverHeightM", 1.2);
    await until(() => settingsOf(b.ydoc).get("receiverHeightM") === 1.2);
  });

  it("閲覧者の書き込みはサーバが受け付けず、ほかのユーザーに届かない", async () => {
    const alice = await login("alice");
    const bob = await login("bob");
    const project = (await (
      await alice.call("POST", "/projects", { name: "p" })
    ).json()) as Project;
    await alice.call("PUT", `/projects/${project.id}/members/${bob.id}`, { role: "viewer" });

    const a = connect(project.id, alice.cookie);
    const b = connect(project.id, bob.cookie);
    await until(() => a.provider.isSynced && b.provider.isSynced);

    settingsOf(b.ydoc).set("receiverHeightM", 9);
    settingsOf(a.ydoc).set("gridResolutionM", 0.25);
    await until(() => settingsOf(b.ydoc).get("gridResolutionM") === 0.25);
    await new Promise((r) => setTimeout(r, 200));
    expect(settingsOf(a.ydoc).get("receiverHeightM")).toBe(1);

    // 後から接続したユーザーにも閲覧者の書き込みは届かない
    const late = connect(project.id, alice.cookie);
    await until(() => late.provider.isSynced);
    expect(settingsOf(late.ydoc).get("receiverHeightM")).toBe(1);
  });

  it("Cookie を持たない接続と、権限のないユーザーの接続を拒否する", async () => {
    const alice = await login("alice");
    const carol = await login("carol");
    const project = (await (
      await alice.call("POST", "/projects", { name: "p" })
    ).json()) as Project;

    const anonymous = connect(project.id);
    const stranger = connect(project.id, carol.cookie);
    await until(() => anonymous.failures.length > 0 && stranger.failures.length > 0);
    expect(settingsOf(stranger.ydoc).size).toBe(0);
  });

  it("共有を外すと接続が切れ、再接続も拒否される", async () => {
    const alice = await login("alice");
    const bob = await login("bob");
    const project = (await (
      await alice.call("POST", "/projects", { name: "p" })
    ).json()) as Project;
    await alice.call("PUT", `/projects/${project.id}/members/${bob.id}`, { role: "editor" });

    const b = connect(project.id, bob.cookie);
    await until(() => b.provider.isSynced);
    await alice.call("DELETE", `/projects/${project.id}/members/${bob.id}`);
    await until(() => b.failures.length > 0);
  });

  it("閲覧から編集に変えると、再接続して書き込めるようになる", async () => {
    const alice = await login("alice");
    const bob = await login("bob");
    const project = (await (
      await alice.call("POST", "/projects", { name: "p" })
    ).json()) as Project;
    await alice.call("PUT", `/projects/${project.id}/members/${bob.id}`, { role: "viewer" });

    const a = connect(project.id, alice.cookie);
    const b = connect(project.id, bob.cookie);
    await until(() => a.provider.isSynced && b.provider.isSynced);
    await alice.call("PUT", `/projects/${project.id}/members/${bob.id}`, { role: "editor" });
    await until(() => b.closes.length > 0);
    await until(() => b.provider.isSynced && b.provider.isAuthenticated);

    settingsOf(b.ydoc).set("receiverHeightM", 2);
    await until(() => settingsOf(a.ydoc).get("receiverHeightM") === 2);
  });

  it("開いている文書の複製には、保存前の最新の変更も含まれる", async () => {
    const alice = await login("alice");
    const project = (await (
      await alice.call("POST", "/projects", { name: "p" })
    ).json()) as Project;
    const a = connect(project.id, alice.cookie);
    await until(() => a.provider.isSynced);
    settingsOf(a.ydoc).set("receiverHeightM", 1.5);
    await new Promise((r) => setTimeout(r, 100));

    const copy = (await (
      await alice.call("POST", `/projects/${project.id}/duplicate`, { name: "copy" })
    ).json()) as Project;
    const c = connect(copy.id, alice.cookie);
    await until(() => c.provider.isSynced);
    expect(settingsOf(c.ydoc).get("receiverHeightM")).toBe(1.5);
  });
});
