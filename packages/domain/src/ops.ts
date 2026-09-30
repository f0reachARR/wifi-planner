import * as Y from "yjs";
import {
  type Floor,
  type Material,
  type ProjectSettings,
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

/** フロアの要素の集合（walls、aps、photoPins） */
export function floorCollection(
  ydoc: Y.Doc,
  floorId: string,
  key: "walls" | "aps" | "photoPins",
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
  const floor: Floor = { ...input, order: maxOrder + 1, walls: {}, aps: {}, photoPins: {} };
  setEntity(floors as YMap, id, floor, FLOOR_SHAPE);
  return id;
}

export function updateFloor(
  ydoc: Y.Doc,
  floorId: string,
  patch: Partial<Pick<Floor, "name" | "elevationM" | "heightM" | "plan" | "scale" | "alignment">>,
): void {
  const floor = floorMap(ydoc, floorId);
  if (floor) updateFields(floor, patch);
}

export function deleteFloor(ydoc: Y.Doc, floorId: string): void {
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

/** 材質を消す。その材質を使っている壁と開口部は replacementId に付け替える */
export function deleteMaterial(ydoc: Y.Doc, materialId: string, replacementId: string): void {
  if (materialId === replacementId) return;
  for (const floor of floorsMap(ydoc).values()) {
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
