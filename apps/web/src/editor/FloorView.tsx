import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Center,
  Divider,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  Popover,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import {
  IconAccessPoint,
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
  IconSettings,
  IconTable,
  IconWall,
  IconX,
} from "@tabler/icons-react";
import {
  ApModel,
  BAND_LABELS,
  BANDS,
  type Band,
  distance,
  metersPerUnit,
  planTransform,
  type Vec2,
} from "@wifi-planner/domain";
import {
  addAp,
  defaultRadios,
  nextApName,
  putApModelSnapshot,
  updateFloor,
} from "@wifi-planner/domain/ops";
import { useMemo, useState } from "react";
import { useApModels } from "../api/hooks";
import { useSession, useSessionState } from "../collab/react";
import { notifyError } from "../notify";
import { composeImage, type HeatmapMode, MODE_LABELS } from "../propagation/render";
import { useHeatmap } from "../propagation/useHeatmap";
import { ApInspector } from "./aps/ApInspector";
import { type ApEntry, ApLayer } from "./aps/ApLayer";
import { ApTableModal } from "./aps/ApTableModal";
import { type CanvasTool, PlanCanvas } from "./canvas/PlanCanvas";
import type { FloorEntry } from "./FloorPanel";
import type { WallEntry } from "./geometry";
import { HeatmapLayer } from "./heatmap/HeatmapLayer";
import { HoverReadout } from "./heatmap/HoverReadout";
import { createHoverStore } from "./heatmap/hover";
import { Legend } from "./heatmap/Legend";
import { PropagationSettingsModal } from "./heatmap/PropagationSettingsModal";
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
  const aps: ApEntry[] = useMemo(
    () => Object.entries(floor.aps).map(([id, a]) => ({ ...a, id })),
    [floor.aps],
  );
  const mpu = metersPerUnit(floor.scale);
  const { data: library = [] } = useApModels();
  const [placeModelId, setPlaceModelId] = useState<string | null>(null);
  const [showApTable, setShowApTable] = useState(false);

  /** AP を置く（FR-6.1）。ライブラリのモデルをまだ写していなければ、プロジェクトに写す */
  const placeAp = (p: Vec2): string | undefined => {
    const entry = library.find((m) => m.id === placeModelId);
    if (!entry || !doc) {
      notifyError(new Error("置く AP モデルを選んでください"));
      return undefined;
    }
    const model = ApModel.parse(entry.definition);
    const names = new Set(
      Object.values(doc.floors).flatMap((f) => Object.values(f.aps).map((a) => a.name)),
    );
    let id: string | undefined;
    session.mutate((ydoc) => {
      if (!doc.apModels[entry.id]) {
        putApModelSnapshot(ydoc, entry.id, {
          ...model,
          source: { libraryId: entry.id, updatedAt: new Date(entry.updatedAt).toISOString() },
        });
      }
      id = addAp(ydoc, floor.id, {
        name: nextApName("AP-0", names),
        modelId: entry.id,
        position: p,
        heightM: Math.min(2.7, floor.heightM),
        mount: "ceiling",
        azimuthDeg: 0,
        tiltDeg: 0,
        radios: defaultRadios(model),
      });
    });
    return id;
  };

  const wallTools = useWallTools({
    floorId: floor.id,
    walls,
    aps,
    tool,
    metersPerUnit: mpu,
    materialIds,
    onPlaceAp: placeAp,
  });
  // 電波の表示（FR-8.1〜8.8）
  const [band, setBand] = useState<Band>("5");
  const [mode, setMode] = useState<HeatmapMode>("rssi");
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [apFilter, setApFilter] = useState<string[]>([]);
  const [editingPropagation, setEditingPropagation] = useState(false);
  const [hoverStore] = useState(createHoverStore);
  const transform = planTransform(floor.plan, floor.scale);
  const { result, pending } = useHeatmap(doc, floor.id, band, showHeatmap && !!transform);
  const legend = doc?.settings.legend;
  const okResult = result?.status === "ok" ? result : undefined;
  const pixels = useMemo(
    () =>
      okResult && legend
        ? composeImage(okResult.radios, okResult.grid.cols * okResult.grid.rows, {
            mode,
            apIds: new Set(apFilter),
            stops: legend.stops,
            thresholdDbm: legend.goodThresholdDbm,
            hideBelow: legend.hideBelow,
          })
        : undefined,
    [okResult, legend, mode, apFilter],
  );

  const selectedWalls = wallTools.selection.filter((id) => floor.walls[id]);
  const selectedAps = wallTools.selection.filter((id) => floor.aps[id]);
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
          onPointerMove={hoverStore.set}
          handlers={{
            onCalibrate: (a, b) => setCalibration({ a, b }),
            onCrop: (crop) => {
              update({ plan: { ...plan, crop } });
              setTool("select");
            },
          }}
        >
          {(px) => (
            <>
              {showHeatmap && okResult && pixels && transform && (
                <HeatmapLayer
                  grid={okResult.grid}
                  pixels={pixels}
                  planRotationDeg={plan.rotationDeg}
                  metersPerUnit={transform.metersPerUnit}
                  opacity={0.6}
                />
              )}
              <WallLayer
                walls={walls}
                materials={materials}
                selection={wallTools.selectionSet}
                peers={floorPeers}
                drafts={wallTools.drafts}
                px={px}
                showHandles={
                  tool === "select" &&
                  !readOnly &&
                  selectedWalls.length === 1 &&
                  selectedAps.length === 0
                }
              />
              <ApLayer
                aps={aps}
                models={doc?.apModels ?? {}}
                selection={wallTools.selectionSet}
                peers={floorPeers}
                move={wallTools.drafts.move}
                px={px}
                planRotationDeg={plan.rotationDeg}
              />
            </>
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
                        value: "ap",
                        label: <ToolLabel icon={<IconAccessPoint size={14} />} text="AP" />,
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
          {tool === "ap" && (
            <Group gap={4} mt={4}>
              <Select
                size="xs"
                w={220}
                aria-label="置く AP モデル"
                placeholder="AP モデルを選ぶ"
                data={library.flatMap((m) => {
                  const def = ApModel.safeParse(m.definition);
                  return def.success ? [{ value: m.id, label: def.data.name }] : [];
                })}
                value={placeModelId}
                onChange={setPlaceModelId}
                nothingFoundMessage="AP モデルがありません"
              />
              <Text size="xs" c="dimmed">
                {library.length === 0
                  ? "先に「AP モデル」の画面でモデルを作成してください"
                  : "図面をクリックすると、その位置に置きます"}
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

        {showHeatmap && legend && okResult && transform && (
          <Stack pos="absolute" bottom={8} left={8} gap={6} style={{ pointerEvents: "none" }}>
            <HoverReadout
              store={hoverStore}
              result={okResult}
              transform={transform}
              floor={floor}
              thresholdDbm={legend.goodThresholdDbm}
            />
            <Legend
              mode={mode}
              stops={legend.stops}
              thresholdDbm={legend.goodThresholdDbm}
              hideBelow={legend.hideBelow}
            />
          </Stack>
        )}
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
              電波
            </Text>
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={<IconSettings size={14} />}
              onClick={() => setEditingPropagation(true)}
            >
              設定
            </Button>
          </Group>
          <Switch
            label="ヒートマップを表示"
            checked={showHeatmap}
            onChange={(e) => setShowHeatmap(e.currentTarget.checked)}
            size="xs"
          />
          <SegmentedControl
            size="xs"
            aria-label="帯域"
            value={band}
            onChange={(v) => setBand(v as Band)}
            data={BANDS.map((b) => ({ value: b, label: BAND_LABELS[b] }))}
          />
          <Select
            size="xs"
            label="表示"
            data={(Object.keys(MODE_LABELS) as HeatmapMode[]).map((m) => ({
              value: m,
              label: MODE_LABELS[m],
            }))}
            value={mode}
            allowDeselect={false}
            onChange={(v) => v && setMode(v as HeatmapMode)}
          />
          <MultiSelect
            size="xs"
            label="対象の AP"
            placeholder={apFilter.length === 0 ? "すべて" : undefined}
            data={aps.map((a) => ({ value: a.id, label: a.name }))}
            value={apFilter.filter((id) => floor.aps[id])}
            onChange={setApFilter}
            clearable
            searchable
          />
          <Text size="xs" c="dimmed" aria-live="polite">
            {!transform
              ? "スケールを校正すると計算します"
              : pending
                ? "計算中…"
                : okResult
                  ? `${okResult.radios.length} 本のラジオを計算済み（${okResult.grid.cols}×${okResult.grid.rows} 点、${okResult.elapsedMs.toFixed(0)} ms）`
                  : ""}
          </Text>
          <Divider />
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
          {(selectedWalls.length > 0 || selectedAps.length === 0) && (
            <WallInspector
              floorId={floor.id}
              walls={walls}
              materials={materials}
              selection={selectedWalls}
              setSelection={wallTools.setSelection}
              onDelete={wallTools.deleteSelection}
              metersPerUnit={mpu}
            />
          )}
          <Divider />
          <Group justify="space-between">
            <Text fw={600} size="sm">
              AP
            </Text>
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={<IconTable size={14} />}
              onClick={() => setShowApTable(true)}
            >
              AP の一覧
            </Button>
          </Group>
          {selectedAps.length > 0 ? (
            <ApInspector
              floorId={floor.id}
              aps={aps}
              selection={selectedAps}
              setSelection={wallTools.setSelection}
              library={library}
              metersPerUnit={mpu}
            />
          ) : (
            <Text size="xs" c="dimmed">
              「AP」の道具でモデルを選び、図面をクリックして置きます。置いた AP
              をクリックすると設定を変えられます。
            </Text>
          )}
        </Stack>
      </Box>
      <MaterialsModal opened={editingMaterials} onClose={() => setEditingMaterials(false)} />
      <ApTableModal opened={showApTable} onClose={() => setShowApTable(false)} />
      <PropagationSettingsModal
        opened={editingPropagation}
        onClose={() => setEditingPropagation(false)}
      />
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
