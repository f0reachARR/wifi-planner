import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createEmptyProjectDoc } from "./defaults.js";
import {
  addAp,
  addFloor,
  addHole,
  addWall,
  clearPlanOffsets,
  defaultRadios,
  deleteFloor,
  deleteHoles,
  deleteMaterial,
  duplicateAps,
  mergeWallsById,
  moveHoles,
  nextApName,
  putApModelSnapshot,
  reorderFloors,
  setWallsHeight,
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
  it("吹き抜けを足して動かし、消せる", () => {
    const ydoc = fresh();
    const f = addFloor(ydoc, { name: "2F", elevationM: 3, heightM: 3 });
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const id = addHole(ydoc, f, { points: square });
    moveHoles(ydoc, f, [id], 5, -1);
    expect(readProjectDoc(ydoc).floors[f]?.holes[id]?.points[1]).toEqual({ x: 15, y: -1 });
    deleteHoles(ydoc, f, [id]);
    expect(readProjectDoc(ydoc).floors[f]?.holes).toEqual({});
  });

  it("吹き抜けの集合が無いフロアも読め、吹き抜けを足すと集合を作る", () => {
    const ydoc = fresh();
    const f = addFloor(ydoc, { name: "1F", elevationM: 0, heightM: 3 });
    // 版 2 より前の文書と統合したときのように、集合を消しておく
    (ydoc.getMap("floors").get(f) as Y.Map<unknown>).delete("holes");
    expect(readProjectDoc(ydoc).floors[f]?.holes).toEqual({});
    const id = addHole(ydoc, f, {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
    });
    expect(Object.keys(readProjectDoc(ydoc).floors[f]!.holes)).toEqual([id]);
  });

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

  it("フロアの位置合わせを、そのフロアに合わせたほかのフロアのものも含めて消す", () => {
    const ydoc = fresh();
    const [f1, f2, f3, f4] = ["1F", "2F", "3F", "4F"].map((name, i) =>
      addFloor(ydoc, { name, elevationM: i * 3, heightM: 3 }),
    ) as [string, string, string, string];
    const offset = (floorId: string) => ({
      planOffset: { floorId, rotationDeg: 0, translation: { x: 0, y: 0 } },
    });
    updateFloor(ydoc, f2, offset(f1));
    updateFloor(ydoc, f3, offset(f2));
    updateFloor(ydoc, f4, offset(f1));
    clearPlanOffsets(ydoc, f2);
    const floors = readProjectDoc(ydoc).floors;
    expect(floors[f2]?.planOffset).toBeUndefined();
    expect(floors[f3]?.planOffset).toBeUndefined();
    expect(floors[f4]?.planOffset?.floorId).toBe(f1);
    deleteFloor(ydoc, f1);
    expect(readProjectDoc(ydoc).floors[f4]?.planOffset).toBeUndefined();
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

  it("新しいフロアの床スラブはプリセットの材質にする", () => {
    const { ydoc, floorId } = setup();
    expect(readProjectDoc(ydoc).floors[floorId]!.slabMaterialId).toBe("slab");
  });

  it("壁の高さをまとめて変え、undefined で既定に戻す", () => {
    const { ydoc, floorId, wallId } = setup();
    setWallsHeight(ydoc, floorId, [wallId], { bottomM: 1, topM: 2.5 });
    expect(readProjectDoc(ydoc).floors[floorId]!.walls[wallId]).toMatchObject({
      bottomM: 1,
      topM: 2.5,
    });
    setWallsHeight(ydoc, floorId, [wallId], { topM: undefined });
    const wall = readProjectDoc(ydoc).floors[floorId]!.walls[wallId]!;
    expect(wall.bottomM).toBe(1);
    expect("topM" in wall).toBe(false);
  });

  it("材質を消すと、使っていた壁と開口部と床スラブを付け替える", () => {
    const { ydoc, floorId, wallId } = setup();
    deleteMaterial(ydoc, "slab", "concrete");
    expect(readProjectDoc(ydoc).floors[floorId]!.slabMaterialId).toBe("concrete");
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

describe("AP の操作", () => {
  it("モデルからラジオの初期設定を作り、複製では名前に次の番号を付ける", () => {
    const ydoc = fresh();
    const floorId = addFloor(ydoc, { name: "1F", elevationM: 0, heightM: 3 });
    const model = {
      name: "AP",
      radios: [
        {
          key: "r0",
          bands: ["2.4" as const],
          maxTxPowerDbm: { "2.4": 20 },
          pattern: { kind: "omni" as const, gainDbi: 3 },
        },
        {
          key: "r1",
          bands: ["5" as const, "6" as const],
          maxTxPowerDbm: { "5": 23 },
          pattern: { kind: "omni" as const, gainDbi: 4 },
        },
      ],
    };
    putApModelSnapshot(ydoc, "m1", model);
    const id = addAp(ydoc, floorId, {
      name: "AP-1",
      modelId: "m1",
      position: { x: 0, y: 0 },
      heightM: 2.7,
      mount: "ceiling",
      azimuthDeg: 0,
      tiltDeg: 0,
      radios: defaultRadios(model),
    });
    const [copy] = duplicateAps(ydoc, floorId, [id], { x: 5, y: 5 });
    const doc = readProjectDoc(ydoc);
    expect(doc.floors[floorId]!.aps[id]!.radios).toEqual([
      { key: "r0", enabled: true, band: "2.4", channel: 1, widthMHz: 20, txPowerDbm: 20 },
      { key: "r1", enabled: true, band: "5", channel: 36, widthMHz: 80, txPowerDbm: 23 },
    ]);
    expect(doc.floors[floorId]!.aps[copy!]).toMatchObject({
      name: "AP-2",
      position: { x: 5, y: 5 },
    });
    expect(nextApName("会議室", new Set())).toBe("会議室-2");
  });
});
