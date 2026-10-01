import type { Vec2 } from "@wifi-planner/domain";
import { Fragment } from "react";
import { Group, Line, Rect, Text } from "react-konva";
import type { PeerPresence } from "../../collab/session";
import type { HoleEntry } from "../geometry";
import type { WallDrafts } from "./WallLayer";

const flat = (points: readonly Vec2[]) => points.flatMap((p) => [p.x, p.y]);
const HOLE_COLOR = "#7048e8";

/** 吹き抜けを、破線の輪郭と薄い塗りの多角形で描く */
export function HoleLayer(props: {
  holes: readonly HoleEntry[];
  selection: ReadonlySet<string>;
  peers: readonly PeerPresence[];
  drafts: WallDrafts;
  px: number;
  showHandles: boolean;
  planRotationDeg: number;
}) {
  const { holes, selection, peers, drafts, px } = props;
  const peerSelection = new Map<string, string>();
  for (const p of peers) for (const id of p.selection ?? []) peerSelection.set(id, p.user.color);

  const pointsOf = (h: HoleEntry): Vec2[] => {
    if (drafts.vertex?.target === "hole" && drafts.vertex.wallId === h.id) {
      return h.points.map((p, i) => (i === drafts.vertex!.index ? drafts.vertex!.point : p));
    }
    if (drafts.move && selection.has(h.id)) {
      return h.points.map((p) => ({ x: p.x + drafts.move!.dx, y: p.y + drafts.move!.dy }));
    }
    return h.points;
  };

  return (
    <Group listening={false}>
      {holes.map((h) => {
        const pts = pointsOf(h);
        const selected = selection.has(h.id);
        const peer = peerSelection.get(h.id);
        // 名前は頂点の重心に置く。画面上で読めるよう、図面の回転を打ち消す
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        return (
          <Fragment key={h.id}>
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
              stroke={selected ? "#228be6" : HOLE_COLOR}
              strokeWidth={(selected ? 3 : 2) * px}
              dash={[8 * px, 4 * px]}
              fill={selected ? "rgba(34,139,230,0.15)" : "rgba(112,72,232,0.10)"}
              lineJoin="round"
            />
            <Text
              x={cx}
              y={cy}
              text="吹き抜け"
              fontSize={12 * px}
              fill={HOLE_COLOR}
              rotation={-props.planRotationDeg}
              offsetX={24 * px}
              offsetY={6 * px}
            />
          </Fragment>
        );
      })}
      {props.showHandles &&
        holes
          .filter((h) => selection.has(h.id))
          .flatMap((h) =>
            pointsOf(h).map((p, i) => (
              <Rect
                // biome-ignore lint/suspicious/noArrayIndexKey: 頂点の番号で区別する
                key={`${h.id}-${i}`}
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
