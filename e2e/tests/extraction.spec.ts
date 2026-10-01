import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { makeSyntheticPlanPdf } from "@wifi-planner/wall-extraction/fixtures";
import { ADMIN } from "../playwright.config";
import { addFloorWithPlan, apiOf, newUserPage, selectAll, sidebarTab } from "./helpers";

test("壁の自動抽出、候補の個別と一括の採用", async ({ browser }, testInfo) => {
  mkdirSync(testInfo.outputDir, { recursive: true });
  const pdfPath = path.join(testInfo.outputDir, "plan.pdf");
  writeFileSync(pdfPath, (await makeSyntheticPlanPdf()).pdf);

  const page = await newUserPage(browser, ADMIN.username, ADMIN.password);
  const project = await apiOf(page).post<{ id: string }>("/projects", { name: "自動抽出" });
  await page.goto(`/projects/${project.id}`);
  await addFloorWithPlan(page, pdfPath);

  await sidebarTab(page, "壁");
  await page.getByRole("button", { name: "図面から壁を自動抽出" }).click();
  // 100 dpi では内壁が 5 px ほどなので、消す線の太さを下げる
  await page.getByLabel("最小の壁の厚さ（px）").fill("3");
  await page.getByLabel("最小の長さ（px）").fill("20");
  await page.getByRole("button", { name: "抽出する" }).click();
  const summary = page.getByText(/^候補 \d+ 本/);
  await expect(summary).toBeVisible({ timeout: 30_000 });
  const total = Number((await summary.textContent())!.match(/候補 (\d+) 本/)![1]);
  expect(total).toBeGreaterThan(10);

  if (process.env.SCREENSHOT_DIR)
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/extraction.png` });

  // 1 本だけ選んで採用する。外壁の上辺はキャンバスの上のほうにある
  await page.getByRole("button", { name: "選択を外す" }).click();
  await expect(summary).toHaveText(/選択中 0 本/);
  await page.getByRole("button", { name: "すべて選ぶ" }).click();
  await expect(summary).toHaveText(new RegExp(`選択中 ${total} 本`));
  await page.getByRole("button", { name: "選択を外す" }).click();

  // 左ドラッグで範囲に触れる候補を選び、同じ範囲の右ドラッグで選択を外す。
  // キャンバスの左上には道具のバーが重なるので、その下の余白から図面の左半分を囲む
  const box = (await page.locator("canvas").first().boundingBox())!;
  const drag = async (button: "left" | "right") => {
    await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.2);
    await page.mouse.down({ button });
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.6, { steps: 5 });
    await page.mouse.up({ button });
  };
  await drag("left");
  const pickedCount = async () =>
    Number((await summary.textContent())!.match(/選択中 (\d+) 本/)![1]);
  await expect.poll(pickedCount).toBeGreaterThan(0);
  expect(await pickedCount()).toBeLessThan(total);
  await drag("right");
  await expect(summary).toHaveText(/選択中 0 本/);

  // 候補の上をクリックして選ぶ。どこに候補があるかは図面の描き方で決まるので、外壁の左辺を狙う
  let picked = false;
  for (let fx = 0.05; fx < 0.3 && !picked; fx += 0.005) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * 0.5);
    picked = /選択中 1 本/.test((await summary.textContent()) ?? "");
  }
  expect(picked).toBe(true);
  await page.getByRole("button", { name: "選んだ候補を採用" }).click();
  await expect(summary).toHaveText(new RegExp(`^候補 ${total - 1} 本`));

  // 残りをすべて採用し、一度の undo でまとめて戻る
  await page.getByRole("button", { name: "すべて採用" }).click();
  await expect(summary).toHaveCount(0);
  await page.getByRole("button", { name: "自動抽出を閉じる" }).click();
  await selectAll(page);
  await expect(page.getByText(`${total} 本の壁を選択中`)).toBeVisible();
  await page.getByRole("button", { name: "元に戻す" }).click();
  await selectAll(page);
  await expect(page.getByText("1 本の壁を選択中")).toBeVisible();
});
