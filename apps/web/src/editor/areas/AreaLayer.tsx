import type { Vec2 } from "@wifi-planner/domain";
import { Fragment } from "react";
import { Group, Label, Line, Rect, Tag, Text } from "react-konva";
import type { PeerPresence } from "../../collab/session";
import type { WallDrafts } from "../walls/WallLayer";
import { type AreaEntry, type AreaStat, formatPeoplePerAp } from "./stats";

const flat = (points: readonly Vec2[]) => points.flatMap((p) => [p.x, p.y]);
export const AREA_COLOR = "#0c8599";
export const AREA_WARNING_COLOR = "#e8590c";
const FONT_PX = 12;
const PADDING_PX = 4;

/** ラベルの幅（画面のピクセル）の見積もり。全角の文字を 1 文字分、半角の文字を 0.6 文字分とする */
function labelWidthPx(lines: readonly string[]): number {
  const chars = (line: string) =>
    [...line].reduce((n, c) => n + (c.charCodeAt(0) < 0x80 ? 0.6 : 1), 0);
  return Math.max(...lines.map(chars)) * FONT_PX + PADDING_PX * 2;
}

/** エリアを、輪郭と薄い塗りの多角形と、人数と AP あたりの人数のラベルで描く（FR-11.2〜11.4） */
export function AreaLayer(props: {
  areas: readonly AreaEntry[];
  stats: ReadonlyMap<string, AreaStat>;
  selection: ReadonlySet<string>;
  peers: readonly PeerPresence[];
  drafts: WallDrafts;
  px: number;
  showHandles: boolean;
  planRotationDeg: number;
}) {
  const { areas, stats, selection, peers, drafts, px } = props;
  const peerSelection = new Map<string, string>();
  for (const p of peers) for (const id of p.selection ?? []) peerSelection.set(id, p.user.color);

  const pointsOf = (a: AreaEntry): Vec2[] => {
    if (drafts.vertex?.target === "area" && drafts.vertex.wallId === a.id) {
      return a.points.map((p, i) => (i === drafts.vertex!.index ? drafts.vertex!.point : p));
    }
    if (drafts.move && selection.has(a.id)) {
      return a.points.map((p) => ({ x: p.x + drafts.move!.dx, y: p.y + drafts.move!.dy }));
    }
    return a.points;
  };

  return (
    <Group listening={false}>
      {areas.map((a) => {
        const pts = pointsOf(a);
        const stat = stats.get(a.id);
        const selected = selection.has(a.id);
        const peer = peerSelection.get(a.id);
        const warned = !!stat?.warning || !!stat?.overlapping;
        const color = warned ? AREA_WARNING_COLOR : AREA_COLOR;
        // ラベルは頂点の重心に置く。画面上で読めるよう、図面の回転を打ち消す
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const lines = [
          a.name,
          `${a.headcount} 人／AP ${stat?.apIds.length ?? 0} 台`,
          stat ? formatPeoplePerAp(stat) : "",
        ];
        if (stat?.overlapping) lines.push("ほかのエリアと重なり");
        const width = labelWidthPx(lines);
        const height = lines.length * FONT_PX * 1.3 + PADDING_PX * 2;
        return (
          <Fragment key={a.id}>
            {peer && (
              <Line
                points={flat(pts)}
                closed
                stroke={peer}
                strokeWidth={8 * px}
                opacity={0.35}
                lineJoin="round"
              />
            )}
            <Line
              points={flat(pts)}
              closed
              stroke={selected ? "#228be6" : color}
              strokeWidth={(selected ? 3 : 2) * px}
              fill={
                selected
                  ? "rgba(34,139,230,0.12)"
                  : warned
                    ? "rgba(232,89,12,0.10)"
                    : "rgba(12,133,153,0.08)"
              }
              lineJoin="round"
            />
            {/* ヒートマップや AP の上でも読めるよう、白い下地を敷く */}
            <Label
              x={cx}
              y={cy}
              rotation={-props.planRotationDeg}
              offsetX={(width / 2) * px}
              offsetY={(height / 2) * px}
            >
              <Tag
                fill="rgba(255,255,255,0.85)"
                stroke={color}
                strokeWidth={px}
                cornerRadius={3 * px}
              />
              <Text
                text={lines.join("\n")}
                align="center"
                width={width * px}
                padding={PADDING_PX * px}
                fontSize={FONT_PX * px}
                lineHeight={1.3}
                fill={color}
                fontStyle={warned ? "bold" : "normal"}
              />
            </Label>
          </Fragment>
        );
      })}
      {props.showHandles &&
        areas
          .filter((a) => selection.has(a.id))
          .flatMap((a) =>
            pointsOf(a).map((p, i) => (
              <Rect
                // biome-ignore lint/suspicious/noArrayIndexKey: 頂点の番号で区別する
                key={`${a.id}-${i}`}
                x={p.x - 4 * px}
                y={p.y - 4 * px}
                width={8 * px}
                height={8 * px}
                fill="#fff"
                stroke="#228be6"
                strokeWidth={1.5 * px}
              />
            )),
          )}
    </Group>
  );
}
