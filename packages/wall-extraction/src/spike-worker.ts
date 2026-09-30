import { parentPort, workerData } from "node:worker_threads";
import { DEFAULT_PARAMS, type ExtractMethod, extractWalls } from "./extract.js";
import { rasterizePdfPage } from "./pdf.js";

const { pdf, dpi, method } = workerData as { pdf: Uint8Array; dpi: number; method: ExtractMethod };
const t0 = performance.now();
const page = await rasterizePdfPage(pdf, 1, dpi);
const rasterMs = performance.now() - t0;
const result = await extractWalls(
  { data: page.rgba, width: page.width, height: page.height },
  { ...DEFAULT_PARAMS, method },
);
parentPort?.postMessage({
  width: page.width,
  height: page.height,
  unitsPerPx: page.unitsPerPx,
  rasterMs,
  totalMs: performance.now() - t0,
  ...result,
});
