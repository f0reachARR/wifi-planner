// worker thread で動かす重い処理（PDF のラスタ化、壁の自動抽出）。Piscina から呼ばれる
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  DEFAULT_PARAMS,
  type ExtractParams,
  extractWalls,
  rasterizePdfPage,
  readPdfInfo,
} from "@wifi-planner/wall-extraction";

export type RasterTask =
  | { op: "pdfInfo"; data: Uint8Array }
  | { op: "rasterize"; data: Uint8Array; page: number; dpi: number }
  | { op: "extract"; image: Uint8Array; params: Partial<ExtractParams> };

export default async function run(task: RasterTask) {
  switch (task.op) {
    case "pdfInfo":
      return readPdfInfo(task.data);
    case "extract": {
      // 図面の画像（PNG）を RGBA に戻してから抽出する
      const img = await loadImage(Buffer.from(task.image));
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, img.width, img.height);
      const result = await extractWalls(
        { data: data as Uint8ClampedArray, width: img.width, height: img.height },
        { ...DEFAULT_PARAMS, ...task.params },
      );
      return result.polylines;
    }
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
