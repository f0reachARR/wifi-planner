import { expect, test } from "@playwright/test";
import {
  addAp,
  addWalls,
  defaultRadios,
  floorsMap,
  putApModelSnapshot,
  updateFloor,
} from "@wifi-planner/domain/ops";
import { ADMIN } from "../playwright.config";
import { editDoc } from "./doc";
import { apiOf, newUserPage } from "./helpers";

// NFR-1：30 m × 30 m、AP 10 台、壁 300 本、格子 0.5 m で、AP を動かしてからヒートマップが更新されるまでを 1 秒程度に収める
test("NFR-1 の条件で、AP を動かしてからヒートマップが更新されるまでの時間", async ({ browser }) => {
  const page = await newUserPage(browser, ADMIN.username, ADMIN.password);
  const project = await apiOf(page).post<{ id: string }>("/projects", { name: "性能" });
  // 30 m 四方の白い図面。1 単位を 1 cm とする
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    "base64",
  );
  const upload = await page.request.post(`/api/projects/${project.id}/plans`, {
    headers: { "x-wifi-planner": "1" },
    multipart: { file: { name: "white.png", mimeType: "image/png", buffer: png } },
  });
  const planInfo = (await upload.json()).plan;

  let floorId = "";
  await page.goto(`/projects/${project.id}`);
  await page.getByRole("button", { name: "追加" }).click();
  await expect(page.getByText("このフロアには図面がありません")).toBeVisible();

  await editDoc(page, project.id, (ydoc) => {
    floorId = [...floorsMap(ydoc).keys()][0]!;
    // 1 ピクセルの画像を 3000 単位（30 m）に引き伸ばした図面にする
    updateFloor(ydoc, floorId, {
      plan: { ...planInfo, widthPx: 1, heightPx: 1, unitsPerPx: 3000, rotationDeg: 0 },
      scale: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, distanceM: 1 },
    });
    const model = {
      name: "性能試験 AP",
      radios: [
        {
          key: "r5",
          bands: ["5" as const],
          maxTxPowerDbm: { "5": 20 },
          pattern: { kind: "omni" as const, gainDbi: 3 },
        },
      ],
    };
    putApModelSnapshot(ydoc, "perf-model", model);
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const walls = Array.from({ length: 300 }, () => {
      const x = rand() * 3000;
      const y = rand() * 3000;
      const len = 100 + rand() * 500;
      const horizontal = rand() < 0.5;
      return {
        points: [
          { x, y },
          horizontal ? { x: Math.min(x + len, 3000), y } : { x, y: Math.min(y + len, 3000) },
        ],
        materialId: rand() < 0.5 ? "drywall" : "concrete",
        openings: [],
      };
    });
    addWalls(ydoc, floorId, walls);
    for (let i = 0; i < 10; i++) {
      addAp(ydoc, floorId, {
        name: `AP-${i + 1}`,
        modelId: "perf-model",
        position: { x: 300 + (i % 5) * 600, y: 750 + Math.floor(i / 5) * 1500 },
        heightM: 2.7,
        mount: "ceiling",
        azimuthDeg: 0,
        tiltDeg: 0,
        radios: defaultRadios(model),
      });
    }
  });

  const status = page.getByText(/本のラジオを計算済み/);
  await expect(status).toHaveText(/^10 本のラジオを計算済み（61×61 点/, { timeout: 15_000 });
  // 最初の計算は全ラジオを計算するので、壁や材質を変えたときと同じ量になる
  console.log(`全ラジオの計算：${await status.textContent()}`);

  // AP-1 をドラッグして、計算済みの表示に戻るまでを測る
  const box = (await page.locator("canvas").first().boundingBox())!;
  const panel = page.getByText(/本のラジオを計算済み|計算中/);
  // AP-1 の画面上の位置は、読み取りの表から探す代わりに、図面の全体表示の倍率から求める
  const scale = Math.min((box.width - 80) / 3000, (box.height - 80) / 3000);
  const origin = {
    x: box.x + (box.width - 3000 * scale) / 2,
    y: box.y + (box.height - 3000 * scale) / 2,
  };
  const ap = { x: origin.x + 300 * scale, y: origin.y + 750 * scale };
  await page.mouse.move(ap.x, ap.y);
  await page.mouse.down();
  await page.mouse.move(ap.x + 60, ap.y + 40, { steps: 5 });
  const t0 = Date.now();
  await page.mouse.up();
  await expect(panel).toHaveText(/計算中/);
  await expect(panel).toHaveText(/本のラジオを計算済み/);
  const elapsed = Date.now() - t0;
  const workerMs = Number((await panel.textContent())?.match(/、(\d+) ms/)?.[1]);
  console.log(`AP を離してから更新まで ${elapsed} ms（Worker の計算 ${workerMs} ms）`);
  expect(elapsed).toBeLessThan(1500);
});
