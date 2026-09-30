import { Box, Button, Group, Table, Text } from "@mantine/core";
import type { AngleCut } from "@wifi-planner/domain";
import { useMemo, useState } from "react";

// アンテナパターンの極座標グラフ（FR-5.3）。1 つのグラフに 1 つの断面だけを描く。
// 断面ごとに角度の意味が違うので、重ねずに並べる。

const SIZE = 220;
const R = 84;
const C = SIZE / 2;
/** 系列の色（分類用の 1 色目）。暗い表示では同じ色相の暗い面向けの段を使う */
const SERIES = "light-dark(#2a78d6, #3987e5)";
const GRID = "light-dark(#dedcd4, #3a3a37)";

export type AngleAxis = {
  /** データの角度をグラフの角度（上が 0 度、時計回り）にする */
  toChart: (deg: number) => number;
  /** グラフの角度からデータの角度に戻す。範囲外なら undefined */
  fromChart: (chartDeg: number) => number | undefined;
  /** 目盛りを打つデータの角度 */
  ticks: number[];
};

export const AZIMUTH_AXIS: AngleAxis = {
  toChart: (d) => d,
  fromChart: (c) => (c > 180 ? c - 360 : c),
  ticks: [0, 90, 180, -90],
};

/** 仰角は右を水平、上を +90 度にする */
export const ELEVATION_AXIS: AngleAxis = {
  toChart: (e) => 90 - e,
  fromChart: (c) => (c <= 180 ? 90 - c : undefined),
  ticks: [90, 0, -90],
};

/** 軸からの角度は下を 0 度（天井設置では真下）にする */
export const OFF_AXIS_AXIS: AngleAxis = {
  toChart: (a) => 180 - a,
  fromChart: (c) => (c <= 180 ? 180 - c : undefined),
  ticks: [0, 90, 180],
};

export const AROUND_AXIS_AXIS: AngleAxis = {
  toChart: (b) => b,
  fromChart: (c) => c,
  ticks: [0, 90, 180, 270],
};

function interpolate(points: AngleCut, deg: number, periodic: boolean): number {
  const sorted = [...points].sort((a, b) => a.deg - b.deg);
  if (sorted.length === 1) return sorted[0]!.gainDbi;
  const ext = periodic
    ? [
        { ...sorted.at(-1)!, deg: sorted.at(-1)!.deg - 360 },
        ...sorted,
        { ...sorted[0]!, deg: sorted[0]!.deg + 360 },
      ]
    : sorted;
  let d = deg;
  if (periodic) while (d < ext[0]!.deg) d += 360;
  if (d <= ext[0]!.deg) return ext[0]!.gainDbi;
  for (let i = 1; i < ext.length; i++) {
    const a = ext[i - 1]!;
    const b = ext[i]!;
    if (d <= b.deg)
      return a.gainDbi + ((b.gainDbi - a.gainDbi) * (d - a.deg)) / (b.deg - a.deg || 1);
  }
  return ext.at(-1)!.gainDbi;
}

export function PolarChart(props: {
  title: string;
  points: AngleCut;
  axis: AngleAxis;
  periodic: boolean;
}) {
  const { points, axis } = props;
  const [hover, setHover] = useState<{ deg: number; gain: number }>();
  const [showTable, setShowTable] = useState(false);

  const { max, min } = useMemo(() => {
    const gains = points.map((p) => p.gainDbi);
    const max = Math.ceil(Math.max(...gains) / 5) * 5;
    // 最大から 30 dB 下までを描く。それより低い値は中心に寄せる
    return { max, min: Math.min(max - 30, Math.floor(Math.min(...gains) / 10) * 10) };
  }, [points]);

  const radius = (g: number) => (Math.max(g - min, 0) / (max - min)) * R;
  const xy = (chartDeg: number, r: number) => {
    const t = (chartDeg * Math.PI) / 180;
    return { x: C + r * Math.sin(t), y: C - r * Math.cos(t) };
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: xy と radius は min、max と定数だけに依存する
  const path = useMemo(() => {
    const sorted = [...points].sort((a, b) => a.deg - b.deg);
    // 点の間を 1 度刻みで補間して、折れ線ではなく曲線に見えるようにする
    const lo = sorted[0]!.deg;
    const hi = props.periodic ? lo + 360 : sorted.at(-1)!.deg;
    const pts: string[] = [];
    for (let d = lo; d <= hi; d += 1) {
      const p = xy(axis.toChart(d), radius(interpolate(points, d, props.periodic)));
      pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    return `M${pts.join("L")}${props.periodic ? "Z" : ""}`;
  }, [points, axis, props.periodic, min, max]);

  const rings = [];
  for (let g = max; g > min; g -= 10) rings.push(g);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * SIZE - C;
    const y = ((e.clientY - rect.top) / rect.height) * SIZE - C;
    const chartDeg = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
    const deg = axis.fromChart(chartDeg);
    setHover(
      deg === undefined
        ? undefined
        : { deg: Math.round(deg), gain: interpolate(points, Math.round(deg), props.periodic) },
    );
  };

  const hoverPoint = hover && xy(axis.toChart(hover.deg), radius(hover.gain));

  return (
    <Box>
      <Group justify="space-between" gap={4}>
        <Text size="sm" fw={600}>
          {props.title}
        </Text>
        <Button size="compact-xs" variant="subtle" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "グラフで見る" : "表で見る"}
        </Button>
      </Group>
      {showTable ? (
        <Box mah={SIZE} style={{ overflowY: "auto" }}>
          <Table striped withTableBorder fz="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>角度（度）</Table.Th>
                <Table.Th>利得（dBi）</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[...points]
                .sort((a, b) => a.deg - b.deg)
                .map((p) => (
                  <Table.Tr key={p.deg}>
                    <Table.Td>{p.deg}</Table.Td>
                    <Table.Td>{p.gainDbi}</Table.Td>
                  </Table.Tr>
                ))}
            </Table.Tbody>
          </Table>
        </Box>
      ) : (
        <Box pos="relative">
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            width={SIZE}
            height={SIZE}
            role="img"
            aria-label={`${props.title}の極座標グラフ。最大 ${max} dBi`}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(undefined)}
          >
            {rings.map((g) => (
              <g key={g}>
                <circle cx={C} cy={C} r={radius(g)} fill="none" stroke={GRID} strokeWidth={1} />
                <text
                  x={C + 2}
                  y={C - radius(g) - 2}
                  fontSize={8}
                  fill="var(--mantine-color-dimmed)"
                >
                  {g}
                </text>
              </g>
            ))}
            {axis.ticks.map((t) => {
              const end = xy(axis.toChart(t), R);
              const label = xy(axis.toChart(t), R + 12);
              return (
                <g key={t}>
                  <line x1={C} y1={C} x2={end.x} y2={end.y} stroke={GRID} strokeWidth={1} />
                  <text
                    x={label.x}
                    y={label.y + 3}
                    fontSize={9}
                    textAnchor="middle"
                    fill="var(--mantine-color-dimmed)"
                  >
                    {t}°
                  </text>
                </g>
              );
            })}
            <path d={path} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" />
            {hoverPoint && (
              <>
                <line
                  x1={C}
                  y1={C}
                  x2={hoverPoint.x}
                  y2={hoverPoint.y}
                  stroke="var(--mantine-color-dimmed)"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />
                <circle
                  cx={hoverPoint.x}
                  cy={hoverPoint.y}
                  r={4}
                  fill={SERIES}
                  stroke="var(--mantine-color-body)"
                  strokeWidth={2}
                />
              </>
            )}
          </svg>
          {hover && (
            <Text
              size="xs"
              pos="absolute"
              top={0}
              right={0}
              bg="var(--mantine-color-body)"
              px={4}
              style={{ borderRadius: 4, boxShadow: "var(--mantine-shadow-xs)" }}
            >
              {hover.deg}°：{hover.gain.toFixed(1)} dBi
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
