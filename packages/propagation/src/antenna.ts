import type { AngleCut, AntennaPattern, Band, MountType } from "@wifi-planner/domain";

// アンテナ利得の計算。取り決めは設計書 5.2 節と 5.3 節を参照。
// 局所座標は +x を主ビーム方向、+z を AP の背面から見た上方向とする右手系。

/** 利得の下限を決める、主ビーム方向からの減衰の上限（dB） */
export const MAX_ATTENUATION_DB = 40;

/** 1 度刻みに補間し直した断面 */
type Cut = { table: Float32Array; minDeg: number; periodic: boolean };

function compileCut(points: AngleCut, minDeg: number, maxDeg: number, periodic: boolean): Cut {
  const span = maxDeg - minDeg;
  const norm = (deg: number) =>
    periodic ? ((((deg - minDeg) % span) + span) % span) + minDeg : deg;
  const sorted = points
    .map((p) => ({ deg: norm(p.deg), gain: p.gainDbi }))
    .sort((a, b) => a.deg - b.deg);
  if (periodic) {
    // 両端に 1 周ずらした点を足し、端をまたぐ補間を通常の補間で扱う
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    sorted.unshift({ deg: last.deg - span, gain: last.gain });
    sorted.push({ deg: first.deg + span, gain: first.gain });
  }
  const size = periodic ? span : span + 1;
  const table = new Float32Array(size);
  for (let i = 0; i < size; i++) table[i] = interpolate(sorted, minDeg + i);
  return { table, minDeg, periodic };
}

/** 角度の昇順に並んだ点列を線形補間する。範囲外は端の値にする。 */
function interpolate(sorted: { deg: number; gain: number }[], deg: number): number {
  if (deg <= sorted[0]!.deg) return sorted[0]!.gain;
  let i = 1;
  while (i < sorted.length && sorted[i]!.deg < deg) i++;
  if (i === sorted.length) return sorted[i - 1]!.gain;
  const a = sorted[i - 1]!;
  const b = sorted[i]!;
  const t = (deg - a.deg) / (b.deg - a.deg || 1);
  return a.gain + (b.gain - a.gain) * t;
}

function lookup(cut: Cut, deg: number): number {
  const n = cut.table.length;
  let x = deg - cut.minDeg;
  if (cut.periodic) {
    x = ((x % n) + n) % n;
  } else {
    x = Math.min(Math.max(x, 0), n - 1);
  }
  const i = Math.floor(x);
  const t = x - i;
  const a = cut.table[i]!;
  const b = cut.table[cut.periodic ? (i + 1) % n : Math.min(i + 1, n - 1)]!;
  return a + (b - a) * t;
}

/** 局所座標の単位ベクトルに対する利得（dBi）を返す関数 */
export type CompiledPattern = (lx: number, ly: number, lz: number) => number;

const RAD = 180 / Math.PI;

export function compilePattern(pattern: AntennaPattern, band: Band): CompiledPattern {
  switch (pattern.kind) {
    case "omni": {
      const g = pattern.gainDbi;
      return () => g;
    }
    case "directional": {
      const cuts = pattern.perBand?.[band] ?? pattern;
      const az = compileCut(cuts.azimuthCut, -180, 180, true);
      const el = compileCut(cuts.elevationCut, -90, 90, false);
      // 方位断面の主ビーム方向の利得を基準にし、仰角断面は主ビーム方向との差だけを使う。
      // こうすると、2 断面の主ビーム方向の値が食い違っていても方位断面の上では元の値と一致する。
      const peak = lookup(az, 0);
      const elRef = lookup(el, 0);
      return (lx, ly, lz) => {
        const phi = Math.atan2(ly, lx) * RAD;
        const theta = Math.asin(Math.min(Math.max(lz, -1), 1)) * RAD;
        const attenuation = peak - lookup(az, phi) + (elRef - lookup(el, theta));
        return peak - Math.min(attenuation, MAX_ATTENUATION_DB);
      };
    }
    case "axial": {
      const cuts = pattern.perBand?.[band] ?? pattern;
      const off = compileCut(cuts.offAxisCut, 0, 180, false);
      const around = compileCut(cuts.aroundAxisCut, 0, 360, true);
      const roll = pattern.rollOffsetDeg;
      const aroundRef = lookup(around, 0);
      let peak = Number.NEGATIVE_INFINITY;
      for (const g of off.table) peak = Math.max(peak, g);
      const floor = peak - MAX_ATTENUATION_DB;
      return (lx, ly, lz) => {
        const alpha = Math.acos(Math.min(Math.max(lx, -1), 1));
        // 軸まわりの角度は局所 +z を 0 度とし、+y の向きへ測る。天井設置では方位角の向きから反時計回りになる
        const beta = Math.atan2(ly, lz) * RAD + roll;
        // 軸まわりの偏差は軸から離れるほど効かせる。軸上では向きによらず一定になる
        const g = lookup(off, alpha * RAD) + Math.sin(alpha) * (lookup(around, beta) - aroundRef);
        return Math.max(g, floor);
      };
    }
  }
}

/** 局所座標の基底をフロア座標で表したもの。[x軸, y軸, z軸] の順に 3 成分ずつ並べる */
export type Frame = Float64Array;

/**
 * 設置方法、方位角、チルトからアンテナの局所座標の基底を作る。
 * 方位角はフロア座標の +x 軸から反時計回り。チルトは主ビームを下げる向きを正とする。
 */
export function antennaFrame(mount: MountType, azimuthDeg: number, tiltDeg: number): Frame {
  const az = azimuthDeg / RAD;
  const t = tiltDeg / RAD;
  const ca = Math.cos(az);
  const sa = Math.sin(az);
  const ct = Math.cos(t);
  const st = Math.sin(t);
  let x: [number, number, number];
  let z: [number, number, number];
  if (mount === "wall") {
    // 主ビームは方位角の向きで、チルトの分だけ下を向く
    x = [ca * ct, sa * ct, -st];
    z = [ca * st, sa * st, ct];
  } else {
    // 主ビームは真下を向き、チルトの分だけ方位角の向きへ傾く。局所 +z は方位角の向きの水平方向
    x = [st * ca, st * sa, -ct];
    z = [ct * ca, ct * sa, st];
  }
  // y = z × x
  const y: [number, number, number] = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];
  return Float64Array.from([...x, ...y, ...z]);
}

/**
 * 基底を鉛直軸のまわりに回す。フロア座標で作った基底を、フロアからワールドへの回転（cos、sin）でワールド座標に移すのに使う
 */
export function rotateFrame(f: Frame, cos: number, sin: number): Frame {
  const out = Float64Array.from(f);
  for (let k = 0; k < 9; k += 3) {
    out[k] = cos * f[k]! - sin * f[k + 1]!;
    out[k + 1] = sin * f[k]! + cos * f[k + 1]!;
  }
  return out;
}

/** 基底と同じ座標の方向ベクトル（正規化不要）に対する利得 */
export function gainToward(pattern: CompiledPattern, f: Frame, dx: number, dy: number, dz: number) {
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return pattern(1, 0, 0);
  const ux = dx / len;
  const uy = dy / len;
  const uz = dz / len;
  return pattern(
    ux * f[0]! + uy * f[1]! + uz * f[2]!,
    ux * f[3]! + uy * f[4]! + uz * f[5]!,
    ux * f[6]! + uy * f[7]! + uz * f[8]!,
  );
}
