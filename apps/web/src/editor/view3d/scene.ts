import {
  applyRigid,
  type Floor,
  type FloorPlacement,
  type HeightRange,
  invertRigid,
  type Material,
  type MountType,
  openingHeightRange,
  pointAtLength,
  type Rect,
  splitByOpeningHeight,
  type Vec2,
  wallHeightRange,
} from "@wifi-planner/domain";
import {
  antennaFrame,
  type GridSpec,
  rotateFrame,
  type SectionBounds,
  type SectionGrid,
  type SectionParams,
} from "@wifi-planner/propagation";
import { ShapeUtils, Vector2 } from "three";

// 疑似 3D ビューの形（FR-3.4〜3.6）。ワールド座標の (x, y) と高さ h を、three.js の y 軸を上とする座標 (x, h, -y) に置く。

export type Vec3 = [number, number, number];

export const toThree = (p: Vec2, h: number): Vec3 => [p.x, h, -p.y];

/** 図面座標の点をワールド座標にする */
export const planToWorld = (placement: FloorPlacement, p: Vec2) =>
  applyRigid(placement.toWorld, placement.plan.toFloor(p));

/** three.js の座標の点を、そのフロアの図面座標にする。高さは捨てる */
export const threeToPlan = (placement: FloorPlacement, p: Vec3): Vec2 =>
  placement.plan.toPlan(applyRigid(invertRigid(placement.toWorld), { x: p[0], y: -p[2] }));

/** フロアの置き方の回転（フロア座標からワールド座標へ）の角度。ラジアン */
const placementAngle = (placement: FloorPlacement) =>
  Math.atan2(placement.toWorld.sin, placement.toWorld.cos);

const normalizeDeg = (deg: number, period: number) => ((deg % period) + period) % period;

/**
 * AP の向き（FR-3.6）を three.js の座標の基底にする。基底はアンテナの局所座標（設計書 5.3 節）の x（主ビーム）、y、z の順で、
 * 伝搬計算と同じ antennaFrame をフロアの置き方の回転でワールド座標に移したもの。
 * フロア座標から three.js への (x, y, z) → (x, z, -y) は回転なので、右手系の基底のまま使える
 */
export function apBasis(
  placement: FloorPlacement,
  mount: MountType,
  azimuthDeg: number,
  tiltDeg: number,
): [Vec3, Vec3, Vec3] {
  const f = rotateFrame(
    antennaFrame(mount, azimuthDeg, tiltDeg),
    placement.toWorld.cos,
    placement.toWorld.sin,
  );
  const axis = (k: number) => toThree({ x: f[k]!, y: f[k + 1]! }, f[k + 2]!);
  return [axis(0), axis(3), axis(6)];
}

/**
 * apBasis の逆。three.js の座標で表した主ビーム（局所 x）と局所 y から、方位角（0 以上 360 未満）とチルトを求める。
 * 局所 y はどちらの設置方法でもチルトによらず水平で、方位角の向き h を反時計回りに 90° 回した向きになる。
 * チルトは局所 y のまわりの回転なので、主ビームを h と鉛直からなる面で測る。表せないひねりは捨て、チルトは ±90° に収める
 */
export function apOrientationFrom(
  placement: FloorPlacement,
  mount: MountType,
  x: Vec3,
  y: Vec3,
): { azimuthDeg: number; tiltDeg: number } {
  // three.js の座標をワールド座標 (x, y, 高さ) にする
  const world = (v: Vec3) => ({ x: v[0], y: -v[2], z: v[1] });
  const yw = world(y);
  const xw = world(x);
  const azWorld = Math.atan2(-yw.x, yw.y);
  const along = xw.x * Math.cos(azWorld) + xw.y * Math.sin(azWorld);
  const tilt = mount === "wall" ? Math.atan2(-xw.z, along) : Math.atan2(along, -xw.z);
  return {
    azimuthDeg: normalizeDeg(((azWorld - placementAngle(placement)) * 180) / Math.PI, 360),
    tiltDeg: Math.min(90, Math.max(-90, (tilt * 180) / Math.PI)),
  };
}

/** 3D ビューのつまみで回すときに揃える角度の刻み（度） */
export const ROTATION_SNAP_DEG = 90;

/**
 * つまみで回している AP の基底を、回した方の値（方位角かチルト）を stepDeg の倍数に揃えた向きにする。
 * 揃えるのは回し始めからの角度ではなく値そのもので、もう一方の値は current のまま保つ。チルトは ±90° に収める
 */
export function snapApBasis(
  placement: FloorPlacement,
  mount: MountType,
  x: Vec3,
  y: Vec3,
  kind: "azimuth" | "tilt",
  current: { azimuthDeg: number; tiltDeg: number },
  stepDeg: number,
): [Vec3, Vec3, Vec3] {
  const o = apOrientationFrom(placement, mount, x, y);
  const snap = (deg: number) => Math.round(deg / stepDeg) * stepDeg;
  return kind === "azimuth"
    ? apBasis(placement, mount, normalizeDeg(snap(o.azimuthDeg), 360), current.tiltDeg)
    : apBasis(placement, mount, current.azimuthDeg, Math.min(90, Math.max(-90, snap(o.tiltDeg))));
}

/** 断面の直線が通る点のうち、建物の中心に最も近いもの（ワールド座標）。sectionGrid の格子の原点と同じ */
export function sectionOrigin(bounds: SectionBounds, params: SectionParams): Vec2 {
  const a = (params.angleDeg * Math.PI) / 180;
  return {
    x: (bounds.minX + bounds.maxX) / 2 - Math.sin(a) * params.offsetM,
    y: (bounds.minY + bounds.maxY) / 2 + Math.cos(a) * params.offsetM,
  };
}

/**
 * 断面の直線が通る点（ワールド座標）と水平の向き（ワールド座標の +x から反時計回り、度）から、断面の向きと位置を求める。
 * 向きは 0° 以上 180° 未満に揃え、位置は建物の中心から断面に垂直な向きへのずれにする
 */
export function sectionParamsFrom(
  bounds: SectionBounds,
  point: Vec2,
  directionDeg: number,
): SectionParams {
  const angleDeg = normalizeDeg(directionDeg, 180);
  const a = (angleDeg * Math.PI) / 180;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { angleDeg, offsetM: -Math.sin(a) * (point.x - cx) + Math.cos(a) * (point.y - cy) };
}

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

/**
 * 縦の断面（FR-3.9）を貼る鉛直な四角形。格子の端の点を四角形の端に置き、テクセルの中心が格子の点に重なるよう UV を内側に寄せる。
 * データのテクスチャは上下を反転しないので、格子の行 0（最も低い点）を v の小さい側にする
 */
export function sectionQuad(grid: SectionGrid, heightScale = 1) {
  const s1 = grid.s0 + (grid.cols - 1) * grid.step;
  const z1 = grid.z0 + (grid.rows - 1) * grid.step;
  const at = (s: number, z: number): Vec3 =>
    toThree({ x: grid.ox + grid.ux * s, y: grid.oy + grid.uy * s }, z * heightScale);
  const u0 = 0.5 / grid.cols;
  const u1 = 1 - u0;
  const v0 = 0.5 / grid.rows;
  const v1 = 1 - v0;
  return quad(
    [at(grid.s0, z1), at(s1, z1), at(s1, grid.z0), at(grid.s0, grid.z0)],
    [
      { x: u0, y: v1 },
      { x: u1, y: v1 },
      { x: u1, y: v0 },
      { x: u0, y: v0 },
    ],
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
