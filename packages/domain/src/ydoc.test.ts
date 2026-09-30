import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createEmptyProjectDoc } from "./defaults.js";
import { encodeProjectDoc, readProjectDoc } from "./ydoc.js";

describe("Y.Doc との変換", () => {
  it("書き込んだ内容を読み戻せる", () => {
    const doc = createEmptyProjectDoc();
    doc.floors.f1 = {
      name: "1F",
      order: 0,
      elevationM: 0,
      heightM: 3,
      walls: {
        w1: {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          materialId: "concrete",
          openings: [],
        },
      },
      aps: {},
      photoPins: {},
    };
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, encodeProjectDoc(doc));
    expect(readProjectDoc(ydoc)).toEqual(doc);
  });

  it("別々の要素のフィールドを同時に変えても両方の変更が残る", () => {
    const base = encodeProjectDoc(createEmptyProjectDoc());
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, base);
    Y.applyUpdate(b, base);
    const material = (d: Y.Doc) => d.getMap("materials").get("concrete") as Y.Map<unknown>;
    material(a).set("name", "RC 壁");
    material(b).set("color", "#000000");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readProjectDoc(a)).toEqual(readProjectDoc(b));
    expect(readProjectDoc(a).materials.concrete).toMatchObject({ name: "RC 壁", color: "#000000" });
  });
});
