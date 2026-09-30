import { Box, Group, Paper, Stack, Text } from "@mantine/core";
import type { LegendStop } from "@wifi-planner/domain";
import { CCI_COLORS, COUNT_COLORS, type HeatmapMode, MODE_LABELS } from "../../propagation/render";

function Swatch({ color }: { color: string }) {
  return <Box w={14} h={10} bg={color} style={{ borderRadius: 2, flexShrink: 0 }} />;
}

/** 凡例（FR-8.4）。色だけに頼らないよう、区切りの値を文字でも示す */
export function Legend(props: {
  mode: HeatmapMode;
  stops: LegendStop[];
  thresholdDbm: number;
  hideBelow: boolean;
}) {
  const sorted = [...props.stops].sort((a, b) => b.dbm - a.dbm);
  const items =
    props.mode === "rssi"
      ? sorted
          .filter((s) => !props.hideBelow || s.dbm >= props.thresholdDbm)
          .map((s) => ({ color: s.color, label: `${s.dbm} dBm 以上` }))
      : props.mode === "count"
        ? COUNT_COLORS.map((c, i) => ({
            color: c,
            label: i === COUNT_COLORS.length - 1 ? `${i + 1} 台以上` : `${i + 1} 台`,
          }))
        : CCI_COLORS.map((c, i) => ({
            color: c,
            label: i === CCI_COLORS.length - 1 ? `${i + 2} 台以上が重なる` : `${i + 2} 台が重なる`,
          }));
  return (
    <Paper shadow="xs" p={6} withBorder>
      <Stack gap={2}>
        <Text size="xs" fw={600}>
          {MODE_LABELS[props.mode]}
          {props.mode !== "rssi" && `（${props.thresholdDbm} dBm 以上で届く AP）`}
        </Text>
        {items.map((it) => (
          <Group key={it.label} gap={6} wrap="nowrap">
            <Swatch color={it.color} />
            <Text size="xs">{it.label}</Text>
          </Group>
        ))}
      </Stack>
    </Paper>
  );
}
