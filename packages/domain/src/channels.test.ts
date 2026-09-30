import { describe, expect, it } from "vitest";
import {
  channelCenterMHz,
  channelWidths,
  isAllowedInJapan,
  listChannels,
  occupiedRange,
  rangesOverlap,
} from "./channels.js";

describe("チャネル表", () => {
  it("中心周波数", () => {
    expect(channelCenterMHz("2.4", 1)).toBe(2412);
    expect(channelCenterMHz("2.4", 13)).toBe(2472);
    expect(channelCenterMHz("2.4", 14)).toBe(2484);
    expect(channelCenterMHz("5", 36)).toBe(5180);
    expect(channelCenterMHz("6", 1)).toBe(5955);
  });

  it("5 GHz は UNII-1〜4 の 20 MHz チャネルを並べる", () => {
    const chs = listChannels("5");
    expect(chs[0]).toBe(36);
    expect(chs).toContain(144);
    expect(chs).toContain(177);
    expect(chs).not.toContain(68);
    expect(listChannels("6")).toHaveLength(59);
  });

  it("広い幅のブロックは区間の先頭から切り出す", () => {
    expect(occupiedRange("5", 44, 80)).toEqual({ lowMHz: 5170, highMHz: 5250 });
    expect(occupiedRange("5", 60, 160)).toEqual({ lowMHz: 5170, highMHz: 5330 });
    // 132〜144 は 80 MHz を組めるが 160 MHz は組めない
    expect(channelWidths("5", 132)).toEqual([20, 40, 80]);
    expect(occupiedRange("6", 1, 320)).toEqual({ lowMHz: 5945, highMHz: 6265 });
  });

  it("2.4 GHz の 40 MHz は上側を優先し、はみ出すなら下側にする", () => {
    expect(occupiedRange("2.4", 1, 40)).toEqual({ lowMHz: 2402, highMHz: 2442 });
    expect(occupiedRange("2.4", 11, 40)).toEqual({ lowMHz: 2432, highMHz: 2472 });
    expect(channelWidths("2.4", 14)).toEqual([20]);
  });

  it("国内で使えるかは占有範囲が国内の割り当てに収まるかで決まる", () => {
    expect(isAllowedInJapan("2.4", 13, 20)).toBe(true);
    expect(isAllowedInJapan("2.4", 14, 20)).toBe(false);
    expect(isAllowedInJapan("5", 36, 160)).toBe(true);
    expect(isAllowedInJapan("5", 100, 160)).toBe(true);
    expect(isAllowedInJapan("5", 149, 20)).toBe(false);
    expect(isAllowedInJapan("6", 93, 20)).toBe(true);
    expect(isAllowedInJapan("6", 97, 20)).toBe(false);
    expect(isAllowedInJapan("6", 1, 320)).toBe(true);
    expect(isAllowedInJapan("6", 65, 320)).toBe(false);
  });

  it("隣接するだけの範囲は重ならない", () => {
    const a = occupiedRange("5", 36, 20);
    const b = occupiedRange("5", 40, 20);
    const c = occupiedRange("5", 36, 40);
    if (!a || !b || !c) throw new Error("範囲が求まらない");
    expect(rangesOverlap(a, b)).toBe(false);
    expect(rangesOverlap(b, c)).toBe(true);
  });
});
