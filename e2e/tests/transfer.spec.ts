import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { makeSyntheticPlanPdf } from "@wifi-planner/wall-extraction/fixtures";
import { ADMIN } from "../playwright.config";
import { addFloorWithPlan, apiOf, at, click, newUserPage, tool } from "./helpers";

async function readoutAt(page: Page, fx: number, fy: number) {
  const p = await at(page, fx, fy);
  await page.mouse.move(p.x, p.y);
  const cell = page
    .getByRole("table", { name: "カーソル位置の推定受信電力" })
    .getByRole("row")
    .first()
    .getByRole("cell")
    .last();
  await expect(cell).toHaveText(/dBm$/);
  return (await cell.textContent()) ?? "";
}

test("エクスポートしたプロジェクトをインポートすると、同じヒートマップになる", async ({
  browser,
}, testInfo) => {
  mkdirSync(testInfo.outputDir, { recursive: true });
  const pdfPath = path.join(testInfo.outputDir, "plan.pdf");
  writeFileSync(pdfPath, (await makeSyntheticPlanPdf()).pdf);

  const page = await newUserPage(browser, ADMIN.username, ADMIN.password);
  await apiOf(page).post("/ap-models", {
    name: "移行用 AP",
    radios: [
      {
        key: "r5",
        bands: ["5"],
        maxTxPowerDbm: { "5": 20 },
        pattern: { kind: "omni", gainDbi: 3 },
      },
    ],
  });
  const project = await apiOf(page).post<{ id: string }>("/projects", { name: "移行元" });
  await page.goto(`/projects/${project.id}`);
  await addFloorWithPlan(page, pdfPath);
  await tool(page, "壁");
  await click(page, 0.6, 0.3);
  const end = await at(page, 0.6, 0.7);
  await page.mouse.dblclick(end.x, end.y);
  await tool(page, "AP");
  await page.getByRole("combobox", { name: "置く AP モデル" }).click();
  await page.getByRole("option", { name: "移行用 AP" }).click();
  await click(page, 0.45, 0.5);
  await tool(page, "移動");
  await expect(page.getByText(/1 本のラジオを計算済み/)).toBeVisible();
  const before = await readoutAt(page, 0.7, 0.5);

  // 書き出して、読み込む
  const zip = await page.request.get(`/api/projects/${project.id}/export`);
  expect(zip.headers()["content-type"]).toBe("application/zip");
  const zipPath = path.join(testInfo.outputDir, "project.zip");
  writeFileSync(zipPath, await zip.body());
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(zipPath);
  await expect(page.getByText("「移行元」をインポートしました")).toBeVisible();
  await expect(page).not.toHaveURL(new RegExp(project.id));
  await expect(page.getByText(/1 本のラジオを計算済み/)).toBeVisible();
  expect(await readoutAt(page, 0.7, 0.5)).toBe(before);
});
