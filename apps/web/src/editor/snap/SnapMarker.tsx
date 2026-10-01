import type { Vec2 } from "@wifi-planner/domain";
import { Circle, Group, Line, Rect, Shape } from "react-konva";
import type { SnapKind } from "../geometry";
import type { GuideSegment } from "./guides";

const COLOR: Record<SnapKind, string> = {
  endpoint: "#e03131",
  guideIntersection: "#9c36b5",
  guideEndpoint: "#9c36b5",
  onWall: "#e8590c",
  guideAxis: "#9c36b5",
  onGuide: "#9c36b5",
  orthogonal: "#228be6",
  none: "#228be6",
};

/**
 * スナップした点の目印。端点は丸、図面の線の交点は ×、図面の線の端点は四角、線の上の点は小さな丸で描き分ける。
 * 既存の壁へのスナップは赤と橙、図面の線へのスナップは紫にする
 */
export function SnapMarker(props: { point: Vec2; kind: SnapKind; px: number }) {
  const { point, kind, px } = props;
  const stroke = COLOR[kind];
  const r = 6 * px;
  return (
    <Group x={point.x} y={point.y} listening={false}>
      {kind === "guideIntersection" ? (
        <>
          <Line points={[-r, -r, r, r]} stroke={stroke} strokeWidth={2 * px} />
          <Line points={[-r, r, r, -r]} stroke={stroke} strokeWidth={2 * px} />
        </>
      ) : kind === "guideEndpoint" ? (
        <Rect x={-r} y={-r} width={2 * r} height={2 * r} stroke={stroke} strokeWidth={2 * px} />
      ) : (
        <Circle
          radius={(kind === "none" ? 3 : kind === "onGuide" || kind === "guideAxis" ? 4 : 6) * px}
          stroke={stroke}
          strokeWidth={2 * px}
        />
      )}
    </Group>
  );
}

/** スナップ用の図面の線。抽出がうまくいったかを確かめられるよう、薄く描く。数千本になり得るので 1 つの図形にまとめる */
export function GuideLayer(props: { segments: readonly GuideSegment[]; px: number }) {
  return (
    <Shape
      listening={false}
      stroke="#9c36b5"
      strokeWidth={1 * props.px}
      opacity={0.5}
      sceneFunc={(ctx, shape) => {
        ctx.beginPath();
        for (const s of props.segments) {
          ctx.moveTo(s.a.x, s.a.y);
          ctx.lineTo(s.b.x, s.b.y);
        }
        ctx.strokeShape(shape);
      }}
    />
  );
}
