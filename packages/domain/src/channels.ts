import { z } from "zod";
import type { Band } from "./band.js";

export type FrequencyRange = { lowMHz: number; highMHz: number };

/** チャネル幅（MHz）。2.4 GHz は 40 まで、5 GHz は 160 まで、6 GHz は 320 まで。 */
export const ChannelWidth = z.union([
  z.literal(20),
  z.literal(40),
  z.literal(80),
  z.literal(160),
  z.literal(320),
]);
export type ChannelWidth = z.infer<typeof ChannelWidth>;

type Segment = { first: number; last: number };

// 20 MHz チャネルが 4 番おきに並び、そこから広い幅のブロックを先頭から順に切り出す区間。
const SEGMENTS: Record<"5" | "6", Segment[]> = {
  "5": [
    { first: 36, last: 64 },
    { first: 100, last: 144 },
    { first: 149, last: 177 },
  ],
  "6": [{ first: 1, last: 233 }],
};

const MAX_WIDTH: Record<Band, ChannelWidth> = { "2.4": 40, "5": 160, "6": 320 };

const ALL_WIDTHS: ChannelWidth[] = [20, 40, 80, 160, 320];

/**
 * 国内で使える周波数範囲。表の値は実装時点の理解に基づくので、法令の改正に合わせてここだけを直す。
 * 5 GHz の W56 は 144ch を含む 5470〜5730 MHz とした。
 */
const JAPAN_RANGES: Record<Band, FrequencyRange[]> = {
  "2.4": [{ lowMHz: 2400, highMHz: 2483.5 }],
  "5": [
    { lowMHz: 5150, highMHz: 5350 }, // W52、W53
    { lowMHz: 5470, highMHz: 5730 }, // W56
  ],
  "6": [{ lowMHz: 5925, highMHz: 6425 }],
};

export function channelCenterMHz(band: Band, channel: number): number {
  switch (band) {
    case "2.4":
      return channel === 14 ? 2484 : 2407 + 5 * channel;
    case "5":
      return 5000 + 5 * channel;
    case "6":
      return 5950 + 5 * channel;
  }
}

/** 帯域で選べる 20 MHz のチャネル番号を昇順で返す。 */
export function listChannels(band: Band): number[] {
  if (band === "2.4") {
    return Array.from({ length: 14 }, (_, i) => i + 1);
  }
  const channels: number[] = [];
  for (const seg of SEGMENTS[band]) {
    for (let ch = seg.first; ch <= seg.last; ch += 4) channels.push(ch);
  }
  return channels;
}

function blockOf(
  band: "5" | "6",
  channel: number,
  width: ChannelWidth,
): [number, number] | undefined {
  const n = width / 20;
  for (const seg of SEGMENTS[band]) {
    if (channel < seg.first || channel > seg.last || (channel - seg.first) % 4 !== 0) continue;
    const index = (channel - seg.first) / 4;
    const first = seg.first + Math.floor(index / n) * n * 4;
    const last = first + (n - 1) * 4;
    return last <= seg.last ? [first, last] : undefined;
  }
  return undefined;
}

/** 主チャネルとチャネル幅から、占有する 20 MHz チャネルの両端を返す。組めない組み合わせなら undefined。 */
function channelBlock(
  band: Band,
  channel: number,
  width: ChannelWidth,
): [number, number] | undefined {
  if (width > MAX_WIDTH[band]) return undefined;
  if (band === "2.4") {
    if (channel < 1 || channel > 14) return undefined;
    if (width === 20) return [channel, channel];
    if (channel === 14) return undefined;
    // 2 次チャネルは上側（HT40+）を優先し、13ch を超えるなら下側（HT40−）にする
    if (channel + 4 <= 13) return [channel, channel + 4];
    if (channel - 4 >= 1) return [channel - 4, channel];
    return undefined;
  }
  return blockOf(band, channel, width);
}

export function channelWidths(band: Band, channel: number): ChannelWidth[] {
  return ALL_WIDTHS.filter((w) => channelBlock(band, channel, w) !== undefined);
}

export function occupiedRange(
  band: Band,
  channel: number,
  width: ChannelWidth,
): FrequencyRange | undefined {
  const block = channelBlock(band, channel, width);
  if (!block) return undefined;
  return {
    lowMHz: channelCenterMHz(band, block[0]) - 10,
    highMHz: channelCenterMHz(band, block[1]) + 10,
  };
}

/** 伝搬計算に使う周波数。占有範囲の中央とする。 */
export function effectiveFrequencyMHz(band: Band, channel: number, width: ChannelWidth): number {
  const range = occupiedRange(band, channel, width);
  if (!range) throw new Error(`組めないチャネル: ${band} GHz ${channel}ch ${width} MHz`);
  return (range.lowMHz + range.highMHz) / 2;
}

export function isAllowedInJapan(band: Band, channel: number, width: ChannelWidth): boolean {
  const range = occupiedRange(band, channel, width);
  if (!range) return false;
  return JAPAN_RANGES[band].some((r) => range.lowMHz >= r.lowMHz && range.highMHz <= r.highMHz);
}

export function rangesOverlap(a: FrequencyRange, b: FrequencyRange): boolean {
  return a.lowMHz < b.highMHz && b.lowMHz < a.highMHz;
}
