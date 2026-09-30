import { createRequire } from "node:module";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
const assets = {
  cMapUrl: `${path.join(pdfjsRoot, "cmaps")}/`,
  cMapPacked: true,
  standardFontDataUrl: `${path.join(pdfjsRoot, "standard_fonts")}/`,
};

const POINTS_PER_INCH = 72;

export type PdfPageInfo = { widthPt: number; heightPt: number };

export async function readPdfInfo(data: Uint8Array): Promise<PdfPageInfo[]> {
  const task = getDocument({ data: data.slice(), ...assets });
  const doc = await task.promise;
  try {
    const pages: PdfPageInfo[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      pages.push({ widthPt: vp.width, heightPt: vp.height });
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

export type RasterizedPage = {
  png: Buffer;
  width: number;
  height: number;
  /** 画像の 1 ピクセルが何ポイントか（図面座標の単位、設計書 3 章） */
  unitsPerPx: number;
  rgba: Uint8ClampedArray;
};

/** PDF の 1 ページを指定した解像度でラスタ化する（FR-2.2）。背景は白で塗る */
export async function rasterizePdfPage(
  data: Uint8Array,
  pageNumber: number,
  dpi: number,
): Promise<RasterizedPage> {
  const task = getDocument({ data: data.slice(), ...assets });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(pageNumber);
    const scale = dpi / POINTS_PER_INCH;
    const viewport = page.getViewport({ scale });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    // biome-ignore lint/suspicious/noExplicitAny: pdf.js の Node 用 canvasFactory は型に現れない
    const factory = (doc as any).canvasFactory;
    const { canvas, context } = factory.create(width, height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const rgba = context.getImageData(0, 0, width, height).data as Uint8ClampedArray;
    const png = canvas.toBuffer("image/png") as Buffer;
    page.cleanup();
    return { png, width, height, unitsPerPx: 1 / scale, rgba };
  } finally {
    await task.destroy();
  }
}
