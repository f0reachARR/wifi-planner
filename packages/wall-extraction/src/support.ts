import type { Point, Segment } from "./merge.js";

/**
 * 線分を、前景の画素で裏付けられた区間だけに切り詰め、その画素に合わせて引き直す。
 * Hough 変換は、たまたま一直線に並んだ無関係な画素（文字、ハッチング、家具の線）をつないで線分にすることがあり、
 * 線分の結合も向きを長い断片に合わせて隙間の先まで伸ばすため、図面に線のないところへ線分が出る。
 * 線分を 1 画素ずつたどり、前景のない区間が maxGap より長ければそこで切る。切った区間のうち、前景で覆われた割合が
 * minCoverage 未満のもの（点在する画素を結んだだけの線）と、minLength より短いものは捨てる。
 * 残った区間は、たどる途中で見つけた前景の画素に最小二乗で直線を当てはめ、両端の画素をその直線へ射影して端点にする。
 */
export function trimToSupport(
  segments: readonly Segment[],
  mask: Uint8Array,
  width: number,
  height: number,
  opts: { radius: number; maxGap: number; minLength: number; minCoverage: number },
): Segment[] {
  const r = Math.max(0, Math.round(opts.radius));
  /** (x, y) にいちばん近い前景の画素。半径 r の中になければ undefined */
  const nearestInk = (x: number, y: number): Point | undefined => {
    const cx = Math.round(x);
    const cy = Math.round(y);
    let best: Point | undefined;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      const yy = cy + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = cx + dx;
        if (xx < 0 || xx >= width || mask[yy * width + xx] === 0) continue;
        const d = (xx - x) ** 2 + (yy - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { x: xx, y: yy };
        }
      }
    }
    return best;
  };

  const out: Segment[] = [];
  for (const s of segments) {
    const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    if (len === 0) continue;
    const steps = Math.ceil(len);
    const stepLen = len / steps;
    const at = (i: number) => {
      const t = i / steps;
      return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
    };
    // 裏付けのある区間 [first, last] と、その中で見つけた前景の画素
    let first = -1;
    let last = -1;
    let inks: Point[] = [];
    const flush = () => {
      if (first < 0) return;
      const runLen = (last - first) * stepLen;
      if (runLen >= opts.minLength && inks.length / (last - first + 1) >= opts.minCoverage) {
        out.push(fitSegment(inks, inks[0]!, inks[inks.length - 1]!));
      }
      first = -1;
      inks = [];
    };
    for (let i = 0; i <= steps; i++) {
      const p = at(i);
      const ink = nearestInk(p.x, p.y);
      if (!ink) {
        if (first >= 0 && (i - last) * stepLen > opts.maxGap) flush();
        continue;
      }
      if (first < 0) first = i;
      last = i;
      inks.push(ink);
    }
    flush();
  }
  return out;
}

/** 点の列に主成分分析で直線を当てはめ、区間の両端 a、b をその直線へ射影した線分を返す */
function fitSegment(points: readonly Point[], a: Point, b: Point): Segment {
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= points.length;
  my /= points.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  let ux: number;
  let uy: number;
  if (sxx + syy === 0) {
    // 点が 1 か所に集まっていれば、元の向きを使う
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    ux = (b.x - a.x) / l;
    uy = (b.y - a.y) / l;
  } else {
    const theta = Math.atan2(2 * sxy, sxx - syy) / 2;
    ux = Math.cos(theta);
    uy = Math.sin(theta);
  }
  const project = (p: Point) => {
    const t = (p.x - mx) * ux + (p.y - my) * uy;
    return { x: mx + ux * t, y: my + uy * t };
  };
  return { a: project(a), b: project(b) };
}
