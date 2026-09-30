import { type FrequencyRange, rangesOverlap } from "@wifi-planner/domain";
import type { GridSpec } from "./field.js";

// ラジオごとに計算した格子を組み合わせてヒートマップを作る（設計書 6.2 節）。

/** 要素ごとの最大値（FR-8.2）。格子がなければ -Infinity で埋める */
export function maxField(fields: readonly Float32Array[], size: number): Float32Array {
  const out = new Float32Array(size).fill(Number.NEGATIVE_INFINITY);
  for (const f of fields) {
    for (let k = 0; k < size; k++) if (f[k]! > out[k]!) out[k] = f[k]!;
  }
  return out;
}

/** 閾値以上で届くラジオの数（FR-8.5） */
export function countAbove(
  fields: readonly Float32Array[],
  size: number,
  thresholdDbm: number,
): Uint8Array {
  const out = new Uint8Array(size);
  for (const f of fields) {
    for (let k = 0; k < size; k++) if (f[k]! >= thresholdDbm) out[k]!++;
  }
  return out;
}

/**
 * 同一チャネル干渉（FR-8.6）。閾値以上で届くラジオのうち、占有周波数が重なる相手の数が最も多いラジオについて、
 * 自分を含めた数を返す。2 以上なら干渉がある。
 */
export function coChannelCount(
  fields: readonly Float32Array[],
  ranges: readonly FrequencyRange[],
  size: number,
  thresholdDbm: number,
): Uint8Array {
  const n = fields.length;
  const overlaps: boolean[][] = Array.from({ length: n }, (_, a) =>
    Array.from({ length: n }, (_, b) => a !== b && rangesOverlap(ranges[a]!, ranges[b]!)),
  );
  const out = new Uint8Array(size);
  const heard: number[] = [];
  for (let k = 0; k < size; k++) {
    heard.length = 0;
    for (let r = 0; r < n; r++) if (fields[r]![k]! >= thresholdDbm) heard.push(r);
    if (heard.length < 2) {
      out[k] = heard.length;
      continue;
    }
    let best = 1;
    for (const a of heard) {
      let c = 1;
      for (const b of heard) if (overlaps[a]![b]) c++;
      if (c > best) best = c;
    }
    out[k] = best;
  }
  return out;
}

/** フロア座標 (x, y) の値を双線形補間で引く（FR-8.7）。格子の外なら undefined */
export function sampleField(field: Float32Array, grid: GridSpec, x: number, y: number) {
  const fx = (x - grid.x0) / grid.step;
  const fy = (y - grid.y0) / grid.step;
  if (fx < 0 || fy < 0 || fx > grid.cols - 1 || fy > grid.rows - 1) return undefined;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  // 端の点では隣がないので同じ点を使う
  const i1 = Math.min(i + 1, grid.cols - 1);
  const j1 = Math.min(j + 1, grid.rows - 1);
  const tx = fx - i;
  const ty = fy - j;
  const at = (ii: number, jj: number) => field[jj * grid.cols + ii]!;
  return (
    at(i, j) * (1 - tx) * (1 - ty) +
    at(i1, j) * tx * (1 - ty) +
    at(i, j1) * (1 - tx) * ty +
    at(i1, j1) * tx * ty
  );
}
