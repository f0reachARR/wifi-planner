import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { makeSyntheticPlanPdf } from "@wifi-planner/wall-extraction/fixtures";
import { ADMIN } from "../playwright.config";
import { apiOf, ensureUser, newUserPage, tool } from "./helpers";

test("図面の取り込み、スケール校正、回転、トリミング", async ({ browser }, testInfo) => {
  mkdirSync(testInfo.outputDir, { recursive: true });
  const pdfPath = path.join(testInfo.outputDir, "plan.pdf");
  writeFileSync(pdfPath, (await makeSyntheticPlanPdf()).pdf);

  const bob = await ensureUser(browser, "plan-bob", "bob-password");
  const alice = await newUserPage(browser, ADMIN.username, ADMIN.password);
  const project = await apiOf(alice).post<{ id: string }>("/projects", { name: "図面" });
  await apiOf(alice).put(`/projects/${project.id}/members/${bob.id}`, { role: "viewer" });

  await alice.goto(`/projects/${project.id}`);
  await alice.getByRole("button", { name: "追加" }).click();
  await alice.getByRole("button", { name: "図面を取り込む" }).click();
  await alice.getByRole("dialog").locator('input[type="file"]').setInputFiles(pdfPath);
  await alice.getByRole("button", { name: "1 ページ" }).click();
  await alice.getByText("100 dpi", { exact: true }).click();
  await alice.getByRole("dialog").getByRole("button", { name: "取り込む", exact: true }).click();

  // 未校正のフロアでは校正を促す（FR-2.5）
  await expect(alice.getByText("スケールが未校正です")).toBeVisible();

  // 2 点を選んで実距離を入力する（FR-2.4）
  await tool(alice, "スケール校正");
  const canvas = alice.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  await alice.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await alice.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.5);
  await alice.getByRole("dialog").getByLabel("2 点間の実際の距離").fill("20");
  await alice.getByRole("dialog").getByRole("button", { name: "設定" }).click();
  await expect(alice.getByText("スケールが未校正です")).toHaveCount(0);
  await expect(alice.getByText(/スケール：1 m ＝ 図面上/)).toBeVisible();

  // 回転とトリミング（FR-2.3）
  await alice.getByRole("button", { name: "図面の調整" }).click();
  await alice.getByRole("button", { name: "右に 90 度回転" }).click();
  await expect(alice.getByLabel("回転角")).toHaveValue("90°");
  await alice.getByRole("button", { name: "左に 90 度回転" }).click();
  await alice.keyboard.press("Escape");
  await tool(alice, "トリミング");
  await alice.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await alice.mouse.down();
  await alice.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, { steps: 5 });
  await alice.mouse.up();
  await alice.getByRole("button", { name: "図面の調整" }).click();
  await expect(alice.getByRole("button", { name: "トリミングを解除" })).toBeVisible();
  await alice.keyboard.press("Escape");

  // 閲覧者にも図面とスケールが届き、編集の道具は出ない
  const bobPage = await newUserPage(browser, "plan-bob", "bob-password");
  await bobPage.goto(`/projects/${project.id}`);
  await expect(bobPage.getByText(/スケール：1 m ＝ 図面上/)).toBeVisible();
  await expect(bobPage.getByRole("button", { name: "図面の調整" })).toHaveCount(0);

  // alice のカーソルが bob の画面に出ているかは、スクリーンショットで確かめる
  await tool(alice, "移動");
  await alice.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await alice.mouse.move(box.x + box.width * 0.5 + 5, box.y + box.height * 0.4 + 5);
  await expect(
    bobPage.getByRole("list", { name: "ほかのユーザーのカーソル" }).getByText(/^admin/),
  ).toBeAttached();
  if (process.env.SCREENSHOT_DIR) {
    await alice.screenshot({ path: `${process.env.SCREENSHOT_DIR}/plan-alice.png` });
    await bobPage.screenshot({ path: `${process.env.SCREENSHOT_DIR}/plan-bob.png` });
  }
});
