import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createEmptyProjectDoc } from "./defaults.js";
import {
  addFloor,
  addWall,
  deleteFloor,
  deleteMaterial,
  mergeWallsById,
  reorderFloors,
  setWallsMaterial,
  splitWallAt,
  updateFloor,
} from "./ops.js";
import { readProjectDoc, writeProjectDoc } from "./ydoc.js";

const fresh = () => {
  const ydoc = new Y.Doc();
  writeProjectDoc(ydoc, createEmptyProjectDoc());
  return ydoc;
};

describe("フロアの操作", () => {
  it("追加したフロアは上に積まれ、並べ替えで order が振り直される", () => {
    const ydoc = fresh();
    const f1 = addFloor(ydoc, { name: "1F", elevationM: 0, heightM: 3 });
    const f2 = addFloor(ydoc, { name: "2F", elevationM: 3, heightM: 3 });
    let doc = readProjectDoc(ydoc);
    expect(doc.floors[f1]?.order).toBe(0);
    expect(doc.floors[f2]?.order).toBe(1);
    expect(doc.floors[f2]?.walls).toEqual({});

    reorderFloors(ydoc, [f2, f1]);
    updateFloor(ydoc, f1, { name: "屋上" });
    doc = readProjectDoc(ydoc);
    expect(doc.floors[f1]).toMatchObject({ name: "屋上", order: 1 });

    deleteFloor(ydoc, f2);
    expect(Object.keys(readProjectDoc(ydoc).floors)).toEqual([f1]);
  });

  it("UndoManager は自分の origin の変更だけを戻す", () => {
    const ydoc = fresh();
    const LOCAL = Symbol("local");
    const undo = new Y.UndoManager([ydoc.getMap("floors")], { trackedOrigins: new Set([LOCAL]) });
    const id = addFloor(ydoc, { name: "1F", elevationM: 0, heightM: 3 });
    ydoc.transact(() => updateFloor(ydoc, id, { name: "自分の変更" }), LOCAL);
    ydoc.transact(() => updateFloor(ydoc, id, { heightM: 4 }), "remote");
    undo.undo();
    expect(readProjectDoc(ydoc).floors[id]).toMatchObject({ name: "1F", heightM: 4 });
  });
});

describe("壁と材質の操作", () => {
  const setup = () => {
    const ydoc = fresh();
    const floorId = addFloor(ydoc, { name: "1F", elevationM: 0, heightM: 3 });
    const wallId = addWall(ydoc, floorId, {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      materialId: "concrete",
      openings: [{ id: "o1", kind: "door", start: 4, end: 6, materialId: "woodDoor" }],
    });
    return { ydoc, floorId, wallId };
  };

  it("分割は一度の undo で元に戻る", () => {
    const { ydoc, floorId, wallId } = setup();
    const LOCAL = Symbol();
    const undo = new Y.UndoManager([ydoc.getMap("floors")], { trackedOrigins: new Set([LOCAL]) });
    ydoc.transact(() => splitWallAt(ydoc, floorId, wallId, 5), LOCAL);
    expect(Object.keys(readProjectDoc(ydoc).floors[floorId]!.walls)).toHaveLength(2);
    undo.undo();
    expect(Object.keys(readProjectDoc(ydoc).floors[floorId]!.walls)).toEqual([wallId]);
  });

  it("分割して結合すると 1 本に戻る", () => {
    const { ydoc, floorId, wallId } = setup();
    const [a, b] = splitWallAt(ydoc, floorId, wallId, 3)!;
    const merged = mergeWallsById(ydoc, floorId, a, b, 1e-6)!;
    const wall = readProjectDoc(ydoc).floors[floorId]!.walls[merged]!;
    expect(wall.points).toHaveLength(2);
    expect(wall.openings).toEqual([
      { id: "o1", kind: "door", start: 4, end: 6, materialId: "woodDoor" },
    ]);
  });

  it("材質を消すと、使っていた壁と開口部を付け替える", () => {
    const { ydoc, floorId, wallId } = setup();
    deleteMaterial(ydoc, "woodDoor", "glass");
    setWallsMaterial(ydoc, floorId, [wallId], "block");
    const doc = readProjectDoc(ydoc);
    expect(doc.materials.woodDoor).toBeUndefined();
    expect(doc.floors[floorId]!.walls[wallId]).toMatchObject({
      materialId: "block",
      openings: [{ materialId: "glass" }],
    });
  });
});
