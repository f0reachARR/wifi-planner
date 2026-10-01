// NFR-1 の条件（30 m × 30 m、AP 10 台、壁 300 本、格子 0.5 m）で、1 帯域の全ラジオの計算時間を測る。
// 1 フロアだけの場合と、この条件のフロアを 3 つ重ねて真ん中のフロアで全フロアの AP を受ける場合を測る（設計書 6.3 節）。
import { antennaFrame, compilePattern } from "./antenna.js";
import { computeField, type Environment, gridForExtent, type RadioSource } from "./field.js";
import { buildSlabLevels, polygon } from "./slabs.js";
import { buildSegments, type SegmentSet, type WallInput } from "./walls.js";

// 再現できるように固定の種で乱数を作る
let seed = 1;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

const SIZE = 30;
const STOREY = 3;
const pattern = compilePattern(
  {
    kind: "axial",
    offAxisCut: [
      { deg: 0, gainDbi: 4 },
      { deg: 90, gainDbi: -2 },
      { deg: 180, gainDbi: -10 },
    ],
    aroundAxisCut: [{ deg: 0, gainDbi: -2 }],
    rollOffsetDeg: 0,
  },
  "5",
);

function makeFloor(elevation: number): { walls: SegmentSet; sources: RadioSource[] } {
  const walls: WallInput[] = [];
  for (let i = 0; i < 300; i++) {
    // 部屋の間仕切りに近い形にするため、軸に平行な 1〜6 m の壁を置く
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const len = 1 + rand() * 5;
    const horizontal = rand() < 0.5;
    const range = { bottom: elevation, top: elevation + STOREY };
    walls.push({
      points: [
        { x, y },
        horizontal ? { x: Math.min(x + len, SIZE), y } : { x, y: Math.min(y + len, SIZE) },
      ],
      lossDb: 3 + rand() * 12,
      range,
      openings:
        rand() < 0.2
          ? [{ start: 0.2, end: 1.0, lossDb: 3, range: { bottom: elevation, top: elevation + 2 } }]
          : [],
    });
  }
  const sources = Array.from({ length: 10 }, () => ({
    x: rand() * SIZE,
    y: rand() * SIZE,
    z: elevation + 2.7,
    frame: antennaFrame("ceiling", 0, 0),
    pattern,
    txPowerDbm: 17,
    frequencyMHz: 5180,
  }));
  return { walls: buildSegments(walls), sources };
}

const grid = gridForExtent({ minX: 0, minY: 0, maxX: SIZE, maxY: SIZE }, 0.5);
const outline = polygon([
  { x: 0, y: 0 },
  { x: SIZE, y: 0 },
  { x: SIZE, y: SIZE },
  { x: 0, y: SIZE },
]);

function measure(label: string, floors: ReturnType<typeof makeFloor>[], receiver: number) {
  const env: Environment = {
    walls: floors.map((f) => f.walls),
    slabs: buildSlabLevels(
      floors.map((_, k) => ({ z: k * STOREY, lossDb: 25, outline, holes: [] })),
    ),
    receiverZ: receiver * STOREY + 1,
    pathLossExponent: 2,
    rxGainDbi: 0,
  };
  const sources = floors.flatMap((f) => f.sources);
  const run = () => {
    const start = performance.now();
    for (const s of sources) computeField(s, env, grid);
    return performance.now() - start;
  };
  run(); // JIT のための空回し
  const times = Array.from({ length: 5 }, run).sort((a, b) => a - b);
  const segments = floors.reduce((n, f) => n + f.walls.count, 0);
  console.log(
    `${label}：格子 ${grid.cols}×${grid.rows}、壁区間 ${segments} 本、ラジオ ${sources.length} 本、` +
      `中央値 ${times[2]!.toFixed(1)} ms（最小 ${times[0]!.toFixed(1)} ms）`,
  );
}

const stack = [0, 1, 2].map((k) => makeFloor(k * STOREY));
measure("1 フロア", [stack[0]!], 0);
measure("3 フロアの真ん中", stack, 1);
