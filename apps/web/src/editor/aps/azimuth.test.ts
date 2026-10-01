import { planTransform } from "@wifi-planner/domain";
import { describe, expect, it } from "vitest";
import { azimuthToPlanDir, planDirToAzimuth } from "./azimuth";

describe("方位角と図面座標の向き", () => {
  const scale = { a: { x: 0, y: 0 }, b: { x: 50, y: 0 }, distanceM: 10 };

  for (const rotationDeg of [0, 90, 33]) {
    it(`回転 ${rotationDeg} 度でも、フロア座標の向きを図面座標に移した向きと一致する`, () => {
      const t = planTransform({ rotationDeg }, scale)!;
      for (const azimuthDeg of [0, 45, 90, 200, 315]) {
        const a = (azimuthDeg * Math.PI) / 180;
        const o = t.toPlan({ x: 0, y: 0 });
        const p = t.toPlan({ x: Math.cos(a), y: Math.sin(a) });
        const len = Math.hypot(p.x - o.x, p.y - o.y);
        const dir = azimuthToPlanDir(azimuthDeg, rotationDeg);
        expect(dir.x).toBeCloseTo((p.x - o.x) / len, 9);
        expect(dir.y).toBeCloseTo((p.y - o.y) / len, 9);
        expect(planDirToAzimuth(dir, rotationDeg)).toBeCloseTo(azimuthDeg, 9);
      }
    });
  }
});
