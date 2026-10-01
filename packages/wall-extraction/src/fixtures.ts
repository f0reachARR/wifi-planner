import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { Segment } from "./merge.js";

// 検証用の合成図面。縮尺 1:100 の A3 横に、部屋が並ぶ事務所のような平面を描く。
// 壁のほかに、寸法線、文字、ハッチング、ドアの軌跡を細い線で描き、抽出で除けるかを確かめる。

const A3 = { width: 1190.55, height: 841.89 };
/** 縮尺 1:100 で 1 m が何ポイントか */
const PT_PER_M = (10 / 25.4) * 72;
const ORIGIN = { x: 85, y: 80 };

export type SyntheticPlan = {
  pdf: Uint8Array;
  /** 正解の壁の中心線（ポイント、左上原点）。hollowWalls なら壁の両側の線 */
  walls: Segment[];
  ptPerMeter: number;
};

/** hollowWalls にすると、壁を塗りつぶさず両側の 2 本の細線で描く */
export async function makeSyntheticPlanPdf(
  opts: { hollowWalls?: boolean } = {},
): Promise<SyntheticPlan> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([A3.width, A3.height]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const black = rgb(0, 0, 0);
  const walls: Segment[] = [];

  const toPt = (xm: number, ym: number) => ({
    x: ORIGIN.x + xm * PT_PER_M,
    y: ORIGIN.y + ym * PT_PER_M,
  });
  const line = (a: { x: number; y: number }, b: { x: number; y: number }, thickness: number) =>
    page.drawLine({
      start: { x: a.x, y: A3.height - a.y },
      end: { x: b.x, y: A3.height - b.y },
      thickness,
      color: black,
    });
  const wall = (x0: number, y0: number, x1: number, y1: number, thicknessM: number) => {
    const a = toPt(x0, y0);
    const b = toPt(x1, y1);
    if (!opts.hollowWalls) {
      line(a, b, thicknessM * PT_PER_M);
      walls.push({ a, b });
      return;
    }
    // 壁の向きに垂直な方向へ、厚さの半分ずつずらした 2 本の線
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const h = (thicknessM * PT_PER_M) / 2;
    const nx = (-(b.y - a.y) / len) * h;
    const ny = ((b.x - a.x) / len) * h;
    for (const sign of [-1, 1]) {
      const fa = { x: a.x + nx * sign, y: a.y + ny * sign };
      const fb = { x: b.x + nx * sign, y: b.y + ny * sign };
      line(fa, fb, 0.5);
      walls.push({ a: fa, b: fb });
    }
  };

  // 外壁 36 m × 24 m
  const OUT = 0.2;
  wall(0, 0, 36, 0, OUT);
  wall(36, 0, 36, 24, OUT);
  wall(0, 24, 36, 24, OUT);
  wall(0, 0, 0, 24, OUT);

  const IN = 0.12;
  // 上の部屋列（0〜10 m）と下の部屋列（12〜24 m）の間仕切り
  for (const x of [6, 12, 18, 24, 30]) wall(x, 0, x, 10, IN);
  for (const x of [9, 18, 27]) wall(x, 12, x, 24, IN);
  // 廊下の両側の壁。部屋ごとに幅 0.9 m のドアの開口を空ける
  const corridorWall = (y: number, rooms: number[]) => {
    let x = 0;
    for (const end of rooms) {
      const door = end - 1.5;
      wall(x, y, door, y, IN);
      // ドアの軌跡（細線）
      line(toPt(door, y), toPt(door + 0.9, y + (y === 10 ? -0.9 : 0.9)), 0.3);
      x = door + 0.9;
    }
    wall(x, y, 36, y, IN);
  };
  corridorWall(10, [6, 12, 18, 24, 30, 36]);
  corridorWall(12, [9, 18, 27, 36]);

  // 寸法線と寸法値
  for (const [x0, x1] of [
    [0, 6],
    [6, 12],
    [12, 18],
    [18, 24],
    [24, 30],
    [30, 36],
  ] as const) {
    const y = -1.5;
    line(toPt(x0, y), toPt(x1, y), 0.3);
    line(toPt(x0, y - 0.3), toPt(x0, y + 0.3), 0.3);
    const p = toPt((x0 + x1) / 2, y - 0.4);
    page.drawText(String((x1 - x0) * 1000), {
      x: p.x - 10,
      y: A3.height - p.y,
      size: 7,
      font,
      color: black,
    });
  }
  // 室名
  for (let i = 0; i < 6; i++) {
    const p = toPt(i * 6 + 2, 5);
    page.drawText(`ROOM ${i + 1}`, { x: p.x, y: A3.height - p.y, size: 9, font, color: black });
  }
  // 1 部屋だけハッチングする
  for (let k = 0; k < 20; k++) {
    const a = toPt(9 + k * 0.4, 12.2);
    const b = toPt(9 + k * 0.4 + 0.4 * 5, 12.2 + 2);
    line(a, b, 0.25);
  }

  return { pdf: await doc.save(), walls, ptPerMeter: PT_PER_M };
}

/** 抽出した線分が正解の壁をどれだけ覆うか。正解の線分ごとに、覆われた長さの割合が minCover 以上なら検出とみなす */
export function evaluateRecall(
  truth: readonly Segment[],
  foundPolylines: readonly { x: number; y: number }[][],
  opts: { maxDistance: number; minCover: number },
): { recall: number; missed: Segment[] } {
  const found: Segment[] = foundPolylines.flatMap((pl) =>
    pl.slice(1).map((b, i) => ({ a: pl[i]!, b })),
  );
  const missed: Segment[] = [];
  for (const t of truth) {
    const len = Math.hypot(t.b.x - t.a.x, t.b.y - t.a.y);
    const ux = (t.b.x - t.a.x) / len;
    const uy = (t.b.y - t.a.y) / len;
    const intervals: [number, number][] = [];
    for (const f of found) {
      const perp = (p: { x: number; y: number }) =>
        Math.abs((p.x - t.a.x) * -uy + (p.y - t.a.y) * ux);
      if (perp(f.a) > opts.maxDistance || perp(f.b) > opts.maxDistance) continue;
      const proj = (p: { x: number; y: number }) => (p.x - t.a.x) * ux + (p.y - t.a.y) * uy;
      const lo = Math.max(0, Math.min(proj(f.a), proj(f.b)));
      const hi = Math.min(len, Math.max(proj(f.a), proj(f.b)));
      if (hi > lo) intervals.push([lo, hi]);
    }
    intervals.sort((p, q) => p[0] - q[0]);
    let covered = 0;
    let end = 0;
    for (const [lo, hi] of intervals) {
      if (hi <= end) continue;
      covered += hi - Math.max(lo, end);
      end = hi;
    }
    if (covered / len < opts.minCover) missed.push(t);
  }
  return { recall: 1 - missed.length / truth.length, missed };
}
