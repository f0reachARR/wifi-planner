import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { makeSyntheticPlanPdf } from "@wifi-planner/wall-extraction/fixtures";
import { ADMIN } from "../playwright.config";
import { addFloorWithPlan, apiOf, click, newUserPage, tool } from "./helpers";

test("フロアの位置合わせ、重ね表示、疑似 3D ビュー", async ({ browser }, testInfo) => {
  mkdirSync(testInfo.outputDir, { recursive: true });
  const pdfPath = path.join(testInfo.outputDir, "plan.pdf");
  writeFileSync(pdfPath, (await makeSyntheticPlanPdf()).pdf);

  const page = await newUserPage(browser, ADMIN.username, ADMIN.password);
  await apiOf(page).post("/ap-models", {
    name: "3D 用 AP",
    radios: [
      {
        key: "r5",
        bands: ["5"],
        maxTxPowerDbm: { "5": 20 },
        pattern: { kind: "omni", gainDbi: 3 },
      },
    ],
  });
  const project = await apiOf(page).post<{ id: string }>("/projects", { name: "複数フロア" });
  await page.goto(`/projects/${project.id}`);

  // 1F：図面、壁、AP、基準点
  await addFloorWithPlan(page, pdfPath);
  await tool(page, "壁");
  await click(page, 0.3, 0.3);
  const end = await (async () => {
    const box = (await page.locator("canvas").first().boundingBox())!;
    return { x: box.x + box.width * 0.7, y: box.y + box.height * 0.3 };
  })();
  await page.mouse.dblclick(end.x, end.y);
  await tool(page, "AP");
  await page.getByRole("combobox", { name: "置く AP モデル" }).click();
  await page.getByRole("option", { name: "3D 用 AP" }).click();
  await click(page, 0.5, 0.5);
  await tool(page, "位置合わせ");
  await click(page, 0.2, 0.2);
  await click(page, 0.8, 0.2);
  await expect(page.getByText("このフロアが位置合わせの基準です", { exact: false })).toBeVisible();

  // 2F：同じ図面を取り込み、同じ 2 点で位置を合わせる
  await addFloorWithPlan(page, pdfPath);
  await expect(page.getByText("まだ位置を合わせていません", { exact: false })).toBeVisible();
  await tool(page, "位置合わせ");
  await click(page, 0.2, 0.2);
  await click(page, 0.8, 0.2);
  await expect(page.getByText("基準フロアに位置を合わせました")).toBeVisible();

  // 2F に吹き抜けを描く（FR-3.8）。3 点を置いて Enter で閉じる
  await tool(page, "吹き抜け");
  await click(page, 0.4, 0.4);
  await click(page, 0.6, 0.4);
  await click(page, 0.6, 0.6);
  await page.keyboard.press("Enter");
  await expect(page.getByText(/吹き抜け 1 個を選択中（[\d.]+ m²）/)).toBeVisible();

  // 1F を重ねる（FR-3.3）
  await page.getByRole("switch", { name: "1F を重ねる" }).check();
  // 2F に AP は無いが、1F の AP が床スラブを通して届く（FR-7.5、FR-7.6）
  await expect(page.getByText(/1 本のラジオを計算済み/)).toBeVisible();
  // 他のフロアの AP を含めない設定にすると、2F では計算するラジオが無くなる（FR-7.8）
  const select = (name: string) =>
    page.getByRole("textbox", { name }).or(page.getByRole("combobox", { name }));
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await select("計算に含める他のフロアの AP").click();
  await page.getByRole("option", { name: "同じフロアだけ" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText(/0 本のラジオを計算済み/)).toBeVisible();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await select("計算に含める他のフロアの AP").click();
  await page.getByRole("option", { name: "全フロア" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText(/1 本のラジオを計算済み/)).toBeVisible();
  // フロアの床スラブは既定でプリセットの材質になる（FR-3.1）
  await page.getByRole("button", { name: "2F の操作" }).click();
  await page.getByRole("menuitem", { name: "設定" }).click();
  await expect(select("床スラブの材質")).toHaveValue("RC 床スラブ");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("slider", { name: "1F の不透明度" })).toBeVisible();

  // 疑似 3D ビュー（FR-3.4〜3.6）
  await page.getByText("3D", { exact: true }).click();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByLabel("表示中のフロア")).toHaveText(
    "表示中のフロア：1F（床 0 m）、2F（床 3 m）",
  );
  // 図面と壁の不透明度をそれぞれ変えられる
  await expect(page.getByRole("slider", { name: "図面の不透明度" })).toHaveAttribute(
    "aria-valuenow",
    "0.5",
  );
  await page.getByRole("slider", { name: "壁の不透明度" }).focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("slider", { name: "壁の不透明度" })).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  // 高さだけを引き伸ばしても、床の高さの表示は実際の値のまま（FR-3.7）
  await page.getByRole("radiogroup", { name: "高さの倍率" }).getByText("×3").click();
  await expect(page.getByText("高さだけを 3 倍にしています", { exact: false })).toBeVisible();
  await expect(page.getByLabel("表示中のフロア")).toHaveText(
    "表示中のフロア：1F（床 0 m）、2F（床 3 m）",
  );
  // 縦の断面（FR-3.9）。1F の AP の電波を、2F まで断面の上で計算する
  await page.getByRole("switch", { name: "縦の断面" }).check();
  await expect(page.getByLabel("断面の状態")).toHaveText(/^断面：\d+×\d+ 点、1 本のラジオ$/);
  await page.getByRole("button", { name: "90°" }).click();
  await expect(page.getByRole("slider", { name: "断面の向き" })).toHaveAttribute(
    "aria-valuenow",
    "90",
  );
  await expect(page.getByLabel("断面の状態")).toHaveText(/^断面：\d+×\d+ 点、1 本のラジオ$/);
  if (process.env.SCREENSHOT_DIR) {
    // テクスチャの読み込みを待ってから撮る
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/view3d.png` });
  }

  // 2D に戻すと編集の画面に戻る
  await page.getByText("2D（編集）").click();
  await expect(page.getByRole("button", { name: "図面の調整" })).toBeVisible();
});
