import { type Area, closestOnPolyline, type Vec2 } from "@wifi-planner/domain";
import { holeRing, pointInPolygon, polygonArea } from "../geometry";

export type AreaEntry = Area & { id: string };

export type AreaStat = {
  /** 位置がエリアの多角形の中にある AP（FR-11.2） */
  apIds: string[];
  /** AP 1 台あたりの人数。AP が無ければ undefined */
  peoplePerAp: number | undefined;
  /** 面積（m²）。スケールが未校正なら undefined */
  areaM2: number | undefined;
  /** 1 人あたりの面積（m²）。未校正か人数が 0 なら undefined */
  m2PerPerson: number | undefined;
  /** 目安を超えた（overTarget）か、人がいるのに AP が無い（noAp）か（FR-11.3） */
  warning: "overTarget" | "noAp" | undefined;
  /** 同じフロアのほかのエリアと重なっている（FR-11.4） */
  overlapping: boolean;
};

/** エリアごとの AP の台数、AP 1 台あたりの人数、面積と警告（設計書 5.5 節） */
export function areaStats(
  areas: readonly AreaEntry[],
  aps: readonly { id: string; position: Vec2 }[],
  metersPerUnit: number | undefined,
  peoplePerApTarget: number,
): Map<string, AreaStat> {
  const overlapping = overlappingAreas(areas);
  const out = new Map<string, AreaStat>();
  for (const area of areas) {
    const apIds = aps.filter((a) => pointInPolygon(a.position, area.points)).map((a) => a.id);
    const peoplePerAp = apIds.length > 0 ? area.headcount / apIds.length : undefined;
    const areaM2 =
      metersPerUnit === undefined
        ? undefined
        : polygonArea(area.points) * metersPerUnit * metersPerUnit;
    out.set(area.id, {
      apIds,
      peoplePerAp,
      areaM2,
      m2PerPerson: areaM2 !== undefined && area.headcount > 0 ? areaM2 / area.headcount : undefined,
      warning:
        peoplePerAp === undefined
          ? area.headcount > 0
            ? "noAp"
            : undefined
          : peoplePerAp > peoplePerApTarget
            ? "overTarget"
            : undefined,
      overlapping: overlapping.has(area.id),
    });
  }
  return out;
}

/** AP 1 台あたりの人数の表示。AP が無ければ割らずに「AP なし」とする */
export function formatPeoplePerAp(stat: AreaStat): string {
  return stat.peoplePerAp === undefined ? "AP なし" : `${stat.peoplePerAp.toFixed(1)} 人/AP`;
}

/** ほかのエリアと重なるエリアの ID（FR-11.4） */
export function overlappingAreas(areas: readonly AreaEntry[]): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      if (polygonsOverlap(areas[i]!.points, areas[j]!.points)) {
        ids.add(areas[i]!.id);
        ids.add(areas[j]!.id);
      }
    }
  }
  return ids;
}

/**
 * 2 つの多角形の内側が、正の面積で重なるか。辺が接するだけ（隣り合う部屋を同じ線で描いた場合）は重ならないとする。
 * 頂点と辺どうしの交点の x 座標で平面を縦の帯に区切ると、帯の中では辺の上下の並びが変わらないので、
 * 帯の真ん中の縦の線の上で、両方の内側の区間が正の長さで重なるかを調べれば足りる
 */
export function polygonsOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  const xs = [...a, ...b].map((p) => p.x);
  for (const [p, q] of edges(a)) {
    for (const [r, t] of edges(b)) {
      const x = intersectionX(p, q, r, t);
      if (x !== undefined) xs.push(x);
    }
  }
  xs.sort((u, v) => u - v);
  const eps = 1e-9 * Math.max(extent(a), extent(b));
  for (let i = 1; i < xs.length; i++) {
    if (xs[i]! - xs[i - 1]! <= eps) continue;
    const x = (xs[i]! + xs[i - 1]!) / 2;
    if (overlapLength(insideIntervals(a, x), insideIntervals(b, x)) > eps) return true;
  }
  return false;
}

const edges = (poly: readonly Vec2[]): [Vec2, Vec2][] =>
  poly.map((p, i) => [p, poly[(i + 1) % poly.length]!]);

/** 2 本の線分が 1 点で交わるか接するときの、その点の x 座標。平行なら undefined */
function intersectionX(p: Vec2, q: Vec2, r: Vec2, t: Vec2): number | undefined {
  const d = (q.x - p.x) * (t.y - r.y) - (q.y - p.y) * (t.x - r.x);
  if (d === 0) return undefined;
  const u = ((r.x - p.x) * (t.y - r.y) - (r.y - p.y) * (t.x - r.x)) / d;
  const v = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
  if (u < 0 || u > 1 || v < 0 || v > 1) return undefined;
  return p.x + (q.x - p.x) * u;
}

/** 縦の線 x の上で多角形の内側にある区間。偶奇の規則で数える（pointInPolygon と同じ） */
function insideIntervals(poly: readonly Vec2[], x: number): [number, number][] {
  const ys: number[] = [];
  for (const [p, q] of edges(poly)) {
    if (p.x < x !== q.x < x) ys.push(p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x));
  }
  ys.sort((u, v) => u - v);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ys.length; i += 2) out.push([ys[i]!, ys[i + 1]!]);
  return out;
}

function overlapLength(a: readonly [number, number][], b: readonly [number, number][]): number {
  let total = 0;
  for (const [a0, a1] of a)
    for (const [b0, b1] of b) total += Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  return total;
}

function extent(poly: readonly Vec2[]): number {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

/**
 * ラベルを置く点。凹んだ多角形でも内側に入り、輪郭からなるべく離れた点にする。
 * 外接矩形を横に切る線の上で内側にある区間の中点を候補とし、輪郭から最も遠いものを選ぶ
 */
export function labelPoint(poly: readonly Vec2[]): Vec2 {
  const ys = poly.map((p) => p.y);
  const top = Math.min(...ys);
  const height = Math.max(...ys) - top;
  const ring = holeRing(poly);
  let best: { point: Vec2; clearance: number } | undefined;
  const LINES = 16;
  for (let k = 0; k < LINES; k++) {
    const y = top + (height * (k + 0.5)) / LINES;
    // 縦の線の区間を求める関数を、x と y を入れ替えて使う
    const swapped = poly.map((p) => ({ x: p.y, y: p.x }));
    for (const [x0, x1] of insideIntervals(swapped, y)) {
      const point = { x: (x0 + x1) / 2, y };
      const clearance = closestOnPolyline(point, ring).distance;
      if (!best || clearance > best.clearance) best = { point, clearance };
    }
  }
  return best?.point ?? poly[0]!;
}
