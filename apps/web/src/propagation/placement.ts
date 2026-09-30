import type { GridSpec } from "@wifi-planner/propagation";

/**
 * ヒートマップの画像を、キャンバスの図面座標のグループに重ねるための変換。
 * 格子はフロア座標（y 上向き、図面の回転を適用済み）の軸に沿っている。
 * フロア座標から図面座標へは p = Rᵀ · (x / m, −y / m) なので、Konva のノードの変換（平行移動・回転・拡大の順）で
 * 回転を −θ、拡大を (1/m, −1/m) にすれば、ノードの中をフロア座標のまま描ける。
 * 画像の行 0 はノードの y が最小の側、つまりフロア座標の y0 の側に来るので、格子の行をそのまま画像の行にすればよい。
 */
export function heatmapPlacement(grid: GridSpec, planRotationDeg: number, metersPerUnit: number) {
  return {
    group: { rotation: -planRotationDeg, scaleX: 1 / metersPerUnit, scaleY: -1 / metersPerUnit },
    image: {
      x: grid.x0 - grid.step / 2,
      y: grid.y0 - grid.step / 2,
      width: grid.cols * grid.step,
      height: grid.rows * grid.step,
    },
  };
}

/** Konva と同じ順（拡大、回転、平行移動）でノードの変換を点に適用する。テストで使う */
export function applyNodeTransform(
  node: { rotation: number; scaleX: number; scaleY: number },
  p: { x: number; y: number },
) {
  const t = (node.rotation * Math.PI) / 180;
  const x = p.x * node.scaleX;
  const y = p.y * node.scaleY;
  return { x: Math.cos(t) * x - Math.sin(t) * y, y: Math.sin(t) * x + Math.cos(t) * y };
}
