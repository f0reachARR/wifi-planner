import { describe, expect, it } from "vitest";
import {
  floorPlacements,
  planOffsetConflict,
  planOffsetFromPoints,
  planOffsetMap,
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
  const scale = (distanceM: number) => ({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, distanceM });

  it("基準点が一致するように、相手の図面座標への回転と平行移動を求める", () => {
    // 相手の図面は 1 単位が 2 倍の長さ。こちらの右向きは相手の下向き
    const own = { a: { x: 5, y: 0 }, b: { x: 25, y: 0 }, scale: scale(1) };
    const target = { a: { x: 1, y: 1 }, b: { x: 1, y: 11 }, scale: scale(2) };
    const result = planOffsetFromPoints(own, target);
    if (!result) throw new Error();
    expect(result.rotationDeg).toBeCloseTo(90);
    expect(result.distanceRatio).toBeCloseTo(1);
    const map = planOffsetMap(result, own, target)!;
    close(map.forward(own.a), target.a);
    close(map.forward(own.b), target.b);
    close(map.inverse(target.b), own.b);
  });

  it("基準点間の実距離が食い違えば、その比を返す", () => {
    const result = planOffsetFromPoints(
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, scale: scale(1) },
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, scale: scale(1.1) },
    );
    expect(result?.distanceRatio).toBeCloseTo(1 / 1.1);
  });

  it("未校正のフロアや、重なった基準点では求めない", () => {
    const pts = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
    expect(planOffsetFromPoints({ ...pts }, { ...pts, scale: scale(1) })).toBeUndefined();
    expect(
      planOffsetFromPoints({ a: pts.a, b: pts.a, scale: scale(1) }, { ...pts, scale: scale(1) }),
    ).toBeUndefined();
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
  const offsetTo = (
    floorId: string,
    own: { a: { x: number; y: number }; b: { x: number; y: number } },
    target: { a: { x: number; y: number }; b: { x: number; y: number } },
  ) => {
    const r = planOffsetFromPoints({ ...own, scale }, { ...target, scale })!;
    return { floorId, rotationDeg: r.rotationDeg, translation: r.translation };
  };

  it("位置を合わせると、別のフロアの同じ地点が同じ図面上の位置に重なる", () => {
    // 2F の図面は 1F を右に 90 度回して 50 単位ずらしたもの。基準点は同じ柱の位置を指す
    const f1 = { order: 0, plan: plan(0), scale };
    const f2 = {
      order: 1,
      plan: plan(30),
      scale,
      planOffset: offsetTo(
        "f1",
        { a: { x: 90, y: 60 }, b: { x: 90, y: 110 } },
        { a: { x: 10, y: 10 }, b: { x: 60, y: 10 } },
      ),
    };
    const placements = floorPlacements({ f1, f2 });
    expect(placements.f1?.isReference).toBe(true);
    expect(placements.f2?.aligned).toBe(true);
    const map = planToPlan(placements.f2!, placements.f1!);
    close(map({ x: 90, y: 60 }), { x: 10, y: 10 });
    close(map({ x: 90, y: 110 }), { x: 60, y: 10 });
    // 図面の表示の回転を変えても、図面どうしの対応は変わらない
    const rotated = floorPlacements({
      f1: { ...f1, plan: plan(90) },
      f2: { ...f2, plan: plan(0) },
    });
    close(planToPlan(rotated.f2!, rotated.f1!)({ x: 90, y: 60 }), { x: 10, y: 10 });
  });

  it("位置合わせを順にたどり、基準フロアへ向かう辺も逆向きに使う", () => {
    // 3F は 2F に、1F は 2F に合わせた。2F と 3F の共通の地点は 1F には無い
    const f1 = {
      order: 0,
      plan: plan(0),
      scale,
      planOffset: offsetTo(
        "f2",
        { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
        { a: { x: 5, y: 5 }, b: { x: 5, y: 15 } },
      ),
    };
    const f2 = { order: 1, plan: plan(0), scale };
    const f3 = {
      order: 2,
      plan: plan(0),
      scale,
      planOffset: offsetTo(
        "f2",
        { a: { x: 20, y: 0 }, b: { x: 30, y: 0 } },
        { a: { x: 40, y: 40 }, b: { x: 50, y: 40 } },
      ),
    };
    const placements = floorPlacements({ f1, f2, f3 });
    expect(placements.f2?.aligned).toBe(true);
    expect(placements.f3?.aligned).toBe(true);
    // 3F の (20, 0) は 2F の (40, 40)、2F の (5, 5) は 1F の (0, 0)
    close(planToPlan(placements.f3!, placements.f2!)({ x: 20, y: 0 }), { x: 40, y: 40 });
    close(planToPlan(placements.f2!, placements.f1!)({ x: 5, y: 5 }), { x: 0, y: 0 });
    // 3F の (20, 0) を 1F へ：2F の (40, 40) は 2F の (5, 5) から右に 35、下に 35。
    // 1F の右向きが 2F の下向きなので、1F では右に 35、上に 35
    close(planToPlan(placements.f3!, placements.f1!)({ x: 20, y: 0 }), { x: 35, y: -35 });
  });

  it("基準フロアにつながらないフロアは位置を合わせず、未校正のフロアは含めない", () => {
    const pts = { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } };
    const placements = floorPlacements({
      f1: { order: 0, plan: plan(0), scale },
      f2: { order: 1, plan: plan(0), scale, planOffset: offsetTo("f3", pts, pts) },
      f3: { order: 2, plan: plan(0), scale },
      f4: { order: 3, plan: plan(0), scale: undefined, planOffset: offsetTo("f1", pts, pts) },
      f5: { order: 4, plan: plan(0), scale, planOffset: offsetTo("f4", pts, pts) },
    });
    expect(placements.f2?.aligned).toBe(false);
    expect(placements.f3?.aligned).toBe(false);
    expect(placements.f4).toBeUndefined();
    expect(placements.f5?.aligned).toBe(false);
  });

  describe("合わせ直したときの問題", () => {
    const pts = { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } };
    const floor = (order: number, to?: string) => ({
      order,
      plan: plan(0),
      scale,
      ...(to ? { planOffset: offsetTo(to, pts, pts) } : {}),
    });
    // 1F ← 2F ← 3F ← 4F
    const chain = { f1: floor(0), f2: floor(1, "f1"), f3: floor(2, "f2"), f4: floor(3, "f3") };

    it("自分を通して基準フロアにつながるフロアに合わせると、両方とも外れる", () => {
      expect(planOffsetConflict(chain, "f2", "f3")).toBe("detach");
    });

    it("自分に合わせたフロアの先に合わせると、輪になる", () => {
      expect(planOffsetConflict(chain, "f2", "f4")).toBe("cycle");
      // 基準フロアにつながらないフロアどうしでも、輪は作らない
      const floating = { f1: floor(0), f2: floor(1), f3: floor(2, "f2"), f4: floor(3, "f3") };
      expect(planOffsetConflict(floating, "f2", "f4")).toBe("cycle");
    });

    it("基準フロアに合わせ直すのと、基準フロアから子へ向きを入れ替えるのは問題ない", () => {
      expect(planOffsetConflict(chain, "f3", "f1")).toBeUndefined();
      expect(planOffsetConflict(chain, "f1", "f2")).toBeUndefined();
      // もともと基準フロアにつながっていないフロアに合わせるのは、警告だけで止めない
      expect(
        planOffsetConflict({ f1: floor(0), f2: floor(1), f3: floor(2) }, "f3", "f2"),
      ).toBeUndefined();
    });
  });
});
