import { mergeCollinear, type Point, type Segment } from "./merge.js";
import { loadOpenCV } from "./opencv.js";
import { trimToSupport } from "./support.js";
import { thinZhangSuen } from "./thinning.js";
import { polylineLengthPx, simplify, traceSkeleton } from "./trace.js";

export type RgbaImage = { data: Uint8ClampedArray; width: number; height: number };

/** 抽出の感度（FR-4.2）。長さの単位はすべて画像のピクセル */
export type ExtractMethod = "trace" | "hough";
export type ExtractPreprocess = "skeleton" | "contour";

export type ExtractParams = {
  /** trace は細線をたどって折れ線にする。hough は確率的 Hough 変換で線分を得る */
  method: ExtractMethod;
  /**
   * skeleton は細い線を消してから塗りつぶしの壁を細線化し、中心線を得る。
   * contour は先に輪郭を抽出し、輪郭の線から検出する。壁を 2 本の細い線で描いた図面向けで、壁の中心線ではなく両側の面が出る
   */
  preprocess: ExtractPreprocess;
  /** 処理する範囲（ピクセル）。省略すると画像全体 */
  region?: { x: number; y: number; width: number; height: number };
  /** 二値化の閾値（0〜255）。省略すると大津の方法で決める */
  threshold?: number;
  /** これより細い線（寸法線、文字、ハッチング）を消す。contour では使わない */
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
  method: "trace",
  preprocess: "skeleton",
  minThicknessPx: 5,
  houghThreshold: 30,
  minLineLengthPx: 40,
  maxLineGapPx: 20,
  perpendicularTolerancePx: 4,
  joinGapPx: 30,
};

export type ExtractResult = {
  /** 壁の候補の折れ線（画像のピクセル座標） */
  polylines: Point[][];
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

  const full = cv.matFromImageData(image);
  const region = params.region && clampRegion(params.region, image.width, image.height);
  const src = region
    ? full.roi(new cv.Rect(region.x, region.y, region.width, region.height))
    : full;
  const ox = region?.x ?? 0;
  const oy = region?.y ?? 0;
  const gray = new cv.Mat();
  const bin = new cv.Mat();
  const opened = new cv.Mat();
  const lines = new cv.Mat();
  let kernel: { delete(): void } | undefined;
  let skel: { delete(): void } | undefined;
  let contours: { delete(): void } | undefined;
  let hierarchy: { delete(): void } | undefined;
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    // 壁は暗く描かれているので、反転して壁を前景（255）にする
    const type =
      params.threshold === undefined ? cv.THRESH_BINARY_INV | cv.THRESH_OTSU : cv.THRESH_BINARY_INV;
    cv.threshold(gray, bin, params.threshold ?? 0, 255, type);
    lap("threshold");

    if (params.preprocess === "contour") {
      // 細い線の壁を消さないよう、太さで除く代わりに短い輪郭（文字、寸法の端の印）を捨てる
      const found = new cv.MatVector();
      contours = found;
      hierarchy = new cv.Mat();
      cv.findContours(bin, found, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_NONE);
      opened.create(bin.rows, bin.cols, cv.CV_8UC1);
      opened.setTo(new cv.Scalar(0));
      const minArc = params.minLineLengthPx * 2;
      for (let i = 0; i < found.size(); i++) {
        const c = found.get(i);
        const keep = cv.arcLength(c, true) >= minArc;
        c.delete();
        if (keep) cv.drawContours(opened, found, i, new cv.Scalar(255), 1);
      }
      lap("contour");
    } else {
      const k = Math.max(1, Math.round(params.minThicknessPx));
      kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k));
      cv.morphologyEx(bin, opened, cv.MORPH_OPEN, kernel);
      lap("open");
    }

    const thinned = thinZhangSuen(opened.data, opened.cols, opened.rows);
    const skelMat = cv.matFromArray(opened.rows, opened.cols, cv.CV_8UC1, thinned);
    skel = skelMat;
    lap("thinning");

    let polylines: Point[][];
    if (params.method === "trace") {
      const tolerance = Math.max(1.5, params.minThicknessPx / 2);
      polylines = traceSkeleton(thinned, opened.cols, opened.rows)
        .map((chain) => simplify(chain, tolerance))
        .filter((pl) => polylineLengthPx(pl) >= params.minLineLengthPx);
      lap("trace");
    } else {
      // 角度の刻みが粗いと、長い線では量子化した向きが数ピクセルずれ、線分が途切れたり画素から外れたりする
      cv.HoughLinesP(
        skelMat,
        lines,
        1,
        Math.PI / 720,
        params.houghThreshold,
        params.minLineLengthPx,
        params.maxLineGapPx,
      );
      lap("hough");
      const raw: Segment[] = [];
      // opencv.js のビルドによって N×1 と 1×N のどちらでも返るので、要素数で数えて順に読む
      const d = lines.data32S as Int32Array;
      for (let i = 0; i < d.length / 4; i++) {
        raw.push({
          a: { x: d[i * 4]!, y: d[i * 4 + 1]! },
          b: { x: d[i * 4 + 2]!, y: d[i * 4 + 3]! },
        });
      }
      const merged = mergeCollinear(raw, {
        angleToleranceDeg: 3,
        perpendicularTolerance: params.perpendicularTolerancePx,
        joinGap: params.joinGapPx,
      });
      lap("merge");
      // 結合した線分は向きを長い断片に合わせて伸ばすので、元の画素から外れていないかを確かめ、画素に合わせて引き直す
      polylines = trimToSupport(merged, thinned, opened.cols, opened.rows, {
        // 輪郭では壁の両側の線が近いので、反対側の線の画素を拾わないよう狭くする
        radius:
          params.preprocess === "contour"
            ? 2
            : Math.max(2, Math.ceil(params.perpendicularTolerancePx)),
        maxGap: params.joinGapPx,
        minLength: params.minLineLengthPx,
        minCoverage: 0.8,
      }).map((s) => [s.a, s.b]);
      lap("support");
    }
    const shifted = polylines.map((pl) => pl.map((p) => ({ x: p.x + ox, y: p.y + oy })));
    return { polylines: shifted, timingsMs: timings };
  } finally {
    for (const m of [full, gray, bin, opened, lines, kernel, skel, contours, hierarchy])
      m?.delete();
    if (src !== full) src.delete();
  }
}

function clampRegion(
  r: { x: number; y: number; width: number; height: number },
  w: number,
  h: number,
) {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const width = Math.min(w - x, Math.ceil(r.width));
  const height = Math.min(h - y, Math.ceil(r.height));
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}
