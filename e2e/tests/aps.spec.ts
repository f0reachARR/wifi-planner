import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { makeSyntheticPlanPdf } from "@wifi-planner/wall-extraction/fixtures";
import { ADMIN } from "../playwright.config";
import { addFloorWithPlan, apiOf, at, click, newUserPage, sidebarTab, tool } from "./helpers";

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

  // 矢印の先のハンドルをドラッグして向きを変える。画面の真上に向けると 90°
  const ap1 = await at(page, 0.35, 0.4);
  await page.mouse.move(ap1.x + 20, ap1.y);
  await page.mouse.down();
  await page.mouse.move(ap1.x, ap1.y - 40, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByLabel("方位角")).toHaveValue("90°");
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

  // 表で方位角を直接変え、設置方法とチルトをまとめて変える。設置方法のプリセットよりチルトの指定が勝つ
  const azimuth2 = table.getByLabel("AP-2 の方位角");
  await azimuth2.fill("180");
  await azimuth2.blur();
  await expect(azimuth2).toHaveValue("180°");
  await table.getByRole("textbox", { name: "送信出力" }).first().fill("");
  await table.getByRole("combobox", { name: "設置方法" }).click();
  await page.getByRole("option", { name: "壁設置" }).click();
  await table.getByRole("textbox", { name: "チルト", exact: true }).fill("15");
  await table.getByRole("button", { name: "適用" }).click();
  for (const name of ["AP-1", "AP-2", "AP-3"]) {
    await expect(table.getByLabel(`${name} のチルト`)).toHaveValue("15°");
  }
  await expect(azimuth2).toHaveValue("180°");
  await expect(table.getByLabel("AP-1 の方位角")).toHaveValue("90°");
  await page.keyboard.press("Escape");
  await expect(table).toBeHidden();

  // 設置方法のボタンは、設置方法を変えてチルトを 0° に戻す（FR-6.2）
  await click(page, 0.35, 0.4);
  await expect(page.getByLabel("名前")).toHaveValue("AP-1");
  const wallButton = page.getByRole("button", { name: "壁設置" });
  const ceilingButton = page.getByRole("button", { name: "天井設置" });
  await expect(wallButton).toHaveAttribute("aria-pressed", "true");
  await ceilingButton.click();
  await expect(ceilingButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("チルト")).toHaveValue("0°");
  await expect(page.getByLabel("方位角")).toHaveValue("90°");

  // 置くときの初期値を指定する（FR-6.1）
  await tool(page, "AP");
  await page.getByLabel("置く AP の設置高さ").fill("3");
  await page.getByRole("radiogroup", { name: "置く AP の設置方法" }).getByText("壁設置").click();
  await page.getByLabel("置く AP の方位角").fill("45");
  await page.getByLabel("置く AP のチルト").fill("10");
  await page.getByLabel("置く AP のチルト").blur();
  await click(page, 0.5, 0.7);
  await expect(page.getByLabel("名前")).toHaveValue("AP-4");
  await expect(page.getByLabel("設置高さ", { exact: true })).toHaveValue("3 m");
  await expect(page.getByLabel("方位角", { exact: true })).toHaveValue("45°");
  await expect(page.getByLabel("チルト", { exact: true })).toHaveValue("10°");
  await expect(wallButton).toHaveAttribute("aria-pressed", "true");

  // 初期値は表示を切り替えて 2D の画面を作り直しても残る
  await page.getByText("3D", { exact: true }).click();
  await page.getByText("2D（編集）", { exact: true }).click();
  await tool(page, "AP");
  await expect(page.getByRole("combobox", { name: "置く AP モデル" })).toHaveValue("テスト AP");
  await expect(page.getByLabel("置く AP の設置高さ")).toHaveValue("3 m");
  await expect(page.getByLabel("置く AP の方位角")).toHaveValue("45°");
  await expect(page.getByLabel("置く AP のチルト")).toHaveValue("10°");

  // チャネルの自動割り当て（FR-6.6）。近い AP-1 と AP-3（複製）、AP-2 と AP-4 が同じチャネルを使っている
  await sidebarTab(page, "AP");
  await page.getByRole("button", { name: "チャネルの自動割り当て" }).click();
  const planDialog = page.getByRole("dialog");
  await planDialog.getByText("このフロア", { exact: true }).click();
  await expect(planDialog.getByRole("combobox", { name: "チャネル幅" })).toHaveValue("80 MHz");
  await planDialog.getByRole("button", { name: "割り当てを計算" }).click();
  await expect(planDialog.getByText(/周波数が重なる AP の組：\d+ → 0/)).toBeVisible();
  await planDialog.getByRole("button", { name: "適用" }).click();
  await expect(planDialog).toBeHidden();
  await page.getByRole("button", { name: "AP の一覧" }).click();
  const channels = await Promise.all(
    ["AP-1", "AP-2", "AP-3", "AP-4"].map((name) =>
      page
        .getByRole("dialog")
        .getByLabel(`${name} の radio1 のチャネル`, { exact: true })
        .inputValue(),
    ),
  );
  expect(new Set(channels).size).toBe(4);
  await page.keyboard.press("Escape");
  // 1 回の元に戻すで、すべてのラジオが元のチャネルに戻る
  await page.getByRole("button", { name: "元に戻す" }).click();
  await page.getByRole("button", { name: "AP の一覧" }).click();
  for (const [name, channel] of [
    ["AP-1", "149（国内不可）"],
    ["AP-2", "36"],
    ["AP-3", "149（国内不可）"],
    ["AP-4", "36"],
  ]) {
    await expect(
      page.getByRole("dialog").getByLabel(`${name} の radio1 のチャネル`, { exact: true }),
    ).toHaveValue(channel!);
  }
  await page.keyboard.press("Escape");

  if (process.env.SCREENSHOT_DIR) {
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/aps.png` });
  }
});
