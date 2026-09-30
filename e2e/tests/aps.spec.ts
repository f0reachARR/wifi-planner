import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { makeSyntheticPlanPdf } from "@wifi-planner/wall-extraction/fixtures";
import { ADMIN } from "../playwright.config";
import { addFloorWithPlan, apiOf, click, newUserPage, tool } from "./helpers";

const PATTERN_CSV = [
  "cut,deg,gain_dbi",
  ...[-180, -90, 0, 90].map(
    (d) => `azimuth,${d},${d === 0 ? 6 : d === 180 || d === -180 ? -10 : 0}`,
  ),
  ...[-90, -45, 0, 45, 90].map((d) => `elevation,${d},${6 - Math.abs(d) / 10}`),
].join("\n");

test("AP モデルの作成、AP の配置と設定、一覧からの一括変更", async ({ browser }, testInfo) => {
  mkdirSync(testInfo.outputDir, { recursive: true });
  const pdfPath = path.join(testInfo.outputDir, "plan.pdf");
  const csvPath = path.join(testInfo.outputDir, "pattern.csv");
  writeFileSync(pdfPath, (await makeSyntheticPlanPdf()).pdf);
  writeFileSync(csvPath, PATTERN_CSV);

  const page = await newUserPage(browser, ADMIN.username, ADMIN.password);

  // AP モデルを作る（FR-5.1〜5.3）
  await page.getByRole("link", { name: "AP モデル" }).click();
  await page.getByRole("button", { name: "AP モデルを作成" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("名前").fill("テスト AP");
  await dialog.locator('input[type="file"]').nth(1).setInputFiles(csvPath);
  await expect(dialog.getByRole("img", { name: /方位断面の極座標グラフ/ })).toBeVisible();
  await expect(dialog.getByRole("img", { name: /仰角断面の極座標グラフ/ })).toBeVisible();
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("cell", { name: "テスト AP", exact: true })).toBeVisible();

  // AP を置く（FR-6.1）
  const project = await apiOf(page).post<{ id: string }>("/projects", { name: "AP の配置" });
  await page.goto(`/projects/${project.id}`);
  await addFloorWithPlan(page, pdfPath);
  await tool(page, "AP");
  await page.getByRole("combobox", { name: "置く AP モデル" }).click();
  await page.getByRole("option", { name: "テスト AP" }).click();
  await click(page, 0.35, 0.4);
  await expect(page.getByLabel("名前")).toHaveValue("AP-1");
  await click(page, 0.65, 0.4);
  await expect(page.getByLabel("名前")).toHaveValue("AP-2");

  // ラジオの設定（FR-6.3、FR-6.4）
  await tool(page, "選択");
  await click(page, 0.35, 0.4);
  await expect(page.getByLabel("名前")).toHaveValue("AP-1");
  const radio1 = page.getByText("radio1", { exact: true }).locator("xpath=../..");
  await radio1.getByRole("combobox", { name: "5 GHz チャネル" }).click();
  await page.getByRole("option", { name: "149（国内不可）" }).click();
  await expect(radio1.getByText("このチャネルとチャネル幅は国内では使えません")).toBeVisible();
  const power = radio1.getByRole("textbox", { name: "送信出力" });
  await power.fill("30");
  await power.blur();
  await expect(power).toHaveValue("20 dBm");

  // 複製すると次の番号になる
  await page.getByRole("button", { name: "複製" }).click();
  await expect(page.getByLabel("名前")).toHaveValue("AP-3");

  // 一覧から 5 GHz の送信出力をまとめて変える（FR-6.5）
  await page.getByRole("button", { name: "AP の一覧" }).click();
  const table = page.getByRole("dialog");
  await expect(table.getByRole("row")).toHaveCount(4);
  await table.getByLabel("すべて選ぶ").check();
  await table.getByRole("combobox", { name: "帯域" }).click();
  await page.getByRole("option", { name: "5 GHz" }).click();
  await table.getByRole("textbox", { name: "送信出力" }).first().fill("12");
  await table.getByRole("button", { name: "適用" }).click();
  for (const name of ["AP-1", "AP-2", "AP-3"]) {
    await expect(table.getByLabel(`${name} の radio1 の送信出力`)).toHaveValue("12 dBm");
  }
  await expect(table.getByLabel("AP-1 の radio0 の送信出力")).toHaveValue("20 dBm");

  if (process.env.SCREENSHOT_DIR) {
    await page.keyboard.press("Escape");
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/aps.png` });
  }
});
