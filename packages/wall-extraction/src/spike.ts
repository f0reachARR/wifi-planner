// 技術検証（M1）：A3 相当の図面を 200 dpi でラスタ化し、worker thread で壁を抽出する時間を測る（NFR-2）。
import { Worker } from "node:worker_threads";
import { evaluateRecall, makeSyntheticPlanPdf } from "./fixtures.js";
import type { Segment } from "./merge.js";

const DPI = 200;
const plan = await makeSyntheticPlanPdf();

const t0 = performance.now();
const result = await new Promise<{
  width: number;
  height: number;
  unitsPerPx: number;
  rasterMs: number;
  totalMs: number;
  segments: Segment[];
  timingsMs: Record<string, number>;
}>((resolve, reject) => {
  const worker = new Worker(new URL("./spike-worker.ts", import.meta.url), {
    workerData: { pdf: plan.pdf, dpi: DPI },
    execArgv: ["--import", "tsx"],
  });
  worker.once("message", (m) => {
    resolve(m);
    void worker.terminate();
  });
  worker.once("error", reject);
});
const wallMs = performance.now() - t0;

const pxPerPt = 1 / result.unitsPerPx;
const truthPx = plan.walls.map((s) => ({
  a: { x: s.a.x * pxPerPt, y: s.a.y * pxPerPt },
  b: { x: s.b.x * pxPerPt, y: s.b.y * pxPerPt },
}));
const { recall, missed } = evaluateRecall(truthPx, result.segments, {
  maxDistance: 6,
  minCover: 0.8,
});

console.log(`画像 ${result.width}×${result.height} px（${DPI} dpi）`);
console.log(`ラスタ化 ${result.rasterMs.toFixed(0)} ms`);
for (const [k, v] of Object.entries(result.timingsMs)) console.log(`  ${k}: ${v.toFixed(0)}`);
console.log(
  `worker 内の合計 ${result.totalMs.toFixed(0)} ms、worker 起動を含む合計 ${wallMs.toFixed(0)} ms`,
);
console.log(
  `抽出した線分 ${result.segments.length} 本、正解 ${truthPx.length} 本、再現率 ${(recall * 100).toFixed(0)}%`,
);
if (missed.length) console.log("見逃し", JSON.stringify(missed.slice(0, 5)));
