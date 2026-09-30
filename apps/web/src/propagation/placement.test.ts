import { planTransform } from "@wifi-planner/domain";
import { describe, expect, it } from "vitest";
import { applyNodeTransform, heatmapPlacement } from "./placement";

describe("ヒートマップの配置", () => {
  const scale = { a: { x: 0, y: 0 }, b: { x: 50, y: 0 }, distanceM: 10 };
  const grid = { x0: -3, y0: -8, step: 0.5, cols: 10, rows: 10 };

  for (const rotationDeg of [0, 90, 33]) {
    it(`回転 ${rotationDeg} 度でも、フロア座標の点が図面座標の同じ点に重なる`, () => {
      const t = planTransform({ rotationDeg }, scale)!;
      const { group } = heatmapPlacement(grid, rotationDeg, t.metersPerUnit);
      for (const floorPoint of [
        { x: 1.5, y: -2 },
        { x: -3, y: 4.25 },
      ]) {
        const viaNode = applyNodeTransform(group, floorPoint);
        const expected = t.toPlan(floorPoint);
        expect(viaNode.x).toBeCloseTo(expected.x, 9);
        expect(viaNode.y).toBeCloseTo(expected.y, 9);
      }
    });
  }
});
