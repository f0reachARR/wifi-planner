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

/** フロアを追加し、合成図面の PDF を取り込んでスケールを校正する */
export async function addFloorWithPlan(page: Page, pdfPath: string) {
  await page.getByRole("button", { name: "追加" }).click();
  await page.getByRole("button", { name: "図面を取り込む" }).click();
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(pdfPath);
  await page.getByRole("button", { name: "1 ページ" }).click();
  await page.getByText("100 dpi", { exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "取り込む", exact: true }).click();
  await expect(page.getByText("スケールが未校正です")).toBeVisible();
  const box = await canvasBox(page);
  await tool(page, "スケール校正");
  await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.5);
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.5);
  await page.getByRole("dialog").getByLabel("2 点間の実際の距離").fill("30");
  await page.getByRole("dialog").getByRole("button", { name: "設定" }).click();
  await expect(page.getByText("スケールが未校正です")).toHaveCount(0);
}

export async function canvasBox(page: Page) {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("キャンバスがない");
  return box;
}

const PLAN_TOOLS = new Set(["スケール校正", "位置合わせ", "トリミング"]);

/** 道具を選ぶ。図面を扱う道具は「図面の調整」の中、そのほかは道具のバー（メイン領域の最初のラジオボタンの組）にある */
export async function tool(page: Page, name: string) {
  if (PLAN_TOOLS.has(name)) {
    await page.getByRole("button", { name: "図面の調整" }).click();
    await page.getByRole("dialog").getByRole("button", { name, exact: true }).click();
    return;
  }
  await page
    .getByRole("main")
    .getByRole("radiogroup")
    .first()
    .getByText(name, { exact: true })
    .click();
}

/** 表示中のフロアの壁と AP をすべて選ぶ */
export async function selectAll(page: Page) {
  await page.getByLabel("図面").focus();
  await page.keyboard.press("Control+a");
}

/** キャンバス上の相対位置 (fx, fy) を画面座標にする */
export async function at(page: Page, fx: number, fy: number) {
  const box = await canvasBox(page);
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

export async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

export async function click(page: Page, fx: number, fy: number) {
  const p = await at(page, fx, fy);
  await page.mouse.click(p.x, p.y);
}
