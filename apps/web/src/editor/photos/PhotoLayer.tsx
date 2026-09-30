import type { PhotoPin } from "@wifi-planner/domain";
import { Arrow, Circle, Group, Text } from "react-konva";

export type PinEntry = PhotoPin & { id: string };

/** 現場写真のピン。写真の枚数と、1 枚目の撮影方向（図面の上を 0° とした時計回り）を示す */
export function PhotoLayer(props: {
  pins: readonly PinEntry[];
  px: number;
  planRotationDeg: number;
  activeId?: string;
}) {
  const { px } = props;
  return (
    <Group listening={false}>
      {props.pins.map((pin) => {
        const dir = pin.photos.find((p) => p.directionDeg !== undefined)?.directionDeg;
        const t = dir === undefined ? undefined : (dir * Math.PI) / 180;
        const active = pin.id === props.activeId;
        return (
          <Group key={pin.id} x={pin.position.x} y={pin.position.y}>
            {t !== undefined && (
              <Arrow
                points={[0, 0, Math.sin(t) * 22 * px, -Math.cos(t) * 22 * px]}
                stroke="#7048e8"
                fill="#7048e8"
                strokeWidth={2 * px}
                pointerLength={6 * px}
                pointerWidth={6 * px}
              />
            )}
            <Circle
              radius={(active ? 10 : 8) * px}
              fill="#7048e8"
              stroke="#ffffff"
              strokeWidth={2 * px}
            />
            <Group rotation={-props.planRotationDeg} scaleX={px} scaleY={px}>
              <Text
                text={String(pin.photos.length)}
                x={-4}
                y={-5}
                fontSize={10}
                fontStyle="bold"
                fill="#ffffff"
              />
            </Group>
          </Group>
        );
      })}
    </Group>
  );
}
