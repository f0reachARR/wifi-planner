import { distance, polylineLength, type Vec2 } from "./geometry.js";
import type { Opening, Wall } from "./schema.js";

// 壁（折れ線）の幾何の操作。開口部の位置は折れ線に沿った距離で持つ（設計書 4.1 節）。

/** 点から線分への最近点。t は線分上の位置（0〜1） */
export function closestOnSegment(
  p: Vec2,
  a: Vec2,
  b: Vec2,
): { point: Vec2; t: number; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { point, t, distance: distance(p, point) };
}

/** 点から折れ線への最近点と、その位置の折れ線に沿った距離 */
export function closestOnPolyline(p: Vec2, points: readonly Vec2[]) {
  let best = { point: points[0]!, distance: Number.POSITIVE_INFINITY, s: 0, segment: 0 };
  let offset = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = closestOnSegment(p, a, b);
    const len = distance(a, b);
    if (c.distance < best.distance)
      best = { point: c.point, distance: c.distance, s: offset + c.t * len, segment: i - 1 };
    offset += len;
  }
  return best;
}

/** 折れ線に沿った距離 s の位置の点と、その点を含む線分の添字 */
export function pointAtLength(
  points: readonly Vec2[],
  s: number,
): { point: Vec2; segment: number } {
  let offset = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = distance(a, b);
    if (s <= offset + len || i === points.length - 1) {
      const t = len === 0 ? 0 : Math.min(1, Math.max(0, (s - offset) / len));
      return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, segment: i - 1 };
    }
    offset += len;
  }
  return { point: points[0]!, segment: 0 };
}

/**
 * 壁を折れ線に沿った距離 s で 2 本に分ける（FR-4.4）。
 * 分割位置より前の開口部は前の壁に、後ろの開口部は位置をずらして後ろの壁に移し、分割位置をまたぐ開口部は二つに切る。
 * 端に近すぎて分けられないときは undefined を返す。
 */
export function splitWall(
  wall: Wall,
  s: number,
  newOpeningId: () => string,
): [Wall, Wall] | undefined {
  const total = polylineLength(wall.points);
  if (s <= 0 || s >= total) return undefined;
  const { point, segment } = pointAtLength(wall.points, s);
  const first = [...wall.points.slice(0, segment + 1), point];
  const second = [point, ...wall.points.slice(segment + 1)];
  // 分割点が既存の頂点と重なるときは、同じ点が 2 回並ばないようにする
  const dedupe = (pts: Vec2[]) => pts.filter((p, i) => i === 0 || distance(p, pts[i - 1]!) > 0);

  const before: Opening[] = [];
  const after: Opening[] = [];
  for (const o of wall.openings) {
    if (o.end <= s) before.push(o);
    else if (o.start >= s) after.push({ ...o, start: o.start - s, end: o.end - s });
    else {
      before.push({ ...o, end: s });
      after.push({ ...o, id: newOpeningId(), start: 0, end: o.end - s });
    }
  }
  return [
    { ...wall, points: dedupe(first), openings: before },
    { ...wall, points: dedupe(second), openings: after },
  ];
}

/** 壁の向きを反転する。開口部の位置も反対の端から測り直す */
export function reverseWall(wall: Wall): Wall {
  const total = polylineLength(wall.points);
  return {
    ...wall,
    points: [...wall.points].reverse(),
    openings: wall.openings.map((o) => ({ ...o, start: total - o.end, end: total - o.start })),
  };
}

/**
 * 端点を共有し、材質が同じ 2 本の壁を 1 本にする（FR-4.4）。
 * 向きが合わなければ反転してからつなぎ、後ろの壁の開口部は前の壁の長さだけずらす。
 * 結合できないときは undefined を返す。
 */
export function mergeWalls(a: Wall, b: Wall, tolerance = 1e-6): Wall | undefined {
  if (a.materialId !== b.materialId) return undefined;
  const near = (p: Vec2, q: Vec2) => distance(p, q) <= tolerance;
  const aStart = a.points[0]!;
  const aEnd = a.points.at(-1)!;
  const bStart = b.points[0]!;
  const bEnd = b.points.at(-1)!;
  let first: Wall;
  let second: Wall;
  if (near(aEnd, bStart)) [first, second] = [a, b];
  else if (near(aEnd, bEnd)) [first, second] = [a, reverseWall(b)];
  else if (near(aStart, bEnd)) [first, second] = [b, a];
  else if (near(aStart, bStart)) [first, second] = [reverseWall(a), b];
  else return undefined;
  const offset = polylineLength(first.points);
  const points = [...first.points, ...second.points.slice(1)];
  // つなぎ目がまっすぐなら頂点を取り除く。長さは変わらないので開口部の位置はそのまま使える
  const joint = first.points.length - 1;
  const prev = points[joint - 1];
  const next = points[joint + 1];
  const mid = points[joint]!;
  if (prev && next) {
    const ux = mid.x - prev.x;
    const uy = mid.y - prev.y;
    const vx = next.x - mid.x;
    const vy = next.y - mid.y;
    const cross = ux * vy - uy * vx;
    const scale = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (scale > 0 && Math.abs(cross) <= 1e-9 * scale && ux * vx + uy * vy > 0)
      points.splice(joint, 1);
  }
  return {
    ...first,
    points,
    openings: [
      ...first.openings,
      ...second.openings.map((o) => ({ ...o, start: o.start + offset, end: o.end + offset })),
    ],
  };
}

export function translateWall(wall: Wall, dx: number, dy: number): Wall {
  return { ...wall, points: wall.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
}

/** 開口部を追加できるか。壁の範囲に収まり、既存の開口部と重ならないこと */
export function canPlaceOpening(
  wall: Wall,
  start: number,
  end: number,
  ignoreId?: string,
): boolean {
  const total = polylineLength(wall.points);
  if (start < 0 || end > total + 1e-9 || start >= end) return false;
  return wall.openings.every((o) => o.id === ignoreId || o.end <= start || o.start >= end);
}
