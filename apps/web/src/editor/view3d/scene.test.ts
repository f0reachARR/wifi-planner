import { floorPlacements } from "@wifi-planner/domain";
import { describe, expect, it } from "vitest";
import { clipToRect, heatmapQuad, planQuad, toThree, wallGeometry } from "./scene";

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
    holes: {},
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

  /** three.js の座標の三角形の、床面（x, z）での面積の合計と重心 */
  const triangles = (positions: Float32Array) => {
    const out: { area: number; cx: number; cz: number }[] = [];
    for (let i = 0; i < positions.length; i += 9) {
      const [ax, , az, bx, , bz, cx, , cz] = Array.from(positions.slice(i, i + 9)) as number[];
      out.push({
        area: Math.abs((bx! - ax!) * (cz! - az!) - (cx! - ax!) * (bz! - az!)) / 2,
        cx: (ax! + bx! + cx!) / 3,
        cz: (az! + bz! + cz!) / 3,
      });
    }
    return out;
  };

  it("吹き抜けの範囲は図面の面から抜く", () => {
    // 図面座標の (20, 10)〜(40, 30) は、ワールド座標で x = 2〜4 m、three.js の z = 1〜3 m
    const hole = [
      { x: 20, y: 10 },
      { x: 40, y: 10 },
      { x: 40, y: 30 },
      { x: 20, y: 30 },
    ];
    const q = planQuad(
      placement,
      { x: 0, y: 0, width: 100, height: 50 },
      { width: 100, height: 50 },
      3,
      [hole],
    );
    const tris = triangles(q.positions);
    expect(tris.reduce((s, t) => s + t.area, 0)).toBeCloseTo(10 * 5 - 2 * 2);
    for (const t of tris) {
      expect(t.cx > 2 && t.cx < 4 && t.cz > 1 && t.cz < 3).toBe(false);
    }
    expect(q.uvs.length / 2).toBe(q.positions.length / 3);
  });

  it("図面の外にはみ出した吹き抜けは、図面の範囲で切り取る", () => {
    const hole = [
      { x: -20, y: -20 },
      { x: 20, y: -20 },
      { x: 20, y: 20 },
      { x: -20, y: 20 },
    ];
    expect(clipToRect(hole, { x: 0, y: 0, width: 100, height: 50 })).toHaveLength(4);
    const q = heatmapQuad(placement, { x0: 0.25, y0: -4.75, step: 0.5, cols: 20, rows: 10 }, 3, [
      hole,
    ]);
    const total = triangles(q.positions).reduce((s, t) => s + t.area, 0);
    expect(total).toBeCloseTo(10 * 5 - 2 * 2);
  });

  it("高さの倍率をかけると、壁の床と天井の高さが引き伸ばされる", () => {
    const g = wallGeometry(
      floor,
      placement,
      { m: { name: "m", color: "#ff0000", lossDb: { "2.4": 1, "5": 1, "6": 1 } } },
      2,
    );
    const ys = new Set<number>();
    for (let i = 1; i < g.positions.length; i += 3) ys.add(g.positions[i]!);
    expect([...ys].sort((a, b) => a - b)).toEqual([6, 11]);
  });
});
