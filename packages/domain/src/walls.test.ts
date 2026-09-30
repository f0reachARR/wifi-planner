import { describe, expect, it } from "vitest";
import type { Wall } from "./schema.js";
import { canPlaceOpening, closestOnPolyline, mergeWalls, reverseWall, splitWall } from "./walls.js";

const L: Wall = {
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
  materialId: "concrete",
  openings: [
    { id: "d1", kind: "door", start: 2, end: 3, materialId: "woodDoor" },
    { id: "d2", kind: "window", start: 9, end: 12, materialId: "glass" },
    { id: "d3", kind: "door", start: 15, end: 16, materialId: "woodDoor" },
  ],
};

let n = 0;
const nextId = () => `new${++n}`;

describe("壁の分割", () => {
  it("開口部を前後の壁に振り分け、またぐものは二つに切る", () => {
    const [a, b] = splitWall(L, 10, nextId)!;
    expect(a.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(b.points).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(a.openings).toEqual([
      { id: "d1", kind: "door", start: 2, end: 3, materialId: "woodDoor" },
      { id: "d2", kind: "window", start: 9, end: 10, materialId: "glass" },
    ]);
    expect(b.openings).toEqual([
      { id: "new1", kind: "window", start: 0, end: 2, materialId: "glass" },
      { id: "d3", kind: "door", start: 5, end: 6, materialId: "woodDoor" },
    ]);
  });

  it("線分の途中でも分けられ、端では分けない", () => {
    const [a, b] = splitWall(L, 4, nextId)!;
    expect(a.points.at(-1)).toEqual({ x: 4, y: 0 });
    expect(b.points).toHaveLength(3);
    expect(splitWall(L, 0, nextId)).toBeUndefined();
    expect(splitWall(L, 20, nextId)).toBeUndefined();
  });
});

describe("壁の結合", () => {
  it("分割した壁を結合すると元に戻る", () => {
    const [a, b] = splitWall(L, 5, nextId)!;
    const merged = mergeWalls(a, b)!;
    expect(merged.points).toEqual(L.points);
    expect(merged.openings.map((o) => [o.start, o.end])).toEqual([
      [2, 3],
      [9, 12],
      [15, 16],
    ]);
  });

  it("向きが逆でも、共有する端点でつなぐ", () => {
    const [a, b] = splitWall(L, 5, nextId)!;
    const merged = mergeWalls(reverseWall(b), a)!;
    // 反転した b と a は終点どうしが (5, 0) で重なるので、a を反転してつなぐ
    expect(merged.points).toEqual([
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
    ]);
    const lengths = merged.openings.map((o) => o.end - o.start).sort();
    expect(lengths).toEqual([1, 1, 3].sort());
  });

  it("またいだ開口部を二つに切って分割しても、結合後の位置は元と同じ区間を覆う", () => {
    const [a, b] = splitWall(L, 10, nextId)!;
    const merged = mergeWalls(a, b)!;
    const windows = merged.openings.filter((o) => o.kind === "window").map((o) => [o.start, o.end]);
    expect(windows).toEqual([
      [9, 10],
      [10, 12],
    ]);
  });

  it("材質が違う壁や、端点を共有しない壁は結合しない", () => {
    const [a, b] = splitWall(L, 5, nextId)!;
    expect(mergeWalls(a, { ...b, materialId: "glass" })).toBeUndefined();
    expect(
      mergeWalls(a, { ...b, points: b.points.map((p) => ({ x: p.x + 1, y: p.y })) }),
    ).toBeUndefined();
  });
});

describe("折れ線の補助", () => {
  it("最近点と折れ線に沿った距離", () => {
    const c = closestOnPolyline({ x: 12, y: 4 }, L.points);
    expect(c.point).toEqual({ x: 10, y: 4 });
    expect(c.s).toBe(14);
    expect(c.distance).toBe(2);
  });

  it("開口部は重ならず、壁の範囲に収まる位置にだけ置ける", () => {
    expect(canPlaceOpening(L, 4, 5)).toBe(true);
    expect(canPlaceOpening(L, 2.5, 4)).toBe(false);
    expect(canPlaceOpening(L, 19, 21)).toBe(false);
    expect(canPlaceOpening(L, 2.5, 4, "d1")).toBe(true);
  });
});
