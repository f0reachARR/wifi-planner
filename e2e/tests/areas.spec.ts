import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { makeSyntheticPlanPdf } from "@wifi-planner/wall-extraction/fixtures";
import { ADMIN } from "../playwright.config";
import { addFloorWithPlan, apiOf, click, drag, newUserPage, tool } from "./helpers";

test("エリアの人数と、エリア内の AP 1 台あたりの人数", async ({ browser }, testInfo) => {
  mkdirSync(testInfo.outputDir, { recursive: true });
  const pdfPath = path.join(testInfo.outputDir, "plan.pdf");
  writeFileSync(pdfPath, (await makeSyntheticPlanPdf()).pdf);

  const page = await newUserPage(browser, ADMIN.username, ADMIN.password);
  await apiOf(page).post("/ap-models", {
    name: "エリア用 AP",
    radios: [
      {
        key: "r5",
        bands: ["5"],
        maxTxPowerDbm: { "5": 20 },
        pattern: { kind: "omni", gainDbi: 3 },
      },
    ],
  });
  const project = await apiOf(page).post<{ id: string }>("/projects", { name: "エリア" });
  await page.goto(`/projects/${project.id}`);
  await addFloorWithPlan(page, pdfPath);

  // エリアを描き、人数を入れる（FR-11.1）
  await tool(page, "エリア");
  await click(page, 0.3, 0.3);
  await click(page, 0.7, 0.3);
  await click(page, 0.7, 0.7);
  await click(page, 0.3, 0.7);
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("名前")).toHaveValue("エリア 1");
  await page.getByLabel("人数", { exact: true }).fill("40");
  await page.getByLabel("人数", { exact: true }).blur();
  // 人がいるのに AP がないエリアは警告する（FR-11.3）
  await expect(
    page.getByText("AP 1 台あたり：AP なし（人がいるのに AP がありません）"),
  ).toBeVisible();

  // エリアの中に AP を 2 台置くと、20 人/AP になる（FR-11.2、FR-11.5）
  await tool(page, "AP");
  await page.getByRole("combobox", { name: "置く AP モデル" }).click();
  await page.getByRole("option", { name: "エリア用 AP" }).click();
  await click(page, 0.4, 0.5);
  await click(page, 0.6, 0.5);
  const row = page.getByRole("row", { name: /エリア 1/ });
  const cells = row.getByRole("cell");
  await expect(cells.nth(1)).toHaveText("40");
  await expect(cells.nth(2)).toHaveText("2");
  await expect(cells.nth(3)).toHaveText("20.0");

  // 1 台をエリアの外に動かすと 40 人/AP になり、目安の 30 人を超えたことを示す
  await tool(page, "選択");
  await drag(page, [0.6, 0.5], [0.85, 0.5]);
  await expect(cells.nth(2)).toHaveText("1");
  await expect(cells.nth(3)).toHaveText("40.0");
  await row.click();
  await expect(
    page.getByText("AP 1 台あたり：40.0 人/AP（目安の 30 人を超えています）"),
  ).toBeVisible();

  // 1 回の元に戻すで 20 人/AP に戻る（FR-10.5）
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(cells.nth(3)).toHaveText("20.0");

  // やり直してから目安を上げると、警告が消える（FR-11.3）
  await page.getByRole("button", { name: "やり直す" }).click();
  await expect(cells.nth(3)).toHaveText("40.0");
  await page.getByLabel("AP 1 台あたりの人数の目安").fill("50");
  await expect(page.getByText("AP 1 台あたり：40.0 人/AP", { exact: true })).toBeVisible();

  // 重なるエリアを描くと警告する（FR-11.4）
  await tool(page, "エリア");
  await click(page, 0.5, 0.2);
  await click(page, 0.9, 0.2);
  await click(page, 0.9, 0.6);
  await page.keyboard.press("Enter");
  await expect(page.getByText(/重なっているエリアが 2 個あります/)).toBeVisible();
});
