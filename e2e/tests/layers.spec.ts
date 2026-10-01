import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { makeSyntheticPlanPdf } from "@wifi-planner/wall-extraction/fixtures";
import { ADMIN } from "../playwright.config";
import { addFloorWithPlan, apiOf, at, click, drag, newUserPage, sidebarTab, tool } from "./helpers";

const activeTab = (page: Page) => page.getByRole("tab", { selected: true });

/** 道具のバーの「表示」で種別の表示を切り替える */
async function setLayer(page: Page, name: string, shown: boolean) {
  await page.getByRole("button", { name: /^表示/ }).click();
  await page.getByRole("checkbox", { name, exact: true }).setChecked(shown);
  await page.keyboard.press("Escape");
}

test("表示する種別の切り替えと、右のパネルのタブ", async ({ browser }, testInfo) => {
  mkdirSync(testInfo.outputDir, { recursive: true });
  const pdfPath = path.join(testInfo.outputDir, "plan.pdf");
  writeFileSync(pdfPath, (await makeSyntheticPlanPdf()).pdf);

  const page = await newUserPage(browser, ADMIN.username, ADMIN.password);
  await apiOf(page).post("/ap-models", {
    name: "表示用 AP",
    radios: [
      {
        key: "r5",
        bands: ["5"],
        maxTxPowerDbm: { "5": 20 },
        pattern: { kind: "omni", gainDbi: 3 },
      },
    ],
  });
  const project = await apiOf(page).post<{ id: string }>("/projects", { name: "表示" });
  await page.goto(`/projects/${project.id}`);
  await addFloorWithPlan(page, pdfPath);
  await expect(activeTab(page)).toHaveText("全体");

  // 図面の上で選んだ要素の種類のタブに切り替わる
  await tool(page, "壁");
  await click(page, 0.3, 0.3);
  const end = await at(page, 0.7, 0.3);
  await page.mouse.dblclick(end.x, end.y);
  await expect(activeTab(page)).toHaveText("壁");
  await expect(page.getByText("1 本の壁を選択中")).toBeVisible();
  await tool(page, "AP");
  await page.getByRole("combobox", { name: "置く AP モデル" }).click();
  await page.getByRole("option", { name: "表示用 AP" }).click();
  await click(page, 0.5, 0.6);
  await expect(activeTab(page)).toHaveText("AP");
  // 選択を外してもタブは変わらない
  await tool(page, "選択");
  await click(page, 0.85, 0.45);
  await expect(page.getByText("「AP」の道具でモデルを選び", { exact: false })).toBeVisible();
  await expect(activeTab(page)).toHaveText("AP");

  // 壁を隠すと、クリックでも範囲選択でも壁は選ばれない（FR-8.9）
  await setLayer(page, "壁", false);
  await expect(page.getByRole("button", { name: "表示（1 種を非表示）" })).toBeVisible();
  await sidebarTab(page, "全体");
  await click(page, 0.5, 0.3);
  await expect(activeTab(page)).toHaveText("全体");
  await drag(page, [0.2, 0.2], [0.8, 0.8]);
  await expect(activeTab(page)).toHaveText("AP");
  await sidebarTab(page, "壁");
  await expect(page.getByText(/本の壁を選択中$/)).toHaveCount(0);

  // 壁の道具を選ぶと、壁が表示に戻る。壁の道具を使っている間に壁を隠すと、選択の道具に戻る
  await tool(page, "壁");
  await expect(page.getByRole("button", { name: "表示", exact: true })).toBeVisible();
  await setLayer(page, "壁", false);
  await expect(page.getByRole("radio", { name: "選択", exact: true })).toBeChecked();
  await setLayer(page, "壁", true);

  // ヒートマップを隠すと計算しない。表示の設定とタブは、フロアを切り替えても保つ
  await setLayer(page, "ヒートマップ", false);
  const hiddenNote = page.getByText("ヒートマップを隠しているので計算していません", {
    exact: false,
  });
  await expect(hiddenNote).toBeVisible();
  await sidebarTab(page, "エリア");
  await addFloorWithPlan(page, pdfPath);
  await expect(hiddenNote).toBeVisible();
  await expect(activeTab(page)).toHaveText("エリア");
  await setLayer(page, "ヒートマップ", true);
  await expect(hiddenNote).toHaveCount(0);
});
