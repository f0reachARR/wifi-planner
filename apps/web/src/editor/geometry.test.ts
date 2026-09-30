import { describe, expect, it } from "vitest";
import { hitTestWall, rectToPolygon, snapPoint, type WallEntry, wallsInPolygon } from "./geometry";

const wall = (id: string, pts: [number, number][]): WallEntry => ({
  id,
  points: pts.map(([x, y]) => ({ x, y })),
  materialId: "concrete",
  openings: [],
});

const walls = [
  wall("a", [
    [0, 0],
    [10, 0],
  ]),
  wall("b", [
    [10, 0],
    [10, 10],
  ]),
  wall("c", [
    [20, 20],
    [30, 20],
  ]),
];

describe("壁の当たり判定と範囲選択", () => {
  it("近くの壁を返し、遠ければ返さない", () => {
    expect(hitTestWall(walls, { x: 5, y: 0.5 }, 1)?.wall.id).toBe("a");
    expect(hitTestWall(walls, { x: 5, y: 3 }, 1)).toBeUndefined();
  });

  it("矩形に触れる壁を選ぶ。頂点が中になくても、辺が横切れば選ぶ", () => {
    expect(wallsInPolygon(walls, rectToPolygon({ x: 4, y: -1, width: 2, height: 2 }))).toEqual([
      "a",
    ]);
    expect(wallsInPolygon(walls, rectToPolygon({ x: 9, y: -1, width: 2, height: 2 }))).toEqual([
      "a",
      "b",
    ]);
    expect(wallsInPolygon(walls, rectToPolygon({ x: 15, y: 15, width: 20, height: 20 }))).toEqual([
      "c",
    ]);
  });
});

describe("スナップ", () => {
  it("端点を最も優先する", () => {
    expect(snapPoint({ x: 10.3, y: 0.2 }, { walls, tolerance: 1 })).toEqual({
      point: { x: 10, y: 0 },
      kind: "endpoint",
    });
  });

  it("壁の上の点にスナップする", () => {
    expect(snapPoint({ x: 5, y: 0.3 }, { walls, tolerance: 1 })).toEqual({
      point: { x: 5, y: 0 },
      kind: "onWall",
    });
  });

  it("直前の点から水平、垂直に近ければ直交方向にそろえる", () => {
    const prev = { x: 50, y: 50 };
    expect(snapPoint({ x: 60, y: 50.5 }, { walls, tolerance: 1, previous: prev })).toEqual({
      point: { x: 60, y: 50 },
      kind: "orthogonal",
    });
    expect(snapPoint({ x: 49.5, y: 40 }, { walls, tolerance: 1, previous: prev }).point).toEqual({
      x: 50,
      y: 40,
    });
    expect(snapPoint({ x: 60, y: 60 }, { walls, tolerance: 1, previous: prev }).kind).toBe("none");
  });
});
