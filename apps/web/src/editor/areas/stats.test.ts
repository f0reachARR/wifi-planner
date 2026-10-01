import { describe, expect, it } from "vitest";
import { pointInPolygon } from "../geometry";
import { type AreaEntry, areaStats, labelPoint, polygonsOverlap } from "./stats";

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const area = (id: string, points = rect(0, 0, 10, 10), headcount = 40): AreaEntry => ({
  id,
  name: id,
  points,
  headcount,
});

const ap = (id: string, x: number, y: number) => ({ id, position: { x, y } });

describe("エリアの集計（FR-11.2、FR-11.3）", () => {
  it("中にある AP で人数を割り、目安を超えれば警告する", () => {
    const two = areaStats([area("a")], [ap("1", 2, 2), ap("2", 8, 8), ap("3", 20, 5)], 0.5, 30);
    expect(two.get("a")).toMatchObject({
      apIds: ["1", "2"],
      peoplePerAp: 20,
      areaM2: 25,
      m2PerPerson: 25 / 40,
      warning: undefined,
    });
    const one = areaStats([area("a")], [ap("1", 2, 2)], 0.5, 30).get("a")!;
    expect(one.peoplePerAp).toBe(40);
    expect(one.warning).toBe("overTarget");
  });

  it("AP が無ければ割らず、人がいるときだけ警告する", () => {
    const stats = areaStats([area("a"), area("b", rect(20, 0, 10, 10), 0)], [], undefined, 30);
    expect(stats.get("a")).toMatchObject({ peoplePerAp: undefined, warning: "noAp" });
    expect(stats.get("b")).toMatchObject({ peoplePerAp: undefined, warning: undefined });
    // スケールが未校正なら面積は出さない
    expect(stats.get("a")!.areaM2).toBeUndefined();
  });
});

describe("エリアの重なり（FR-11.4）", () => {
  it("一部が重なるエリア、同じ形のエリア、中に含まれるエリアは重なるとする", () => {
    expect(polygonsOverlap(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toBe(true);
    expect(polygonsOverlap(rect(0, 0, 10, 10), rect(0, 0, 10, 10))).toBe(true);
    expect(polygonsOverlap(rect(0, 0, 10, 10), rect(2, 2, 3, 3))).toBe(true);
    // 辺を共有して内側にあるエリア
    expect(polygonsOverlap(rect(0, 0, 10, 10), rect(0, 0, 5, 10))).toBe(true);
    // 辺が同じ直線の上に並び、辺どうしが交わらない細い重なり
    expect(polygonsOverlap(rect(0, 0, 100, 10), rect(90, 0, 100, 10))).toBe(true);
    // 頂点を共有せずに斜めの辺が交わる三角形
    const tri = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(polygonsOverlap(tri, rect(4, 4, 10, 10))).toBe(true);
  });

  it("辺や頂点が接するだけのエリアは重ならないとする", () => {
    expect(polygonsOverlap(rect(0, 0, 10, 10), rect(10, 0, 10, 10))).toBe(false);
    expect(polygonsOverlap(rect(0, 0, 10, 10), rect(10, 10, 5, 5))).toBe(false);
    expect(polygonsOverlap(rect(0, 0, 10, 10), rect(10, 3, 5, 4))).toBe(false);
    expect(polygonsOverlap(rect(0, 0, 10, 10), rect(30, 0, 5, 5))).toBe(false);
    // 凹んだエリアの切り欠きに収まるエリア
    const u = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
      { x: 20, y: 30 },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 30 },
      { x: 0, y: 30 },
    ];
    expect(polygonsOverlap(u, rect(10, 10, 10, 20))).toBe(false);
  });

  it("重なったエリアは両方に印を付ける", () => {
    const stats = areaStats(
      [area("a"), area("b", rect(5, 0, 10, 10)), area("c", rect(40, 0, 5, 5))],
      [],
      1,
      30,
    );
    expect(stats.get("a")!.overlapping).toBe(true);
    expect(stats.get("b")!.overlapping).toBe(true);
    expect(stats.get("c")!.overlapping).toBe(false);
  });
});

describe("エリアのラベルの位置", () => {
  it("凹んだエリアでも内側の、輪郭から離れた点に置く", () => {
    // U 字の頂点の平均（15, 16.25）は切り欠きの中に入る
    const u = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
      { x: 20, y: 30 },
      { x: 20, y: 5 },
      { x: 10, y: 5 },
      { x: 10, y: 30 },
      { x: 0, y: 30 },
    ];
    expect(pointInPolygon({ x: 15, y: 16.25 }, u)).toBe(false);
    const p = labelPoint(u);
    expect(pointInPolygon(p, u)).toBe(true);
    expect(labelPoint(rect(0, 0, 10, 20))).toMatchObject({ x: 5 });
  });
});
