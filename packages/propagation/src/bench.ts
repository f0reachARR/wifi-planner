// NFR-1 の条件（30 m × 30 m、AP 10 台、壁 300 本、格子 0.5 m）で、1 帯域の全ラジオの計算時間を測る。
import { antennaFrame, compilePattern } from "./antenna.js";
import { computeField, gridForExtent, type RadioSource } from "./field.js";
import { buildSegments, type WallInput } from "./walls.js";

// 再現できるように固定の種で乱数を作る
let seed = 1;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

const SIZE = 30;
const walls: WallInput[] = [];
for (let i = 0; i < 300; i++) {
  // 部屋の間仕切りに近い形にするため、軸に平行な 1〜6 m の壁を置く
  const x = rand() * SIZE;
  const y = rand() * SIZE;
  const len = 1 + rand() * 5;
  const horizontal = rand() < 0.5;
  walls.push({
    points: [
      { x, y },
      horizontal ? { x: Math.min(x + len, SIZE), y } : { x, y: Math.min(y + len, SIZE) },
    ],
    lossDb: 3 + rand() * 12,
    range: { bottom: 0, top: 3 },
    openings:
      rand() < 0.2 ? [{ start: 0.2, end: 1.0, lossDb: 3, range: { bottom: 0, top: 2 } }] : [],
  });
}

const env = {
  segments: buildSegments(walls),
  receiverHeightM: 1,
  pathLossExponent: 2,
  rxGainDbi: 0,
};
const grid = gridForExtent({ minX: 0, minY: 0, maxX: SIZE, maxY: SIZE }, 0.5);
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
const sources: RadioSource[] = Array.from({ length: 10 }, () => ({
  x: rand() * SIZE,
  y: rand() * SIZE,
  heightM: 2.7,
  frame: antennaFrame("ceiling", 0, 0),
  pattern,
  txPowerDbm: 17,
  frequencyMHz: 5180,
}));

const run = () => {
  const start = performance.now();
  for (const s of sources) computeField(s, env, grid);
  return performance.now() - start;
};

run(); // JIT のための空回し
const times = Array.from({ length: 5 }, run).sort((a, b) => a - b);
console.log(
  `格子 ${grid.cols}×${grid.rows}、壁区間 ${env.segments.count} 本、ラジオ ${sources.length} 本`,
);
console.log(`中央値 ${times[2]!.toFixed(1)} ms（最小 ${times[0]!.toFixed(1)} ms）`);
