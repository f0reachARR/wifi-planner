import { describe, expect, it } from "vitest";
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
    expect(migrated.meta.schemaVersion).toBe(3);
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
    expect(migrated.meta.schemaVersion).toBe(3);
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
});
