import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { makeSyntheticPlanPdf } from "@wifi-planner/wall-extraction/fixtures";
import { ADMIN } from "../playwright.config";
import { addFloorWithPlan, apiOf, at, click, newUserPage, tool } from "./helpers";

/** カーソル位置の読み取りの、最も強い AP の値（dBm） */
async function readoutAt(page: Page, fx: number, fy: number): Promise<number> {
  const p = await at(page, fx, fy);
  await page.mouse.move(p.x, p.y);
  const cell = page
    .getByRole("table", { name: "カーソル位置の推定受信電力" })
    .getByRole("row")
    .first()
    .getByRole("cell")
    .last();
  await expect(cell).toHaveText(/dBm$/);
  return Number.parseFloat((await cell.textContent()) ?? "NaN");
}

async function pixelAt(page: Page, fx: number, fy: number) {
  const box = (await page.locator("canvas").first().boundingBox())!;
  return page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector("canvas")!;
      const ratio = canvas.width / canvas.getBoundingClientRect().width;
      return Array.from(
        canvas.getContext("2d")!.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1)
          .data,
      );
    },
    { x: box.width * fx, y: box.height * fy },
  );
}

test("ヒートマップの計算、表示、壁の減衰、読み取り", async ({ browser }, testInfo) => {
  mkdirSync(testInfo.outputDir, { recursive: true });
  const pdfPath = path.join(testInfo.outputDir, "plan.pdf");
  writeFileSync(pdfPath, (await makeSyntheticPlanPdf()).pdf);

  const page = await newUserPage(browser, ADMIN.username, ADMIN.password);
  await apiOf(page).post("/ap-models", {
    name: "無指向性 AP",
    radios: [
      {
        key: "r5",
        bands: ["5"],
        maxTxPowerDbm: { "5": 20 },
        pattern: { kind: "omni", gainDbi: 3 },
      },
    ],
  });
  const project = await apiOf(page).post<{ id: string }>("/projects", { name: "ヒートマップ" });
  await page.goto(`/projects/${project.id}`);
  await addFloorWithPlan(page, pdfPath);

  await tool(page, "AP");
  await page.getByRole("combobox", { name: "置く AP モデル" }).click();
  await page.getByRole("option", { name: "無指向性 AP" }).click();
  await click(page, 0.5, 0.5);
  await expect(page.getByText(/1 本のラジオを計算済み/)).toBeVisible();

  // AP のすぐ横は最も強い区切りの色（緑）で塗られる。ヒートマップが AP の位置に重なっている
  await tool(page, "移動");
  await page.mouse.move(0, 0);
  const near = await pixelAt(page, 0.53, 0.5);
  expect(near[1]).toBeGreaterThan(near[0]!);

  // 壁のない左右対称の 2 点は同じ値になる
  const left0 = await readoutAt(page, 0.35, 0.5);
  const right0 = await readoutAt(page, 0.65, 0.5);
  expect(Math.abs(left0 - right0)).toBeLessThan(1);

  // 右側に壁を描くと、壁の向こうだけが壁の減衰量（コンクリート壁の 5 GHz で 20 dB）ほど下がる（FR-8.8）
  await tool(page, "壁");
  await click(page, 0.58, 0.3);
  const end = await at(page, 0.58, 0.7);
  await page.mouse.dblclick(end.x, end.y);
  await tool(page, "移動");
  await expect(async () => {
    const right1 = await readoutAt(page, 0.65, 0.5);
    expect(right0 - right1).toBeGreaterThan(18);
    expect(right0 - right1).toBeLessThan(22);
  }).toPass();
  const left1 = await readoutAt(page, 0.35, 0.5);
  expect(Math.abs(left1 - left0)).toBeLessThan(1);

  // 表示の切り替え（FR-8.5、FR-8.6）
  await page.getByRole("combobox", { name: "表示" }).click();
  await page.getByRole("option", { name: "AP 数" }).click();
  await expect(page.getByText("1 台", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "表示" }).click();
  await page.getByRole("option", { name: "同一チャネル干渉" }).click();
  await expect(page.getByText("2 台が重なる")).toBeVisible();
  await page.getByRole("combobox", { name: "表示" }).click();
  await page.getByRole("option", { name: "受信電力" }).click();

  if (process.env.SCREENSHOT_DIR) {
    await readoutAt(page, 0.45, 0.45);
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/heatmap.png` });
  }
});
