import { floorPlacements, planOffsetFromPoints, planToPlan } from "@wifi-planner/domain";
import { describe, expect, it } from "vitest";
import { applyNodeTransform } from "../../propagation/placement";
import { similarityNode } from "./similarity";

describe("重ね表示の変換", () => {
  it("別のフロアの図面座標を、Konva のノードの変換で今のフロアの図面座標に移せる", () => {
    const plan = (rotationDeg: number, unitsPerPx = 1) => ({
      sourceSha256: "s",
      imageSha256: "i",
      widthPx: 100,
      heightPx: 100,
      unitsPerPx,
      rotationDeg,
    });
    const f1 = {
      order: 0,
      plan: plan(20),
      scale: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, distanceM: 1 },
    };
    const f2 = {
      order: 1,
      plan: plan(-35),
      scale: { a: { x: 0, y: 0 }, b: { x: 20, y: 0 }, distanceM: 1 },
    };
    const offset = planOffsetFromPoints(
      { ...f2, a: { x: 80, y: 20 }, b: { x: 30, y: 90 } },
      { ...f1, a: { x: 3, y: 4 }, b: { x: 50, y: 7 } },
    )!;
    const placements = floorPlacements({
      f1,
      f2: { ...f2, planOffset: { floorId: "f1", ...offset } },
    });
    const map = planToPlan(placements.f2!, placements.f1!);
    const node = similarityNode(map);
    for (const p of [
      { x: 12, y: 34 },
      { x: -5, y: 70 },
    ]) {
      const moved = applyNodeTransform(node, p);
      expect(moved.x + node.x).toBeCloseTo(map(p).x, 9);
      expect(moved.y + node.y).toBeCloseTo(map(p).y, 9);
    }
  });
});
