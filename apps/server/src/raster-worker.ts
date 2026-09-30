// worker thread で動かす重い処理（PDF のラスタ化）。Piscina から呼ばれる
import { rasterizePdfPage, readPdfInfo } from "@wifi-planner/wall-extraction";

export type RasterTask =
  | { op: "pdfInfo"; data: Uint8Array }
  | { op: "rasterize"; data: Uint8Array; page: number; dpi: number };

export default async function run(task: RasterTask) {
  switch (task.op) {
    case "pdfInfo":
      return readPdfInfo(task.data);
    case "rasterize": {
      const r = await rasterizePdfPage(task.data, task.page, task.dpi);
      return {
        png: new Uint8Array(r.png),
        width: r.width,
        height: r.height,
        unitsPerPx: r.unitsPerPx,
      };
    }
  }
}
