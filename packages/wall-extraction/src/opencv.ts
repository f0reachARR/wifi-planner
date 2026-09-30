import { createRequire } from "node:module";

// opencv.js の型定義は巨大で、使う関数も限られるので、ここでは必要な部分だけを緩く型付けする。
// biome-ignore lint/suspicious/noExplicitAny: opencv.js の実行時オブジェクト
export type CV = any;

let loading: Promise<CV> | undefined;

/** opencv.js（WASM）を読み込む。初期化には数百ミリ秒かかるので、プロセスごとに一度だけ行う */
export function loadOpenCV(): Promise<CV> {
  loading ??= (async () => {
    const require = createRequire(import.meta.url);
    const mod = require("@techstark/opencv-js");
    if (mod instanceof Promise) return await mod;
    if (mod.Mat) return mod;
    await new Promise<void>((resolve) => {
      mod.onRuntimeInitialized = () => resolve();
    });
    return mod;
  })();
  return loading;
}
