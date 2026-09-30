import type { GridSpec } from "@wifi-planner/propagation";
import { useMemo } from "react";
import { Group, Image as KonvaImage } from "react-konva";
import { heatmapPlacement } from "../../propagation/placement";

/** ヒートマップの画像。1 点を 1 画素にして描き、拡大はブラウザの補間に任せる */
export function HeatmapLayer(props: {
  grid: GridSpec;
  pixels: Uint8ClampedArray;
  planRotationDeg: number;
  metersPerUnit: number;
  opacity: number;
}) {
  const { grid, pixels } = props;
  const canvas = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = grid.cols;
    c.height = grid.rows;
    const ctx = c.getContext("2d");
    if (ctx)
      ctx.putImageData(
        new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, grid.cols, grid.rows),
        0,
        0,
      );
    return c;
  }, [grid, pixels]);
  const placement = heatmapPlacement(grid, props.planRotationDeg, props.metersPerUnit);
  return (
    <Group {...placement.group} listening={false}>
      <KonvaImage image={canvas} {...placement.image} opacity={props.opacity} />
    </Group>
  );
}
