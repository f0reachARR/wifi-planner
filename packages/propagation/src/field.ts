import { type CompiledPattern, type Frame, gainToward } from "./antenna.js";
import { type SegmentSet, wallLossDb } from "./walls.js";

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

/** 送信側のラジオ。位置はフロア座標、高さは床から */
export type RadioSource = {
  x: number;
  y: number;
  heightM: number;
  frame: Frame;
  pattern: CompiledPattern;
  txPowerDbm: number;
  frequencyMHz: number;
};

export type Environment = {
  segments: SegmentSet;
  receiverHeightM: number;
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

/** フロア座標 (x, y) の受信高さにおける推定受信電力（dBm） */
export function evaluatePoint(src: RadioSource, env: Environment, x: number, y: number): number {
  const dx = x - src.x;
  const dy = y - src.y;
  const dz = env.receiverHeightM - src.heightM;
  const d = Math.hypot(dx, dy, dz);
  return (
    src.txPowerDbm +
    gainToward(src.pattern, src.frame, dx, dy, dz) +
    env.rxGainDbi -
    pathLossDb(d, src.frequencyMHz, env.pathLossExponent) -
    wallLossDb(env.segments, src.x, src.y, src.heightM, x, y, env.receiverHeightM)
  );
}

export function computeField(src: RadioSource, env: Environment, grid: GridSpec): Float32Array {
  const out = new Float32Array(grid.cols * grid.rows);
  for (let j = 0; j < grid.rows; j++) {
    const y = grid.y0 + j * grid.step;
    for (let i = 0; i < grid.cols; i++) {
      out[j * grid.cols + i] = evaluatePoint(src, env, grid.x0 + i * grid.step, y);
    }
  }
  return out;
}
