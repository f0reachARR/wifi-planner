import type { Ap, ApModel } from "@wifi-planner/domain";
import { Arrow, Circle, Group, Text } from "react-konva";
import type { PeerPresence } from "../../collab/session";

export type ApEntry = Ap & { id: string };

/**
 * AP の記号。位置は図面座標。主ビームの向きを矢印で示す（無指向性のアンテナでも、方位角の向きを示す）。
 * 方位角はフロア座標（y 上向き）の +x から反時計回りなので、図面座標（y 下向き）では y を反転して向きを求める。
 * 図面の回転はキャンバスのグループが受け持つので、ここでは図面座標のまま描けばよい。
 */
export function ApLayer(props: {
  aps: readonly ApEntry[];
  models: Record<string, ApModel>;
  selection: ReadonlySet<string>;
  peers: readonly PeerPresence[];
  move?: { dx: number; dy: number };
  px: number;
  /** AP があるフロアの図面の回転。方位角を図面座標の向きに直すのに使う */
  planRotationDeg: number;
  /** 画面に対する回転。名前の文字を画面に対してまっすぐにするのに使う。省略すると planRotationDeg と同じ */
  labelRotationDeg?: number;
}) {
  const { px } = props;
  const peerSelection = new Map<string, string>();
  for (const p of props.peers)
    for (const id of p.selection ?? []) peerSelection.set(id, p.user.color);

  return (
    <Group listening={false}>
      {props.aps.map((ap) => {
        const selected = props.selection.has(ap.id);
        const x = ap.position.x + (selected && props.move ? props.move.dx : 0);
        const y = ap.position.y + (selected && props.move ? props.move.dy : 0);
        const enabled = ap.radios.some((r) => r.enabled);
        // フロア座標の方位角を、回転前の図面座標の向きにする（フロア座標 = 回転した図面座標の y を反転したもの）
        const floorAngle = (ap.azimuthDeg * Math.PI) / 180;
        const rot = (props.planRotationDeg * Math.PI) / 180;
        const dirX = Math.cos(floorAngle) * Math.cos(rot) - Math.sin(floorAngle) * Math.sin(rot);
        const dirY = -Math.cos(floorAngle) * Math.sin(rot) - Math.sin(floorAngle) * Math.cos(rot);
        return (
          <Group key={ap.id} x={x} y={y}>
            {peerSelection.has(ap.id) && (
              <Circle radius={16 * px} fill={peerSelection.get(ap.id)} opacity={0.35} />
            )}
            {selected && <Circle radius={13 * px} fill="#228be6" opacity={0.35} />}
            <Arrow
              points={[0, 0, dirX * 20 * px, dirY * 20 * px]}
              stroke="#343a40"
              fill="#343a40"
              strokeWidth={1.5 * px}
              pointerLength={5 * px}
              pointerWidth={5 * px}
              opacity={ap.mount === "wall" ? 0.9 : 0.4}
            />
            <Circle
              radius={8 * px}
              fill={enabled ? "#f8f9fa" : "#ced4da"}
              stroke="#212529"
              strokeWidth={2 * px}
            />
            <Circle radius={3 * px} fill={enabled ? "#e8590c" : "#868e96"} />
            <Group
              rotation={-(props.labelRotationDeg ?? props.planRotationDeg)}
              scaleX={px}
              scaleY={px}
            >
              <Text
                text={ap.name}
                x={11}
                y={-6}
                fontSize={12}
                fontStyle="bold"
                fill="#212529"
                stroke="#ffffff"
                strokeWidth={3}
                fillAfterStrokeEnabled
              />
              <Text
                text={props.models[ap.modelId]?.name ?? "（モデルなし）"}
                x={11}
                y={7}
                fontSize={10}
                fill="#495057"
              />
            </Group>
          </Group>
        );
      })}
    </Group>
  );
}
