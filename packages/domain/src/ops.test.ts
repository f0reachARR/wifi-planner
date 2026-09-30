import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createEmptyProjectDoc } from "./defaults.js";
import { addFloor, deleteFloor, reorderFloors, updateFloor } from "./ops.js";
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
