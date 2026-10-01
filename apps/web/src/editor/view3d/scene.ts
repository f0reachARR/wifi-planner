import {
  applyRigid,
  type Floor,
  type FloorPlacement,
  type HeightRange,
  type Material,
  openingHeightRange,
  pointAtLength,
  type Rect,
  splitByOpeningHeight,
  type Vec2,
  wallHeightRange,
} from "@wifi-planner/domain";
import type { GridSpec } from "@wifi-planner/propagation";
import { ShapeUtils, Vector2 } from "three";

// 疑似 3D ビューの形（FR-3.4〜3.6）。ワールド座標の (x, y) と高さ h を、three.js の y 軸を上とする座標 (x, h, -y) に置く。

export type Vec3 = [number, number, number];

export const toThree = (p: Vec2, h: number): Vec3 => [p.x, h, -p.y];

/** 図面座標の点をワールド座標にする */
export const planToWorld = (placement: FloorPlacement, p: Vec2) =>
  applyRigid(placement.toWorld, placement.plan.toFloor(p));

/** 四角形（2 つの三角形）の頂点と UV。corners は左上、右上、右下、左下の順 */
function quad(corners: [Vec3, Vec3, Vec3, Vec3], uvs: [Vec2, Vec2, Vec2, Vec2]) {
  const order = [0, 1, 2, 0, 2, 3];
  return {
    positions: Float32Array.from(order.flatMap((i) => corners[i]!)),
    uvs: Float32Array.from(order.flatMap((i) => [uvs[i]!.x, uvs[i]!.y])),
  };
}

/** 多角形を軸に沿った長方形の中に切り取る（Sutherland–Hodgman 法） */
export function clipToRect(points: readonly Vec2[], r: Rect): Vec2[] {
  const edges: [(p: Vec2) => number, (a: Vec2, b: Vec2) => Vec2][] = [];
  const at = (a: Vec2, b: Vec2, t: number) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  for (const [axis, bound, sign] of [
    ["x", r.x, 1],
    ["x", r.x + r.width, -1],
    ["y", r.y, 1],
    ["y", r.y + r.height, -1],
  ] as const) {
    const inside = (p: Vec2) => sign * (p[axis] - bound);
    edges.push([inside, (a, b) => at(a, b, inside(a) / (inside(a) - inside(b)))]);
  }
  let out = [...points];
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]!;
      const prev = input[(i + input.length - 1) % input.length]!;
      if (inside(cur) >= 0) {
        if (inside(prev) < 0) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev) >= 0) {
        out.push(cut(prev, cur));
      }
    }
  }
  return out;
}

const area = (points: readonly Vec2[]) =>
  points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length]!;
    return sum + p.x * q.y - q.x * p.y;
  }, 0) / 2;

/**
 * 長方形から吹き抜けを抜いた面の三角形。rect と holes は同じ 2D 座標で表し、
 * to3 と toUv でその座標から頂点の位置と UV を求める。吹き抜けがなければ四角形を 2 つの三角形にする
 */
function holedRect(
  rect: Rect,
  holes: readonly (readonly Vec2[])[],
  to3: (p: Vec2) => Vec3,
  toUv: (p: Vec2) => Vec2,
) {
  const pts: Vec2[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  // 長方形の外にはみ出した部分は三角形分割できないので切り取る
  const clipped = holes
    .map((h) => clipToRect(h, rect))
    .filter((h) => h.length >= 3 && Math.abs(area(h)) > 1e-9);
  if (clipped.length === 0) {
    return quad(
      pts.map(to3) as [Vec3, Vec3, Vec3, Vec3],
      pts.map(toUv) as [Vec2, Vec2, Vec2, Vec2],
    );
  }
  // triangulateShape は閉じた端点の重複を除くために配列を書き換えるので、その後の配列で頂点を並べる
  const contour = pts.map((p) => new Vector2(p.x, p.y));
  const holeVecs = clipped.map((h) => h.map((p) => new Vector2(p.x, p.y)));
  const faces = ShapeUtils.triangulateShape(contour, holeVecs);
  const all = [...contour, ...holeVecs.flat()].map((v) => ({ x: v.x, y: v.y }));
  const order = faces.flat();
  return {
    positions: Float32Array.from(order.flatMap((i) => to3(all[i]!))),
    uvs: Float32Array.from(
      order.flatMap((i) => {
        const uv = toUv(all[i]!);
        return [uv.x, uv.y];
      }),
    ),
  };
}

/**
 * 図面の画像を貼る面。three.js の画像のテクスチャは上下を反転して読むので、図面の上端を v = 1 にする。
 * holes は吹き抜けの多角形（図面座標）で、その範囲は抜いて下の階が見えるようにする
 */
export function planQuad(
  placement: FloorPlacement,
  extent: Rect,
  imageSize: { width: number; height: number },
  h: number,
  holes: readonly (readonly Vec2[])[] = [],
) {
  return holedRect(
    extent,
    holes,
    (p) => toThree(planToWorld(placement, p), h),
    (p) => ({ x: p.x / imageSize.width, y: 1 - p.y / imageSize.height }),
  );
}

/**
 * ヒートマップを貼る面。格子はフロア座標の軸に沿い、画像の行 0 がフロア座標の y0 の側になる。
 * holes は吹き抜けの多角形（図面座標）で、その範囲は抜く
 */
export function heatmapQuad(
  placement: FloorPlacement,
  grid: GridSpec,
  h: number,
  holes: readonly (readonly Vec2[])[] = [],
) {
  const x0 = grid.x0 - grid.step / 2;
  const y0 = grid.y0 - grid.step / 2;
  const width = grid.cols * grid.step;
  const height = grid.rows * grid.step;
  // データのテクスチャは上下を反転しないので、行 0 を v = 0 にする
  return holedRect(
    { x: x0, y: y0, width, height },
    holes.map((hole) => hole.map((p) => placement.plan.toFloor(p))),
    (p) => toThree(applyRigid(placement.toWorld, p), h),
    (p) => ({ x: (p.x - x0) / width, y: (p.y - y0) / height }),
  );
}

const rgb = (hex: string): Vec3 => [
  Number.parseInt(hex.slice(1, 3), 16) / 255,
  Number.parseInt(hex.slice(3, 5), 16) / 255,
  Number.parseInt(hex.slice(5, 7), 16) / 255,
];

/**
 * 壁を、壁ごとの高さの範囲（FR-4.10）を持つ面にする。開口部の区間は、開口部の高さの範囲を開口部の材質の色にし、
 * その上下を壁の材質の色にする。heightScale は見やすさのために高さ方向だけを引き伸ばす倍率
 */
export function wallGeometry(
  floor: Floor,
  placement: FloorPlacement,
  materials: Record<string, Material>,
  heightScale = 1,
) {
  const positions: number[] = [];
  const colors: number[] = [];
  const push = (a: Vec2, b: Vec2, color: Vec3, range: HeightRange) => {
    const bottom = (floor.elevationM + range.bottom) * heightScale;
    const top = (floor.elevationM + range.top) * heightScale;
    const wa = planToWorld(placement, a);
    const wb = planToWorld(placement, b);
    const corners: Vec3[] = [
      toThree(wa, top),
      toThree(wb, top),
      toThree(wb, bottom),
      toThree(wa, bottom),
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      positions.push(...corners[i]!);
      colors.push(...color);
    }
  };
  for (const wall of Object.values(floor.walls)) {
    const base = rgb(materials[wall.materialId]?.color ?? "#888888");
    const range = wallHeightRange(wall, floor.heightM);
    const cuts = new Set<number>([0]);
    let total = 0;
    for (let i = 1; i < wall.points.length; i++) {
      total += Math.hypot(
        wall.points[i]!.x - wall.points[i - 1]!.x,
        wall.points[i]!.y - wall.points[i - 1]!.y,
      );
      cuts.add(total);
    }
    for (const o of wall.openings) {
      cuts.add(o.start);
      cuts.add(o.end);
    }
    const sorted = [...cuts].filter((c) => c >= 0 && c <= total).sort((a, b) => a - b);
    for (let k = 1; k < sorted.length; k++) {
      const s0 = sorted[k - 1]!;
      const s1 = sorted[k]!;
      if (s1 - s0 < 1e-9) continue;
      const mid = (s0 + s1) / 2;
      const opening = wall.openings.find((o) => o.start <= mid && mid < o.end);
      const a = pointAtLength(wall.points, s0).point;
      const b = pointAtLength(wall.points, s1).point;
      if (!opening) {
        push(a, b, base, range);
        continue;
      }
      const color = rgb(materials[opening.materialId]?.color ?? "#888888");
      for (const part of splitByOpeningHeight(range, openingHeightRange(opening, range)))
        push(a, b, part.isOpening ? color : base, part.range);
    }
  }
  return { positions: Float32Array.from(positions), colors: Float32Array.from(colors) };
}
