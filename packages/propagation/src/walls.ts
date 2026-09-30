import type { Vec2 } from "@wifi-planner/domain";

/** 伝搬計算に渡す壁。座標はフロア座標（メートル）、開口部の位置は折れ線に沿った距離（メートル） */
export type WallInput = {
  points: readonly Vec2[];
  lossDb: number;
  openings: readonly { start: number; end: number; lossDb: number }[];
};

/** 壁を、減衰量が一定の線分に分けて平らな配列に並べたもの */
export type SegmentSet = {
  /** 線分ごとに ax, ay, bx, by, minX, minY, maxX, maxY の 8 要素 */
  coords: Float64Array;
  lossDb: Float32Array;
  count: number;
};

const STRIDE = 8;

export function buildSegments(walls: readonly WallInput[]): SegmentSet {
  const coords: number[] = [];
  const loss: number[] = [];
  const push = (a: Vec2, b: Vec2, lossDb: number) => {
    if (a.x === b.x && a.y === b.y) return;
    coords.push(
      a.x,
      a.y,
      b.x,
      b.y,
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.max(a.x, b.x),
      Math.max(a.y, b.y),
    );
    loss.push(lossDb);
  };

  for (const wall of walls) {
    const openings = [...wall.openings].sort((a, b) => a.start - b.start);
    let offset = 0;
    for (let i = 1; i < wall.points.length; i++) {
      const a = wall.points[i - 1]!;
      const b = wall.points[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len === 0) continue;
      // この線分と重なる開口部の境界で線分を切り、区間ごとの減衰量を割り当てる
      const cuts = [0, len];
      for (const o of openings) {
        if (o.start > offset && o.start < offset + len) cuts.push(o.start - offset);
        if (o.end > offset && o.end < offset + len) cuts.push(o.end - offset);
      }
      cuts.sort((x, y) => x - y);
      for (let k = 1; k < cuts.length; k++) {
        const s0 = cuts[k - 1]!;
        const s1 = cuts[k]!;
        if (s1 <= s0) continue;
        const mid = offset + (s0 + s1) / 2;
        const opening = openings.find((o) => o.start <= mid && mid < o.end);
        const p0 = { x: a.x + ((b.x - a.x) * s0) / len, y: a.y + ((b.y - a.y) * s0) / len };
        const p1 = { x: a.x + ((b.x - a.x) * s1) / len, y: a.y + ((b.y - a.y) * s1) / len };
        push(p0, p1, opening ? opening.lossDb : wall.lossDb);
      }
      offset += len;
    }
  }
  return { coords: Float64Array.from(coords), lossDb: Float32Array.from(loss), count: loss.length };
}

/**
 * p→q の線分が横切る壁区間の減衰量の合計。
 * 壁区間は始点を含み終点を含まない半開区間として判定し、折れ線の頂点を通る線分で減衰を二重に数えないようにする。
 */
export function wallLossDb(
  set: SegmentSet,
  px: number,
  py: number,
  qx: number,
  qy: number,
): number {
  const { coords, lossDb, count } = set;
  const rx = qx - px;
  const ry = qy - py;
  const minX = Math.min(px, qx);
  const maxX = Math.max(px, qx);
  const minY = Math.min(py, qy);
  const maxY = Math.max(py, qy);
  let total = 0;
  for (let i = 0; i < count; i++) {
    const o = i * STRIDE;
    if (
      coords[o + 6]! < minX ||
      coords[o + 4]! > maxX ||
      coords[o + 7]! < minY ||
      coords[o + 5]! > maxY
    ) {
      continue;
    }
    const ax = coords[o]!;
    const ay = coords[o + 1]!;
    const sx = coords[o + 2]! - ax;
    const sy = coords[o + 3]! - ay;
    const denom = rx * sy - ry * sx;
    if (denom === 0) continue; // 平行。壁に沿って進む経路は横切らないものとする
    const apx = ax - px;
    const apy = ay - py;
    const t = (apx * sy - apy * sx) / denom;
    const u = (apx * ry - apy * rx) / denom;
    if (t >= 0 && t <= 1 && u >= 0 && u < 1) total += lossDb[i]!;
  }
  return total;
}
