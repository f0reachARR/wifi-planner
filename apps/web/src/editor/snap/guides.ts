import type { Vec2 } from "@wifi-planner/domain";

// スナップ用の図面の線（輪郭を抽出して Hough 変換で得た線分）と、その交点と端点。
// 実際の図面では線分が数千本になるので、交点の計算もスナップの検索も格子のバケツで近くのものだけを調べる。

export type GuideSegment = { a: Vec2; b: Vec2 };

export type SnapGuides = {
  segments: readonly GuideSegment[];
  intersections: readonly Vec2[];
  endpoints: readonly Vec2[];
  /** p から距離 r 以内の交点（なければ undefined） */
  nearestIntersection(p: Vec2, r: number): Vec2 | undefined;
  nearestEndpoint(p: Vec2, r: number): Vec2 | undefined;
  /** p から距離 r 以内の線分の上で、p にいちばん近い点 */
  nearestOnSegment(p: Vec2, r: number): Vec2 | undefined;
  /**
   * 点 origin を通る水平線（horizontal）か垂直線と線分が交わる点のうち、p から距離 r 以内でいちばん近いもの。
   * 直前の点から縦横に引いた線と図面の線が交わる点にスナップするのに使う
   */
  nearestOnAxis(p: Vec2, origin: Vec2, horizontal: boolean, r: number): Vec2 | undefined;
};

export type BuildGuidesOptions = {
  /** 角で線が少し手前で止まっていても交わるよう、交点を探すときに両端を延ばす長さ */
  extend: number;
  /** 交点を探す線分の組の、向きの差の下限（度）。ほぼ平行な線の交点は位置が定まらないので除く */
  minAngleDeg: number;
  /** これより近い交点を 1 点にまとめる */
  mergeDistance: number;
};

/** 格子のバケツ。セルごとに、そのセルに掛かる要素の番号を持つ */
class Grid {
  private readonly cells = new Map<string, number[]>();
  constructor(readonly size: number) {}

  private range(min: number, max: number) {
    return [Math.floor(min / this.size), Math.floor(max / this.size)] as const;
  }

  insertBox(i: number, x0: number, y0: number, x1: number, y1: number) {
    const [cx0, cx1] = this.range(Math.min(x0, x1), Math.max(x0, x1));
    const [cy0, cy1] = this.range(Math.min(y0, y1), Math.max(y0, y1));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = `${cx},${cy}`;
        const cell = this.cells.get(key);
        if (cell) cell.push(i);
        else this.cells.set(key, [i]);
      }
    }
  }

  /** 範囲に掛かるセルの要素の番号（重複なし） */
  query(x0: number, y0: number, x1: number, y1: number): Set<number> {
    const out = new Set<number>();
    const [cx0, cx1] = this.range(x0, x1);
    const [cy0, cy1] = this.range(y0, y1);
    // 範囲が広すぎるとき（大きく縮小した表示など）は、セルを数えるより全部のセルを見るほうが速い
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > this.cells.size) {
      for (const cell of this.cells.values()) for (const i of cell) out.add(i);
      return out;
    }
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (const i of this.cells.get(`${cx},${cy}`) ?? []) out.add(i);
      }
    }
    return out;
  }
}

/** 2 本の線分（端を extend だけ延ばす）の交点 */
function intersect(s: GuideSegment, t: GuideSegment, extend: number, minSin: number) {
  const dx1 = s.b.x - s.a.x;
  const dy1 = s.b.y - s.a.y;
  const dx2 = t.b.x - t.a.x;
  const dy2 = t.b.y - t.a.y;
  const l1 = Math.hypot(dx1, dy1);
  const l2 = Math.hypot(dx2, dy2);
  if (l1 === 0 || l2 === 0) return undefined;
  const cross = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(cross) < minSin * l1 * l2) return undefined;
  // s.a + u·d1 = t.a + v·d2
  const ex = t.a.x - s.a.x;
  const ey = t.a.y - s.a.y;
  const u = (ex * dy2 - ey * dx2) / cross;
  const v = (ex * dy1 - ey * dx1) / cross;
  const eu = extend / l1;
  const ev = extend / l2;
  if (u < -eu || u > 1 + eu || v < -ev || v > 1 + ev) return undefined;
  return { x: s.a.x + dx1 * u, y: s.a.y + dy1 * u };
}

function closestOnSegment(p: Vec2, s: GuideSegment): Vec2 {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2));
  return { x: s.a.x + dx * t, y: s.a.y + dy * t };
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

export function buildSnapGuides(
  segments: readonly GuideSegment[],
  opts: BuildGuidesOptions,
): SnapGuides {
  // セルの大きさは、線分の平均の長さを目安にする。小さすぎると長い線分が多くのセルに入り、大きすぎると絞り込めない
  const meanLen =
    segments.reduce((sum, s) => sum + dist(s.a, s.b), 0) / Math.max(1, segments.length);
  const size = Math.max(opts.extend * 4, meanLen, 1e-6);
  const segGrid = new Grid(size);
  segments.forEach((s, i) => {
    segGrid.insertBox(i, s.a.x, s.a.y, s.b.x, s.b.y);
  });

  const minSin = Math.sin((opts.minAngleDeg * Math.PI) / 180);
  const merged = new Map<string, Vec2>();
  const m = Math.max(opts.mergeDistance, 1e-9);
  segments.forEach((s, i) => {
    const e = opts.extend;
    const near = segGrid.query(
      Math.min(s.a.x, s.b.x) - e,
      Math.min(s.a.y, s.b.y) - e,
      Math.max(s.a.x, s.b.x) + e,
      Math.max(s.a.y, s.b.y) + e,
    );
    for (const j of near) {
      if (j <= i) continue;
      const p = intersect(s, segments[j]!, e, minSin);
      if (!p) continue;
      const key = `${Math.round(p.x / m)},${Math.round(p.y / m)}`;
      if (!merged.has(key)) merged.set(key, p);
    }
  });
  const intersections = [...merged.values()];
  const endpoints = segments.flatMap((s) => [s.a, s.b]);

  const pointGrid = (points: readonly Vec2[]) => {
    const g = new Grid(size);
    points.forEach((p, i) => {
      g.insertBox(i, p.x, p.y, p.x, p.y);
    });
    return (p: Vec2, r: number) => {
      let best: Vec2 | undefined;
      let bestD = r;
      for (const i of g.query(p.x - r, p.y - r, p.x + r, p.y + r)) {
        const d = dist(points[i]!, p);
        if (d <= bestD) {
          best = points[i];
          bestD = d;
        }
      }
      return best && { ...best };
    };
  };

  return {
    segments,
    intersections,
    endpoints,
    nearestIntersection: pointGrid(intersections),
    nearestEndpoint: pointGrid(endpoints),
    nearestOnSegment: (p, r) => {
      let best: Vec2 | undefined;
      let bestD = r;
      for (const i of segGrid.query(p.x - r, p.y - r, p.x + r, p.y + r)) {
        const q = closestOnSegment(p, segments[i]!);
        const d = dist(q, p);
        if (d <= bestD) {
          best = q;
          bestD = d;
        }
      }
      return best;
    },
    nearestOnAxis: (p, origin, horizontal, r) => {
      // 軸の上で p にいちばん近い点の周りだけを調べる
      const q = horizontal ? { x: p.x, y: origin.y } : { x: origin.x, y: p.y };
      let best: Vec2 | undefined;
      let bestD = r;
      for (const i of segGrid.query(q.x - r, q.y - r, q.x + r, q.y + r)) {
        const s = segments[i]!;
        const [c0, c1] = horizontal ? [s.a.y, s.b.y] : [s.a.x, s.b.x];
        const c = horizontal ? origin.y : origin.x;
        if (c0 === c1 || (c - c0) * (c - c1) > 0) continue;
        const t = (c - c0) / (c1 - c0);
        const hit = horizontal
          ? { x: s.a.x + (s.b.x - s.a.x) * t, y: c }
          : { x: c, y: s.a.y + (s.b.y - s.a.y) * t };
        const d = dist(hit, p);
        if (d <= bestD) {
          best = hit;
          bestD = d;
        }
      }
      return best;
    },
  };
}
