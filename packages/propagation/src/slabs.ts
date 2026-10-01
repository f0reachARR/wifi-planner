import type { Vec2 } from "@wifi-planner/domain";

// 床スラブ（設計書 6.1.2 節）。座標はワールド座標（メートル）、高さは絶対の高さ。

/** 多角形。頂点を x, y の順に並べ、外接矩形を添える */
type Polygon = { xy: Float64Array; minX: number; minY: number; maxX: number; maxY: number };

/**
 * 1 フロアの床スラブ。outline が無ければ全面にあるものとする（位置の分からないフロア、設計書 6.4 節）。
 * outline の中で、holes（吹き抜け）のどれにも入らない範囲にある
 */
export type SlabRegion = { lossDb: number; outline?: Polygon; holes: Polygon[] };

/** 同じ高さの床スラブをまとめたもの。高さの順に並べる */
export type SlabLevel = { z: number; regions: SlabRegion[] };

export function polygon(points: readonly Vec2[]): Polygon {
  return {
    xy: Float64Array.from(points.flatMap((p) => [p.x, p.y])),
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

/** 点が多角形の内側にあるか（交差数の偶奇で判定する） */
function inside(poly: Polygon, x: number, y: number): boolean {
  if (x < poly.minX || x > poly.maxX || y < poly.minY || y > poly.maxY) return false;
  const v = poly.xy;
  const n = v.length / 2;
  let odd = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = v[i * 2]!;
    const yi = v[i * 2 + 1]!;
    const xj = v[j * 2]!;
    const yj = v[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
}

function covers(region: SlabRegion, x: number, y: number): boolean {
  if (region.outline && !inside(region.outline, x, y)) return false;
  return !region.holes.some((h) => inside(h, x, y));
}

/** 床スラブを高さごとにまとめる */
export function buildSlabLevels(slabs: readonly (SlabRegion & { z: number })[]): SlabLevel[] {
  const levels = new Map<number, SlabRegion[]>();
  for (const { z, ...region } of slabs) {
    const list = levels.get(z) ?? [];
    list.push(region);
    levels.set(z, list);
  }
  return [...levels.entries()].sort((a, b) => a[0] - b[0]).map(([z, regions]) => ({ z, regions }));
}

/**
 * p→q の線分が横切る床スラブの減衰量の合計。
 * 床面の高さを、下端を含まず上端を含む区間 (min(pz, qz), max(pz, qz)] で含むときに横切るものとする。
 * 同じ高さの床スラブは一つの面として、横切る点を含むもののうち減衰量の最も大きいものを一度だけ加える
 */
export function slabLossDb(
  levels: readonly SlabLevel[],
  px: number,
  py: number,
  pz: number,
  qx: number,
  qy: number,
  qz: number,
): number {
  if (pz === qz) return 0;
  const minZ = Math.min(pz, qz);
  const maxZ = Math.max(pz, qz);
  let total = 0;
  for (const level of levels) {
    if (level.z <= minZ) continue;
    if (level.z > maxZ) break;
    const t = (level.z - pz) / (qz - pz);
    const x = px + (qx - px) * t;
    const y = py + (qy - py) * t;
    let loss = 0;
    for (const r of level.regions) if (r.lossDb > loss && covers(r, x, y)) loss = r.lossDb;
    total += loss;
  }
  return total;
}
