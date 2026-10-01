import { createEmptyProjectDoc, type Floor, type ProjectDoc } from "@wifi-planner/domain";
import { describe, expect, it } from "vitest";
import { pathLossDb } from "./field.js";
import { buildProjectScene } from "./scene.js";
import {
  buildSectionScene,
  computeSectionField,
  MAX_SECTION_POINTS,
  sectionBounds,
  sectionGrid,
  sectionOffsetRange,
} from "./section.js";

// 縦の断面（設計書 6.5 節）。図面は 200 × 100 単位で、1 単位 = 0.1 m（フロア座標で x 0〜20 m、y −10〜0 m）

const SLAB_DB = 25;

const floor = (order: number, over: Partial<Floor> = {}): Floor => ({
  name: `${order + 1}F`,
  order,
  elevationM: order * 3,
  heightM: 3,
  plan: {
    sourceSha256: "s",
    imageSha256: "i",
    widthPx: 200,
    heightPx: 100,
    unitsPerPx: 1,
    rotationDeg: 0,
  },
  scale: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, distanceM: 1 },
  planOffset: { floorId: "f1", rotationDeg: 0, translation: { x: 0, y: 0 } },
  walls: {},
  aps: {},
  photoPins: {},
  holes: {},
  slabMaterialId: "slab",
  ...over,
});

const ap = {
  name: "AP",
  modelId: "m",
  position: { x: 100, y: 50 },
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
};

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

/** 断面を x 軸に沿って建物の中心（y = −5 m）に置き、AP の真上の列（x = 10 m）の高さ z の値を引く */
function column(doc: ProjectDoc) {
  const p = buildProjectScene(doc, "5");
  const scene = buildSectionScene(doc, "5", { angleDeg: 0, offsetM: 0 }, p);
  if (scene.status !== "ok") throw new Error(scene.status);
  const field = computeSectionField(scene, scene.radios[0]!, doc.settings.crossFloorRange, p);
  const { grid } = scene;
  const i = Math.round((0 - grid.s0) / grid.step);
  expect(grid.ox + grid.ux * (grid.s0 + i * grid.step)).toBeCloseTo(10, 9);
  return (z: number) => field[Math.round((z - grid.z0) / grid.step) * grid.cols + i]!;
}

describe("縦の断面", () => {
  it("断面は計算に含めるフロアの外接矩形の中に、最も低い床面から最も高い天井まで置く", () => {
    const doc = project({ f1: floor(0), f2: floor(1), f3: floor(2, { planOffset: undefined }) });
    const bounds = sectionBounds(doc)!;
    expect(bounds).toEqual({ minX: 0, minY: -10, maxX: 20, maxY: 0, bottom: 0, top: 6 });
    expect(sectionOffsetRange(bounds, 0)).toEqual([-5, 5]);
    expect(sectionOffsetRange(bounds, 90)[1]).toBeCloseTo(10, 9);
    const grid = sectionGrid(bounds, { angleDeg: 0, offsetM: 0 }, 0.5)!;
    expect(grid).toMatchObject({ s0: -10, z0: 0, step: 0.5, cols: 41, rows: 13 });
    expect(sectionGrid(bounds, { angleDeg: 0, offsetM: 6 }, 0.5)).toBeUndefined();
    // 点が多すぎるときは間隔を広げる
    const fine = sectionGrid(bounds, { angleDeg: 30, offsetM: 0 }, 0.01)!;
    expect(fine.cols * fine.rows).toBeLessThanOrEqual(MAX_SECTION_POINTS);
  });

  it("点ごとの高さで計算し、床スラブの上では減衰し、吹き抜けの上では減衰しない", () => {
    const at = column(project({ f1: floor(0, { aps: { a: ap } }), f2: floor(1) }));
    // AP は高さ 2.5 m。真上 1.5 m（4 m）では床スラブを 1 枚通る
    expect(at(4)).toBeCloseTo(17 - pathLossDb(1.5, 5180, 2) - SLAB_DB, 5);
    expect(at(2)).toBeCloseTo(17 - pathLossDb(1, 5180, 2), 5);
    const hole = {
      points: [
        { x: 80, y: 30 },
        { x: 120, y: 30 },
        { x: 120, y: 70 },
        { x: 80, y: 70 },
      ],
    };
    const open = column(
      project({ f1: floor(0, { aps: { a: ap } }), f2: floor(1, { holes: { h: hole } }) }),
    );
    expect(open(4)).toBeCloseTo(17 - pathLossDb(1.5, 5180, 2), 5);
  });

  it("対象範囲の外のフロアの高さと、計算に含めないフロアの高さの点は値を持たない", () => {
    const doc = project({
      f1: floor(0, { aps: { a: ap } }),
      f2: floor(1),
      f3: floor(2, { planOffset: undefined }),
    });
    doc.settings.crossFloorRange = 0;
    const at = column(doc);
    expect(Number.isFinite(at(2))).toBe(true);
    expect(at(4)).toBe(Number.NEGATIVE_INFINITY);
    doc.settings.crossFloorRange = null;
    const all = column(doc);
    expect(Number.isFinite(all(4))).toBe(true);
    // 3F は位置合わせをしていないので、3F の床面より上は描かない
    expect(all(6)).toBe(Number.NEGATIVE_INFINITY);
  });
});
