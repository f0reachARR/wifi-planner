import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Center,
  Group,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconCrop,
  IconFileImport,
  IconHandStop,
  IconRotate2,
  IconRotateClockwise2,
  IconRuler2,
  IconX,
} from "@tabler/icons-react";
import { distance, metersPerUnit, type Vec2 } from "@wifi-planner/domain";
import { updateFloor } from "@wifi-planner/domain/ops";
import { useState } from "react";
import { useSession } from "../collab/react";
import { type CanvasTool, PlanCanvas } from "./canvas/PlanCanvas";
import type { FloorEntry } from "./FloorPanel";
import { PlanImportModal } from "./PlanImportModal";

/** 1 フロアの 2D 編集画面 */
export function FloorView({ floor }: { floor: FloorEntry }) {
  const session = useSession();
  const readOnly = session.readOnly;
  const [tool, setTool] = useState<CanvasTool>("pan");
  const [importing, setImporting] = useState(false);
  const [calibration, setCalibration] = useState<{ a: Vec2; b: Vec2 }>();
  const plan = floor.plan;

  const update = (patch: Parameters<typeof updateFloor>[2]) =>
    session.mutate((ydoc) => updateFloor(ydoc, floor.id, patch));

  const rotate = (delta: number) => {
    if (!plan) return;
    update({ plan: { ...plan, rotationDeg: (((plan.rotationDeg + delta) % 360) + 360) % 360 } });
  };

  if (!plan) {
    return (
      <Center h="100%">
        <Stack align="center" gap="sm">
          <Text c="dimmed">このフロアには図面がありません</Text>
          {!readOnly && (
            <Button leftSection={<IconFileImport size={16} />} onClick={() => setImporting(true)}>
              図面を取り込む
            </Button>
          )}
        </Stack>
        <PlanImportModal
          floor={importing ? floor : undefined}
          onClose={() => setImporting(false)}
        />
      </Center>
    );
  }

  const mpu = metersPerUnit(floor.scale);

  return (
    <Box pos="relative" h="100%">
      <PlanCanvas
        floor={floor}
        tool={tool}
        handlers={{
          onCalibrate: (a, b) => setCalibration({ a, b }),
          onCrop: (crop) => {
            update({ plan: { ...plan, crop } });
            setTool("pan");
          },
        }}
      />

      <Paper pos="absolute" top={8} left={8} shadow="sm" p={4} withBorder>
        <Group gap={4}>
          <SegmentedControl
            size="xs"
            value={tool}
            onChange={(v) => setTool(v as CanvasTool)}
            data={[
              { value: "pan", label: <ToolLabel icon={<IconHandStop size={14} />} text="移動" /> },
              ...(readOnly
                ? []
                : [
                    {
                      value: "calibrate",
                      label: <ToolLabel icon={<IconRuler2 size={14} />} text="スケール校正" />,
                    },
                    {
                      value: "crop",
                      label: <ToolLabel icon={<IconCrop size={14} />} text="トリミング" />,
                    },
                  ]),
            ]}
          />
          {!readOnly && (
            <>
              <Tooltip label="左に 90 度回転">
                <ActionIcon
                  variant="subtle"
                  onClick={() => rotate(-90)}
                  aria-label="左に 90 度回転"
                >
                  <IconRotate2 size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="右に 90 度回転">
                <ActionIcon variant="subtle" onClick={() => rotate(90)} aria-label="右に 90 度回転">
                  <IconRotateClockwise2 size={16} />
                </ActionIcon>
              </Tooltip>
              <NumberInput
                size="xs"
                w={90}
                aria-label="回転角"
                suffix="°"
                value={plan.rotationDeg}
                min={0}
                max={359.9}
                decimalScale={1}
                onChange={(v) =>
                  typeof v === "number" && update({ plan: { ...plan, rotationDeg: v } })
                }
              />
              {plan.crop && (
                <Tooltip label="トリミングを解除">
                  <ActionIcon
                    variant="subtle"
                    onClick={() => update({ plan: { ...plan, crop: undefined } })}
                    aria-label="トリミングを解除"
                  >
                    <IconX size={16} />
                  </ActionIcon>
                </Tooltip>
              )}
              <Button
                size="compact-xs"
                variant="subtle"
                leftSection={<IconFileImport size={14} />}
                onClick={() => setImporting(true)}
              >
                図面を差し替え
              </Button>
            </>
          )}
        </Group>
      </Paper>

      <Box pos="absolute" top={8} right={8} maw={360}>
        {mpu === undefined ? (
          <Alert color="yellow" title="スケールが未校正です" p="xs">
            <Text size="xs">
              電波の計算にはスケールが必要です。「スケール校正」で図面上の 2
              点を選び、その間の実際の距離を入力してください。
            </Text>
          </Alert>
        ) : (
          <Paper shadow="xs" p={6} withBorder>
            <Text size="xs">
              スケール：1 m ＝ 図面上 {(1 / mpu).toFixed(1)} 単位
              {plan.dpi ? `（${plan.dpi} dpi）` : ""}
            </Text>
          </Paper>
        )}
      </Box>

      {tool === "calibrate" && (
        <Paper
          pos="absolute"
          bottom={8}
          left="50%"
          style={{ transform: "translateX(-50%)" }}
          shadow="sm"
          p="xs"
          withBorder
        >
          <Text size="xs">図面上で距離がわかっている 2 点をクリックしてください</Text>
        </Paper>
      )}
      {tool === "crop" && (
        <Paper
          pos="absolute"
          bottom={8}
          left="50%"
          style={{ transform: "translateX(-50%)" }}
          shadow="sm"
          p="xs"
          withBorder
        >
          <Text size="xs">残す範囲をドラッグで囲んでください</Text>
        </Paper>
      )}

      <CalibrationModal
        points={calibration}
        onClose={() => setCalibration(undefined)}
        onSubmit={(distanceM) => {
          if (calibration) update({ scale: { ...calibration, distanceM } });
          setCalibration(undefined);
          setTool("pan");
        }}
      />
      <PlanImportModal floor={importing ? floor : undefined} onClose={() => setImporting(false)} />
    </Box>
  );
}

function ToolLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <Group gap={4} wrap="nowrap">
      {icon}
      <span>{text}</span>
    </Group>
  );
}

/** 2 点間の実際の距離を入力する（FR-2.4） */
function CalibrationModal(props: {
  points: { a: Vec2; b: Vec2 } | undefined;
  onClose: () => void;
  onSubmit: (distanceM: number) => void;
}) {
  const [value, setValue] = useState<number | string>("");
  const valid = typeof value === "number" && value > 0;
  const tooShort = props.points && distance(props.points.a, props.points.b) === 0;
  return (
    <Modal opened={!!props.points} onClose={props.onClose} title="スケール校正">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) props.onSubmit(value);
        }}
      >
        <Stack>
          {tooShort ? (
            <Text c="red" size="sm">
              2 点が同じ位置です。離れた 2 点を選び直してください。
            </Text>
          ) : (
            <NumberInput
              label="2 点間の実際の距離"
              suffix=" m"
              min={0.01}
              decimalScale={3}
              value={value}
              onChange={setValue}
              data-autofocus
            />
          )}
          <Group justify="flex-end">
            <Button type="submit" disabled={!valid || tooShort}>
              設定
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
