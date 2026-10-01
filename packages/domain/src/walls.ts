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
 * 端点を共有し、材質と高さの範囲が同じ 2 本の壁を 1 本にする（FR-4.4）。
 * 向きが合わなければ反転してからつなぎ、後ろの壁の開口部は前の壁の長さだけずらす。
 * 結合できないときは undefined を返す。
 */
export function mergeWalls(a: Wall, b: Wall, tolerance = 1e-6): Wall | undefined {
  if (a.materialId !== b.materialId || a.bottomM !== b.bottomM || a.topM !== b.topM)
    return undefined;
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

/** 床からの高さの範囲。下端を含み上端を含まない（設計書 6.1.1 節） */
export type HeightRange = { bottom: number; top: number };

/** 壁の高さの範囲（FR-4.10）。指定が無ければ床から天井まで */
export function wallHeightRange(
  wall: Pick<Wall, "bottomM" | "topM">,
  floorHeightM: number,
): HeightRange {
  return { bottom: wall.bottomM ?? 0, top: wall.topM ?? floorHeightM };
}

/** 開口部の高さの範囲。指定が無ければ壁と同じで、壁の範囲からはみ出す部分は切り取る */
export function openingHeightRange(
  opening: Pick<Opening, "bottomM" | "topM">,
  wall: HeightRange,
): HeightRange {
  return {
    bottom: Math.max(wall.bottom, opening.bottomM ?? wall.bottom),
    top: Math.min(wall.top, opening.topM ?? wall.top),
  };
}

/**
 * 開口部のある区間を、高さの範囲ごとに開口部と壁に分ける（設計書 4.1 節）。
 * 開口部の下と上に残る壁の部分は壁の材質になる。空の範囲は返さない
 */
export function splitByOpeningHeight(
  wall: HeightRange,
  opening: HeightRange,
): { range: HeightRange; isOpening: boolean }[] {
  const parts = [
    { range: { bottom: wall.bottom, top: Math.min(opening.bottom, wall.top) }, isOpening: false },
    { range: opening, isOpening: true },
    { range: { bottom: Math.max(opening.top, wall.bottom), top: wall.top }, isOpening: false },
  ];
  return parts.filter((p) => p.range.top > p.range.bottom);
}

/** 重なりを調べる壁。座標はメートルの共通の座標、高さは絶対の高さ */
export type WallSpan = { key: string; points: readonly Vec2[]; range: HeightRange };

const OVERLAP = { sinAngle: Math.sin((1 * Math.PI) / 180), distanceM: 0.05, minOverlapM: 0.1 };

/**
 * 平面で同じ線の上に重なり、高さの範囲も重なる壁の組（FR-4.11、設計書 4.1.1 節）。
 * 重なった部分の減衰を二重に数えることになるので、警告に使う。同じ壁の中の重なりは調べない
 */
export function overlappingWalls(spans: readonly WallSpan[]): [string, string][] {
  type Seg = { key: string; ax: number; ay: number; bx: number; by: number; range: HeightRange };
  const segs: Seg[] = [];
  for (const s of spans) {
    for (let i = 1; i < s.points.length; i++) {
      const a = s.points[i - 1]!;
      const b = s.points[i]!;
      if (a.x !== b.x || a.y !== b.y)
        segs.push({ key: s.key, ax: a.x, ay: a.y, bx: b.x, by: b.y, range: s.range });
    }
  }
  const tol = OVERLAP.distanceM;
  const found = new Set<string>();
  const out: [string, string][] = [];
  for (let i = 0; i < segs.length; i++) {
    const p = segs[i]!;
    const ux = p.bx - p.ax;
    const uy = p.by - p.ay;
    const len = Math.hypot(ux, uy);
    for (let j = i + 1; j < segs.length; j++) {
      const q = segs[j]!;
      if (q.key === p.key) continue;
      const pair = p.key < q.key ? `${p.key}\n${q.key}` : `${q.key}\n${p.key}`;
      if (found.has(pair)) continue;
      if (
        Math.max(q.ax, q.bx) < Math.min(p.ax, p.bx) - tol ||
        Math.min(q.ax, q.bx) > Math.max(p.ax, p.bx) + tol ||
        Math.max(q.ay, q.by) < Math.min(p.ay, p.by) - tol ||
        Math.min(q.ay, q.by) > Math.max(p.ay, p.by) + tol
      )
        continue;
      if (Math.max(p.range.bottom, q.range.bottom) >= Math.min(p.range.top, q.range.top)) continue;
      const vx = q.bx - q.ax;
      const vy = q.by - q.ay;
      const qlen = Math.hypot(vx, vy);
      if (Math.abs(ux * vy - uy * vx) > OVERLAP.sinAngle * len * qlen) continue;
      // q の両端が p の直線の近くにあり、p の向きに沿って重なる長さが十分あるか
      const off = (x: number, y: number) => Math.abs(ux * (y - p.ay) - uy * (x - p.ax)) / len;
      if (off(q.ax, q.ay) > tol || off(q.bx, q.by) > tol) continue;
      const along = (x: number, y: number) => (ux * (x - p.ax) + uy * (y - p.ay)) / len;
      const t0 = along(q.ax, q.ay);
      const t1 = along(q.bx, q.by);
      const overlap = Math.min(len, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));
      if (overlap < OVERLAP.minOverlapM) continue;
      found.add(pair);
      out.push([p.key, q.key]);
    }
  }
  return out;
}
