import { degToRad, distance, type Vec2 } from "./geometry.js";
import type { Floor, PlanImage, PlanOffset, ScaleCalibration } from "./schema.js";

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

/** 写像が原点と (1, 0) を移す先から、回転と平行移動を取り出す。写像は回転と平行移動からなるものとする */
function rigidFromMap(map: (p: Vec2) => Vec2): RigidTransform {
  const o = map({ x: 0, y: 0 });
  const e = map({ x: 1, y: 0 });
  const angle = Math.atan2(e.y - o.y, e.x - o.x);
  return { cos: Math.cos(angle), sin: Math.sin(angle), tx: o.x, ty: o.y };
}

type ScaledPlan = { plan?: Pick<PlanImage, "rotationDeg">; scale?: ScaleCalibration };

/** 位置合わせの結果を、図面座標から相手のフロアの図面座標への関数にする。どちらかが未校正なら undefined */
export function planOffsetMap(
  offset: Pick<PlanOffset, "rotationDeg" | "translation">,
  own: ScaledPlan,
  target: ScaledPlan,
): { forward(p: Vec2): Vec2; inverse(p: Vec2): Vec2 } | undefined {
  const ownMpu = metersPerUnit(own.scale);
  const targetMpu = metersPerUnit(target.scale);
  if (ownMpu === undefined || targetMpu === undefined) return undefined;
  const k = ownMpu / targetMpu;
  const t = degToRad(offset.rotationDeg);
  const c = Math.cos(t);
  const s = Math.sin(t);
  const { x: tx, y: ty } = offset.translation;
  return {
    forward: (p) => ({ x: k * (c * p.x - s * p.y) + tx, y: k * (s * p.x + c * p.y) + ty }),
    inverse: (p) => {
      const x = (p.x - tx) / k;
      const y = (p.y - ty) / k;
      return { x: c * x + s * y, y: -s * x + c * y };
    },
  };
}

/**
 * 2 つのフロアの図面で指定した基準点 2 点の対応から、位置合わせの結果を求める（FR-3.2）。
 * スケールは各フロアで校正済みとし、回転と平行移動だけを求める。点 a を一致させ、a→b の向きを揃える。
 * 点は各フロアの図面座標で渡す。distanceRatio は基準点間の実距離の比（このフロア / 相手）で、
 * 1 から離れていればスケール校正の誤りを疑う
 */
export function planOffsetFromPoints(
  own: ScaledPlan & { a: Vec2; b: Vec2 },
  target: ScaledPlan & { a: Vec2; b: Vec2 },
): { rotationDeg: number; translation: Vec2; distanceRatio: number } | undefined {
  const ownMpu = metersPerUnit(own.scale);
  const targetMpu = metersPerUnit(target.scale);
  const ownLen = distance(own.a, own.b);
  const targetLen = distance(target.a, target.b);
  if (ownMpu === undefined || targetMpu === undefined || ownLen === 0 || targetLen === 0) {
    return undefined;
  }
  const angle =
    Math.atan2(target.b.y - target.a.y, target.b.x - target.a.x) -
    Math.atan2(own.b.y - own.a.y, own.b.x - own.a.x);
  const rotationDeg = (angle * 180) / Math.PI;
  const map = planOffsetMap({ rotationDeg, translation: { x: 0, y: 0 } }, own, target)!;
  const rotatedA = map.forward(own.a);
  return {
    rotationDeg,
    translation: { x: target.a.x - rotatedA.x, y: target.a.y - rotatedA.y },
    distanceRatio: (ownLen * ownMpu) / (targetLen * targetMpu),
  };
}

export type FloorPlacement = {
  /** フロア座標からワールド座標への変換 */
  toWorld: RigidTransform;
  /** 基準フロアか、位置合わせをたどって基準フロアにつながるフロアなら true */
  aligned: boolean;
  isReference: boolean;
  plan: PlanTransform;
};

/**
 * 各フロアのワールド座標での置き方（FR-3.2）。基準は order が最小で、スケールを校正済みのフロアとする。
 * 位置合わせの結果（planOffset）を、どちら向きにも使える辺とみなし、基準フロアから辺をたどって届くフロアの位置を決める。
 * 届かないフロアは恒等変換のまま aligned を false にする。スケールが未校正のフロアは含めない。
 */
export function floorPlacements(
  floors: Record<string, Pick<Floor, "order" | "plan" | "scale" | "planOffset">>,
): Record<string, FloorPlacement> {
  const calibrated = Object.entries(floors)
    .map(([id, f]) => ({ id, f, plan: planTransform(f.plan, f.scale) }))
    .filter((x): x is typeof x & { plan: PlanTransform } => x.plan !== undefined)
    .sort((a, b) => a.f.order - b.f.order);
  const out: Record<string, FloorPlacement> = {};
  const base = calibrated[0];
  if (!base) return out;
  const byId = new Map(calibrated.map((x) => [x.id, x]));

  // 辺：位置の決まった from から to の位置を決める。map は to の図面座標を from の図面座標に移す
  const edges = new Map<string, { to: string; map: (p: Vec2) => Vec2 }[]>();
  const addEdge = (from: string, to: string, map: (p: Vec2) => Vec2) => {
    const list = edges.get(from) ?? [];
    list.push({ to, map });
    edges.set(from, list);
  };
  for (const { id, f } of calibrated) {
    const offset = f.planOffset;
    const target = offset && offset.floorId !== id ? byId.get(offset.floorId) : undefined;
    if (!offset || !target) continue;
    const map = planOffsetMap(offset, f, target.f)!;
    addEdge(target.id, id, map.forward);
    addEdge(id, target.id, map.inverse);
  }

  out[base.id] = { toWorld: IDENTITY, aligned: true, isReference: true, plan: base.plan };
  const queue = [base.id];
  while (queue.length > 0) {
    const from = queue.shift()!;
    const placed = out[from]!;
    for (const { to, map } of edges.get(from) ?? []) {
      if (out[to]) continue;
      const plan = byId.get(to)!.plan;
      out[to] = {
        toWorld: rigidFromMap((q) =>
          applyRigid(placed.toWorld, placed.plan.toFloor(map(plan.toPlan(q)))),
        ),
        aligned: true,
        isReference: false,
        plan,
      };
      queue.push(to);
    }
  }
  for (const { id, plan } of calibrated) {
    out[id] ??= { toWorld: IDENTITY, aligned: false, isReference: false, plan };
  }
  return out;
}

/** あるフロアの図面座標を、別のフロアの図面座標に移す関数（重ね表示に使う、FR-3.3） */
export function planToPlan(from: FloorPlacement, to: FloorPlacement): (p: Vec2) => Vec2 {
  const toInverse = invertRigid(to.toWorld);
  return (p) =>
    to.plan.toPlan(applyRigid(toInverse, applyRigid(from.toWorld, from.plan.toFloor(p))));
}
