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
  Popover,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import {
  IconAdjustments,
  IconCrop,
  IconDoor,
  IconFileImport,
  IconHandStop,
  IconPalette,
  IconPointer,
  IconRotate2,
  IconRotateClockwise2,
  IconRuler2,
  IconScissors,
  IconWall,
  IconX,
} from "@tabler/icons-react";
import { distance, metersPerUnit, type Vec2 } from "@wifi-planner/domain";
import { updateFloor } from "@wifi-planner/domain/ops";
import { useMemo, useState } from "react";
import { useSession, useSessionState } from "../collab/react";
import { type CanvasTool, PlanCanvas } from "./canvas/PlanCanvas";
import type { FloorEntry } from "./FloorPanel";
import type { WallEntry } from "./geometry";
import { MaterialsModal } from "./MaterialsModal";
import { PlanImportModal } from "./PlanImportModal";
import { useWallTools } from "./walls/useWallTools";
import { WallInspector } from "./walls/WallInspector";
import { WallLayer } from "./walls/WallLayer";

/** 1 フロアの 2D 編集画面 */
export function FloorView({ floor }: { floor: FloorEntry }) {
  const session = useSession();
  const { doc, peers } = useSessionState();
  const readOnly = session.readOnly;
  const [tool, setTool] = useState<CanvasTool>("select");
  const [importing, setImporting] = useState(false);
  const [editingMaterials, setEditingMaterials] = useState(false);
  const [calibration, setCalibration] = useState<{ a: Vec2; b: Vec2 }>();
  const plan = floor.plan;
  const materials = doc?.materials ?? {};
  const materialIds = useMemo(() => new Set(Object.keys(materials)), [materials]);
  const walls: WallEntry[] = useMemo(
    () => Object.entries(floor.walls).map(([id, w]) => ({ ...w, id })),
    [floor.walls],
  );
  const mpu = metersPerUnit(floor.scale);
  const wallTools = useWallTools({
    floorId: floor.id,
    walls,
    tool,
    metersPerUnit: mpu,
    materialIds,
  });
  const floorPeers = peers.filter((p) => p.floorId === floor.id);

  useHotkeys([
    ["Delete", () => !readOnly && wallTools.deleteSelection()],
    [
      "Backspace",
      () =>
        tool === "wall" ? wallTools.undoLastPoint() : !readOnly && wallTools.deleteSelection(),
    ],
    [
      "Escape",
      () =>
        tool === "wall" && wallTools.drawing.length > 0
          ? wallTools.cancelDrawing()
          : wallTools.setSelection([]),
    ],
    ["Enter", () => tool === "wall" && wallTools.finishDrawing()],
    ["V", () => setTool("select")],
    ["H", () => setTool("pan")],
    ...(readOnly ? [] : ([["W", () => setTool("wall")]] as [string, () => void][])),
  ]);

  const update = (patch: Parameters<typeof updateFloor>[2], coalesce = false) =>
    session.mutate((ydoc) => updateFloor(ydoc, floor.id, patch), { coalesce });

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

  return (
    <Box pos="relative" h="100%" style={{ display: "flex" }}>
      <Box pos="relative" h="100%" style={{ flex: 1, minWidth: 0 }}>
        <PlanCanvas
          floor={floor}
          tool={tool}
          controller={wallTools.controller}
          handlers={{
            onCalibrate: (a, b) => setCalibration({ a, b }),
            onCrop: (crop) => {
              update({ plan: { ...plan, crop } });
              setTool("select");
            },
          }}
        >
          {(px) => (
            <WallLayer
              walls={walls}
              materials={materials}
              selection={wallTools.selectionSet}
              peers={floorPeers}
              drafts={wallTools.drafts}
              px={px}
              showHandles={tool === "select" && !readOnly && wallTools.selection.length === 1}
            />
          )}
        </PlanCanvas>

        <Paper pos="absolute" top={8} left={8} shadow="sm" p={4} withBorder>
          <Group gap={4}>
            <SegmentedControl
              size="xs"
              value={tool}
              onChange={(v) => setTool(v as CanvasTool)}
              data={[
                {
                  value: "select",
                  label: <ToolLabel icon={<IconPointer size={14} />} text="選択" />,
                },
                {
                  value: "pan",
                  label: <ToolLabel icon={<IconHandStop size={14} />} text="移動" />,
                },
                ...(readOnly
                  ? []
                  : [
                      {
                        value: "wall",
                        label: <ToolLabel icon={<IconWall size={14} />} text="壁" />,
                      },
                      {
                        value: "split",
                        label: <ToolLabel icon={<IconScissors size={14} />} text="分割" />,
                      },
                      {
                        value: "opening",
                        label: <ToolLabel icon={<IconDoor size={14} />} text="ドア・窓" />,
                      },
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
              <Popover position="bottom-start" shadow="md" withinPortal>
                <Popover.Target>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    leftSection={<IconAdjustments size={14} />}
                  >
                    図面の調整
                  </Button>
                </Popover.Target>
                <Popover.Dropdown>
                  <Stack gap="xs">
                    <Group gap={4}>
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
                        <ActionIcon
                          variant="subtle"
                          onClick={() => rotate(90)}
                          aria-label="右に 90 度回転"
                        >
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
                          typeof v === "number" &&
                          update({ plan: { ...plan, rotationDeg: v } }, true)
                        }
                      />
                    </Group>
                    {plan.crop && (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        leftSection={<IconX size={14} />}
                        onClick={() => update({ plan: { ...plan, crop: undefined } })}
                      >
                        トリミングを解除
                      </Button>
                    )}
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      leftSection={<IconFileImport size={14} />}
                      onClick={() => setImporting(true)}
                    >
                      図面を差し替え
                    </Button>
                  </Stack>
                </Popover.Dropdown>
              </Popover>
            )}
          </Group>
          {tool === "wall" && (
            <Group gap={4} mt={4}>
              <Select
                size="xs"
                w={180}
                aria-label="描く壁の材質"
                data={Object.entries(materials).map(([id, m]) => ({ value: id, label: m.name }))}
                value={wallTools.drawMaterialId}
                allowDeselect={false}
                onChange={(v) => v && wallTools.setDrawMaterialId(v)}
              />
              <Text size="xs" c="dimmed">
                クリックで点を置き、ダブルクリックか Enter で確定。Esc で取り消し
              </Text>
            </Group>
          )}
          {tool === "opening" && (
            <Group gap={4} mt={4}>
              <SegmentedControl
                size="xs"
                value={wallTools.openingKind}
                onChange={(v) => wallTools.setOpeningKind(v as "door" | "window")}
                data={[
                  { value: "door", label: "ドア" },
                  { value: "window", label: "窓" },
                ]}
              />
              <Text size="xs" c="dimmed">
                壁をクリックすると、その位置に追加します
              </Text>
            </Group>
          )}
          {tool === "select" && (
            <Group gap={4} mt={4}>
              <SegmentedControl
                size="xs"
                aria-label="範囲選択の方法"
                value={wallTools.selectMode}
                onChange={(v) => wallTools.setSelectMode(v as "rect" | "lasso")}
                data={[
                  { value: "rect", label: "矩形選択" },
                  { value: "lasso", label: "投げ縄選択" },
                ]}
              />
            </Group>
          )}
        </Paper>

        <Box pos="absolute" bottom={8} right={8} maw={360}>
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
            setTool("select");
          }}
        />
        <PlanImportModal
          floor={importing ? floor : undefined}
          onClose={() => setImporting(false)}
        />
      </Box>
      <Box
        w={280}
        p="sm"
        style={{ borderLeft: "1px solid var(--mantine-color-default-border)", overflowY: "auto" }}
      >
        <Stack gap="md">
          <Group justify="space-between">
            <Text fw={600} size="sm">
              壁
            </Text>
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={<IconPalette size={14} />}
              onClick={() => setEditingMaterials(true)}
            >
              材質
            </Button>
          </Group>
          <WallInspector
            floorId={floor.id}
            walls={walls}
            materials={materials}
            selection={wallTools.selection}
            setSelection={wallTools.setSelection}
            onDelete={wallTools.deleteSelection}
            metersPerUnit={mpu}
          />
        </Stack>
      </Box>
      <MaterialsModal opened={editingMaterials} onClose={() => setEditingMaterials(false)} />
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
