import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { makeSyntheticPlanPdf } from "@wifi-planner/wall-extraction/fixtures";
import { ADMIN } from "../playwright.config";
import { addFloorWithPlan, apiOf, canvasBox, newUserPage, tool } from "./helpers";

/** 合成図面（A3 横）の紙面の大きさ（ポイント） */
const A3 = { width: 1190.55, height: 841.89 };

test("図面の線の交点に、スケール校正と壁の描画の点をスナップする", async ({
  browser,
}, testInfo) => {
  mkdirSync(testInfo.outputDir, { recursive: true });
  const pdfPath = path.join(testInfo.outputDir, "plan.pdf");
  const plan = await makeSyntheticPlanPdf({ hollowWalls: true });
  writeFileSync(pdfPath, plan.pdf);

  const page = await newUserPage(browser, ADMIN.username, ADMIN.password);
  const project = await apiOf(page).post<{ id: string }>("/projects", { name: "スナップ" });
  await page.goto(`/projects/${project.id}`);
  await addFloorWithPlan(page, pdfPath);

  await page.getByRole("button", { name: "スナップ" }).click();
  await page.getByLabel("図面の線にスナップ").check();
  await expect(page.getByText(/^線 \d+ 本、交点 \d+ 個$/)).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");

  // 図面全体を画面に収めたときの、紙面の座標（ポイント）から画面の座標への変換（PlanCanvas の fitView と同じ）
  const box = await canvasBox(page);
  const scale = Math.min((box.width - 80) / A3.width, (box.height - 80) / A3.height);
  const screen = (pt: { x: number; y: number }, dx: number, dy: number) => ({
    x: box.x + (box.width - A3.width * scale) / 2 + pt.x * scale + dx,
    y: box.y + (box.height - A3.height * scale) / 2 + pt.y * scale + dy,
  });
  // 外壁の内側の線の、左上と右上の角。外側の線の角に吸い寄せられないよう、部屋の内側へ少しずらして押す
  const m = plan.ptPerMeter;
  const left = { x: 85 + 0.1 * m, y: 80 + 0.1 * m };
  const right = { x: 85 + 35.9 * m, y: 80 + 0.1 * m };

  // スケール校正の 2 点を角にスナップさせ、角の間の実際の距離 35.8 m で校正する
  await tool(page, "スケール校正");
  for (const [p, dx] of [
    [left, 1],
    [right, -1],
  ] as const) {
    const s = screen(p, dx, 2);
    await page.mouse.click(s.x, s.y);
  }
  await page.getByRole("dialog").getByLabel("2 点間の実際の距離").fill("35.8");
  await page.getByRole("dialog").getByRole("button", { name: "設定" }).click();

  // 少し違う位置を押して壁を描いても、同じ角にスナップするので長さがちょうど 35.8 m になる
  await tool(page, "壁");
  const a = screen(left, 3, 1);
  await page.mouse.click(a.x, a.y);
  const b = screen(right, -2, 3);
  await page.mouse.dblclick(b.x, b.y);
  await expect(page.getByText(/^長さ 35\.80 m／頂点 2$/)).toBeVisible();
});
