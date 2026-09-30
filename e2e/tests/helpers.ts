import { type Browser, expect, type Page } from "@playwright/test";
import { ADMIN } from "../playwright.config";

const HEADERS = { "x-wifi-planner": "1" };

export async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("ユーザー名").fill(username);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { name: "プロジェクト" })).toBeVisible();
}

/** 新しいブラウザのコンテキストでログインしたページを返す */
export async function newUserPage(browser: Browser, username: string, password: string) {
  const page = await (await browser.newContext()).newPage();
  await login(page, username, password);
  return page;
}

/** 管理者の API でユーザーを作る。すでにあれば何もしない */
export async function ensureUser(browser: Browser, username: string, password: string) {
  const ctx = await browser.newContext();
  const req = ctx.request;
  await req.post("/api/auth/login", { data: ADMIN, headers: HEADERS });
  const res = await req.post("/api/admin/users", {
    data: { username, password },
    headers: HEADERS,
  });
  if (res.status() !== 201 && res.status() !== 409)
    throw new Error(`ユーザーを作れない: ${res.status()}`);
  const users = (await (await req.get("/api/users")).json()) as { id: string; username: string }[];
  await ctx.close();
  return users.find((u) => u.username === username)!;
}

/** ページのログイン中のユーザーとして API を呼ぶ */
export function apiOf(page: Page) {
  return {
    post: async <T>(path: string, data: unknown) =>
      (await (await page.request.post(`/api${path}`, { data, headers: HEADERS })).json()) as T,
    put: (path: string, data: unknown) =>
      page.request.put(`/api${path}`, { data, headers: HEADERS }),
  };
}
