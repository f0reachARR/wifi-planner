import { describe, expect, it } from "vitest";
import { parsePatternCsv, patternToCsv } from "./pattern-import.js";

describe("アンテナパターンの CSV", () => {
  it("方位断面と仰角断面から指向性パターンを作り、CSV に戻せる", () => {
    const csv =
      "cut,deg,gain_dbi\nazimuth,0,8\nazimuth,180,-10\nelevation,-90,-5\nelevation,0,8\nelevation,90,-5\n";
    const r = parsePatternCsv(csv);
    expect(r.ok && r.pattern.kind).toBe("directional");
    if (r.ok) expect(parsePatternCsv(patternToCsv(r.pattern)!)).toEqual(r);
  });

  it("軸対称に近いパターンを読む", () => {
    const r = parsePatternCsv("﻿cut,deg,gain_dbi\r\noff_axis,0,5\r\naround_axis,0,-2\r\n");
    expect(r).toEqual({
      ok: true,
      pattern: {
        kind: "axial",
        offAxisCut: [{ deg: 0, gainDbi: 5 }],
        aroundAxisCut: [{ deg: 0, gainDbi: -2 }],
        rollOffsetDeg: 0,
      },
    });
  });

  it("見出しの違いや、読めない行や、断面の不足を知らせる", () => {
    expect(parsePatternCsv("a,b,c\n").ok).toBe(false);
    expect(parsePatternCsv("cut,deg,gain_dbi\nazimuth,x,1\n")).toEqual({
      ok: false,
      error: "2 行目を読めません",
    });
    expect(parsePatternCsv("cut,deg,gain_dbi\nazimuth,0,1\n").ok).toBe(false);
  });
});
