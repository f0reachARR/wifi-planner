import { Piscina } from "piscina";
import type { RasterTask } from "./raster-worker.js";

// 開発時（tsx）は src/raster-worker.ts を、ビルド後は dist/raster-worker.js を読む。
// このファイルは src/ 直下と dist/main.js のどちらにあっても、同じ階層に worker がある
const isSource = import.meta.url.endsWith(".ts");
const filename = new URL(`./raster-worker.${isSource ? "ts" : "js"}`, import.meta.url).href;

export type RasterPool = {
  pdfInfo(data: Uint8Array): Promise<{ widthPt: number; heightPt: number }[]>;
  rasterize(
    data: Uint8Array,
    page: number,
    dpi: number,
  ): Promise<{ png: Uint8Array; width: number; height: number; unitsPerPx: number }>;
  extract(
    image: Uint8Array,
    params: Partial<import("@wifi-planner/wall-extraction").ExtractParams>,
    signal: AbortSignal,
  ): Promise<{ x: number; y: number }[][]>;
  destroy(): Promise<void>;
};

export function createRasterPool(): RasterPool {
  const pool = new Piscina({
    filename,
    maxThreads: 2,
    // 開発時は TypeScript のまま読めるよう、worker にも tsx を読み込ませる
    execArgv: isSource ? ["--import", "tsx"] : [],
  });
  return {
    pdfInfo: (data) => pool.run({ op: "pdfInfo", data } satisfies RasterTask),
    rasterize: (data, page, dpi) =>
      pool.run({ op: "rasterize", data, page, dpi } satisfies RasterTask),
    extract: (image, params, signal) =>
      pool.run({ op: "extract", image, params } satisfies RasterTask, { signal }),
    destroy: () => pool.destroy(),
  };
}
