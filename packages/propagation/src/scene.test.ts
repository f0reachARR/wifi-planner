import { createEmptyProjectDoc, type Floor, type ProjectDoc } from "@wifi-planner/domain";
import { describe, expect, it } from "vitest";
import { computeField, evaluatePoint, pathLossDb } from "./field.js";
import { buildFloorScene, buildProjectScene, relevantFloorIds } from "./scene.js";
import { slabLossDb } from "./slabs.js";

// フロアをまたぐ計算（設計書 6.1 節、6.4 節）。図面は 200 × 100 単位で、1 単位 = 0.1 m（20 m × 10 m）

const SLAB_DB = 25; // 床スラブのプリセットの 5 GHz の減衰量

const plan = {
  sourceSha256: "s",
  imageSha256: "i",
  widthPx: 200,
  heightPx: 100,
  unitsPerPx: 1,
  rotationDeg: 0,
};
const scale = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, distanceM: 1 };

function floor(order: number, over: Partial<Floor> = {}): Floor {
  return {
    name: `${order + 1}F`,
    order,
    elevationM: order * 3,
    heightM: 3,
    plan,
    scale,
    // f1（基準フロア）にそのまま重ねる。f1 自身を指す位置合わせは無視される
    planOffset: { floorId: "f1", rotationDeg: 0, translation: { x: 0, y: 0 } },
    walls: {},
    aps: {},
    photoPins: {},
    holes: {},
    slabMaterialId: "slab",
    ...over,
  };
}

const ap = (x: number, y: number) => ({
  name: `AP-${x}-${y}`,
  modelId: "m",
  position: { x, y },
  heightM: 2.5,
  mount: "wall" as const,
  azimuthDeg: 0,
  tiltDeg: 0,
  radios: [
    {
      key: "r5",
      enabled: true,
      band: "5" as const,
      channel: 36,
      widthMHz: 20 as const,
      txPowerDbm: 17,
    },
  ],
});

function project(floors: Record<string, Floor>): ProjectDoc {
  const doc = createEmptyProjectDoc();
  doc.apModels.m = {
    name: "無指向性",
    radios: [
      {
        key: "r5",
        bands: ["5"],
        maxTxPowerDbm: { "5": 20 },
        pattern: { kind: "omni", gainDbi: 0 },
      },
    ],
  };
  doc.floors = floors;
  return doc;
}

const ok = (doc: ProjectDoc, floorId: string) => {
  const scene = buildFloorScene(doc, floorId, "5");
  if (scene.status !== "ok") throw new Error(scene.status);
  return scene;
};

/** 図面座標 (px, py) の格子点での、ラジオ k の値 */
const at = (doc: ProjectDoc, floorId: string, k: number, px: number, py: number) => {
  const scene = ok(doc, floorId);
  const p = scene.transform.toFloor({ x: px, y: py });
  const w = {
    x: scene.toWorld.cos * p.x - scene.toWorld.sin * p.y + scene.toWorld.tx,
    y: scene.toWorld.sin * p.x + scene.toWorld.cos * p.y + scene.toWorld.ty,
  };
  return evaluatePoint(scene.radios[k]!.source, scene.env, w.x, w.y);
};

describe("フロアをまたぐ計算", () => {
  it("下のフロアの AP は、床スラブの減衰を受けて上のフロアに届く", () => {
    const doc = project({ f1: floor(0, { aps: { a: ap(100, 50) } }), f2: floor(1) });
    const scene = ok(doc, "f2");
    expect(scene.radios.map((r) => r.apId)).toEqual(["a"]);
    // AP は高さ 2.5 m、受信点は 2F の床から 1 m（絶対 4 m）。真上の点では距離 1.5 m
    const v = at(doc, "f2", 0, 100, 50);
    expect(v).toBeCloseTo(17 - pathLossDb(1.5, 5180, 2) - SLAB_DB, 6);
  });

  it("吹き抜けの範囲と、図面の範囲の外では床スラブの減衰を加えない", () => {
    const hole = {
      points: [
        { x: 80, y: 30 },
        { x: 120, y: 30 },
        { x: 120, y: 70 },
        { x: 80, y: 70 },
      ],
    };
    const doc = project({
      f1: floor(0, { aps: { a: ap(100, 50) } }),
      f2: floor(1, { holes: { h: hole } }),
    });
    expect(at(doc, "f2", 0, 100, 50)).toBeCloseTo(17 - pathLossDb(1.5, 5180, 2), 6);
    const scene = ok(doc, "f2");
    // 図面の外（x = -5 m）の真上を通る経路
    expect(slabLossDb(scene.env.slabs, -5, 0, 2, -5, 0, 4)).toBe(0);
    expect(slabLossDb(scene.env.slabs, 5, -2, 2, 5, -2, 4)).toBe(SLAB_DB);
  });

  it("3 フロアを貫く経路は、間の床スラブをすべて数える", () => {
    const doc = project({ f1: floor(0, { aps: { a: ap(100, 50) } }), f2: floor(1), f3: floor(2) });
    const d = 6 + 1 - 2.5;
    expect(at(doc, "f3", 0, 100, 50)).toBeCloseTo(17 - pathLossDb(d, 5180, 2) - 2 * SLAB_DB, 6);
  });

  it("同じ高さの床スラブは、重なっていても一度だけ数える", () => {
    const doc = project({
      f1: floor(0, { aps: { a: ap(100, 50) } }),
      f2: floor(1),
      f2b: floor(2, { elevationM: 3 }),
    });
    expect(at(doc, "f2", 0, 100, 50)).toBeCloseTo(17 - pathLossDb(1.5, 5180, 2) - SLAB_DB, 6);
  });

  it("フロアからワールドへの回転があっても、同じフロアの値は変わらない", () => {
    const walls = {
      w: {
        points: [
          { x: 120, y: 0 },
          { x: 120, y: 100 },
        ],
        materialId: "concrete",
        openings: [],
      },
    };
    const directional = { ...ap(60, 50), azimuthDeg: 30 };
    // 2F は図面を 90° 回して描いたものとし、位置合わせでも 90° 回す
    const one = project({ f1: floor(0, { walls, aps: { a: directional } }) });
    const two = project({
      f0: floor(0, { planOffset: undefined }),
      f1: floor(1, {
        walls,
        aps: { a: directional },
        planOffset: { floorId: "f0", rotationDeg: -90, translation: { x: 0, y: 0 } },
      }),
    });
    for (const doc of [one, two]) {
      doc.apModels.m!.radios[0]!.pattern = {
        kind: "directional",
        azimuthCut: [
          { deg: 0, gainDbi: 6 },
          { deg: 90, gainDbi: -4 },
          { deg: 180, gainDbi: -14 },
          { deg: -90, gainDbi: -4 },
        ],
        elevationCut: [
          { deg: -90, gainDbi: -10 },
          { deg: 0, gainDbi: 6 },
          { deg: 90, gainDbi: -10 },
        ],
      };
    }
    const a = ok(one, "f1");
    const b = ok(two, "f1");
    expect(b.toWorld.cos).toBeCloseTo(0, 9);
    const own = b.radios.filter((r) => r.floorId === "f1");
    expect(own).toHaveLength(1);
    const fa = computeField(a.radios[0]!.source, a.env, a.grid, a.toWorld);
    const fb = computeField(own[0]!.source, b.env, b.grid, b.toWorld);
    for (let k = 0; k < fa.length; k += 37) expect(fb[k]).toBeCloseTo(fa[k]!, 4);
  });

  it("対象範囲で AP を絞っても、範囲の外のフロアの壁と床スラブは使う", () => {
    const doc = project({
      f1: floor(0, { aps: { a: ap(100, 50) } }),
      f2: floor(1, { aps: { b: ap(100, 50) } }),
      f3: floor(2, { aps: { c: ap(100, 50) } }),
    });
    doc.settings.crossFloorRange = 1;
    const s1 = ok(doc, "f1");
    expect(s1.radios.map((r) => r.apId).sort()).toEqual(["a", "b"]);
    expect(s1.env.walls).toHaveLength(3);
    expect(s1.env.slabs.map((l) => l.z)).toEqual([0, 3, 6]);
    doc.settings.crossFloorRange = 0;
    expect(ok(doc, "f2").radios.map((r) => r.apId)).toEqual(["b"]);
    doc.settings.crossFloorRange = null;
    expect(ok(doc, "f2").radios).toHaveLength(3);
  });

  it("位置合わせをしていないフロアは、そのフロアだけで計算する", () => {
    const doc = project({
      f1: floor(0, { aps: { a: ap(100, 50) } }),
      f2: floor(1, { aps: { b: ap(100, 50) }, planOffset: undefined }),
      f3: floor(2),
    });
    const s2 = ok(doc, "f2");
    expect(s2.notes.isolated).toBe(true);
    expect(s2.radios.map((r) => r.apId)).toEqual(["b"]);
    expect(s2.env.slabs).toEqual([]);
    const s3 = ok(doc, "f3");
    expect(s3.radios.map((r) => r.apId)).toEqual(["a"]);
    // 2F の位置が分からないので、2F の床スラブは全面にあるものとし、そのことを知らせる
    expect(s3.notes.fullSlabFloorIds).toEqual(["f2"]);
    expect(slabLossDb(s3.env.slabs, -50, 0, 2, -50, 0, 7)).toBe(SLAB_DB);
  });

  it("床スラブの材質が無いフロアは減衰を 0 dB とし、そのことを知らせる", () => {
    const doc = project({ f1: floor(0, { aps: { a: ap(100, 50) } }), f2: floor(1) });
    delete doc.materials.slab;
    const scene = ok(doc, "f2");
    expect(scene.notes.noSlabMaterialFloorIds).toEqual(["f2"]);
    expect(at(doc, "f2", 0, 100, 50)).toBeCloseTo(17 - pathLossDb(1.5, 5180, 2), 6);
  });

  it("組の計算に効くフロアは、経路の高さの範囲に壁か床面が重なるもの", () => {
    const doc = project({
      f1: floor(0, { aps: { a: ap(100, 50) } }),
      f2: floor(1, { aps: { b: ap(100, 50) } }),
      f3: floor(2),
    });
    const p = buildProjectScene(doc, "5");
    const s2 = ok(doc, "f2");
    const byAp = (id: string) => s2.radios.find((r) => r.apId === id)!;
    // 2F の AP（5.5 m）と 2F の受信点（4 m）の組には、2F の壁だけが効く
    expect(relevantFloorIds(p, s2, "f2", byAp("b")).sort()).toEqual(["f2"]);
    // 1F の AP（2.5 m）からの組には、1F の壁と 2F の床スラブと壁が効く
    expect(relevantFloorIds(p, s2, "f2", byAp("a")).sort()).toEqual(["f1", "f2"]);
  });
});
