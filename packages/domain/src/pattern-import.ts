import type { AngleCut, AntennaPattern } from "./schema.js";

// アンテナパターンの取り込み（FR-5.2）。CSV の形式は 1 行目を見出しとし、次の 3 列を持つ。
//
//   cut,deg,gain_dbi
//   azimuth,0,5.0
//   elevation,-90,-3.0
//
// cut は、指向性パターンでは azimuth（方位断面）と elevation（仰角断面）、
// 軸対称に近いパターンでは off_axis（軸からの角度）と around_axis（軸まわりの角度）とする。

export const PATTERN_CSV_HEADER = "cut,deg,gain_dbi";

export type PatternImportResult =
  | { ok: true; pattern: AntennaPattern }
  | { ok: false; error: string };

export function parsePatternCsv(text: string): PatternImportResult {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const header = lines[0]?.split(",").map((c) => c.trim().toLowerCase());
  if (!header || header.join(",") !== PATTERN_CSV_HEADER) {
    return { ok: false, error: `1 行目は「${PATTERN_CSV_HEADER}」にしてください` };
  }
  const cuts = new Map<string, AngleCut>();
  for (let i = 1; i < lines.length; i++) {
    const [cut, deg, gain] = lines[i]!.split(",").map((c) => c.trim());
    const d = Number(deg);
    const g = Number(gain);
    if (!cut || !Number.isFinite(d) || !Number.isFinite(g)) {
      return { ok: false, error: `${i + 1} 行目を読めません` };
    }
    const list = cuts.get(cut.toLowerCase()) ?? [];
    list.push({ deg: d, gainDbi: g });
    cuts.set(cut.toLowerCase(), list);
  }
  const has = (k: string) => (cuts.get(k)?.length ?? 0) > 0;
  if (has("azimuth") && has("elevation")) {
    return {
      ok: true,
      pattern: {
        kind: "directional",
        azimuthCut: cuts.get("azimuth")!,
        elevationCut: cuts.get("elevation")!,
      },
    };
  }
  if (has("off_axis") && has("around_axis")) {
    return {
      ok: true,
      pattern: {
        kind: "axial",
        offAxisCut: cuts.get("off_axis")!,
        aroundAxisCut: cuts.get("around_axis")!,
        rollOffsetDeg: 0,
      },
    };
  }
  return {
    ok: false,
    error: "azimuth と elevation、または off_axis と around_axis の 2 種類の断面が必要です",
  };
}

/** パターンを CSV にする。無指向性は断面を持たないので undefined */
export function patternToCsv(pattern: AntennaPattern): string | undefined {
  const rows = (cut: string, list: AngleCut) => list.map((p) => `${cut},${p.deg},${p.gainDbi}`);
  if (pattern.kind === "directional") {
    return [
      PATTERN_CSV_HEADER,
      ...rows("azimuth", pattern.azimuthCut),
      ...rows("elevation", pattern.elevationCut),
    ].join("\n");
  }
  if (pattern.kind === "axial") {
    return [
      PATTERN_CSV_HEADER,
      ...rows("off_axis", pattern.offAxisCut),
      ...rows("around_axis", pattern.aroundAxisCut),
    ].join("\n");
  }
  return undefined;
}
