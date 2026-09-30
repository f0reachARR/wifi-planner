import {
  applyRigid,
  type Floor,
  type FloorPlacement,
  type Material,
  pointAtLength,
  type Rect,
  type Vec2,
} from "@wifi-planner/domain";
import type { GridSpec } from "@wifi-planner/propagation";

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

/** 図面の画像を貼る四角形。three.js の画像のテクスチャは上下を反転して読むので、図面の上端を v = 1 にする */
export function planQuad(
  placement: FloorPlacement,
  extent: Rect,
  imageSize: { width: number; height: number },
  h: number,
) {
  const pts: Vec2[] = [
    { x: extent.x, y: extent.y },
    { x: extent.x + extent.width, y: extent.y },
    { x: extent.x + extent.width, y: extent.y + extent.height },
    { x: extent.x, y: extent.y + extent.height },
  ];
  const corners = pts.map((p) => toThree(planToWorld(placement, p), h)) as [Vec3, Vec3, Vec3, Vec3];
  const uvs = pts.map((p) => ({ x: p.x / imageSize.width, y: 1 - p.y / imageSize.height })) as [
    Vec2,
    Vec2,
    Vec2,
    Vec2,
  ];
  return quad(corners, uvs);
}

/** ヒートマップを貼る四角形。格子はフロア座標の軸に沿い、画像の行 0 がフロア座標の y0 の側になる */
export function heatmapQuad(placement: FloorPlacement, grid: GridSpec, h: number) {
  const x0 = grid.x0 - grid.step / 2;
  const y0 = grid.y0 - grid.step / 2;
  const x1 = x0 + grid.cols * grid.step;
  const y1 = y0 + grid.rows * grid.step;
  const floorPts: Vec2[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  const corners = floorPts.map((p) => toThree(applyRigid(placement.toWorld, p), h)) as [
    Vec3,
    Vec3,
    Vec3,
    Vec3,
  ];
  // データのテクスチャは上下を反転しないので、行 0 を v = 0 にする
  const uvs: [Vec2, Vec2, Vec2, Vec2] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  return quad(corners, uvs);
}

const rgb = (hex: string): Vec3 => [
  Number.parseInt(hex.slice(1, 3), 16) / 255,
  Number.parseInt(hex.slice(3, 5), 16) / 255,
  Number.parseInt(hex.slice(5, 7), 16) / 255,
];

/** 壁を、床から天井までの高さを持つ面にする。開口部の区間は開口部の材質の色にする */
export function wallGeometry(
  floor: Floor,
  placement: FloorPlacement,
  materials: Record<string, Material>,
) {
  const positions: number[] = [];
  const colors: number[] = [];
  const bottom = floor.elevationM;
  const top = floor.elevationM + floor.heightM;
  const push = (a: Vec2, b: Vec2, color: Vec3) => {
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
      const color = opening ? rgb(materials[opening.materialId]?.color ?? "#888888") : base;
      push(pointAtLength(wall.points, s0).point, pointAtLength(wall.points, s1).point, color);
    }
  }
  return { positions: Float32Array.from(positions), colors: Float32Array.from(colors) };
}
