import { Paper, Stack, Table, Text } from "@mantine/core";
import type { Floor, PlanTransform } from "@wifi-planner/domain";
import { sampleField } from "@wifi-planner/propagation";
import { useSyncExternalStore } from "react";
import type { ComputeResponse } from "../../propagation/protocol";
import type { HoverStore } from "./hover";

/** カーソル位置での AP ごとの推定受信電力（FR-8.7）。他のフロアの AP にはフロア名を添える */
export function HoverReadout(props: {
  store: HoverStore;
  result: Extract<ComputeResponse, { status: "ok" }>;
  transform: PlanTransform;
  floors: Record<string, Floor>;
  floorId: string;
  thresholdDbm: number;
}) {
  const p = useSyncExternalStore(props.store.subscribe, props.store.get);
  if (!p) return null;
  const f = props.transform.toFloor(p);
  const rows = props.result.radios
    .map((r) => ({ r, v: sampleField(r.field, props.result.grid, f.x, f.y) }))
    .filter((x): x is { r: typeof x.r; v: number } => x.v !== undefined)
    .sort((a, b) => b.v - a.v)
    .slice(0, 8);
  if (rows.length === 0) return null;
  return (
    <Paper shadow="sm" p={6} withBorder>
      <Stack gap={2}>
        <Text size="xs" c="dimmed">
          カーソル位置（{f.x.toFixed(1)} m, {f.y.toFixed(1)} m）
        </Text>
        <Table
          fz="xs"
          verticalSpacing={1}
          horizontalSpacing={6}
          aria-label="カーソル位置の推定受信電力"
        >
          <Table.Tbody>
            {rows.map(({ r, v }) => (
              <Table.Tr key={`${r.apId}-${r.radioKey}`}>
                <Table.Td>
                  {props.floors[r.floorId]?.aps[r.apId]?.name ?? "?"}
                  {r.floorId !== props.floorId && `（${props.floors[r.floorId]?.name ?? "?"}）`}
                </Table.Td>
                <Table.Td>{r.channel}ch</Table.Td>
                <Table.Td ta="right" fw={v >= props.thresholdDbm ? 600 : undefined}>
                  {v.toFixed(1)} dBm
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>
    </Paper>
  );
}
