import { Button, Checkbox, Popover, Stack } from "@mantine/core";
import { IconEye } from "@tabler/icons-react";
import { useState } from "react";
import type { CanvasTool } from "./canvas/PlanCanvas";

/** 2D ビューに表示する種別（FR-8.9） */
export type LayerKind = "plan" | "heatmap" | "walls" | "holes" | "areas" | "aps" | "photos";
export type LayerVisibility = Record<LayerKind, boolean>;

export const LAYER_LABELS: Record<LayerKind, string> = {
  plan: "図面",
  heatmap: "ヒートマップ",
  walls: "壁",
  holes: "吹き抜け",
  areas: "エリア",
  aps: "AP",
  photos: "写真のピン",
};

export const ALL_LAYERS_VISIBLE: LayerVisibility = {
  plan: true,
  heatmap: true,
  walls: true,
  holes: true,
  areas: true,
  aps: true,
  photos: true,
};

/** 要素を作る道具と、その道具で作る要素の種別。隠したまま作らないよう、道具を選んだら表示に戻す */
export const TOOL_LAYER: Partial<Record<CanvasTool, LayerKind>> = {
  wall: "walls",
  split: "walls",
  opening: "walls",
  hole: "holes",
  area: "areas",
  ap: "aps",
  photo: "photos",
};

/** 道具のバーに置く、表示する種別の切り替え */
export function LayerMenu({
  layers,
  onChange,
}: {
  layers: LayerVisibility;
  onChange: (patch: Partial<LayerVisibility>) => void;
}) {
  const [opened, setOpened] = useState(false);
  const hidden = (Object.keys(LAYER_LABELS) as LayerKind[]).filter((k) => !layers[k]).length;
  return (
    <Popover
      position="bottom-start"
      shadow="md"
      withinPortal
      opened={opened}
      onChange={setOpened}
      transitionProps={{ duration: 0 }}
    >
      <Popover.Target>
        <Button
          onClick={() => setOpened((o) => !o)}
          size="compact-xs"
          variant={hidden > 0 ? "light" : "subtle"}
          leftSection={<IconEye size={14} />}
        >
          {hidden > 0 ? `表示（${hidden} 種を非表示）` : "表示"}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap={6} aria-label="表示する種別">
          {(Object.keys(LAYER_LABELS) as LayerKind[]).map((kind) => (
            <Checkbox
              key={kind}
              size="xs"
              label={LAYER_LABELS[kind]}
              checked={layers[kind]}
              onChange={(e) => onChange({ [kind]: e.currentTarget.checked })}
            />
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
