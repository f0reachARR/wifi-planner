import { floorPlacements } from "@wifi-planner/domain";
import { describe, expect, it } from "vitest";
import { heatmapQuad, planQuad, toThree, wallGeometry } from "./scene";

const plan = {
  sourceSha256: "s",
  imageSha256: "i",
  widthPx: 100,
  heightPx: 50,
  unitsPerPx: 1,
  rotationDeg: 0,
};
const scale = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, distanceM: 1 };

describe("疑似 3D ビューの形", () => {
  const floor = {
    name: "1F",
    order: 0,
    elevationM: 3,
    heightM: 2.5,
    plan,
    scale,
    walls: {
      w: {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        materialId: "m",
        openings: [{ id: "o", kind: "door" as const, start: 40, end: 60, materialId: "d" }],
      },
    },
    aps: {},
    photoPins: {},
  };
  const placement = floorPlacements({ f: floor }).f!;

  it("図面の左上は、ワールド座標の原点に、画像の上端（v = 1）で貼られる", () => {
    const q = planQuad(
      placement,
      { x: 0, y: 0, width: 100, height: 50 },
      { width: 100, height: 50 },
      3,
    );
    expect(Array.from(q.positions.slice(0, 3))).toEqual(toThree({ x: 0, y: 0 }, 3));
    expect(Array.from(q.uvs.slice(0, 2))).toEqual([0, 1]);
    // 図面の右下（x = 10 m、図面の下向き 5 m）は、フロア座標で y = -5、three.js で z = 5
    expect(Array.from(q.positions.slice(6, 9))).toEqual([10, 3, 5]);
  });

  it("ヒートマップの格子の端の点は、格子の間隔の半分だけ外にある", () => {
    const q = heatmapQuad(placement, { x0: 0, y0: -5, step: 0.5, cols: 21, rows: 11 }, 3);
    expect(Array.from(q.positions.slice(0, 3))).toEqual([-0.25, 3, 5.25]);
  });

  it("壁は床から天井までの面になり、開口部の区間は別の色になる", () => {
    const g = wallGeometry(floor, placement, {
      m: { name: "m", color: "#ff0000", lossDb: { "2.4": 1, "5": 1, "6": 1 } },
      d: { name: "d", color: "#0000ff", lossDb: { "2.4": 1, "5": 1, "6": 1 } },
    });
    // 壁の前、開口部、壁の後ろの 3 区間 × 2 つの三角形 × 3 頂点
    expect(g.positions.length).toBe(3 * 6 * 3);
    const ys = new Set<number>();
    for (let i = 1; i < g.positions.length; i += 3) ys.add(g.positions[i]!);
    expect([...ys].sort()).toEqual([3, 5.5]);
    // 2 区間目（開口部）の色は青
    expect(Array.from(g.colors.slice(18, 21))).toEqual([0, 0, 1]);
  });
});
