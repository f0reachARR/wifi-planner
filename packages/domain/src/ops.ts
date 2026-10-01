import * as Y from "yjs";
import type { Band } from "./band.js";
import type { ChannelWidth } from "./channels.js";
import type { Vec2 } from "./geometry.js";
import { slabPresetId } from "./materials.js";
import {
  type Ap,
  type ApModel,
  Ap as ApSchema,
  type Floor,
  type Hole,
  Hole as HoleSchema,
  type Material,
  type PhotoPin,
  type ProjectSettings,
  type RadioConfig,
  type Wall,
  Wall as WallSchema,
} from "./schema.js";
import { mergeWalls, splitWall, translateWall } from "./walls.js";
import { FLOOR_SHAPE, fromY, setEntity } from "./ydoc.js";

// Y.Doc を書き換える操作。呼び出し側がトランザクションと origin（undo の対象）を決める。

type YMap = Y.Map<unknown>;

export const floorsMap = (ydoc: Y.Doc) => ydoc.getMap("floors") as Y.Map<YMap>;

export function floorMap(ydoc: Y.Doc, floorId: string): YMap | undefined {
  return floorsMap(ydoc).get(floorId);
}

/** フロアの要素の集合（walls、aps、photoPins、holes） */
export function floorCollection(
  ydoc: Y.Doc,
  floorId: string,
  key: "walls" | "aps" | "photoPins" | "holes",
): Y.Map<YMap> | undefined {
  return floorMap(ydoc, floorId)?.get(key) as Y.Map<YMap> | undefined;
}

/** Y.Map のフィールドをまとめて書き換える。undefined のフィールドは消す */
export function updateFields(map: YMap, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) map.delete(key);
    else if (map.get(key) !== value) map.set(key, value);
  }
}

export function newId(): string {
  return crypto.randomUUID();
}

export type NewFloor = Pick<Floor, "name" | "elevationM" | "heightM">;

/** フロアを一番上に追加する */
export function addFloor(ydoc: Y.Doc, input: NewFloor): string {
  const floors = floorsMap(ydoc);
  let maxOrder = -1;
  for (const f of floors.values()) maxOrder = Math.max(maxOrder, Number(f.get("order") ?? 0));
  const id = newId();
  const slabMaterialId = slabPresetId(fromY(ydoc.getMap("materials")) as Record<string, Material>);
  const floor: Floor = {
    ...input,
    order: maxOrder + 1,
    walls: {},
    aps: {},
    photoPins: {},
    holes: {},
    ...(slabMaterialId ? { slabMaterialId } : {}),
  };
  setEntity(floors as YMap, id, floor, FLOOR_SHAPE);
  return id;
}

export function updateFloor(
  ydoc: Y.Doc,
  floorId: string,
  patch: Partial<
    Pick<
      Floor,
      "name" | "elevationM" | "heightM" | "plan" | "scale" | "planOffset" | "slabMaterialId"
    >
  >,
): void {
  const floor = floorMap(ydoc, floorId);
  if (floor) updateFields(floor, patch);
}

/**
 * フロアの位置合わせの結果（FR-3.2）を、そのフロアのものと、ほかのフロアをそのフロアに合わせたものの両方とも消す。
 * 図面を別のファイルに差し替えると図面座標の意味が変わり、どちらも誤った位置を指すようになるため。
 * フロアを消すときにも使う
 */
export function clearPlanOffsets(ydoc: Y.Doc, floorId: string): void {
  floorsMap(ydoc).forEach((floor, id) => {
    const offset = floor.get("planOffset") as { floorId?: string } | undefined;
    if (offset && (id === floorId || offset.floorId === floorId)) floor.delete("planOffset");
  });
}

export function deleteFloor(ydoc: Y.Doc, floorId: string): void {
  // そのフロアに合わせたほかのフロアは、相手がいなくなるので位置合わせの結果を消す
  clearPlanOffsets(ydoc, floorId);
  floorsMap(ydoc).delete(floorId);
}

/** 指定した順に order を振り直す（下の階から順） */
export function reorderFloors(ydoc: Y.Doc, orderedIds: readonly string[]): void {
  const floors = floorsMap(ydoc);
  orderedIds.forEach((id, i) => {
    const f = floors.get(id);
    if (f && f.get("order") !== i) f.set("order", i);
  });
}

export function updateSettings(ydoc: Y.Doc, patch: Partial<ProjectSettings>): void {
  updateFields(ydoc.getMap("settings"), patch);
}

export { Y };

// ---- 壁（FR-4.4〜4.8） ----

function wallsOf(ydoc: Y.Doc, floorId: string) {
  const walls = floorCollection(ydoc, floorId, "walls");
  if (!walls) throw new Error(`フロアがない: ${floorId}`);
  return walls;
}

export function readWall(ydoc: Y.Doc, floorId: string, wallId: string): Wall | undefined {
  const map = floorCollection(ydoc, floorId, "walls")?.get(wallId);
  if (!map) return undefined;
  const parsed = WallSchema.safeParse(fromY(map));
  return parsed.success ? parsed.data : undefined;
}

export function addWall(ydoc: Y.Doc, floorId: string, wall: Wall): string {
  const id = newId();
  setEntity(wallsOf(ydoc, floorId) as YMap, id, wall);
  return id;
}

export function addWalls(ydoc: Y.Doc, floorId: string, walls: readonly Wall[]): string[] {
  return walls.map((w) => addWall(ydoc, floorId, w));
}

export function updateWall(
  ydoc: Y.Doc,
  floorId: string,
  wallId: string,
  patch: Partial<Wall>,
): void {
  const map = wallsOf(ydoc, floorId).get(wallId);
  if (map) updateFields(map, patch);
}

export function deleteWalls(ydoc: Y.Doc, floorId: string, wallIds: readonly string[]): void {
  const walls = wallsOf(ydoc, floorId);
  for (const id of wallIds) walls.delete(id);
}

/** 選んだ壁の材質をまとめて変える（FR-4.6）。開口部の材質は変えない */
export function setWallsMaterial(
  ydoc: Y.Doc,
  floorId: string,
  wallIds: readonly string[],
  materialId: string,
) {
  const walls = wallsOf(ydoc, floorId);
  for (const id of wallIds) {
    const map = walls.get(id);
    if (map && map.get("materialId") !== materialId) map.set("materialId", materialId);
  }
}

/**
 * 選んだ壁の高さの範囲をまとめて変える（FR-4.6、FR-4.10）。
 * patch に含めたフィールドだけを書き、値が undefined なら既定（0 m と階高）に戻す
 */
export function setWallsHeight(
  ydoc: Y.Doc,
  floorId: string,
  wallIds: readonly string[],
  patch: { bottomM?: number | undefined; topM?: number | undefined },
) {
  const walls = wallsOf(ydoc, floorId);
  for (const id of wallIds) {
    const map = walls.get(id);
    if (map) updateFields(map, patch);
  }
}

export function moveWalls(
  ydoc: Y.Doc,
  floorId: string,
  wallIds: readonly string[],
  dx: number,
  dy: number,
) {
  for (const id of wallIds) {
    const wall = readWall(ydoc, floorId, id);
    if (wall) updateWall(ydoc, floorId, id, { points: translateWall(wall, dx, dy).points });
  }
}

/** 壁を折れ線に沿った距離 s で分ける。分けた 2 本の ID を返す */
export function splitWallAt(
  ydoc: Y.Doc,
  floorId: string,
  wallId: string,
  s: number,
): [string, string] | undefined {
  const wall = readWall(ydoc, floorId, wallId);
  if (!wall) return undefined;
  const parts = splitWall(wall, s, newId);
  if (!parts) return undefined;
  deleteWalls(ydoc, floorId, [wallId]);
  return [addWall(ydoc, floorId, parts[0]), addWall(ydoc, floorId, parts[1])];
}

/** 2 本の壁を結合する。結合できなければ何もせず undefined を返す */
export function mergeWallsById(
  ydoc: Y.Doc,
  floorId: string,
  aId: string,
  bId: string,
  tolerance: number,
) {
  const a = readWall(ydoc, floorId, aId);
  const b = readWall(ydoc, floorId, bId);
  if (!a || !b) return undefined;
  const merged = mergeWalls(a, b, tolerance);
  if (!merged) return undefined;
  deleteWalls(ydoc, floorId, [aId, bId]);
  return addWall(ydoc, floorId, merged);
}

// ---- 材質（FR-4.7、FR-4.9） ----

const materialsMap = (ydoc: Y.Doc) => ydoc.getMap("materials") as Y.Map<YMap>;

export function addMaterial(ydoc: Y.Doc, material: Material): string {
  const id = newId();
  setEntity(materialsMap(ydoc) as YMap, id, material);
  return id;
}

export function updateMaterial(ydoc: Y.Doc, materialId: string, patch: Partial<Material>): void {
  const map = materialsMap(ydoc).get(materialId);
  if (map) updateFields(map, patch);
}

/** 材質を消す。その材質を使っている壁、開口部、床スラブは replacementId に付け替える */
export function deleteMaterial(ydoc: Y.Doc, materialId: string, replacementId: string): void {
  if (materialId === replacementId) return;
  for (const floor of floorsMap(ydoc).values()) {
    if (floor.get("slabMaterialId") === materialId) floor.set("slabMaterialId", replacementId);
    const walls = floor.get("walls") as Y.Map<YMap> | undefined;
    for (const wall of walls?.values() ?? []) {
      if (wall.get("materialId") === materialId) wall.set("materialId", replacementId);
      const openings = wall.get("openings") as Wall["openings"] | undefined;
      if (openings?.some((o) => o.materialId === materialId)) {
        wall.set(
          "openings",
          openings.map((o) =>
            o.materialId === materialId ? { ...o, materialId: replacementId } : o,
          ),
        );
      }
    }
  }
  materialsMap(ydoc).delete(materialId);
}

// ---- AP（FR-6.1〜6.3） ----

const DEFAULT_CHANNEL: Record<Band, { channel: number; widthMHz: ChannelWidth }> = {
  "2.4": { channel: 1, widthMHz: 20 },
  "5": { channel: 36, widthMHz: 80 },
  "6": { channel: 1, widthMHz: 80 },
};

/** AP モデルのラジオから、配置したときのラジオの初期設定を作る */
export function defaultRadios(model: ApModel): RadioConfig[] {
  return model.radios.map((r) => {
    const band = r.bands[0]!;
    return {
      key: r.key,
      enabled: true,
      band,
      ...DEFAULT_CHANNEL[band],
      txPowerDbm: r.maxTxPowerDbm[band] ?? 17,
    };
  });
}

export function defaultChannelFor(band: Band) {
  return DEFAULT_CHANNEL[band];
}

/** ライブラリの AP モデルをプロジェクトに写す（設計書 2.3 節）。同じ ID の写しがあれば置き換える */
export function putApModelSnapshot(ydoc: Y.Doc, modelId: string, model: ApModel): void {
  setEntity(ydoc.getMap("apModels") as YMap, modelId, model);
}

function apsOf(ydoc: Y.Doc, floorId: string) {
  const aps = floorCollection(ydoc, floorId, "aps");
  if (!aps) throw new Error(`フロアがない: ${floorId}`);
  return aps;
}

export function readAp(ydoc: Y.Doc, floorId: string, apId: string): Ap | undefined {
  const map = floorCollection(ydoc, floorId, "aps")?.get(apId);
  if (!map) return undefined;
  const parsed = ApSchema.safeParse(fromY(map));
  return parsed.success ? parsed.data : undefined;
}

export function addAp(ydoc: Y.Doc, floorId: string, ap: Ap): string {
  const id = newId();
  setEntity(apsOf(ydoc, floorId) as YMap, id, ap);
  return id;
}

export function updateAp(ydoc: Y.Doc, floorId: string, apId: string, patch: Partial<Ap>): void {
  const map = apsOf(ydoc, floorId).get(apId);
  if (map) updateFields(map, patch);
}

/** ラジオの設定を 1 本だけ書き換える */
export function updateRadio(
  ydoc: Y.Doc,
  floorId: string,
  apId: string,
  key: string,
  patch: Partial<RadioConfig>,
) {
  const ap = readAp(ydoc, floorId, apId);
  if (!ap) return;
  updateAp(ydoc, floorId, apId, {
    radios: ap.radios.map((r) => (r.key === key ? { ...r, ...patch } : r)),
  });
}

export function deleteAps(ydoc: Y.Doc, floorId: string, apIds: readonly string[]): void {
  const aps = apsOf(ydoc, floorId);
  for (const id of apIds) aps.delete(id);
}

export function moveAps(
  ydoc: Y.Doc,
  floorId: string,
  apIds: readonly string[],
  dx: number,
  dy: number,
) {
  for (const id of apIds) {
    const ap = readAp(ydoc, floorId, id);
    if (ap)
      updateAp(ydoc, floorId, id, { position: { x: ap.position.x + dx, y: ap.position.y + dy } });
  }
}

/** AP を複製する（FR-6.1）。名前には連番を付け、位置を少しずらす */
export function duplicateAps(
  ydoc: Y.Doc,
  floorId: string,
  apIds: readonly string[],
  offset: Vec2,
): string[] {
  const existing = new Set<string>();
  for (const f of floorsMap(ydoc).values()) {
    for (const ap of (f.get("aps") as Y.Map<YMap> | undefined)?.values() ?? [])
      existing.add(String(ap.get("name")));
  }
  const ids: string[] = [];
  for (const id of apIds) {
    const ap = readAp(ydoc, floorId, id);
    if (!ap) continue;
    const name = nextApName(ap.name, existing);
    existing.add(name);
    ids.push(
      addAp(ydoc, floorId, {
        ...ap,
        name,
        position: { x: ap.position.x + offset.x, y: ap.position.y + offset.y },
      }),
    );
  }
  return ids;
}

/** 「AP-3」のような名前の末尾の番号を、使われていない次の番号にする */
export function nextApName(base: string, existing: ReadonlySet<string>): string {
  const m = base.match(/^(.*?)(\d+)$/);
  const prefix = m ? m[1]! : `${base}-`;
  let n = m ? Number(m[2]) + 1 : 2;
  while (existing.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

// ---- 現場写真（FR-9.1〜9.3） ----

function pinsOf(ydoc: Y.Doc, floorId: string) {
  const pins = floorCollection(ydoc, floorId, "photoPins");
  if (!pins) throw new Error(`フロアがない: ${floorId}`);
  return pins;
}

export function addPhotoPin(ydoc: Y.Doc, floorId: string, pin: PhotoPin): string {
  const id = newId();
  setEntity(pinsOf(ydoc, floorId) as YMap, id, pin);
  return id;
}

export function updatePhotoPin(
  ydoc: Y.Doc,
  floorId: string,
  pinId: string,
  patch: Partial<PhotoPin>,
): void {
  const map = pinsOf(ydoc, floorId).get(pinId);
  if (map) updateFields(map, patch);
}

export function deletePhotoPin(ydoc: Y.Doc, floorId: string, pinId: string): void {
  pinsOf(ydoc, floorId).delete(pinId);
}

// ---- 吹き抜け ----

/** 吹き抜けの集合。版 2 より前に作ったフロアには無いことがあるので、そのときは作る */
function holesOf(ydoc: Y.Doc, floorId: string) {
  const floor = floorMap(ydoc, floorId);
  if (!floor) throw new Error(`フロアがない: ${floorId}`);
  let holes = floor.get("holes") as Y.Map<YMap> | undefined;
  if (!holes) {
    holes = new Y.Map<YMap>();
    floor.set("holes", holes);
  }
  return holes;
}

export function readHole(ydoc: Y.Doc, floorId: string, holeId: string): Hole | undefined {
  const map = floorCollection(ydoc, floorId, "holes")?.get(holeId);
  if (!map) return undefined;
  const parsed = HoleSchema.safeParse(fromY(map));
  return parsed.success ? parsed.data : undefined;
}

export function addHole(ydoc: Y.Doc, floorId: string, hole: Hole): string {
  const id = newId();
  setEntity(holesOf(ydoc, floorId) as YMap, id, hole);
  return id;
}

export function updateHole(
  ydoc: Y.Doc,
  floorId: string,
  holeId: string,
  patch: Partial<Hole>,
): void {
  const map = holesOf(ydoc, floorId).get(holeId);
  if (map) updateFields(map, patch);
}

/** 吹き抜けを消す。吹き抜けでない ID は無視する */
export function deleteHoles(ydoc: Y.Doc, floorId: string, holeIds: readonly string[]): void {
  const holes = holesOf(ydoc, floorId);
  for (const id of holeIds) holes.delete(id);
}

export function moveHoles(
  ydoc: Y.Doc,
  floorId: string,
  holeIds: readonly string[],
  dx: number,
  dy: number,
) {
  for (const id of holeIds) {
    const hole = readHole(ydoc, floorId, id);
    if (hole)
      updateHole(ydoc, floorId, id, {
        points: hole.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      });
  }
}
