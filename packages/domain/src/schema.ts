import { z } from "zod";
import { Band, PerBand } from "./band.js";
import { ChannelWidth } from "./channels.js";
import { Vec2 } from "./geometry.js";

// プロジェクトの Yjs 文書の形。文書では各要素を ID をキーにした Y.Map に入れるので、
// ここでも要素そのものには ID を持たせず、Record のキーで表す。

export const SCHEMA_VERSION = 4;

const Id = z.string().min(1);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const Material = z.object({
  name: z.string(),
  color: Color,
  lossDb: PerBand(z.number().min(0)),
  presetKey: z.string().optional(),
});
export type Material = z.infer<typeof Material>;

export const OpeningKind = z.enum(["door", "window", "other"]);
export type OpeningKind = z.infer<typeof OpeningKind>;

/** 壁の一部区間に別の材質を割り当てたもの（FR-4.8）。位置は折れ線に沿った距離（図面座標）。 */
export const Opening = z
  .object({
    id: Id,
    kind: OpeningKind,
    start: z.number().min(0),
    end: z.number().min(0),
    materialId: Id,
    bottomM: z.number().optional(),
    topM: z.number().optional(),
  })
  .refine((o) => o.start < o.end, { message: "開口部の始点は終点より前にある必要がある" });
export type Opening = z.infer<typeof Opening>;

export const Wall = z.object({
  points: z.array(Vec2).min(2),
  materialId: Id,
  /** 床からの高さの範囲（FR-4.10、設計書 4.1 節）。無ければ 0 m と階高。版 3 で足した */
  bottomM: z.number().min(0).optional(),
  topM: z.number().positive().optional(),
  openings: z.array(Opening),
});
export type Wall = z.infer<typeof Wall>;

const AngleCut = z.array(z.object({ deg: z.number(), gainDbi: z.number() })).min(1);
export type AngleCut = z.infer<typeof AngleCut>;

const DirectionalCuts = z.object({ azimuthCut: AngleCut, elevationCut: AngleCut });
const AxialCuts = z.object({ offAxisCut: AngleCut, aroundAxisCut: AngleCut });

/** アンテナパターン。形の違いは設計書 5.2 節を参照。 */
export const AntennaPattern = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("omni"), gainDbi: z.number() }),
  DirectionalCuts.extend({
    kind: z.literal("directional"),
    perBand: z.partialRecord(Band, DirectionalCuts).optional(),
  }),
  AxialCuts.extend({
    kind: z.literal("axial"),
    rollOffsetDeg: z.number().default(0),
    perBand: z.partialRecord(Band, AxialCuts).optional(),
  }),
]);
export type AntennaPattern = z.infer<typeof AntennaPattern>;

export const ApModelRadio = z.object({
  key: z.string().min(1),
  bands: z.array(Band).min(1),
  maxTxPowerDbm: z.partialRecord(Band, z.number()),
  pattern: AntennaPattern,
});
export type ApModelRadio = z.infer<typeof ApModelRadio>;

export const ApModel = z.object({
  name: z.string(),
  vendor: z.string().optional(),
  radios: z.array(ApModelRadio).min(1),
  /** ライブラリから写したときの元のモデル（設計書 2.3 節） */
  source: z.object({ libraryId: Id, updatedAt: z.string() }).optional(),
});
export type ApModel = z.infer<typeof ApModel>;

export const RadioConfig = z.object({
  /** AP モデルのラジオの key */
  key: z.string().min(1),
  enabled: z.boolean(),
  band: Band,
  channel: z.number().int(),
  widthMHz: ChannelWidth,
  txPowerDbm: z.number(),
});
export type RadioConfig = z.infer<typeof RadioConfig>;

export const MountType = z.enum(["ceiling", "wall"]);
export type MountType = z.infer<typeof MountType>;

export const Ap = z.object({
  name: z.string(),
  modelId: Id,
  /** 図面座標 */
  position: Vec2,
  heightM: z.number(),
  mount: MountType,
  /** フロア座標の +x 軸から反時計回りの角度 */
  azimuthDeg: z.number(),
  tiltDeg: z.number(),
  radios: z.array(RadioConfig),
});
export type Ap = z.infer<typeof Ap>;

export const Rect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type Rect = z.infer<typeof Rect>;

export const PlanImage = z.object({
  sourceSha256: z.string(),
  page: z.number().int().optional(),
  dpi: z.number().optional(),
  imageSha256: z.string(),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  /** 画像の 1 ピクセルが図面座標でいくつか（PDF ならポイント数） */
  unitsPerPx: z.number().positive(),
  /** 画面上で時計回りの回転角 */
  rotationDeg: z.number(),
  /** 図面座標での表示範囲 */
  crop: Rect.optional(),
});
export type PlanImage = z.infer<typeof PlanImage>;

export const ScaleCalibration = z.object({
  a: Vec2,
  b: Vec2,
  distanceM: z.number().positive(),
});
export type ScaleCalibration = z.infer<typeof ScaleCalibration>;

export const PhotoPin = z.object({
  position: Vec2,
  photos: z.array(
    z.object({
      sha256: z.string(),
      thumbSha256: z.string(),
      directionDeg: z.number().optional(),
      memo: z.string(),
      takenAt: z.string().optional(),
    }),
  ),
});
export type PhotoPin = z.infer<typeof PhotoPin>;

/** 吹き抜け（床のない範囲）。頂点は図面座標で、閉じた多角形として扱う */
export const Hole = z.object({
  points: z.array(Vec2).min(3),
});
export type Hole = z.infer<typeof Hole>;

/**
 * あるフロアの図面座標 p を、別のフロアの図面座標 k·R(rotationDeg)·p + translation に移す変換。
 * R は図面座標（y 下向き）での回転で、正の角度は画面上の時計回り。k は 2 つのフロアのスケールの比で、
 * 保存せずに計算時に求める（スケールを校正し直しても、図面上の向きと原点の写り先は変わらない）
 */
export const PlanOffset = z.object({
  floorId: Id,
  rotationDeg: z.number(),
  translation: Vec2,
});
export type PlanOffset = z.infer<typeof PlanOffset>;

export const Floor = z.object({
  name: z.string(),
  order: z.number(),
  elevationM: z.number(),
  heightM: z.number().positive(),
  plan: PlanImage.optional(),
  scale: ScaleCalibration.optional(),
  /**
   * フロア間の位置合わせ（FR-3.2）。このフロアの図面座標を floorId のフロアの図面座標に移す変換で、
   * 2 つのフロアで指定した基準点 2 点から求めた結果だけを持つ。版 4 で、基準点を持つ alignment から置き換えた
   */
  planOffset: PlanOffset.optional(),
  walls: z.record(Id, Wall),
  aps: z.record(Id, Ap),
  photoPins: z.record(Id, PhotoPin),
  /**
   * 版 2 で足した。サーバのマイグレーションで足しても、ブラウザに残った古い文書と統合すると
   * 足す前のフロアが勝つことがあるので、無ければ空とみなす
   */
  holes: z.record(Id, Hole).default({}),
  /** 床スラブの材質（FR-3.1、FR-7.6）。版 3 で足した。無いときの扱いは slabMaterialOf を参照 */
  slabMaterialId: Id.optional(),
});
export type Floor = z.infer<typeof Floor>;

export const LegendStop = z.object({ dbm: z.number(), color: Color });
export type LegendStop = z.infer<typeof LegendStop>;

export const ProjectSettings = z.object({
  receiverHeightM: z.number().min(0),
  gridResolutionM: z.number().positive(),
  pathLossExponent: PerBand(z.number().positive()),
  rxGainDbi: z.number(),
  legend: z.object({
    stops: z.array(LegendStop).min(1),
    goodThresholdDbm: z.number(),
    hideBelow: z.boolean(),
  }),
  /**
   * 他のフロアの AP を計算に含める範囲（FR-7.8）。null は全フロア、0 は同じフロアだけ、n は上下 n フロアまで。
   * 版 3 で足した。足す前の文書と統合したときに消えることがあるので、無ければ全フロアとみなす
   */
  crossFloorRange: z.number().int().min(0).nullable().default(null),
});
export type ProjectSettings = z.infer<typeof ProjectSettings>;

export const ProjectDoc = z.object({
  meta: z.object({ schemaVersion: z.number().int() }),
  settings: ProjectSettings,
  materials: z.record(Id, Material),
  apModels: z.record(Id, ApModel),
  floors: z.record(Id, Floor),
});
export type ProjectDoc = z.infer<typeof ProjectDoc>;
