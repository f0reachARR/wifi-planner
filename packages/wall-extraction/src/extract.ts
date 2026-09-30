import { mergeCollinear, type Segment } from "./merge.js";
import { loadOpenCV } from "./opencv.js";
import { thinZhangSuen } from "./thinning.js";

export type RgbaImage = { data: Uint8ClampedArray; width: number; height: number };

/** 抽出の感度（FR-4.2）。長さの単位はすべて画像のピクセル */
export type ExtractParams = {
  /** 二値化の閾値（0〜255）。省略すると大津の方法で決める */
  threshold?: number;
  /** これより細い線（寸法線、文字、ハッチング）を消す */
  minThicknessPx: number;
  /** HoughLinesP の投票数 */
  houghThreshold: number;
  minLineLengthPx: number;
  maxLineGapPx: number;
  /** 同じ壁とみなす、線分どうしの垂直方向のずれ */
  perpendicularTolerancePx: number;
  /** 同じ壁とみなす、線に沿った方向の隙間。ドアの開口より小さくする */
  joinGapPx: number;
};

export const DEFAULT_PARAMS: ExtractParams = {
  minThicknessPx: 5,
  houghThreshold: 30,
  minLineLengthPx: 40,
  maxLineGapPx: 20,
  perpendicularTolerancePx: 4,
  joinGapPx: 30,
};

export type ExtractResult = {
  segments: Segment[];
  timingsMs: Record<string, number>;
};

export async function extractWalls(
  image: RgbaImage,
  params: ExtractParams = DEFAULT_PARAMS,
): Promise<ExtractResult> {
  const cv = await loadOpenCV();
  const timings: Record<string, number> = {};
  let t = performance.now();
  const lap = (name: string) => {
    const now = performance.now();
    timings[name] = now - t;
    t = now;
  };

  const src = cv.matFromImageData(image);
  const gray = new cv.Mat();
  const bin = new cv.Mat();
  const opened = new cv.Mat();
  const lines = new cv.Mat();
  let kernel: { delete(): void } | undefined;
  let skel: { delete(): void } | undefined;
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    // 壁は暗く描かれているので、反転して壁を前景（255）にする
    const type =
      params.threshold === undefined ? cv.THRESH_BINARY_INV | cv.THRESH_OTSU : cv.THRESH_BINARY_INV;
    cv.threshold(gray, bin, params.threshold ?? 0, 255, type);
    lap("threshold");

    const k = Math.max(1, Math.round(params.minThicknessPx));
    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k));
    cv.morphologyEx(bin, opened, cv.MORPH_OPEN, kernel);
    lap("open");

    const thinned = thinZhangSuen(opened.data, opened.cols, opened.rows);
    const skelMat = cv.matFromArray(opened.rows, opened.cols, cv.CV_8UC1, thinned);
    skel = skelMat;
    lap("thinning");

    cv.HoughLinesP(
      skelMat,
      lines,
      1,
      Math.PI / 180,
      params.houghThreshold,
      params.minLineLengthPx,
      params.maxLineGapPx,
    );
    lap("hough");

    const raw: Segment[] = [];
    // opencv.js のビルドによって N×1 と 1×N のどちらでも返るので、要素数で数えて順に読む
    const d = lines.data32S as Int32Array;
    const n = d.length / 4;
    for (let i = 0; i < n; i++) {
      raw.push({
        a: { x: d[i * 4]!, y: d[i * 4 + 1]! },
        b: { x: d[i * 4 + 2]!, y: d[i * 4 + 3]! },
      });
    }
    const segments = mergeCollinear(raw, {
      angleToleranceDeg: 3,
      perpendicularTolerance: params.perpendicularTolerancePx,
      joinGap: params.joinGapPx,
    }).filter((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) >= params.minLineLengthPx);
    lap("merge");
    timings.houghSegments = raw.length;
    return { segments, timingsMs: timings };
  } finally {
    for (const m of [src, gray, bin, opened, lines, kernel, skel]) m?.delete();
  }
}
