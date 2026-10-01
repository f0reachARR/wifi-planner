import type { ScaleCalibration } from "./schema.js";

// PDF の図面座標の単位はポイント（1/72 インチ、設計書 3 章）。
// 縮尺 1:N で描かれた図面なら、紙面上の長さを N 倍すれば実際の長さになる。

const METERS_PER_POINT = 0.0254 / 72;
const MM_PER_POINT = 25.4 / 72;
/** 用紙サイズとみなす寸法の誤差（mm） */
const PAPER_TOLERANCE_MM = 3;

export type PaperSize = { name: string; shortMm: number; longMm: number };

/** 図面でよく使う用紙サイズ（ISO A 列、JIS B 列） */
export const PAPER_SIZES: readonly PaperSize[] = [
  { name: "A0", shortMm: 841, longMm: 1189 },
  { name: "A1", shortMm: 594, longMm: 841 },
  { name: "A2", shortMm: 420, longMm: 594 },
  { name: "A3", shortMm: 297, longMm: 420 },
  { name: "A4", shortMm: 210, longMm: 297 },
  { name: "B0", shortMm: 1030, longMm: 1456 },
  { name: "B1", shortMm: 728, longMm: 1030 },
  { name: "B2", shortMm: 515, longMm: 728 },
  { name: "B3", shortMm: 364, longMm: 515 },
  { name: "B4", shortMm: 257, longMm: 364 },
];

export function pointsToMm(pt: number): number {
  return pt * MM_PER_POINT;
}

/** ページの寸法（ポイント）から用紙サイズを推定する。縦横は問わない。当てはまらなければ undefined */
export function detectPaperSize(widthPt: number, heightPt: number): PaperSize | undefined {
  const short = pointsToMm(Math.min(widthPt, heightPt));
  const long = pointsToMm(Math.max(widthPt, heightPt));
  return PAPER_SIZES.find(
    (p) =>
      Math.abs(p.shortMm - short) <= PAPER_TOLERANCE_MM &&
      Math.abs(p.longMm - long) <= PAPER_TOLERANCE_MM,
  );
}

/**
 * 縮尺からスケールを作る。値はページの上端（幅いっぱい）を 2 点とした校正として表す。
 * 元の用紙（nominal）を指定すると、縮小して出力された PDF でも元の用紙での縮尺として扱う
 * （例：A1 で 1:100 の図面を A3 に縮小した PDF）。
 */
export function scaleFromRatio(opts: {
  ratio: number;
  pageWidthPt: number;
  pageHeightPt: number;
  nominal?: PaperSize;
}): ScaleCalibration {
  const { ratio, pageWidthPt, pageHeightPt, nominal } = opts;
  let enlargement = 1;
  if (nominal) {
    // 長辺どうしを比べる（縦横どちらの向きでも同じ倍率になる）
    enlargement = nominal.longMm / pointsToMm(Math.max(pageWidthPt, pageHeightPt));
  }
  return scaleFromMetersPerUnit(METERS_PER_POINT * enlargement * ratio, pageWidthPt);
}

/** 図面座標の 1 単位が何メートルかからスケールを作る。2 点はページの上端（幅いっぱい）に置く */
export function scaleFromMetersPerUnit(metersPerUnit: number, pageWidth: number): ScaleCalibration {
  return {
    a: { x: 0, y: 0 },
    b: { x: pageWidth, y: 0 },
    distanceM: pageWidth * metersPerUnit,
  };
}

/** PDF の図面で、スケールが紙面上で 1:N に当たるときの N */
export function ratioOfPdfScale(metersPerUnit: number): number {
  return metersPerUnit / METERS_PER_POINT;
}
