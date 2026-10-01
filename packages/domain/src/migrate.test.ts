import { describe, expect, it } from "vitest";
import { floorPlacements, planToPlan } from "./coords.js";
import { createEmptyProjectDoc } from "./defaults.js";
import { migrateDoc, UnsupportedSchemaError } from "./migrate.js";

describe("文書のマイグレーション", () => {
  it("古い版から順に変換して検証する", () => {
    const current = createEmptyProjectDoc();
    // 版 1 の文書に、版 2 で足した項目があるものとして試す
    const v1 = {
      ...current,
      meta: { schemaVersion: 1 },
      settings: { ...current.settings, receiverHeightM: undefined },
    };
    const migrated = migrateDoc(
      v1,
      { 1: (d) => ({ ...d, settings: { ...(d.settings as object), receiverHeightM: 1.2 } }) },
      2,
    );
    expect(migrated.meta.schemaVersion).toBe(2);
    expect(migrated.settings.receiverHeightM).toBe(1.2);
  });

  it("版 1 の文書のフロアに、空の吹き抜けを足す", () => {
    const current = createEmptyProjectDoc();
    const floor = {
      name: "1F",
      order: 0,
      elevationM: 0,
      heightM: 3,
      walls: {},
      aps: {},
      photoPins: {},
    };
    const migrated = migrateDoc({ ...current, meta: { schemaVersion: 1 }, floors: { f: floor } });
    expect(migrated.meta.schemaVersion).toBe(4);
    expect(migrated.floors.f!.holes).toEqual({});
  });

  it("版 2 の文書に床スラブのプリセットを足し、各フロアの床スラブとし、全フロアを計算の対象にする", () => {
    const current = createEmptyProjectDoc();
    const { slab: _, ...materials } = current.materials;
    const { crossFloorRange: __, ...settings } = current.settings;
    const floor = {
      name: "1F",
      order: 0,
      elevationM: 0,
      heightM: 3,
      walls: {},
      aps: {},
      photoPins: {},
      holes: {},
    };
    const migrated = migrateDoc({
      ...current,
      meta: { schemaVersion: 2 },
      settings,
      materials,
      floors: { f: floor },
    });
    expect(migrated.meta.schemaVersion).toBe(4);
    expect(migrated.materials.slab?.presetKey).toBe("slab");
    expect(migrated.floors.f!.slabMaterialId).toBe("slab");
    expect(migrated.settings.crossFloorRange).toBeNull();
  });

  it("床スラブのプリセットが既にあれば足さずにそれを使う", () => {
    const current = createEmptyProjectDoc();
    const { slab, ...rest } = current.materials;
    const migrated = migrateDoc({
      ...current,
      meta: { schemaVersion: 2 },
      materials: { ...rest, mySlab: slab! },
      floors: {
        f: { name: "1F", order: 0, elevationM: 0, heightM: 3, walls: {}, aps: {}, photoPins: {} },
      },
    });
    expect(migrated.materials.slab).toBeUndefined();
    expect(migrated.floors.f!.slabMaterialId).toBe("mySlab");
  });

  it("新しすぎる版と、変換の方法がない版は読まない", () => {
    const doc = { ...createEmptyProjectDoc(), meta: { schemaVersion: 99 } };
    expect(() => migrateDoc(doc)).toThrow(UnsupportedSchemaError);
    expect(() => migrateDoc({ ...doc, meta: { schemaVersion: 1 } }, {}, 3)).toThrow(
      UnsupportedSchemaError,
    );
  });

  it("版 3 の基準点を、基準フロアへの位置合わせの結果に置き換える", () => {
    const current = createEmptyProjectDoc();
    const scale = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, distanceM: 1 };
    const floor = (order: number, extra: object) => ({
      name: `${order}F`,
      order,
      elevationM: order * 3,
      heightM: 3,
      walls: {},
      aps: {},
      photoPins: {},
      holes: {},
      slabMaterialId: "slab",
      scale,
      ...extra,
    });
    const migrated = migrateDoc({
      ...current,
      meta: { schemaVersion: 3 },
      floors: {
        // 基準フロアは order が最小の校正済みのフロア
        u: floor(-1, { scale: undefined, alignment: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } } }),
        f1: floor(0, { alignment: { a: { x: 10, y: 10 }, b: { x: 60, y: 10 } } }),
        f2: floor(1, { alignment: { a: { x: 90, y: 60 }, b: { x: 90, y: 110 } } }),
        f3: floor(2, {}),
      },
    });
    expect(migrated.meta.schemaVersion).toBe(4);
    expect(migrated.floors.f1!.planOffset).toBeUndefined();
    expect(migrated.floors.u!.planOffset).toBeUndefined();
    expect(migrated.floors.f3!.planOffset).toBeUndefined();
    expect("alignment" in migrated.floors.f2!).toBe(false);
    const offset = migrated.floors.f2!.planOffset!;
    expect(offset.floorId).toBe("f1");
    const placements = floorPlacements(migrated.floors);
    const a = planToPlan(placements.f2!, placements.f1!)({ x: 90, y: 110 });
    expect(a.x).toBeCloseTo(60);
    expect(a.y).toBeCloseTo(10);
  });
});
