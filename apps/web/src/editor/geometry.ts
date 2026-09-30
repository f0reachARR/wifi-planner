import { closestOnPolyline, type Rect, type Vec2, type Wall } from "@wifi-planner/domain";

export type WallEntry = Wall & { id: string };

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

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
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

/** 多角形の範囲に触れる壁（頂点が中にあるか、辺と交わる） */
export function wallsInPolygon(walls: readonly WallEntry[], polygon: readonly Vec2[]): string[] {
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

export type SnapKind = "endpoint" | "onWall" | "orthogonal" | "none";

/**
 * 描画中の点のスナップ（FR-4.4）。既存の壁の端点、既存の壁の上の点、直前の点からの直交方向の順に優先する。
 * tolerance は図面座標での距離。直交方向は図面の軸に対する角度で判定する。
 */
export function snapPoint(
  p: Vec2,
  opts: {
    walls: readonly WallEntry[];
    extraEndpoints?: readonly Vec2[];
    previous?: Vec2;
    tolerance: number;
    angleToleranceDeg?: number;
    excludeWallIds?: ReadonlySet<string>;
  },
): { point: Vec2; kind: SnapKind } {
  const candidates = opts.walls.filter((w) => !opts.excludeWallIds?.has(w.id));
  let best: Vec2 | undefined;
  let bestDist = opts.tolerance;
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

  const onWall = hitTestWall(candidates, p, opts.tolerance * 0.6);
  if (onWall) return { point: onWall.point, kind: "onWall" };

  if (opts.previous) {
    const dx = p.x - opts.previous.x;
    const dy = p.y - opts.previous.y;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const nearest = Math.round(angle / 90) * 90;
    if (Math.abs(angle - nearest) <= (opts.angleToleranceDeg ?? 7)) {
      const horizontal = nearest % 180 === 0;
      return {
        point: horizontal ? { x: p.x, y: opts.previous.y } : { x: opts.previous.x, y: p.y },
        kind: "orthogonal",
      };
    }
  }
  return { point: p, kind: "none" };
}
