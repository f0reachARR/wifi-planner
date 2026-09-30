import * as Y from "yjs";
import type { Floor, ProjectSettings } from "./schema.js";
import { FLOOR_SHAPE, setEntity } from "./ydoc.js";

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
