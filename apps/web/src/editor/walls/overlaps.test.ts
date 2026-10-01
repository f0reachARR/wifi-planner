import type { Floor } from "@wifi-planner/domain";
import { describe, expect, it } from "vitest";
import { floorWallOverlaps } from "./overlaps";

const plan = {
  sourceSha256: "s",
  imageSha256: "i",
  widthPx: 200,
  heightPx: 100,
  unitsPerPx: 1,
  rotationDeg: 0,
};

const floor = (order: number, walls: Floor["walls"], aligned = true): Floor => ({
  name: `${order + 1}F`,
  order,
  elevationM: order * 3,
  heightM: 3,
  plan,
  scale: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, distanceM: 1 },
  planOffset: aligned ? { floorId: "f1", rotationDeg: 0, translation: { x: 0, y: 0 } } : undefined,
  walls,
  aps: {},
  photoPins: {},
  holes: {},
});

const wall = (topM?: number) => ({
  points: [
    { x: 50, y: 50 },
    { x: 150, y: 50 },
  ],
  materialId: "concrete",
  openings: [],
  ...(topM === undefined ? {} : { topM }),
});

describe("フロアをまたいで高さの範囲が重なる壁", () => {
  it("階高より高い下のフロアの壁と、上のフロアの同じ線の壁を重なりとして示す", () => {
    const floors = { f1: floor(0, { tall: wall(4.5) }), f2: floor(1, { w: wall() }) };
    expect(floorWallOverlaps(floors, "f2")).toEqual({
      pairs: [["w", "f1/tall"]],
      ownIds: new Set(["w"]),
    });
    expect(floorWallOverlaps(floors, "f1").ownIds).toEqual(new Set(["tall"]));
  });

  it("天井までの壁は上のフロアの壁と重ならず、位置合わせをしていないフロアとは比べない", () => {
    expect(
      floorWallOverlaps({ f1: floor(0, { w: wall() }), f2: floor(1, { w: wall() }) }, "f2").pairs,
    ).toEqual([]);
    expect(
      floorWallOverlaps(
        { f1: floor(0, { tall: wall(4.5) }), f2: floor(1, { w: wall() }, false) },
        "f2",
      ).pairs,
    ).toEqual([]);
  });
});
