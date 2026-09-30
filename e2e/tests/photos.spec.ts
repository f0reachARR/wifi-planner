import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { makeSyntheticPlanPdf } from "@wifi-planner/wall-extraction/fixtures";
import sharp from "sharp";
import { ADMIN } from "../playwright.config";
import { addFloorWithPlan, apiOf, click, newUserPage, tool } from "./helpers";

test("現場写真のピン、撮影日時、撮影方向とメモ、拡大表示", async ({ browser }, testInfo) => {
  mkdirSync(testInfo.outputDir, { recursive: true });
  const pdfPath = path.join(testInfo.outputDir, "plan.pdf");
  writeFileSync(pdfPath, (await makeSyntheticPlanPdf()).pdf);
  const photoPaths = await Promise.all(
    ["#4dabf7", "#ffa94d"].map(async (color, i) => {
      const p = path.join(testInfo.outputDir, `photo${i}.jpg`);
      const jpeg = await sharp({
        create: { width: 800, height: 600, channels: 3, background: color },
      })
        .jpeg()
        .withExif({ IFD2: { DateTimeOriginal: `2026:09:0${i + 1} 10:1${i}:00` } })
        .toBuffer();
      writeFileSync(p, jpeg);
      return p;
    }),
  );

  const page = await newUserPage(browser, ADMIN.username, ADMIN.password);
  const project = await apiOf(page).post<{ id: string }>("/projects", { name: "写真" });
  await page.goto(`/projects/${project.id}`);
  await addFloorWithPlan(page, pdfPath);

  // ピンを置くと写真の一覧が開く（FR-9.1）
  await tool(page, "写真");
  await click(page, 0.4, 0.6);
  const drawer = page.getByRole("dialog", { name: "現場写真" });
  await expect(drawer.getByText("写真がありません")).toBeVisible();
  await drawer.locator('input[type="file"]').setInputFiles(photoPaths);
  await expect(drawer.getByText("撮影日時：2026/09/01 10:10")).toBeVisible();
  await expect(drawer.getByText("撮影日時：2026/09/02 10:11")).toBeVisible();

  // 撮影方向とメモ（FR-9.2）
  await drawer.getByLabel("撮影方向（図面の上が 0°、時計回り）").first().fill("90");
  await drawer.getByLabel("メモ").first().fill("分電盤の横");
  await drawer.getByLabel("メモ").first().blur();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);

  // 開き直しても残っていて、拡大表示できる（FR-9.3）
  await click(page, 0.4, 0.6);
  await expect(drawer.getByLabel("撮影方向（図面の上が 0°、時計回り）").first()).toHaveValue("90°");
  await expect(drawer.getByLabel("メモ").first()).toHaveValue("分電盤の横");
  await drawer.getByRole("button", { name: "写真 1 を拡大" }).click();
  await expect(page.getByRole("img", { name: "分電盤の横" })).toBeVisible();
  if (process.env.SCREENSHOT_DIR)
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/photos.png` });
});
