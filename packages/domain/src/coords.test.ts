import { describe, expect, it } from "vitest";
import {
  alignFloor,
  applyRigid,
  floorPlacements,
  invertRigid,
  planToPlan,
  planTransform,
} from "./coords.js";

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe("図面座標とフロア座標", () => {
  const scale = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, distanceM: 10 };

  it("未校正なら変換できない", () => {
    expect(planTransform({ rotationDeg: 0 }, undefined)).toBeUndefined();
  });

  it("メートルに換算し、y を上向きにする", () => {
    const t = planTransform({ rotationDeg: 0 }, scale);
    close(t?.toFloor({ x: 50, y: 20 }) ?? { x: Number.NaN, y: 0 }, { x: 5, y: -2 });
  });

  it("画面上の時計回り 90 度で、右向きが下向きになる", () => {
    const t = planTransform({ rotationDeg: 90 }, scale);
    // 図面の右（+x）は、回転後の画面では下（フロア座標では −y）を向く
    close(t?.toFloor({ x: 10, y: 0 }) ?? { x: Number.NaN, y: 0 }, { x: 0, y: -1 });
  });

  it("逆変換で元に戻る", () => {
    const t = planTransform({ rotationDeg: 33 }, scale);
    if (!t) throw new Error();
    const p = { x: 123, y: -45 };
    close(t.toPlan(t.toFloor(p)), p);
  });
});

describe("フロア間の位置合わせ", () => {
  it("基準点が一致するように回転と平行移動を求める", () => {
    const reference = { a: { x: 1, y: 1 }, b: { x: 1, y: 11 } };
    const own = { a: { x: 5, y: 0 }, b: { x: 15, y: 0 } };
    const result = alignFloor(own, reference);
    if (!result) throw new Error();
    close(applyRigid(result.toWorld, own.a), reference.a);
    close(applyRigid(result.toWorld, own.b), reference.b);
    expect(result.distanceRatio).toBeCloseTo(1);
    close(applyRigid(invertRigid(result.toWorld), reference.b), own.b);
  });
});

describe("フロアの置き方", () => {
  const plan = (rotationDeg: number) => ({
    sourceSha256: "s",
    imageSha256: "i",
    widthPx: 100,
    heightPx: 100,
    unitsPerPx: 1,
    rotationDeg,
  });
  const scale = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, distanceM: 1 };

  it("基準点を合わせると、別のフロアの同じ地点が同じ図面上の位置に重なる", () => {
    // 2F の図面は 1F を右に 90 度回して 50 単位ずらしたもの。基準点は同じ柱の位置を指す
    const f1 = {
      order: 0,
      plan: plan(0),
      scale,
      alignment: { a: { x: 10, y: 10 }, b: { x: 60, y: 10 } },
    };
    const f2 = {
      order: 1,
      plan: plan(0),
      scale,
      alignment: { a: { x: 90, y: 60 }, b: { x: 90, y: 110 } },
    };
    const placements = floorPlacements({ f1, f2 });
    expect(placements.f1?.isReference).toBe(true);
    expect(placements.f2?.aligned).toBe(true);
    expect(placements.f2?.distanceRatio).toBeCloseTo(1);
    const map = planToPlan(placements.f2!, placements.f1!);
    const a = map({ x: 90, y: 60 });
    const b = map({ x: 90, y: 110 });
    expect(a.x).toBeCloseTo(10);
    expect(a.y).toBeCloseTo(10);
    expect(b.x).toBeCloseTo(60);
    expect(b.y).toBeCloseTo(10);
  });

  it("基準点のないフロアは位置を合わせず、未校正のフロアは含めない", () => {
    const placements = floorPlacements({
      f1: { order: 0, plan: plan(0), scale },
      f2: { order: 1, plan: plan(0), scale, alignment: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } } },
      f3: { order: 2, plan: plan(0), scale: undefined },
    });
    expect(placements.f2?.aligned).toBe(false);
    expect(placements.f3).toBeUndefined();
  });
});
