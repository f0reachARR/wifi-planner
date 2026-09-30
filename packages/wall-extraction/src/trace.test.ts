import { describe, expect, it } from "vitest";
import { simplify, traceSkeleton } from "./trace.js";

describe("細線をたどって折れ線にする", () => {
  it("T 字の交点で 3 本の枝に分かれる", () => {
    const w = 21;
    const h = 21;
    const img = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) img[10 * w + x] = 1; // 横線
    for (let y = 11; y < h; y++) img[y * w + 10] = 1; // 下への縦線
    const chains = traceSkeleton(img, w, h).map((c) => simplify(c, 1));
    expect(chains).toHaveLength(3);
    const lengths = chains
      .map((c) => Math.round(Math.hypot(c.at(-1)!.x - c[0]!.x, c.at(-1)!.y - c[0]!.y)))
      .sort((a, b) => a - b);
    expect(lengths).toEqual([10, 10, 10]);
  });

  it("L 字は 1 本の枝になり、間引くと角の頂点が残る", () => {
    const w = 12;
    const img = new Uint8Array(w * w);
    for (let x = 1; x <= 10; x++) img[1 * w + x] = 1;
    for (let y = 2; y <= 10; y++) img[y * w + 10] = 1;
    const chains = traceSkeleton(img, w, w);
    expect(chains).toHaveLength(1);
    expect(simplify(chains[0]!, 1)).toHaveLength(3);
  });

  it("閉じた輪もたどる", () => {
    const w = 10;
    const img = new Uint8Array(w * w);
    for (let i = 2; i <= 7; i++) {
      img[2 * w + i] = 1;
      img[7 * w + i] = 1;
      img[i * w + 2] = 1;
      img[i * w + 7] = 1;
    }
    const chains = traceSkeleton(img, w, w);
    expect(chains.length).toBeGreaterThanOrEqual(1);
    expect(chains.reduce((n, c) => n + c.length, 0)).toBeGreaterThanOrEqual(20);
  });
});
