import { describe, expect, it } from "vitest";
import { snapPoint } from "../geometry";
import { buildSnapGuides, type GuideSegment } from "./guides";

const seg = (x0: number, y0: number, x1: number, y1: number): GuideSegment => ({
  a: { x: x0, y: y0 },
  b: { x: x1, y: y1 },
});
const OPTS = { extend: 2, minAngleDeg: 15, mergeDistance: 0.5 };

describe("スナップ用の線の交点", () => {
  it("L 字、T 字、十字の交点を見つける", () => {
    const g = buildSnapGuides(
      [
        seg(0, 0, 100, 0), // 上辺
        seg(0, 0, 0, 100), // 左辺（L 字）
        seg(50, 0, 50, 100), // 上辺に T 字で突き当たる
        seg(20, 50, 80, 50), // 縦線と十字に交わる
      ],
      OPTS,
    );
    const has = (x: number, y: number) =>
      g.intersections.some((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6);
    expect(has(0, 0)).toBe(true);
    expect(has(50, 0)).toBe(true);
    expect(has(50, 50)).toBe(true);
    expect(g.intersections).toHaveLength(3);
  });

  it("少し手前で止まった角は延ばして交わらせ、離れすぎた線と平行な線は交わらせない", () => {
    const g = buildSnapGuides(
      [
        seg(1, 0, 100, 0),
        seg(0, 1.5, 0, 100), // 角まで 1.5 足りない
        seg(200, 10, 200, 100), // 上辺の延長から 10 離れている
        seg(0, 5, 100, 6), // 上辺とほぼ平行
      ],
      OPTS,
    );
    expect(g.nearestIntersection({ x: 0, y: 0 }, 1)).toEqual({ x: 0, y: 0 });
    expect(g.nearestIntersection({ x: 200, y: 0 }, 5)).toBeUndefined();
    expect(g.intersections.every((p) => p.x < 100)).toBe(true);
  });

  it("近い交点は 1 点にまとめる", () => {
    const g = buildSnapGuides([seg(0, 0, 100, 0), seg(10, -50, 10, 50), seg(10.1, -50, 10.1, 50)], {
      ...OPTS,
      mergeDistance: 1,
    });
    expect(g.intersections).toHaveLength(1);
  });

  it("縦横の線と図面の線の交わり、線の上の点を返す", () => {
    const g = buildSnapGuides([seg(50, 0, 50, 100), seg(0, 200, 100, 300)], OPTS);
    // (0, 20) から水平に引いた線と x = 50 の縦線の交わり
    expect(g.nearestOnAxis({ x: 49, y: 21 }, { x: 0, y: 20 }, true, 3)).toEqual({ x: 50, y: 20 });
    expect(g.nearestOnAxis({ x: 30, y: 21 }, { x: 0, y: 20 }, true, 3)).toBeUndefined();
    expect(g.nearestOnSegment({ x: 52, y: 40 }, 3)).toEqual({ x: 50, y: 40 });
    expect(g.nearestOnSegment({ x: 60, y: 40 }, 3)).toBeUndefined();
  });
});

describe("図面の線を含めたスナップの優先順位", () => {
  const guides = buildSnapGuides([seg(0, 0, 100, 0), seg(40, -50, 40, 50)], OPTS);
  const wall = {
    id: "w",
    points: [
      { x: 41, y: 1 },
      { x: 41, y: 30 },
    ],
    materialId: "c",
    openings: [],
  };

  it("既存の壁の端点は図面の線の交点より優先する", () => {
    expect(snapPoint({ x: 40.6, y: 0.6 }, { walls: [wall], guides, tolerance: 2 })).toEqual({
      point: { x: 41, y: 1 },
      kind: "endpoint",
    });
  });

  it("交点、線の端点、線の上の点の順に優先する", () => {
    const opts = { walls: [], guides, tolerance: 2 };
    expect(snapPoint({ x: 40.5, y: 1 }, opts).kind).toBe("guideIntersection");
    expect(snapPoint({ x: 99, y: 1 }, opts)).toEqual({
      point: { x: 100, y: 0 },
      kind: "guideEndpoint",
    });
    expect(snapPoint({ x: 70, y: 0.8 }, opts)).toEqual({ point: { x: 70, y: 0 }, kind: "onGuide" });
  });

  it("直前の点から縦横に引いた線と図面の線の交わりは、ただの直交方向より優先する", () => {
    const opts = { walls: [], guides, tolerance: 2, previous: { x: 0, y: 20 } };
    expect(snapPoint({ x: 39, y: 20.5 }, opts)).toEqual({
      point: { x: 40, y: 20 },
      kind: "guideAxis",
    });
    expect(snapPoint({ x: 20, y: 20.5 }, opts)).toEqual({
      point: { x: 20, y: 20 },
      kind: "orthogonal",
    });
  });
});
