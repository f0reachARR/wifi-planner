import { degToRad, distance, type Vec2 } from "./geometry.js";
import type { PlanImage, ScaleCalibration } from "./schema.js";

// 座標系は設計書 3 章を参照。
// - 図面座標：画像と同じく x は右、y は下向き。
// - フロア座標：図面の回転を適用してメートルに換算し、y を上向きに反転した右手系。
//   z（高さ）を上に取ると右手系になるので、伝搬計算の 3 次元ベクトルをそのまま扱える。

/** 図面座標の 1 単位が何メートルか。未校正なら undefined。 */
export function metersPerUnit(scale: ScaleCalibration | undefined): number | undefined {
  if (!scale) return undefined;
  const d = distance(scale.a, scale.b);
  return d > 0 ? scale.distanceM / d : undefined;
}

export type PlanTransform = {
  toFloor(p: Vec2): Vec2;
  toPlan(p: Vec2): Vec2;
  metersPerUnit: number;
};

/** 図面座標とフロア座標の変換。スケールが未校正なら undefined（FR-2.5）。 */
export function planTransform(
  plan: Pick<PlanImage, "rotationDeg"> | undefined,
  scale: ScaleCalibration | undefined,
): PlanTransform | undefined {
  const mpu = metersPerUnit(scale);
  if (mpu === undefined) return undefined;
  // 図面座標（y 下向き）で角度 θ の回転行列をかけると、画面上では時計回りに回る
  const t = degToRad(plan?.rotationDeg ?? 0);
  const c = Math.cos(t);
  const s = Math.sin(t);
  return {
    metersPerUnit: mpu,
    toFloor: (p) => ({ x: (c * p.x - s * p.y) * mpu, y: -(s * p.x + c * p.y) * mpu }),
    toPlan: (p) => {
      const x = p.x / mpu;
      const y = -p.y / mpu;
      return { x: c * x + s * y, y: -s * x + c * y };
    },
  };
}

/** 回転と平行移動からなる変換 */
export type RigidTransform = { cos: number; sin: number; tx: number; ty: number };

export const IDENTITY: RigidTransform = { cos: 1, sin: 0, tx: 0, ty: 0 };

export function applyRigid(t: RigidTransform, p: Vec2): Vec2 {
  return { x: t.cos * p.x - t.sin * p.y + t.tx, y: t.sin * p.x + t.cos * p.y + t.ty };
}

export function invertRigid(t: RigidTransform): RigidTransform {
  // R^T (p - t)
  return {
    cos: t.cos,
    sin: -t.sin,
    tx: -(t.cos * t.tx + t.sin * t.ty),
    ty: -(-t.sin * t.tx + t.cos * t.ty),
  };
}

export type Alignment = {
  /** このフロアのフロア座標からワールド座標への変換 */
  toWorld: RigidTransform;
  /** 基準点間の距離の比（このフロア / 基準フロア）。1 から離れていればスケール校正の誤りを疑う */
  distanceRatio: number;
};

/**
 * 基準点 2 点の対応から、フロア座標をワールド座標（基準フロアのフロア座標）に移す変換を求める（FR-3.2）。
 * スケールは各フロアで校正済みとし、回転と平行移動だけを求める。点 a を一致させ、a→b の向きを揃える。
 * 引数はフロア座標で渡す。`Floor.alignment` は図面座標で保存しているので、先に `planTransform` で変換する。
 */
export function alignFloor(
  own: { a: Vec2; b: Vec2 },
  reference: { a: Vec2; b: Vec2 },
): Alignment | undefined {
  const ownLen = distance(own.a, own.b);
  const refLen = distance(reference.a, reference.b);
  if (ownLen === 0 || refLen === 0) return undefined;
  const angle =
    Math.atan2(reference.b.y - reference.a.y, reference.b.x - reference.a.x) -
    Math.atan2(own.b.y - own.a.y, own.b.x - own.a.x);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rotatedA = { x: cos * own.a.x - sin * own.a.y, y: sin * own.a.x + cos * own.a.y };
  return {
    toWorld: { cos, sin, tx: reference.a.x - rotatedA.x, ty: reference.a.y - rotatedA.y },
    distanceRatio: ownLen / refLen,
  };
}
