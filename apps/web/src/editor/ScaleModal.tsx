import { Button, Group, Modal, NumberInput, SegmentedControl, Stack, Text } from "@mantine/core";
import {
  metersPerUnit,
  type PlanImage,
  type ScaleCalibration,
  scaleFromMetersPerUnit,
} from "@wifi-planner/domain";
import { useState } from "react";
import { EMPTY_RATIO, RatioScaleFields, ratioToScale } from "./RatioScaleFields";

/** スケールを数値や縮尺で直接設定する（FR-2.4 の 2 点による校正の代わり） */
export function ScaleModal(props: {
  opened: boolean;
  plan: PlanImage;
  scale: ScaleCalibration | undefined;
  onClose: () => void;
  onSubmit: (scale: ScaleCalibration | undefined) => void;
}) {
  return (
    <Modal opened={props.opened} onClose={props.onClose} title="スケールの設定" size="lg">
      {props.opened && <ScaleBody {...props} />}
    </Modal>
  );
}

function ScaleBody({ plan, scale, onSubmit }: Parameters<typeof ScaleModal>[0]) {
  const isPdf = plan.dpi !== undefined;
  // 図面座標でのページの大きさ（PDF ならポイント、画像なら元の画像のピクセル）
  const page = {
    widthPt: plan.widthPx * plan.unitsPerPx,
    heightPt: plan.heightPx * plan.unitsPerPx,
  };
  const unit = isPdf ? "pt" : "px";
  const mpu = metersPerUnit(scale);
  const [mode, setMode] = useState(isPdf ? "ratio" : "value");
  const [ratio, setRatio] = useState(EMPTY_RATIO);
  const [unitsPerMeter, setUnitsPerMeter] = useState<number | string>(
    mpu ? Number((1 / mpu).toFixed(3)) : "",
  );

  const next =
    mode === "ratio"
      ? ratioToScale(ratio, page)
      : typeof unitsPerMeter === "number" && unitsPerMeter > 0
        ? scaleFromMetersPerUnit(1 / unitsPerMeter, page.widthPt)
        : undefined;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (next) onSubmit(next);
      }}
    >
      <Stack>
        {isPdf && (
          <SegmentedControl
            data={[
              { value: "ratio", label: "縮尺で指定" },
              { value: "value", label: "数値で指定" },
            ]}
            value={mode}
            onChange={setMode}
          />
        )}
        {mode === "ratio" ? (
          <RatioScaleFields page={page} value={ratio} onChange={setRatio} autoFocus />
        ) : (
          <NumberInput
            label="1 m あたりの図面上の長さ"
            description={
              isPdf
                ? "PDF の紙面上の長さをポイント（1/72 インチ）で入力します"
                : "元の画像のピクセル数で入力します"
            }
            leftSection={<Text size="sm">1 m ＝</Text>}
            leftSectionWidth={56}
            suffix={` ${unit}`}
            min={0.001}
            decimalScale={3}
            w={260}
            value={unitsPerMeter}
            onChange={setUnitsPerMeter}
            data-autofocus
          />
        )}
        <Group justify="space-between">
          {scale ? (
            <Button variant="subtle" color="red" onClick={() => onSubmit(undefined)}>
              スケールを解除
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={!next}>
            設定
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
