import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { makeSyntheticPlanPdf } from "@wifi-planner/wall-extraction/fixtures";
import sharp from "sharp";
import { ADMIN } from "../playwright.config";
import { addFloorWithPlan, apiOf, click, newUserPage, tool } from "./helpers";

/** AP の球の色（View3D の ApObject）、断面の枠の色（SectionHandle）、つまみの y 軸と z 軸の色（three.js の TransformControls） */
const AP_COLOR = [0xe8, 0x59, 0x0c] as const;
const FRAME_COLOR = [0xae, 0x3e, 0xc9] as const;
const RING_COLOR = [0x00, 0xff, 0x00] as const;
const ARROW_COLOR = [0x00, 0x00, 0xff] as const;

/** 3D ビューのキャンバスで、指定した色の画素の重心（lowest なら最も下の画素）をページの座標で返す */
async function findColor(
  page: Page,
  rgb: readonly [number, number, number],
  at: "center" | "lowest" = "center",
) {
  const canvas = page.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  const { data, info } = await sharp(await canvas.screenshot())
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sx = 0;
  let sy = 0;
  let n = 0;
  let lowest = { x: 0, y: -1 };
  for (let i = 0; i < info.width * info.height; i++) {
    const d = Math.max(...rgb.map((c, k) => Math.abs(data[i * 3 + k]! - c)));
    if (d > 12) continue;
    const x = i % info.width;
    const y = Math.floor(i / info.width);
    sx += x;
    sy += y;
    n++;
    if (y > lowest.y) lowest = { x, y };
  }
  expect(n, "その色の画素がない").toBeGreaterThan(10);
  if (at === "lowest")
    return {
      x: box.x + (lowest.x * box.width) / info.width,
      y: box.y + (lowest.y * box.height) / info.height,
    };
  return {
    x: box.x + ((sx / n) * box.width) / info.width,
    y: box.y + ((sy / n) * box.height) / info.height,
  };
}

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
  // 3D ビューで AP を選び、つまみで動かす（FR-3.6）。図面、壁、ヒートマップを消して、AP の色の画素を探す
  for (const name of ["図面", "壁", "ヒートマップ"])
    await page.getByRole("switch", { name, exact: true }).uncheck({ force: true });
  const ap = await findColor(page, AP_COLOR);
  await page.mouse.click(ap.x, ap.y);
  await expect(page.getByLabel("3D ビューで選択中")).toHaveText(/^AP「.+」$/);
  // つまみの中心をつかむと、画面に平行な面の上で動かせる
  await page.mouse.move(ap.x, ap.y);
  await page.mouse.down();
  await page.mouse.move(ap.x + 80, ap.y + 20, { steps: 10 });
  await page.mouse.up();
  if (process.env.SCREENSHOT_DIR)
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/view3d-ap-move.png` });
  // 選択を解除してつまみを消すと、AP は動かした先にある
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("3D ビューで選択中")).toHaveCount(0);
  const moved = await findColor(page, AP_COLOR);
  expect(Math.hypot(moved.x - ap.x, moved.y - ap.y)).toBeGreaterThan(40);
  // 動かした操作は 1 回の元に戻すで戻る
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect
    .poll(async () => {
      const back = await findColor(page, AP_COLOR);
      return Math.hypot(back.x - ap.x, back.y - ap.y);
    })
    .toBeLessThan(2);
  // 方位角とチルトのつまみはそれぞれ 1 本の軸のまわりの輪だけ。輪の手前の端をつかんで横に動かすと値が変わる（2D の画面で確かめる）
  await page.mouse.click(ap.x, ap.y);
  for (const kind of ["方位角", "チルト"]) {
    await page.getByRole("radiogroup", { name: "つまみの種類" }).getByText(kind).click();
    const ring = await findColor(page, RING_COLOR, "lowest");
    if (process.env.SCREENSHOT_DIR)
      await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/view3d-ap-${kind}.png` });
    await page.mouse.move(ring.x, ring.y - 1);
    await page.mouse.down();
    await page.mouse.move(ring.x + 40, ring.y - 1, { steps: 10 });
    await page.mouse.up();
  }
  if (process.env.SCREENSHOT_DIR)
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/view3d-ap-rotated.png` });
  await page.keyboard.press("Escape");
  for (const name of ["図面", "壁", "ヒートマップ"])
    await page.getByRole("switch", { name, exact: true }).check({ force: true });

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

  // 断面の枠の中をクリックして選び、つまみで断面に垂直な向きに動かすと、位置のスライダーも動く
  await page.getByRole("switch", { name: "ヒートマップ", exact: true }).uncheck({ force: true });
  const frame = await findColor(page, FRAME_COLOR);
  // 枠の中心には AP があるので、少し上をクリックする
  await page.mouse.click(frame.x, frame.y - 40);
  await expect(page.getByLabel("3D ビューで選択中")).toHaveText("断面");
  // 断面のつまみは移動と回転だけ。AP でチルトを選んでいたときは回転になる
  await expect(
    page.getByRole("radiogroup", { name: "つまみの種類" }).getByRole("radio", { name: "回転" }),
  ).toBeChecked();
  await page.getByRole("radiogroup", { name: "つまみの種類" }).getByText("移動").click();
  const arrow = await findColor(page, ARROW_COLOR);
  await page.mouse.move(arrow.x, arrow.y);
  await page.mouse.down();
  await page.mouse.move(arrow.x + 60, arrow.y + 30, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByRole("slider", { name: "断面の位置" })).not.toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  await expect(page.getByRole("slider", { name: "断面の向き" })).toHaveAttribute(
    "aria-valuenow",
    "90",
  );
  if (process.env.SCREENSHOT_DIR) {
    await page.getByRole("radiogroup", { name: "つまみの種類" }).getByText("回転").click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/view3d-section-rotate.png` });
  }

  // 2D に戻すと編集の画面に戻る
  await page.getByText("2D（編集）").click();
  await expect(page.getByRole("button", { name: "図面の調整" })).toBeVisible();
  // 3D ビューで回した AP の方位角とチルトが、2D の画面にも出る
  await page.getByText("1F", { exact: true }).click();
  await click(page, 0.5, 0.5);
  await expect(page.getByLabel("方位角")).not.toHaveValue("0°");
  await expect(page.getByLabel("チルト")).not.toHaveValue("0°");
});
