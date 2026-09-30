import type { LegendStop } from "@wifi-planner/domain";
import { coChannelCount, countAbove, maxField } from "@wifi-planner/propagation";
import type { RadioField } from "./protocol";

export type HeatmapMode = "rssi" | "count" | "cci";

export const MODE_LABELS: Record<HeatmapMode, string> = {
  rssi: "受信電力",
  count: "AP 数",
  cci: "同一チャネル干渉",
};

/** AP 数の色。一つの色相の明るい段から暗い段へ（1 台、2 台、3 台、4 台以上） */
export const COUNT_COLORS = ["#9ec5f4", "#5598e7", "#2a78d6", "#184f95"];
/** 同一チャネル干渉の色。重なる数が 2、3、4 以上の順に濃くする */
export const CCI_COLORS = ["#f6b89c", "#eb6834", "#a8401b"];

type RGBA = [number, number, number, number];
const hex = (c: string): RGBA => [
  Number.parseInt(c.slice(1, 3), 16),
  Number.parseInt(c.slice(3, 5), 16),
  Number.parseInt(c.slice(5, 7), 16),
  255,
];
const CLEAR: RGBA = [0, 0, 0, 0];

/** 受信電力の色。区切りの値以上で最も高い区切りの色にする。一番低い区切りより弱ければ塗らない */
export function rssiColor(stops: readonly LegendStop[], hideBelowDbm: number | undefined) {
  const sorted = [...stops]
    .sort((a, b) => b.dbm - a.dbm)
    .map((s) => ({ dbm: s.dbm, rgba: hex(s.color) }));
  return (v: number): RGBA => {
    if (!Number.isFinite(v) || (hideBelowDbm !== undefined && v < hideBelowDbm)) return CLEAR;
    for (const s of sorted) if (v >= s.dbm) return s.rgba;
    return CLEAR;
  };
}

export type ComposeOptions = {
  mode: HeatmapMode;
  /** 対象の AP（FR-8.3）。空ならすべて */
  apIds: ReadonlySet<string>;
  stops: readonly LegendStop[];
  thresholdDbm: number;
  hideBelow: boolean;
};

/** ラジオごとの格子を組み合わせ、1 点 1 画素の RGBA にする（FR-8.2〜8.6） */
export function composeImage(
  radios: readonly RadioField[],
  size: number,
  opts: ComposeOptions,
): Uint8ClampedArray {
  const picked = radios.filter((r) => opts.apIds.size === 0 || opts.apIds.has(r.apId));
  const fields = picked.map((r) => r.field);
  const out = new Uint8ClampedArray(size * 4);
  const put = (k: number, c: RGBA) => {
    out[k * 4] = c[0];
    out[k * 4 + 1] = c[1];
    out[k * 4 + 2] = c[2];
    out[k * 4 + 3] = c[3];
  };
  if (opts.mode === "rssi") {
    const values = maxField(fields, size);
    const color = rssiColor(opts.stops, opts.hideBelow ? opts.thresholdDbm : undefined);
    for (let k = 0; k < size; k++) put(k, color(values[k]!));
  } else if (opts.mode === "count") {
    const counts = countAbove(fields, size, opts.thresholdDbm);
    const colors = COUNT_COLORS.map(hex);
    for (let k = 0; k < size; k++)
      put(k, counts[k]! === 0 ? CLEAR : colors[Math.min(counts[k]!, colors.length) - 1]!);
  } else {
    const counts = coChannelCount(
      fields,
      picked.map((r) => r.range),
      size,
      opts.thresholdDbm,
    );
    const colors = CCI_COLORS.map(hex);
    for (let k = 0; k < size; k++)
      put(k, counts[k]! < 2 ? CLEAR : colors[Math.min(counts[k]! - 2, colors.length - 1)]!);
  }
  return out;
}
