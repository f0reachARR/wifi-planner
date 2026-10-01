import { type Material, pointAtLength, type Vec2 } from "@wifi-planner/domain";
import { Fragment } from "react";
import { Circle, Group, Line, Rect } from "react-konva";
import type { PeerPresence } from "../../collab/session";
import type { SnapKind, WallEntry } from "../geometry";
import { SnapMarker } from "../snap/SnapMarker";

const flat = (points: readonly Vec2[]) => points.flatMap((p) => [p.x, p.y]);

/** 折れ線の s0〜s1 の区間の点列 */
function subPolyline(points: readonly Vec2[], s0: number, s1: number): Vec2[] {
  const a = pointAtLength(points, s0);
  const b = pointAtLength(points, s1);
  return [a.point, ...points.slice(a.segment + 1, b.segment + 1), b.point];
}

export type WallDrafts = {
  drawing?: { points: Vec2[]; hover?: Vec2; snap: SnapKind };
  marquee?: Vec2[];
  move?: { dx: number; dy: number };
  vertex?: { wallId: string; index: number; point: Vec2; snap: SnapKind };
  hover?: { wallId: string; point: Vec2 };
};

export function WallLayer(props: {
  walls: readonly WallEntry[];
  materials: Record<string, Material>;
  selection: ReadonlySet<string>;
  peers: readonly PeerPresence[];
  drafts: WallDrafts;
  px: number;
  showHandles: boolean;
}) {
  const { walls, materials, selection, peers, drafts, px } = props;
  const color = (id: string) => materials[id]?.color ?? "#888888";
  const peerSelection = new Map<string, string>();
  for (const p of peers) for (const id of p.selection ?? []) peerSelection.set(id, p.user.color);
  const wallWidth = 4 * px;

  const pointsOf = (w: WallEntry): Vec2[] => {
    if (drafts.vertex?.wallId === w.id) {
      return w.points.map((p, i) => (i === drafts.vertex!.index ? drafts.vertex!.point : p));
    }
    if (drafts.move && selection.has(w.id)) {
      return w.points.map((p) => ({ x: p.x + drafts.move!.dx, y: p.y + drafts.move!.dy }));
    }
    return w.points;
  };

  return (
    <Group listening={false}>
      {/* ほかのユーザーの選択は下に太く敷く */}
      {walls.map((w) =>
        peerSelection.has(w.id) ? (
          <Line
            key={`peer-${w.id}`}
            points={flat(w.points)}
            stroke={peerSelection.get(w.id)}
            strokeWidth={wallWidth * 3}
            opacity={0.35}
            lineCap="round"
            lineJoin="round"
          />
        ) : null,
      )}
      {walls.map((w) => {
        const pts = pointsOf(w);
        const selected = selection.has(w.id);
        return (
          <Fragment key={w.id}>
            {selected && (
              <Line
                points={flat(pts)}
                stroke="#228be6"
                strokeWidth={wallWidth * 2.5}
                opacity={0.5}
                lineCap="round"
                lineJoin="round"
              />
            )}
            <Line
              points={flat(pts)}
              stroke={color(w.materialId)}
              strokeWidth={wallWidth}
              lineCap="round"
              lineJoin="round"
            />
            {w.openings.map((o) => (
              <Line
                key={o.id}
                points={flat(subPolyline(pts, o.start, o.end))}
                stroke={color(o.materialId)}
                strokeWidth={wallWidth * 1.8}
                dash={o.kind === "window" ? [3 * px, 2 * px] : undefined}
                lineCap="butt"
              />
            ))}
          </Fragment>
        );
      })}

      {/* ほかのユーザーがドラッグ中の壁 */}
      {peers.map((p) =>
        p.drag
          ? walls
              .filter((w) => p.drag!.wallIds.includes(w.id))
              .map((w) => (
                <Line
                  key={`drag-${p.clientId}-${w.id}`}
                  points={flat(w.points.map((q) => ({ x: q.x + p.drag!.dx, y: q.y + p.drag!.dy })))}
                  stroke={p.user.color}
                  strokeWidth={wallWidth}
                  dash={[6 * px, 4 * px]}
                  opacity={0.8}
                />
              ))
          : null,
      )}

      {drafts.hover && (
        <Circle
          x={drafts.hover.point.x}
          y={drafts.hover.point.y}
          radius={5 * px}
          stroke="#e8590c"
          strokeWidth={2 * px}
        />
      )}

      {props.showHandles &&
        walls
          .filter((w) => selection.has(w.id))
          .flatMap((w) =>
            pointsOf(w).map((p, i) => (
              <Rect
                // 頂点のハンドルは頂点の番号がそのまま識別子になる
                // biome-ignore lint/suspicious/noArrayIndexKey: 頂点の番号で区別する
                key={`${w.id}-${i}`}
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

      {drafts.drawing && (
        <>
          <Line
            points={flat(
              drafts.drawing.hover
                ? [...drafts.drawing.points, drafts.drawing.hover]
                : drafts.drawing.points,
            )}
            stroke="#228be6"
            strokeWidth={wallWidth}
            lineCap="round"
            lineJoin="round"
            opacity={0.8}
          />
          {drafts.drawing.hover && (
            <SnapMarker point={drafts.drawing.hover} kind={drafts.drawing.snap} px={px} />
          )}
        </>
      )}

      {drafts.vertex && drafts.vertex.snap !== "none" && (
        <SnapMarker point={drafts.vertex.point} kind={drafts.vertex.snap} px={px} />
      )}

      {drafts.marquee && drafts.marquee.length > 1 && (
        <Line
          points={flat(drafts.marquee)}
          closed
          stroke="#228be6"
          strokeWidth={1.5 * px}
          dash={[6 * px, 4 * px]}
          fill="rgba(34,139,230,0.08)"
        />
      )}
    </Group>
  );
}
