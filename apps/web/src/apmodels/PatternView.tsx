import { Group, Text } from "@mantine/core";
import type { AntennaPattern } from "@wifi-planner/domain";
import {
  AROUND_AXIS_AXIS,
  AZIMUTH_AXIS,
  ELEVATION_AXIS,
  OFF_AXIS_AXIS,
  PolarChart,
} from "./PolarChart";

/** アンテナパターンを断面ごとの極座標グラフで見せる */
export function PatternView({ pattern }: { pattern: AntennaPattern }) {
  if (pattern.kind === "omni") {
    return <Text size="sm">無指向性（どの方向も {pattern.gainDbi} dBi）</Text>;
  }
  if (pattern.kind === "directional") {
    return (
      <Group align="flex-start">
        <PolarChart title="方位断面" points={pattern.azimuthCut} axis={AZIMUTH_AXIS} periodic />
        <PolarChart
          title="仰角断面"
          points={pattern.elevationCut}
          axis={ELEVATION_AXIS}
          periodic={false}
        />
      </Group>
    );
  }
  return (
    <Group align="flex-start">
      <PolarChart
        title="軸からの角度"
        points={pattern.offAxisCut}
        axis={OFF_AXIS_AXIS}
        periodic={false}
      />
      <PolarChart
        title="軸まわりの角度"
        points={pattern.aroundAxisCut}
        axis={AROUND_AXIS_AXIS}
        periodic
      />
    </Group>
  );
}
