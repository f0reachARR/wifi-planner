import {
  closestOnPolyline,
  type Hole,
  type Rect,
  type Vec2,
  type Wall,
} from "@wifi-planner/domain";

import type { SnapGuides } from "./snap/guides";

export type WallEntry = Wall & { id: string };
export type HoleEntry = Hole & { id: string };

/** 吹き抜けの輪郭を、最初の頂点に戻る折れ線にする */
export const holeRing = (points: readonly Vec2[]): Vec2[] => [...points, points[0]!];

/** p に最も近い壁。tolerance（図面座標）より遠ければ undefined */
export function hitTestWall(walls: readonly WallEntry[], p: Vec2, tolerance: number) {
  let best: { wall: WallEntry; s: number; point: Vec2; distance: number } | undefined;
  for (const wall of walls) {
    const c = closestOnPolyline(p, wall.points);
    if (c.distance <= tolerance && (!best || c.distance < best.distance)) {
      best = { wall, s: c.s, point: c.point, distance: c.distance };
    }
  }
  return best;
}

export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (o: Vec2, p: Vec2, q: Vec2) =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function pointInPolygon(p: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/**
 * p に最も近い輪郭を持つ吹き抜け（エリアにも使う）。中を選べるようにすると範囲選択を始められなくなるので、輪郭だけで選ぶ
 */
export function hitTestHole<T extends { points: readonly Vec2[] }>(
  holes: readonly T[],
  p: Vec2,
  tolerance: number,
) {
  let best: { hole: T; distance: number } | undefined;
  for (const hole of holes) {
    const c = closestOnPolyline(p, holeRing(hole.points));
    if (c.distance <= tolerance && (!best || c.distance < best.distance))
      best = { hole, distance: c.distance };
  }
  return best?.hole;
}

/** 範囲に触れる吹き抜け */
export function holesInPolygon(holes: readonly HoleEntry[], polygon: readonly Vec2[]): string[] {
  return wallsInPolygon(
    holes.map((h) => ({ id: h.id, points: holeRing(h.points) })),
    polygon,
  );
}

/** 多角形の面積（向きによらず正） */
export function polygonArea(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** 多角形の範囲に触れる壁（頂点が中にあるか、辺と交わる） */
export function wallsInPolygon(
  walls: readonly { id: string; points: readonly Vec2[] }[],
  polygon: readonly Vec2[],
): string[] {
  if (polygon.length < 3) return [];
  return walls
    .filter((w) => {
      if (w.points.some((p) => pointInPolygon(p, polygon))) return true;
      for (let i = 1; i < w.points.length; i++) {
        for (let j = 0; j < polygon.length; j++) {
          if (
            segmentsIntersect(
              w.points[i - 1]!,
              w.points[i]!,
              polygon[j]!,
              polygon[(j + 1) % polygon.length]!,
            )
          ) {
            return true;
          }
        }
      }
      return false;
    })
    .map((w) => w.id);
}

export function rectToPolygon(r: Rect): Vec2[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}

export type SnapKind =
  | "endpoint"
  | "guideIntersection"
  | "guideEndpoint"
  | "onWall"
  | "guideAxis"
  | "onGuide"
  | "orthogonal"
  | "none";

export type SnapResult = { point: Vec2; kind: SnapKind };

/** スナップする距離（画面のピクセル） */
export const SNAP_PX = 10;

/**
 * 点のスナップ（FR-4.4）。次の順に優先する。
 * 既存の壁の端点、図面の線の交点、図面の線の端点、既存の壁の上の点、
 * 直前の点から縦横に引いた線と図面の線が交わる点、図面の線の上の点、直前の点からの直交方向。
 * 既存の壁を図面の線より優先し、描いた壁どうしのつながりを崩さない。
 * tolerance は図面座標での距離。直交方向は図面の軸に対する角度で判定する。
 */
export function snapPoint(
  p: Vec2,
  opts: {
    walls: readonly WallEntry[];
    extraEndpoints?: readonly Vec2[];
    /** スナップ用の図面の線 */
    guides?: SnapGuides;
    previous?: Vec2;
    tolerance: number;
    angleToleranceDeg?: number;
    excludeWallIds?: ReadonlySet<string>;
  },
): SnapResult {
  const tol = opts.tolerance;
  const candidates = opts.walls.filter((w) => !opts.excludeWallIds?.has(w.id));
  let best: Vec2 | undefined;
  let bestDist = tol;
  const endpoints = [
    ...candidates.flatMap((w) => [w.points[0]!, w.points.at(-1)!]),
    ...(opts.extraEndpoints ?? []),
  ];
  for (const e of endpoints) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d <= bestDist) {
      best = e;
      bestDist = d;
    }
  }
  if (best) return { point: { ...best }, kind: "endpoint" };

  const g = opts.guides;
  const cross = g?.nearestIntersection(p, tol);
  if (cross) return { point: cross, kind: "guideIntersection" };
  const guideEnd = g?.nearestEndpoint(p, tol * 0.8);
  if (guideEnd) return { point: guideEnd, kind: "guideEndpoint" };

  const onWall = hitTestWall(candidates, p, tol * 0.6);
  if (onWall) return { point: onWall.point, kind: "onWall" };

  let axis: { point: Vec2; horizontal: boolean } | undefined;
  if (opts.previous) {
    const dx = p.x - opts.previous.x;
    const dy = p.y - opts.previous.y;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const nearest = Math.round(angle / 90) * 90;
    if (Math.abs(angle - nearest) <= (opts.angleToleranceDeg ?? 7)) {
      const horizontal = nearest % 180 === 0;
      axis = {
        point: horizontal ? { x: p.x, y: opts.previous.y } : { x: opts.previous.x, y: p.y },
        horizontal,
      };
    }
  }
  if (axis && opts.previous) {
    const hit = g?.nearestOnAxis(p, opts.previous, axis.horizontal, tol);
    if (hit) return { point: hit, kind: "guideAxis" };
  }
  const onGuide = g?.nearestOnSegment(p, tol * 0.6);
  if (onGuide) return { point: onGuide, kind: "onGuide" };
  if (axis) return { point: axis.point, kind: "orthogonal" };
  return { point: p, kind: "none" };
}
