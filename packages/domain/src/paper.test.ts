import { describe, expect, it } from "vitest";
import { metersPerUnit } from "./coords.js";
import { detectPaperSize, PAPER_SIZES, ratioOfPdfScale, scaleFromRatio } from "./paper.js";

const mmToPt = (mm: number) => (mm / 25.4) * 72;
const A1 = PAPER_SIZES.find((p) => p.name === "A1")!;

describe("用紙サイズの推定", () => {
  it("縦でも横でも A3 とわかる", () => {
    expect(detectPaperSize(mmToPt(420), mmToPt(297))?.name).toBe("A3");
    expect(detectPaperSize(mmToPt(297), mmToPt(420))?.name).toBe("A3");
  });

  it("JIS B 列もわかる", () => {
    expect(detectPaperSize(mmToPt(364), mmToPt(257))?.name).toBe("B4");
  });

  it("どれにも当てはまらなければ undefined", () => {
    expect(detectPaperSize(mmToPt(300), mmToPt(300))).toBeUndefined();
  });
});

describe("縮尺からのスケール", () => {
  it("1:100 なら紙面の 1 mm が 0.1 m になる", () => {
    const scale = scaleFromRatio({
      ratio: 100,
      pageWidthPt: mmToPt(420),
      pageHeightPt: mmToPt(297),
    });
    expect(scale.distanceM).toBeCloseTo(42, 9);
    expect(metersPerUnit(scale)! * mmToPt(1)).toBeCloseTo(0.1, 9);
    expect(ratioOfPdfScale(metersPerUnit(scale)!)).toBeCloseTo(100, 9);
  });

  it("A1 の 1:100 を A3 に縮小した PDF なら、紙面上では 1:200 相当になる", () => {
    const scale = scaleFromRatio({
      ratio: 100,
      pageWidthPt: mmToPt(420),
      pageHeightPt: mmToPt(297),
      nominal: A1,
    });
    // A1 の長辺 841 mm × 100 = 84.1 m
    expect(scale.distanceM).toBeCloseTo(84.1, 9);
    expect(ratioOfPdfScale(metersPerUnit(scale)!)).toBeCloseTo(200.24, 2);
  });
});
