import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, extractWalls } from "./extract.js";
import { evaluateRecall, makeSyntheticPlanPdf } from "./fixtures.js";
import { mergeCollinear } from "./merge.js";
import { rasterizePdfPage, readPdfInfo } from "./pdf.js";
import { thinZhangSuen } from "./thinning.js";

describe("細線化", () => {
  it("太い横線を 1 画素幅にする", () => {
    const w = 20;
    const h = 9;
    const img = new Uint8Array(w * h);
    for (let y = 2; y <= 6; y++) for (let x = 2; x < 18; x++) img[y * w + x] = 255;
    const thin = thinZhangSuen(img, w, h);
    for (let x = 5; x < 15; x++) {
      let count = 0;
      for (let y = 0; y < h; y++) if (thin[y * w + x]) count++;
      expect(count).toBe(1);
    }
  });
});

describe("線分の結合", () => {
  it("同一直線上の断片はつなぎ、ドアの開口より広い隙間はつながない", () => {
    const merged = mergeCollinear(
      [
        { a: { x: 0, y: 0 }, b: { x: 50, y: 0 } },
        { a: { x: 60, y: 1 }, b: { x: 100, y: 1 } },
        { a: { x: 170, y: 0 }, b: { x: 200, y: 0 } },
        { a: { x: 0, y: 10 }, b: { x: 100, y: 10 } },
      ],
      { angleToleranceDeg: 3, perpendicularTolerance: 4, joinGap: 30 },
    );
    expect(merged).toHaveLength(3);
  });
});

describe("合成図面からの壁抽出", () => {
  it("A3 横の PDF を 200 dpi でラスタ化し、壁の大半を抽出する", async () => {
    const plan = await makeSyntheticPlanPdf();
    const [info] = await readPdfInfo(plan.pdf);
    expect(info?.widthPt).toBeCloseTo(1190.55, 1);

    const page = await rasterizePdfPage(plan.pdf, 1, 200);
    expect(page.width).toBe(3308);
    const k = 1 / page.unitsPerPx;
    const truth = plan.walls.map((s) => ({
      a: { x: s.a.x * k, y: s.a.y * k },
      b: { x: s.b.x * k, y: s.b.y * k },
    }));
    const image = { data: page.rgba, width: page.width, height: page.height };
    // 精度の評価は実際の図面が届いてから行う（設計書 9.3 節）。ここでは退行を防ぐ下限だけを置く
    const trace = await extractWalls(image, { ...DEFAULT_PARAMS, method: "trace" });
    const hough = await extractWalls(image, { ...DEFAULT_PARAMS, method: "hough" });
    const recall = (r: typeof trace) =>
      evaluateRecall(truth, r.polylines, { maxDistance: 6, minCover: 0.8 }).recall;
    expect(recall(trace)).toBeGreaterThanOrEqual(0.95);
    expect(recall(hough)).toBeGreaterThanOrEqual(0.8);
  }, 30_000);
});

describe("処理する範囲", () => {
  it("範囲を指定すると、その中の壁だけを画像全体の座標で返す", async () => {
    const plan = await makeSyntheticPlanPdf();
    const page = await rasterizePdfPage(plan.pdf, 1, 100);
    const image = { data: page.rgba, width: page.width, height: page.height };
    const region = { x: 0, y: 0, width: page.width / 2, height: page.height };
    const r = await extractWalls(image, {
      ...DEFAULT_PARAMS,
      minThicknessPx: 3,
      minLineLengthPx: 20,
      region,
    });
    expect(r.polylines.length).toBeGreaterThan(0);
    for (const pl of r.polylines) for (const p of pl) expect(p.x).toBeLessThanOrEqual(region.width);
  }, 30_000);
});
