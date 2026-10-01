import { Group, NumberInput, Select, Stack, Text } from "@mantine/core";
import {
  detectPaperSize,
  PAPER_SIZES,
  pointsToMm,
  type ScaleCalibration,
  scaleFromRatio,
} from "@wifi-planner/domain";

/** 元の用紙を指定しない（PDF の紙面のままの縮尺とみなす） */
const AS_PAGE = "page";

export type RatioInput = { ratio: number | string; nominal: string };
export const EMPTY_RATIO: RatioInput = { ratio: "", nominal: AS_PAGE };

type PageSize = { widthPt: number; heightPt: number };

/** 縮尺の入力からスケールを作る。未入力なら undefined */
export function ratioToScale(input: RatioInput, page: PageSize): ScaleCalibration | undefined {
  if (typeof input.ratio !== "number" || input.ratio <= 0) return undefined;
  return scaleFromRatio({
    ratio: input.ratio,
    pageWidthPt: page.widthPt,
    pageHeightPt: page.heightPt,
    nominal: PAPER_SIZES.find((p) => p.name === input.nominal),
  });
}

/** ページの寸法を「A3 横、420×297 mm」のように表す */
export function paperLabel(widthPt: number, heightPt: number): string {
  const mm = `${Math.round(pointsToMm(widthPt))}×${Math.round(pointsToMm(heightPt))} mm`;
  const paper = detectPaperSize(widthPt, heightPt);
  if (!paper) return mm;
  return `${paper.name} ${widthPt >= heightPt ? "横" : "縦"}、${mm}`;
}

/** PDF の縮尺（1:N）と、縮尺の基準にする用紙の入力欄 */
export function RatioScaleFields(props: {
  page: PageSize;
  value: RatioInput;
  onChange: (v: RatioInput) => void;
  ratioLabel?: string;
  ratioDescription?: string;
  autoFocus?: boolean;
}) {
  const { page, value, onChange } = props;
  const scale = ratioToScale(value, page);
  return (
    <Stack gap={4}>
      <Group gap="xs" align="flex-end">
        <NumberInput
          label={props.ratioLabel ?? "縮尺"}
          description={props.ratioDescription}
          leftSection={<Text size="sm">1 :</Text>}
          leftSectionWidth={36}
          min={1}
          decimalScale={2}
          w={180}
          value={value.ratio}
          onChange={(ratio) => onChange({ ...value, ratio })}
          data-autofocus={props.autoFocus || undefined}
        />
        <Select
          label="縮尺の基準の用紙"
          w={200}
          allowDeselect={false}
          data={[
            { value: AS_PAGE, label: `PDF の紙面（${paperLabel(page.widthPt, page.heightPt)}）` },
            ...PAPER_SIZES.map((p) => ({ value: p.name, label: `${p.name}（縮小前）` })),
          ]}
          value={value.nominal}
          onChange={(nominal) => onChange({ ...value, nominal: nominal ?? AS_PAGE })}
        />
      </Group>
      {scale && (
        <Text size="xs" c="dimmed">
          紙面の幅 {Math.round(pointsToMm(page.widthPt))} mm が実際の {scale.distanceM.toFixed(2)} m
          に当たります
        </Text>
      )}
    </Stack>
  );
}
