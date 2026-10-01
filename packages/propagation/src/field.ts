import type { RigidTransform } from "@wifi-planner/domain";
import { type CompiledPattern, type Frame, gainToward } from "./antenna.js";
import { type SlabLevel, slabLossDb } from "./slabs.js";
import { type SegmentSet, wallLossDbAll } from "./walls.js";

/** 格子。点 (i, j) はフロア座標 (x0 + i·step, y0 + j·step) にある。値は行優先（j が行）で並べる */
export type GridSpec = { x0: number; y0: number; step: number; cols: number; rows: number };

export function gridForExtent(
  extent: { minX: number; minY: number; maxX: number; maxY: number },
  step: number,
): GridSpec {
  return {
    x0: extent.minX,
    y0: extent.minY,
    step,
    cols: Math.floor((extent.maxX - extent.minX) / step) + 1,
    rows: Math.floor((extent.maxY - extent.minY) / step) + 1,
  };
}

/** 送信側のラジオ。位置はワールド座標、高さは絶対の高さ（床面の標高 + 設置高さ）、基底もワールド座標で表す */
export type RadioSource = {
  x: number;
  y: number;
  z: number;
  frame: Frame;
  pattern: CompiledPattern;
  txPowerDbm: number;
  frequencyMHz: number;
};

export type Environment = {
  /** フロアごとの壁区間の集合 */
  walls: readonly SegmentSet[];
  slabs: readonly SlabLevel[];
  /** 受信点の絶対の高さ（受信するフロアの床面の標高 + 受信高さ） */
  receiverZ: number;
  pathLossExponent: number;
  rxGainDbi: number;
};

/** 1 m での自由空間損失（dB） */
export function fsplAt1mDb(frequencyMHz: number): number {
  return 20 * Math.log10(frequencyMHz) - 27.55;
}

/** 距離減衰（dB）。1 m 未満は 1 m として扱う。減衰指数 2 で自由空間損失と一致する */
export function pathLossDb(distanceM: number, frequencyMHz: number, exponent: number): number {
  return fsplAt1mDb(frequencyMHz) + 10 * exponent * Math.log10(Math.max(distanceM, 1));
}

/** ワールド座標 (x, y) の受信点（高さは env.receiverZ）における推定受信電力（dBm、設計書 6.1 節） */
export function evaluatePoint(src: RadioSource, env: Environment, x: number, y: number): number {
  const z = env.receiverZ;
  const dx = x - src.x;
  const dy = y - src.y;
  const dz = z - src.z;
  const d = Math.hypot(dx, dy, dz);
  return (
    src.txPowerDbm +
    gainToward(src.pattern, src.frame, dx, dy, dz) +
    env.rxGainDbi -
    pathLossDb(d, src.frequencyMHz, env.pathLossExponent) -
    wallLossDbAll(env.walls, src.x, src.y, src.z, x, y, z) -
    slabLossDb(env.slabs, src.x, src.y, src.z, x, y, z)
  );
}

/**
 * 格子の各点の推定受信電力。格子は受信するフロアのフロア座標で置き、toWorld でワールド座標に移して計算する
 */
export function computeField(
  src: RadioSource,
  env: Environment,
  grid: GridSpec,
  toWorld: RigidTransform = { cos: 1, sin: 0, tx: 0, ty: 0 },
): Float32Array {
  const out = new Float32Array(grid.cols * grid.rows);
  const { cos, sin, tx, ty } = toWorld;
  for (let j = 0; j < grid.rows; j++) {
    const fy = grid.y0 + j * grid.step;
    for (let i = 0; i < grid.cols; i++) {
      const fx = grid.x0 + i * grid.step;
      out[j * grid.cols + i] = evaluatePoint(
        src,
        env,
        cos * fx - sin * fy + tx,
        sin * fx + cos * fy + ty,
      );
    }
  }
  return out;
}
