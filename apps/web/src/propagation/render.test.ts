import { describe, expect, it } from "vitest";
import type { RadioField } from "./protocol";
import { composeImage, rssiColor } from "./render";

const stops = [
  { dbm: -60, color: "#00ff00" },
  { dbm: -75, color: "#ff0000" },
];

describe("ヒートマップの色", () => {
  it("区切りの値以上で最も高い区切りの色にし、一番低い区切りより弱ければ塗らない", () => {
    const color = rssiColor(stops, undefined);
    expect(color(-50)).toEqual([0, 255, 0, 255]);
    expect(color(-70)).toEqual([255, 0, 0, 255]);
    expect(color(-80)[3]).toBe(0);
    expect(rssiColor(stops, -67)(-70)[3]).toBe(0);
  });

  it("AP 数と同一チャネル干渉は閾値以上で届くラジオで数え、対象の AP で絞れる", () => {
    const radio = (apId: string, values: number[], low: number): RadioField => ({
      floorId: "f",
      apId,
      radioKey: "r",
      channel: 36,
      widthMHz: 20,
      range: { lowMHz: low, highMHz: low + 20 },
      field: Float32Array.from(values),
    });
    const radios = [radio("a", [-50, -50], 5170), radio("b", [-50, -90], 5170)];
    const base = { stops, thresholdDbm: -67, hideBelow: false, apIds: new Set<string>() };
    const count = composeImage(radios, 2, { ...base, mode: "count" });
    expect([count[3], count[7]]).toEqual([255, 255]);
    const cci = composeImage(radios, 2, { ...base, mode: "cci" });
    expect([cci[3], cci[7]]).toEqual([255, 0]);
    const onlyA = composeImage(radios, 2, { ...base, mode: "cci", apIds: new Set(["a"]) });
    expect(onlyA[3]).toBe(0);
  });
});
