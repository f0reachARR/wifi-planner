import { metersPerUnit, planOffsetFromPoints } from "./coords.js";
import type { Vec2 } from "./geometry.js";
import { MATERIAL_PRESETS, SLAB_PRESET_KEY, slabPresetId } from "./materials.js";
import { type Material, ProjectDoc, SCHEMA_VERSION, type ScaleCalibration } from "./schema.js";

// 文書のスキーマのマイグレーション（設計書 2.2 節）。
// 版 n から n + 1 への変換を MIGRATIONS[n] に並べる。

type RawDoc = Record<string, unknown> & { meta?: { schemaVersion?: number } };
export type Migration = (doc: RawDoc) => RawDoc;

export const MIGRATIONS: Record<number, Migration> = {
  // 版 2 でフロアに吹き抜け（holes）を足した
  1: (doc) => ({
    ...doc,
    floors: Object.fromEntries(
      Object.entries((doc.floors ?? {}) as Record<string, Record<string, unknown>>).map(
        ([id, floor]) => [id, { holes: {}, ...floor }],
      ),
    ),
  }),
  // 版 3 で床スラブの材質と、フロアをまたぐ計算の範囲を足した。壁の高さは無ければ既定なので何もしない
  2: (doc) => {
    const materials = { ...((doc.materials ?? {}) as Record<string, Material>) };
    let slabId = slabPresetId(materials);
    if (!slabId) {
      slabId = materials[SLAB_PRESET_KEY] ? crypto.randomUUID() : SLAB_PRESET_KEY;
      materials[slabId] = { ...MATERIAL_PRESETS[SLAB_PRESET_KEY]! };
    }
    return {
      ...doc,
      settings: { crossFloorRange: null, ...(doc.settings as object) },
      materials,
      floors: Object.fromEntries(
        Object.entries((doc.floors ?? {}) as Record<string, Record<string, unknown>>).map(
          ([id, floor]) => [id, { slabMaterialId: slabId, ...floor }],
        ),
      ),
    };
  },
  // 版 4 で、フロアごとの基準点（alignment）を、2 つのフロアの基準点から求めた結果（planOffset）に置き換えた。
  // 版 3 までは全フロアを基準フロア（校正済みで order が最小）の基準点に合わせていたので、その結果を基準フロアへの変換にする
  3: (doc) => {
    type OldFloor = Record<string, unknown> & {
      order?: number;
      scale?: ScaleCalibration;
      alignment?: { a: Vec2; b: Vec2 };
    };
    const floors = (doc.floors ?? {}) as Record<string, OldFloor>;
    const base = Object.entries(floors)
      .filter(([, f]) => metersPerUnit(f.scale) !== undefined)
      .sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0))[0];
    return {
      ...doc,
      floors: Object.fromEntries(
        Object.entries(floors).map(([id, { alignment, ...floor }]) => {
          const ref = base?.[1].alignment;
          const offset =
            base && id !== base[0] && alignment && ref
              ? planOffsetFromPoints(
                  { ...alignment, scale: floor.scale },
                  { ...ref, scale: base[1].scale },
                )
              : undefined;
          if (!offset) return [id, floor];
          const { distanceRatio: _, ...rest } = offset;
          return [id, { ...floor, planOffset: { floorId: base![0], ...rest } }];
        }),
      ),
    };
  },
};

export class UnsupportedSchemaError extends Error {}

/** 古い版の文書を今の版に変換し、スキーマで検証する。新しすぎる版は読めない */
export function migrateDoc(
  raw: unknown,
  migrations: Record<number, Migration> = MIGRATIONS,
  target = SCHEMA_VERSION,
): ProjectDoc {
  let doc = raw as RawDoc;
  let version = doc?.meta?.schemaVersion ?? 1;
  if (version > target) {
    throw new UnsupportedSchemaError(
      `この版（${version}）の文書は、このバージョンのアプリでは読めません`,
    );
  }
  while (version < target) {
    const step = migrations[version];
    if (!step) throw new UnsupportedSchemaError(`版 ${version} から変換する方法がありません`);
    doc = step(doc);
    version++;
    doc = { ...doc, meta: { ...doc.meta, schemaVersion: version } };
  }
  return ProjectDoc.parse(doc);
}

/** 文書が参照するファイル（図面の元ファイルと画像、写真と縮小画像） */
export function referencedFiles(doc: ProjectDoc) {
  const files = new Map<string, "plan_source" | "plan_image" | "photo" | "thumbnail">();
  for (const floor of Object.values(doc.floors)) {
    if (floor.plan) {
      files.set(floor.plan.sourceSha256, "plan_source");
      files.set(floor.plan.imageSha256, "plan_image");
    }
    for (const pin of Object.values(floor.photoPins)) {
      for (const p of pin.photos) {
        files.set(p.sha256, "photo");
        files.set(p.thumbSha256, "thumbnail");
      }
    }
  }
  return files;
}
