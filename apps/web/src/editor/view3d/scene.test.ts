import { floorPlacements } from "@wifi-planner/domain";
import { describe, expect, it } from "vitest";
import {
  apBasis,
  apOrientationFrom,
  clipToRect,
  heatmapQuad,
  planQuad,
  planToWorld,
  sectionOrigin,
  sectionParamsFrom,
  sectionQuad,
  snapApBasis,
  threeToPlan,
  toThree,
  wallGeometry,
} from "./scene";

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

  it("縦の断面は鉛直な四角形で、高さの倍率をかけ、テクセルの中心が格子の端の点に重なる", () => {
    const grid = { ox: 0, oy: 0, ux: 0, uy: 1, s0: 2, z0: 0, step: 0.5, cols: 5, rows: 3 };
    const q = sectionQuad(grid, 2);
    // 左上は (x, y) = (0, 2)、高さ 1 m × 2 倍。three.js では (0, 2, -2)
    expect(Array.from(q.positions.slice(0, 3))).toEqual([0, 2, -2]);
    // 右下（3 番目の頂点）は (0, 4)、高さ 0
    expect(Array.from(q.positions.slice(6, 9))).toEqual([0, 0, -4]);
    expect(q.uvs[0]).toBeCloseTo(0.1, 6);
    expect(q.uvs[1]).toBeCloseTo(1 - 1 / 6, 6);
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

  it("壁は壁ごとの高さの範囲の面になり、ドアの上は壁の色になる", () => {
    const w = floor.walls.w;
    const g = wallGeometry(
      {
        ...floor,
        walls: {
          w: {
            ...w,
            bottomM: 0.5,
            openings: [{ ...w.openings[0]!, topM: 2 }],
          },
        },
      },
      placement,
      {
        m: { name: "m", color: "#ff0000", lossDb: { "2.4": 1, "5": 1, "6": 1 } },
        d: { name: "d", color: "#0000ff", lossDb: { "2.4": 1, "5": 1, "6": 1 } },
      },
    );
    // 壁の前、ドア、ドアの上、壁の後ろの 4 面
    expect(g.positions.length).toBe(4 * 6 * 3);
    const ys = new Set<number>();
    for (let i = 1; i < g.positions.length; i += 3) ys.add(g.positions[i]!);
    // 床面 3 m に、下端 0.5 m、ドアの上端 2 m、天井 2.5 m を足した高さ
    expect([...ys].sort()).toEqual([3.5, 5, 5.5]);
    expect(Array.from(g.colors.slice(18, 21))).toEqual([0, 0, 1]);
    expect(Array.from(g.colors.slice(36, 39))).toEqual([1, 0, 0]);
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

describe("3D ビューでの AP と断面の操作", () => {
  const base = {
    order: 0,
    elevationM: 0,
    heightM: 3,
    plan: { ...plan, rotationDeg: 30 },
    scale,
    walls: {},
    aps: {},
    photoPins: {},
    holes: {},
  };
  // 2F は位置を合わせ、基準フロアに対して回っている
  const placements = floorPlacements({
    a: base,
    b: {
      ...base,
      order: 1,
      planOffset: { floorId: "a", rotationDeg: -90, translation: { x: -5, y: 5 } },
    },
  });

  it("three.js の座標から図面座標に戻せる", () => {
    for (const id of ["a", "b"]) {
      const p = placements[id]!;
      const back = threeToPlan(p, toThree(planToWorld(p, { x: 12, y: 34 }), 2));
      expect(back.x).toBeCloseTo(12);
      expect(back.y).toBeCloseTo(34);
    }
  });

  it("AP の向きを three.js の基底にして、方位角とチルトに戻せる", () => {
    const identity = floorPlacements({ f: { ...base, plan } }).f!;
    const close = (v: number[], w: number[]) => {
      for (const [i, c] of v.entries()) expect(c).toBeCloseTo(w[i]!);
    };
    // 天井設置でチルト 0° なら主ビームは真下、方位角 90° はフロア座標の +y、つまり three.js の -z に局所 z を向ける
    const [cx, , cz] = apBasis(identity, "ceiling", 90, 0);
    close(cx, [0, -1, 0]);
    close(cz, [0, 0, -1]);
    // 壁設置で方位角 0°、チルト 30° なら、主ビームは +x から 30° 下を向く
    const [wx] = apBasis(identity, "wall", 0, 30);
    close(wx, [Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6), 0]);
    for (const p of [identity, placements.b!])
      for (const mount of ["ceiling", "wall"] as const)
        for (const [az, tilt] of [
          [0, 0],
          [45, 20],
          [200, -35],
          [359, 89],
        ] as const) {
          const [x, y] = apBasis(p, mount, az, tilt);
          const back = apOrientationFrom(p, mount, x, y);
          expect(back.azimuthDeg).toBeCloseTo(az);
          expect(back.tiltDeg).toBeCloseTo(tilt);
        }
  });

  it("つまみで回している AP の向きを、回した方の値だけ刻みに揃える", () => {
    const p = placements.b!;
    for (const mount of ["ceiling", "wall"] as const) {
      // 回している最中の向き（方位角、チルト）から、揃えた後の方位角とチルトを求める
      const snapped = (az: number, tilt: number, kind: "azimuth" | "tilt") => {
        const [x, y] = apBasis(p, mount, az, tilt);
        const [sx, sy] = snapApBasis(p, mount, x, y, kind, { azimuthDeg: az, tiltDeg: tilt }, 90);
        return apOrientationFrom(p, mount, sx, sy);
      };
      const az = snapped(80, 20, "azimuth");
      expect(az.azimuthDeg).toBeCloseTo(90);
      expect(az.tiltDeg).toBeCloseTo(20);
      // 0° の近くでは 360° ではなく 0° に揃える
      const zero = snapped(350, 20, "azimuth").azimuthDeg;
      expect(Math.min(zero, 360 - zero)).toBeCloseTo(0);
      const tilt = snapped(80, 70, "tilt");
      expect(tilt.azimuthDeg).toBeCloseTo(80);
      expect(tilt.tiltDeg).toBeCloseTo(90);
      expect(snapped(80, -30, "tilt").tiltDeg).toBeCloseTo(0);
    }
  });

  it("断面が通る点と向きから、断面の向きと位置を求める", () => {
    const bounds = { minX: 0, minY: 0, maxX: 20, maxY: 10, bottom: 0, top: 6 };
    for (const params of [
      { angleDeg: 0, offsetM: 2 },
      { angleDeg: 90, offsetM: -3 },
      { angleDeg: 30, offsetM: 1.5 },
    ]) {
      const o = sectionOrigin(bounds, params);
      const back = sectionParamsFrom(bounds, o, params.angleDeg);
      expect(back.angleDeg).toBeCloseTo(params.angleDeg);
      expect(back.offsetM).toBeCloseTo(params.offsetM);
      // 直線の上の別の点でも同じ
      const a = (params.angleDeg * Math.PI) / 180;
      const far = sectionParamsFrom(
        bounds,
        { x: o.x + 4 * Math.cos(a), y: o.y + 4 * Math.sin(a) },
        params.angleDeg,
      );
      expect(far.offsetM).toBeCloseTo(params.offsetM);
    }
    // 向きを 180° 回すと同じ直線になり、向きは 0°〜180° に揃えてずれの符号は変わらない
    const o = sectionOrigin(bounds, { angleDeg: 30, offsetM: 1.5 });
    const flipped = sectionParamsFrom(bounds, o, 210);
    expect(flipped.angleDeg).toBeCloseTo(30);
    expect(flipped.offsetM).toBeCloseTo(1.5);
    // 180° のすぐ手前の向きを 1° 刻みに丸めてから求めると、0° の直線として同じ側のずれになる
    const nearFlip = sectionParamsFrom(bounds, { x: 3, y: 7 }, Math.round(179.7));
    expect(nearFlip.angleDeg).toBe(0);
    expect(nearFlip.offsetM).toBeCloseTo(2);
    // 0°、x 方向の直線の上で y が中心より 2 m 大きい点は、ずれ 2 m
    expect(sectionParamsFrom(bounds, { x: 3, y: 7 }, 0).offsetM).toBeCloseTo(2);
  });
});
