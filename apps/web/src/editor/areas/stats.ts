import { type Area, closestOnPolyline, type Vec2 } from "@wifi-planner/domain";
import { holeRing, pointInPolygon, polygonArea, segmentsIntersect } from "../geometry";

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
 * 2 つの多角形の内側が重なるか。辺が接するだけ（隣り合う部屋を同じ線で描いた場合）は重ならないとする。
 * 辺どうしが交わるか、一方の頂点か内側の点が他方の内側にあれば重なるとする
 */
export function polygonsOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersect(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!))
        return true;
    }
  }
  const eps = 1e-6 * Math.max(extent(a), extent(b));
  const strictlyInside = (p: Vec2, poly: readonly Vec2[]) =>
    pointInPolygon(p, poly) && closestOnPolyline(p, holeRing(poly)).distance > eps;
  const probes = (poly: readonly Vec2[]) => [...poly, ...interiorPoints(poly)];
  return probes(a).some((p) => strictlyInside(p, b)) || probes(b).some((p) => strictlyInside(p, a));
}

function extent(poly: readonly Vec2[]): number {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

/**
 * 多角形の内側にある点。頂点とその両隣の 3 点の重心のうち、内側にあるものを返す。
 * 同じ形のエリアや、頂点がすべて他方の輪郭の上にあるエリアの重なりを見つけるのに使う
 */
function interiorPoints(poly: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[(i + poly.length - 1) % poly.length]!;
    const q = poly[i]!;
    const r = poly[(i + 1) % poly.length]!;
    const c = { x: (p.x + q.x + r.x) / 3, y: (p.y + q.y + r.y) / 3 };
    if (pointInPolygon(c, poly)) out.push(c);
  }
  return out;
}
