import { createEmptyProjectDoc, type ProjectDoc } from "@wifi-planner/domain";
import { describe, expect, it } from "vitest";
import { antennaFrame, compilePattern, gainToward } from "./antenna.js";
import { coChannelCount, countAbove, maxField, sampleField } from "./compose.js";
import {
  computeField,
  type Environment,
  evaluatePoint,
  pathLossDb,
  type RadioSource,
} from "./field.js";
import { buildFloorScene } from "./scene.js";
import { buildSegments, type SegmentSet, wallLossDb } from "./walls.js";

const omni = compilePattern({ kind: "omni", gainDbi: 0 }, "2.4");

const source = (x: number, y: number, over: Partial<RadioSource> = {}): RadioSource => ({
  x,
  y,
  z: 1,
  frame: antennaFrame("wall", 0, 0),
  pattern: omni,
  txPowerDbm: 20,
  frequencyMHz: 2437,
  ...over,
});

const FULL = { bottom: 0, top: 3 };

const envWith = (walls: Parameters<typeof buildSegments>[0]): Environment => ({
  walls: [buildSegments(walls)],
  slabs: [],
  receiverZ: 1,
  pathLossExponent: 2,
  rxGainDbi: 0,
});

describe("距離減衰", () => {
  it("1 m の自由空間損失は既知の値に一致する", () => {
    expect(pathLossDb(1, 2437, 2)).toBeCloseTo(40.19, 2);
  });

  it("減衰指数 2 では距離 10 倍で 20 dB 増える", () => {
    expect(pathLossDb(10, 5180, 2) - pathLossDb(1, 5180, 2)).toBeCloseTo(20, 9);
    expect(pathLossDb(10, 5180, 3) - pathLossDb(1, 5180, 3)).toBeCloseTo(30, 9);
  });

  it("1 m 未満は 1 m として扱う", () => {
    expect(pathLossDb(0.1, 2437, 2)).toBe(pathLossDb(1, 2437, 2));
  });

  it("距離は設置高さと受信高さを含めた 3 次元距離で測る", () => {
    const env = envWith([]);
    const high = evaluatePoint(source(0, 0, { z: 1 + Math.sqrt(3) }), env, 1, 0);
    expect(high).toBeCloseTo(20 - pathLossDb(2, 2437, 2), 6);
  });
});

describe("壁の減衰", () => {
  const wall = (x: number, lossDb: number) => ({
    points: [
      { x, y: -5 },
      { x, y: 5 },
    ],
    lossDb,
    range: FULL,
    openings: [],
  });
  /** 床から高さ 1 m の水平な経路 */
  const flat = (set: SegmentSet, px: number, py: number, qx: number, qy: number) =>
    wallLossDb(set, px, py, 1, qx, qy, 1);

  it("横切った壁の減衰量を足す", () => {
    const set = buildSegments([wall(1, 10), wall(2, 5)]);
    expect(flat(set, 0, 0, 1.5, 0)).toBe(10);
    expect(flat(set, 0, 0, 3, 0)).toBe(15);
    expect(flat(set, 0, 0, 0.5, 0)).toBe(0);
  });

  it("折れ線の頂点を通る経路で減衰を二重に数えない", () => {
    const set = buildSegments([
      {
        points: [
          { x: 1, y: -5 },
          { x: 1, y: 0 },
          { x: 1, y: 5 },
        ],
        lossDb: 10,
        range: FULL,
        openings: [],
      },
    ]);
    expect(flat(set, 0, 0, 2, 0)).toBe(10);
  });

  it("開口部の区間では開口部の材質の減衰量を使う", () => {
    // 壁は y=-5 から y=5 まで。折れ線に沿った距離 4〜6 m（y=-1〜1）がドア
    const set = buildSegments([
      { ...wall(1, 20), openings: [{ start: 4, end: 6, lossDb: 3, range: FULL }] },
    ]);
    expect(flat(set, 0, 0, 2, 0)).toBe(3);
    expect(flat(set, 0, 3, 2, 3)).toBe(20);
  });

  it("交点の高さが壁の高さの範囲に入るときだけ足す（設計書 6.1.1 節）", () => {
    // 高さ 1.2 m までの腰壁
    const set = buildSegments([{ ...wall(1, 10), range: { bottom: 0, top: 1.2 } }]);
    expect(wallLossDb(set, 0, 0, 1, 2, 0, 1)).toBe(10);
    expect(wallLossDb(set, 0, 0, 1.5, 2, 0, 1.5)).toBe(0);
    // 高さ 2.5 m から 1.0 m へ下る経路は、x=1 で高さ 1.75 m を通るので越える
    expect(wallLossDb(set, 0, 0, 2.5, 2, 0, 1)).toBe(0);
    // 下端を含み上端を含まない
    expect(wallLossDb(set, 0, 0, 0, 2, 0, 0)).toBe(10);
    expect(wallLossDb(set, 0, 0, 1.2, 2, 0, 1.2)).toBe(0);
  });

  it("上下に積んだ壁の境目を通る経路で減衰を二重に数えない", () => {
    const set = buildSegments([
      { ...wall(1, 10), range: { bottom: 0, top: 3 } },
      { ...wall(1, 7), range: { bottom: 3, top: 6 } },
    ]);
    expect(wallLossDb(set, 0, 0, 3, 2, 0, 3)).toBe(7);
    expect(wallLossDb(set, 0, 0, 1, 2, 0, 3)).toBe(10);
  });

  it("開口部の高さの上下は壁の材質の減衰量を使う", () => {
    // 高さ 2 m までのドア。その上から天井までは壁
    const set = buildSegments([
      {
        ...wall(1, 20),
        openings: [{ start: 4, end: 6, lossDb: 3, range: { bottom: 0, top: 2 } }],
      },
    ]);
    expect(wallLossDb(set, 0, 0, 1, 2, 0, 1)).toBe(3);
    expect(wallLossDb(set, 0, 0, 2.5, 2, 0, 2.5)).toBe(20);
  });
});

describe("アンテナ利得", () => {
  const directional = compilePattern(
    {
      kind: "directional",
      azimuthCut: [
        { deg: 0, gainDbi: 8 },
        { deg: 90, gainDbi: 0 },
        { deg: 180, gainDbi: -10 },
        { deg: -90, gainDbi: 0 },
      ],
      elevationCut: [
        { deg: -90, gainDbi: -2 },
        { deg: 0, gainDbi: 8 },
        { deg: 90, gainDbi: -2 },
      ],
    },
    "5",
  );

  it("方位断面と仰角断面の上では元の値に一致する", () => {
    expect(directional(1, 0, 0)).toBeCloseTo(8);
    expect(directional(0, 1, 0)).toBeCloseTo(0);
    expect(directional(-1, 0, 0)).toBeCloseTo(-10);
    expect(directional(0, 0, 1)).toBeCloseTo(-2);
    // 方位 45 度は 0 度と 90 度の間を補間する
    expect(directional(Math.SQRT1_2, Math.SQRT1_2, 0)).toBeCloseTo(4);
  });

  it("減衰は上限で打ち切る", () => {
    const deep = compilePattern(
      {
        kind: "directional",
        azimuthCut: [
          { deg: 0, gainDbi: 0 },
          { deg: 180, gainDbi: -30 },
        ],
        elevationCut: [
          { deg: -90, gainDbi: -30 },
          { deg: 0, gainDbi: 0 },
          { deg: 90, gainDbi: -30 },
        ],
      },
      "5",
    );
    expect(deep(-Math.SQRT1_2, 0, Math.SQRT1_2)).toBeCloseTo(-40);
  });

  it("局所座標の基底は正規直交で右手系になる", () => {
    for (const mount of ["wall", "ceiling"] as const) {
      const f = antennaFrame(mount, 37, 20);
      const x = [f[0]!, f[1]!, f[2]!];
      const y = [f[3]!, f[4]!, f[5]!];
      const z = [f[6]!, f[7]!, f[8]!];
      const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
      expect(dot(x, x)).toBeCloseTo(1);
      expect(dot(x, y)).toBeCloseTo(0);
      expect(dot(x, z)).toBeCloseTo(0);
      // x × y = z
      expect(x[1]! * y[2]! - x[2]! * y[1]!).toBeCloseTo(z[0]!);
    }
  });

  it("下向きの天井設置 AP は真下で最大利得になり、真下の利得は方位角によらない", () => {
    const axial = compilePattern(
      {
        kind: "axial",
        offAxisCut: [
          { deg: 0, gainDbi: 5 },
          { deg: 90, gainDbi: -3 },
          { deg: 180, gainDbi: -15 },
        ],
        aroundAxisCut: [
          { deg: 0, gainDbi: -3 },
          { deg: 90, gainDbi: 1 },
          { deg: 180, gainDbi: -3 },
          { deg: 270, gainDbi: 1 },
        ],
        rollOffsetDeg: 0,
      },
      "5",
    );
    for (const az of [0, 45, 90]) {
      const frame = antennaFrame("ceiling", az, 0);
      expect(gainToward(axial, frame, 0, 0, -1)).toBeCloseTo(5);
    }
    const frame = antennaFrame("ceiling", 0, 0);
    // 水平方向では軸まわりの断面の値になる。方位角の向き（+x）が 0 度、反時計回りに 90 度が +y
    expect(gainToward(axial, frame, 1, 0, 0)).toBeCloseTo(-3);
    expect(gainToward(axial, frame, 0, 1, 0)).toBeCloseTo(1);
  });

  it("壁設置でチルトを付けると主ビームが下を向く", () => {
    const frame = antennaFrame("wall", 0, 30);
    const down = { x: Math.cos(Math.PI / 6), z: -Math.sin(Math.PI / 6) };
    const pattern = compilePattern(
      {
        kind: "directional",
        azimuthCut: [
          { deg: 0, gainDbi: 10 },
          { deg: 180, gainDbi: -10 },
        ],
        elevationCut: [
          { deg: -90, gainDbi: -10 },
          { deg: 0, gainDbi: 10 },
          { deg: 90, gainDbi: -10 },
        ],
      },
      "5",
    );
    expect(gainToward(pattern, frame, down.x, 0, down.z)).toBeCloseTo(10);
  });
});

describe("ヒートマップの合成", () => {
  const grid = { x0: 0, y0: 0, step: 1, cols: 3, rows: 1 };

  it("最大値、閾値以上の数、同一チャネル干渉", () => {
    const a = Float32Array.from([-50, -70, -90]);
    const b = Float32Array.from([-60, -60, -95]);
    const c = Float32Array.from([-55, -80, -60]);
    expect(Array.from(maxField([a, b, c], 3))).toEqual([-50, -60, -60]);
    expect(Array.from(countAbove([a, b, c], 3, -67))).toEqual([3, 1, 1]);
    const ch36 = { lowMHz: 5170, highMHz: 5190 };
    const ch40 = { lowMHz: 5190, highMHz: 5210 };
    const ch36w40 = { lowMHz: 5170, highMHz: 5210 };
    // a と c は重ならない。b は両方と重なる
    expect(Array.from(coChannelCount([a, b, c], [ch36, ch36w40, ch40], 3, -67))).toEqual([3, 1, 1]);
    expect(Array.from(coChannelCount([a, c], [ch36, ch40], 3, -67))).toEqual([1, 0, 1]);
  });

  it("格子の値を双線形補間で引く", () => {
    const f = Float32Array.from([0, 10, 20]);
    expect(sampleField(f, grid, 0.5, 0)).toBeCloseTo(5);
    expect(sampleField(f, grid, 2, 0)).toBeCloseTo(20);
    const g2 = { x0: 0, y0: 0, step: 1, cols: 2, rows: 2 };
    expect(sampleField(Float32Array.from([0, 10, 20, 30]), g2, 0.5, 0.5)).toBeCloseTo(15);
    expect(sampleField(Float32Array.from([0, 10, 20, 30]), g2, 2, 0)).toBeUndefined();
  });

  it("格子は各点の受信電力を並べる", () => {
    const env = envWith([]);
    const src = source(0, 0);
    const field = computeField(src, env, { x0: 0, y0: 0, step: 1, cols: 3, rows: 2 });
    expect(field[4]).toBeCloseTo(evaluatePoint(src, env, 1, 1));
  });
});

describe("フロアの計算入力", () => {
  const docWithFloor = (): ProjectDoc => {
    const doc = createEmptyProjectDoc();
    doc.apModels.m = {
      name: "テスト AP",
      radios: [
        {
          key: "r5",
          bands: ["5"],
          maxTxPowerDbm: { "5": 20 },
          pattern: { kind: "omni", gainDbi: 3 },
        },
      ],
    };
    doc.floors.f1 = {
      name: "1F",
      order: 0,
      elevationM: 0,
      heightM: 3,
      plan: {
        sourceSha256: "s",
        imageSha256: "i",
        widthPx: 200,
        heightPx: 100,
        unitsPerPx: 1,
        rotationDeg: 0,
      },
      walls: {},
      aps: {
        ap1: {
          name: "AP-1",
          modelId: "m",
          position: { x: 100, y: 50 },
          heightM: 2.5,
          mount: "ceiling",
          azimuthDeg: 0,
          tiltDeg: 0,
          radios: [
            { key: "r5", enabled: true, band: "5", channel: 36, widthMHz: 80, txPowerDbm: 17 },
          ],
        },
      },
      photoPins: {},
      holes: {},
      areas: {},
    };
    return doc;
  };

  it("未校正のフロアでは計算しない", () => {
    expect(buildFloorScene(docWithFloor(), "f1", "5").status).toBe("uncalibrated");
  });

  it("有効なラジオだけを、図面全体を覆う格子で計算する", () => {
    const doc = docWithFloor();
    doc.floors.f1!.scale = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, distanceM: 1 };
    const scene = buildFloorScene(doc, "f1", "5");
    if (scene.status !== "ok") throw new Error(scene.status);
    expect(scene.radios).toHaveLength(1);
    expect(scene.radios[0]!.source.frequencyMHz).toBe(5210);
    expect(scene.grid.cols).toBe(41); // 20 m を 0.5 m 刻み
    expect(scene.grid.rows).toBe(21);
    expect(buildFloorScene(doc, "f1", "2.4").status === "ok").toBe(true);

    doc.floors.f1!.aps.ap1!.radios[0]!.enabled = false;
    const disabled = buildFloorScene(doc, "f1", "5");
    expect(disabled.status === "ok" && disabled.radios).toEqual([]);
  });
});
