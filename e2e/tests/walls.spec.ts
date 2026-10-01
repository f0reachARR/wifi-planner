import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { makeSyntheticPlanPdf } from "@wifi-planner/wall-extraction/fixtures";
import { ADMIN } from "../playwright.config";
import { addFloorWithPlan, apiOf, at, click, drag, ensureUser, newUserPage, tool } from "./helpers";

const selectedCount = (page: Page) => page.getByText(/本の壁を選択中$/);
const materialSelect = (page: Page) =>
  page.getByRole("textbox", { name: "材質" }).or(page.getByRole("combobox", { name: "材質" }));

test("壁の描画、選択、分割、結合、ドア、一括の材質変更、削除", async ({ browser }, testInfo) => {
  mkdirSync(testInfo.outputDir, { recursive: true });
  const pdfPath = path.join(testInfo.outputDir, "plan.pdf");
  writeFileSync(pdfPath, (await makeSyntheticPlanPdf()).pdf);

  const bob = await ensureUser(browser, "walls-bob", "bob-password");
  const alice = await newUserPage(browser, ADMIN.username, ADMIN.password);
  const project = await apiOf(alice).post<{ id: string }>("/projects", { name: "壁" });
  await apiOf(alice).put(`/projects/${project.id}/members/${bob.id}`, { role: "editor" });
  await alice.goto(`/projects/${project.id}`);
  await addFloorWithPlan(alice, pdfPath);

  // 折れ線の壁を描く（FR-4.4）。Enter で確定すると、描いた壁が選ばれる
  await tool(alice, "壁");
  await click(alice, 0.3, 0.3);
  await click(alice, 0.6, 0.3);
  await click(alice, 0.6, 0.6);
  await alice.keyboard.press("Enter");
  await expect(selectedCount(alice)).toHaveText("1 本の壁を選択中");
  await expect(alice.getByText(/頂点 3$/)).toBeVisible();

  // 2 本目はダブルクリックで確定する
  await click(alice, 0.3, 0.75);
  const end = await at(alice, 0.5, 0.75);
  await alice.mouse.dblclick(end.x, end.y);
  await expect(alice.getByText(/頂点 2$/)).toBeVisible();

  // 矩形選択（FR-4.5）
  await tool(alice, "選択");
  await drag(alice, [0.2, 0.2], [0.8, 0.85]);
  await expect(selectedCount(alice)).toHaveText("2 本の壁を選択中");

  // 分割して結合する
  await tool(alice, "分割");
  await click(alice, 0.45, 0.3);
  await expect(selectedCount(alice)).toHaveText("2 本の壁を選択中");
  await alice.getByRole("button", { name: "結合" }).click();
  await expect(selectedCount(alice)).toHaveText("1 本の壁を選択中");
  await expect(alice.getByText(/頂点 3$/)).toBeVisible();

  // ドアを置く（FR-4.8）
  await tool(alice, "ドア・窓");
  await click(alice, 0.45, 0.3);
  await expect(
    alice.getByRole("textbox", { name: "種類" }).or(alice.getByRole("combobox", { name: "種類" })),
  ).toHaveValue("ドア");

  // 2 本をまとめて石膏ボードにし、一度の undo で両方戻る（FR-4.6、FR-10.5）
  await tool(alice, "選択");
  await drag(alice, [0.2, 0.2], [0.8, 0.85]);
  await expect(selectedCount(alice)).toHaveText("2 本の壁を選択中");
  await materialSelect(alice).click();
  await alice.getByRole("option", { name: "石膏ボード間仕切り" }).click();
  await expect(materialSelect(alice)).toHaveValue("石膏ボード間仕切り");
  await alice.getByRole("button", { name: "元に戻す" }).click();
  await expect(materialSelect(alice)).toHaveValue("コンクリート壁");
  await alice.getByRole("button", { name: "やり直す" }).click();
  await expect(materialSelect(alice)).toHaveValue("石膏ボード間仕切り");

  // bob にも同じ壁が見える
  const bobPage = await newUserPage(browser, "walls-bob", "bob-password");
  await bobPage.goto(`/projects/${project.id}`);
  await expect(bobPage.getByLabel("接続の状態")).toHaveText("同期済み");
  await drag(bobPage, [0.2, 0.2], [0.8, 0.85]);
  await expect(selectedCount(bobPage)).toHaveText("2 本の壁を選択中");
  await expect(materialSelect(bobPage)).toHaveValue("石膏ボード間仕切り");

  // 同じ材質の壁をまとめて選ぶ
  await click(bobPage, 0.4, 0.75);
  await expect(selectedCount(bobPage)).toHaveText("1 本の壁を選択中");
  await bobPage.getByRole("button", { name: "同じ材質を選択" }).click();
  await expect(selectedCount(bobPage)).toHaveText("2 本の壁を選択中");

  // 削除と投げ縄選択
  await click(alice, 0.4, 0.75);
  await expect(selectedCount(alice)).toHaveText("1 本の壁を選択中");
  await alice.keyboard.press("Delete");
  await expect(selectedCount(alice)).toHaveCount(0);
  await expect(selectedCount(bobPage)).toHaveText("1 本の壁を選択中");

  await alice.getByText("投げ縄選択", { exact: true }).click();
  const lasso = [
    [0.25, 0.25],
    [0.7, 0.25],
    [0.7, 0.65],
    [0.25, 0.65],
  ] as const;
  const first = await at(alice, ...lasso[0]);
  await alice.mouse.move(first.x, first.y);
  await alice.mouse.down();
  for (const [fx, fy] of lasso.slice(1)) {
    const p = await at(alice, fx, fy);
    await alice.mouse.move(p.x, p.y, { steps: 4 });
  }
  await alice.mouse.up();
  await expect(selectedCount(alice)).toHaveText("1 本の壁を選択中");

  // 材質の減衰量を変える（FR-4.7）
  await alice.getByRole("button", { name: "材質", exact: true }).click();
  const loss = alice.getByLabel("コンクリート壁 の 2.4 GHz の減衰量");
  await loss.fill("15");
  await alice.keyboard.press("Escape");
  await alice.getByRole("button", { name: "材質", exact: true }).click();
  await expect(alice.getByLabel("コンクリート壁 の 2.4 GHz の減衰量")).toHaveValue("15");

  if (process.env.SCREENSHOT_DIR) {
    await alice.keyboard.press("Escape");
    await alice.screenshot({ path: `${process.env.SCREENSHOT_DIR}/walls-alice.png` });
  }
});

test("壁の高さの範囲と、高さの範囲が重なる壁の警告", async ({ browser }, testInfo) => {
  mkdirSync(testInfo.outputDir, { recursive: true });
  const pdfPath = path.join(testInfo.outputDir, "plan.pdf");
  writeFileSync(pdfPath, (await makeSyntheticPlanPdf()).pdf);
  const page = await newUserPage(browser, ADMIN.username, ADMIN.password);
  const project = await apiOf(page).post<{ id: string }>("/projects", { name: "壁の高さ" });
  await page.goto(`/projects/${project.id}`);
  await addFloorWithPlan(page, pdfPath);

  // 床から天井までの壁と、同じ線の上の腰壁を描く
  await tool(page, "壁");
  await click(page, 0.3, 0.3);
  const end = await at(page, 0.7, 0.3);
  await page.mouse.dblclick(end.x, end.y);
  await click(page, 0.4, 0.3);
  const end2 = await at(page, 0.6, 0.3);
  await page.mouse.dblclick(end2.x, end2.y);
  await expect(selectedCount(page)).toHaveText("1 本の壁を選択中");
  const top = page.getByRole("textbox", { name: "上端（床から m）" });
  await expect(top).toHaveAttribute("placeholder", "既定 3");
  await top.fill("1.2");
  await expect(
    page.getByText("高さの範囲が重なる壁が 1 組あります", { exact: false }),
  ).toBeVisible();

  // 重なる壁を選び、片方を腰壁の上の下がり壁にすると警告が消える（FR-4.11）
  await page.getByRole("button", { name: "重なる壁を選択" }).click();
  await expect(selectedCount(page)).toHaveText("2 本の壁を選択中");
  await expect(top).toHaveAttribute("placeholder", "混在");
  await tool(page, "選択");
  await click(page, 0.35, 0.3);
  await expect(selectedCount(page)).toHaveText("1 本の壁を選択中");
  await page.getByRole("textbox", { name: "下端（床から m）" }).fill("1.2");
  await expect(page.getByText("高さの範囲が重なる壁が", { exact: false })).toHaveCount(0);

  // 床から天井までに戻すと、また重なる
  await page.getByRole("button", { name: "高さを床から天井までに戻す" }).click();
  await expect(
    page.getByText("高さの範囲が重なる壁が 1 組あります", { exact: false }),
  ).toBeVisible();
});
