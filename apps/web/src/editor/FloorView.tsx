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
  Slider,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import {
  IconAccessPoint,
  IconAdjustments,
  IconCamera,
  IconCrop,
  IconDoor,
  IconFileImport,
  IconHandStop,
  IconMagnet,
  IconPalette,
  IconPointer,
  IconRotate2,
  IconRotateClockwise2,
  IconRuler,
  IconRuler2,
  IconScissors,
  IconSettings,
  IconSquareDashed,
  IconStack2,
  IconTable,
  IconTrash,
  IconWall,
  IconWand,
  IconX,
} from "@tabler/icons-react";
import {
  ApModel,
  BAND_LABELS,
  BANDS,
  type Band,
  distance,
  floorPlacements,
  metersPerUnit,
  planToPlan,
  planTransform,
  ratioOfPdfScale,
  type Vec2,
} from "@wifi-planner/domain";
import {
  addAp,
  addPhotoPin,
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
import { type CanvasTool, PlanCanvas, type ToolController } from "./canvas/PlanCanvas";
import { CandidateLayer } from "./extraction/CandidateLayer";
import { ExtractionPanel } from "./extraction/ExtractionPanel";
import { useCandidateSelection } from "./extraction/useCandidateSelection";
import { useExtraction } from "./extraction/useExtraction";
import { type FloorEntry, sortedFloors } from "./FloorPanel";
import { type HoleEntry, polygonArea, SNAP_PX, snapPoint, type WallEntry } from "./geometry";
import { HeatmapLayer } from "./heatmap/HeatmapLayer";
import { HoverReadout } from "./heatmap/HoverReadout";
import { createHoverStore } from "./heatmap/hover";
import { Legend } from "./heatmap/Legend";
import { PropagationSettingsModal } from "./heatmap/PropagationSettingsModal";
import { MaterialsModal } from "./MaterialsModal";
import { OverlayFloor } from "./overlay/OverlayLayer";
import { similarityNode } from "./overlay/similarity";
import { PlanImportModal } from "./PlanImportModal";
import { PhotoLayer, type PinEntry } from "./photos/PhotoLayer";
import { PhotoPinDrawer } from "./photos/PhotoPinDrawer";
import { ScaleModal } from "./ScaleModal";
import { GuideLayer } from "./snap/SnapMarker";
import { useSnapGuides } from "./snap/useSnapGuides";
import { HoleLayer } from "./walls/HoleLayer";
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
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [settingScale, setSettingScale] = useState(false);
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
  const holes: HoleEntry[] = useMemo(
    () => Object.entries(floor.holes).map(([id, h]) => ({ ...h, id })),
    [floor.holes],
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

  // 図面の線へのスナップ（FR-4.4）。抽出した線はユーザーごとのローカル状態
  const [snapToGuides, setSnapToGuides] = useState(false);
  const [showGuides, setShowGuides] = useState(false);
  const [snapOpen, setSnapOpen] = useState(false);
  const snapGuides = useSnapGuides(session.projectId, floor.plan, snapToGuides);
  const wallTools = useWallTools({
    floorId: floor.id,
    walls,
    aps,
    holes,
    tool,
    metersPerUnit: mpu,
    planRotationDeg: plan?.rotationDeg ?? 0,
    materialIds,
    guides: snapGuides.guides,
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

  // 壁の自動抽出（FR-4.1〜4.3）
  const extraction = useExtraction(session.projectId, floor.plan);
  const [extractionOpen, setExtractionOpen] = useState(false);
  const candidateSelection = useCandidateSelection(extraction.candidates, extraction);
  // 現場写真のピン（FR-9.1〜9.3）
  const pins: PinEntry[] = useMemo(
    () => Object.entries(floor.photoPins).map(([id, p]) => ({ ...p, id })),
    [floor.photoPins],
  );
  const [openPinId, setOpenPinId] = useState<string>();
  const photoController: ToolController | undefined =
    tool === "photo"
      ? {
          cursor: "pointer",
          onDown: (e) => {
            const hit = pins.find(
              (p) => Math.hypot(p.position.x - e.p.x, p.position.y - e.p.y) <= 12 * e.px,
            );
            if (hit) {
              setOpenPinId(hit.id);
              return;
            }
            if (readOnly) return;
            let id = "";
            session.mutate((ydoc) => {
              id = addPhotoPin(ydoc, floor.id, { position: e.p, photos: [] });
            });
            if (id) setOpenPinId(id);
          },
        }
      : undefined;

  const candidateController: ToolController | undefined =
    extractionOpen && extraction.candidates.length > 0 ? candidateSelection.controller : undefined;

  // フロア間の位置合わせと重ね表示（FR-3.2、FR-3.3）。重ね表示の設定はユーザーごとのローカル状態
  const placements = useMemo(() => floorPlacements(doc?.floors ?? {}), [doc?.floors]);
  const here = placements[floor.id];
  const [overlays, setOverlays] = useState<Record<string, { on: boolean; opacity: number }>>({});
  const otherFloors = sortedFloors(doc?.floors ?? {}).filter((f) => f.id !== floor.id);

  const selectedWalls = wallTools.selection.filter((id) => floor.walls[id]);
  const selectedAps = wallTools.selection.filter((id) => floor.aps[id]);
  const selectedHoles = wallTools.selection.filter((id) => floor.holes[id]);
  const drawingTool = tool === "wall" || tool === "hole";
  const floorPeers = peers.filter((p) => p.floorId === floor.id);

  useHotkeys([
    ["Delete", () => !readOnly && wallTools.deleteSelection()],
    [
      "Backspace",
      () => (drawingTool ? wallTools.undoLastPoint() : !readOnly && wallTools.deleteSelection()),
    ],
    [
      "Escape",
      () =>
        drawingTool && wallTools.drawing.length > 0
          ? wallTools.cancelDrawing()
          : wallTools.setSelection([]),
    ],
    ["Enter", () => drawingTool && wallTools.finishDrawing()],
    ["V", () => setTool("select")],
    [
      "mod+A",
      () => {
        setTool("select");
        wallTools.setSelection([
          ...walls.map((w) => w.id),
          ...aps.map((a) => a.id),
          ...holes.map((h) => h.id),
        ]);
      },
    ],
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
          controller={candidateController ?? photoController ?? wallTools.controller}
          onPointerMove={hoverStore.set}
          // 校正、位置合わせ、トリミングは、図面の線へのスナップを有効にしたときだけスナップする
          snap={
            snapToGuides
              ? (p, px, previous) =>
                  snapPoint(p, {
                    walls,
                    guides: snapGuides.guides,
                    previous,
                    tolerance: SNAP_PX * px,
                  })
              : undefined
          }
          handlers={{
            onCalibrate: (a, b) => setCalibration({ a, b }),
            onAlign: (a, b) => {
              update({ alignment: { a, b } });
              setTool("select");
            },
            onCrop: (crop) => {
              update({ plan: { ...plan, crop } });
              setTool("select");
            },
          }}
        >
          {(px) => (
            <>
              {here &&
                otherFloors.map((other) => {
                  const o = overlays[other.id];
                  const there = placements[other.id];
                  if (!o?.on || !there) return null;
                  return (
                    <OverlayFloor
                      key={other.id}
                      projectId={session.projectId}
                      floor={other}
                      node={similarityNode(planToPlan(there, here))}
                      opacity={o.opacity}
                      materials={materials}
                      models={doc?.apModels ?? {}}
                      px={px}
                      currentRotationDeg={plan.rotationDeg}
                    />
                  );
                })}
              {showHeatmap && okResult && pixels && transform && (
                <HeatmapLayer
                  grid={okResult.grid}
                  pixels={pixels}
                  planRotationDeg={plan.rotationDeg}
                  metersPerUnit={transform.metersPerUnit}
                  opacity={0.6}
                />
              )}
              <HoleLayer
                holes={holes}
                selection={wallTools.selectionSet}
                peers={floorPeers}
                drafts={wallTools.drafts}
                px={px}
                planRotationDeg={plan.rotationDeg}
                showHandles={tool === "select" && !readOnly && wallTools.selection.length === 1}
              />
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
                  selectedAps.length === 0 &&
                  selectedHoles.length === 0
                }
              />
              <ApLayer
                aps={aps}
                models={doc?.apModels ?? {}}
                selection={wallTools.selectionSet}
                peers={floorPeers}
                move={wallTools.drafts.move}
                rotate={wallTools.drafts.rotate}
                showHandles={tool === "select" && !readOnly && wallTools.selection.length === 1}
                px={px}
                planRotationDeg={plan.rotationDeg}
              />
              <PhotoLayer
                pins={pins}
                px={px}
                planRotationDeg={plan.rotationDeg}
                activeId={openPinId}
              />
              {showGuides && snapGuides.guides && (
                <GuideLayer segments={snapGuides.guides.segments} px={px} />
              )}
              {extractionOpen && (
                <CandidateLayer
                  candidates={extraction.candidates}
                  picked={extraction.picked}
                  marquee={candidateSelection.marquee}
                  px={px}
                />
              )}
            </>
          )}
        </PlanCanvas>
        {extractionOpen && (
          // 道具のバー（最大 2 段）と重ならないよう、その下に置く
          <Box pos="absolute" top={100} right={8}>
            <ExtractionPanel
              floorId={floor.id}
              extraction={extraction}
              materials={materials}
              onClose={() => {
                setExtractionOpen(false);
                extraction.clear();
              }}
            />
          </Box>
        )}

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
                {
                  value: "photo",
                  label: <ToolLabel icon={<IconCamera size={14} />} text="写真" />,
                },
                ...(readOnly
                  ? []
                  : [
                      {
                        value: "wall",
                        label: <ToolLabel icon={<IconWall size={14} />} text="壁" />,
                      },
                      {
                        value: "hole",
                        label: <ToolLabel icon={<IconSquareDashed size={14} />} text="吹き抜け" />,
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
                    ]),
              ]}
            />
            {!readOnly && (
              <Popover
                position="bottom-start"
                shadow="md"
                withinPortal
                opened={adjustOpen}
                onChange={setAdjustOpen}
                transitionProps={{ duration: 0 }}
              >
                <Popover.Target>
                  <Button
                    onClick={() => setAdjustOpen((o) => !o)}
                    size="compact-xs"
                    variant="subtle"
                    leftSection={<IconAdjustments size={14} />}
                  >
                    図面の調整
                  </Button>
                </Popover.Target>
                <Popover.Dropdown>
                  <Stack gap="xs">
                    {/* 図面そのものを扱う道具。使う頻度が低いので、道具のバーを短くするためにここへ置く */}
                    <Group gap={4}>
                      {(
                        [
                          ["calibrate", "スケール校正", <IconRuler2 key="c" size={14} />],
                          ["align", "位置合わせ", <IconStack2 key="a" size={14} />],
                          ["crop", "トリミング", <IconCrop key="t" size={14} />],
                        ] as const
                      ).map(([value, label, icon]) => (
                        <Button
                          key={value}
                          size="compact-xs"
                          variant={tool === value ? "filled" : "light"}
                          leftSection={icon}
                          onClick={() => {
                            setTool(value);
                            setAdjustOpen(false);
                          }}
                        >
                          {label}
                        </Button>
                      ))}
                    </Group>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      leftSection={<IconRuler size={14} />}
                      onClick={() => {
                        setSettingScale(true);
                        setAdjustOpen(false);
                      }}
                    >
                      スケールを数値で設定
                    </Button>
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
            {!readOnly && (
              <Popover
                position="bottom-start"
                shadow="md"
                withinPortal
                opened={snapOpen}
                onChange={setSnapOpen}
                transitionProps={{ duration: 0 }}
              >
                <Popover.Target>
                  <Button
                    onClick={() => setSnapOpen((o) => !o)}
                    size="compact-xs"
                    variant={snapToGuides ? "light" : "subtle"}
                    leftSection={<IconMagnet size={14} />}
                    loading={snapGuides.loading}
                  >
                    スナップ
                  </Button>
                </Popover.Target>
                <Popover.Dropdown>
                  <Stack gap="xs" maw={260}>
                    <Switch
                      size="xs"
                      label="図面の線にスナップ"
                      description="図面から輪郭の線を抽出し、その線と交点にスナップします。Alt を押している間はスナップしません"
                      checked={snapToGuides}
                      onChange={(e) => setSnapToGuides(e.currentTarget.checked)}
                    />
                    <Switch
                      size="xs"
                      label="スナップする線を表示"
                      checked={showGuides}
                      disabled={!snapToGuides}
                      onChange={(e) => setShowGuides(e.currentTarget.checked)}
                    />
                    {snapGuides.guides && (
                      <Text size="xs" c="dimmed">
                        線 {snapGuides.guides.segments.length} 本、交点{" "}
                        {snapGuides.guides.intersections.length} 個
                      </Text>
                    )}
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
          {tool === "hole" && (
            <Group gap={4} mt={4}>
              <Text size="xs" c="dimmed">
                床のない範囲の頂点をクリックで置き、最初の点のクリック、ダブルクリック、Enter
                のいずれかで閉じます。3D ビューではこの範囲の床を抜いて表示します
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

        {showHeatmap && legend && okResult && okResult.radios.length > 0 && transform && (
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
                点を選び、その間の実際の距離を入力してください。縮尺がわかっていれば数値でも設定できます。
              </Text>
              {!readOnly && (
                <Button
                  size="compact-xs"
                  variant="light"
                  mt={6}
                  onClick={() => setSettingScale(true)}
                >
                  スケールを数値で設定
                </Button>
              )}
            </Alert>
          ) : (
            <Paper shadow="xs" p={6} withBorder>
              <Text size="xs">
                スケール：1 m ＝ 図面上 {(1 / mpu).toFixed(1)} 単位
                {plan.dpi ? `（${plan.dpi} dpi）` : ""}
                {/* PDF の図面座標はポイントなので、紙面上の縮尺に直せる */}
                {plan.dpi ? `、紙面上 1:${formatRatio(ratioOfPdfScale(mpu))}` : ""}
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
        {tool === "align" && (
          <Paper
            pos="absolute"
            bottom={8}
            left="50%"
            style={{ transform: "translateX(-50%)" }}
            shadow="sm"
            p="xs"
            withBorder
          >
            <Text size="xs">
              ほかのフロアと共通の地点（柱の角など）を 2 点、決まった順にクリックしてください
            </Text>
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
        <ScaleModal
          opened={settingScale}
          plan={plan}
          scale={floor.scale}
          onClose={() => setSettingScale(false)}
          onSubmit={(scale) => {
            update({ scale });
            setSettingScale(false);
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
          <Text fw={600} size="sm">
            フロアの重ね表示
          </Text>
          <Text size="xs" c={here && !here.aligned ? "orange" : "dimmed"}>
            {!here
              ? "スケールを校正すると位置合わせができます"
              : here.isReference
                ? "このフロアが位置合わせの基準です。ほかのフロアと同じ地点（柱の角など）を「位置合わせ」で 2 点指定してください。"
                : here.aligned
                  ? "基準フロアに位置を合わせました"
                  : "まだ位置を合わせていません。「位置合わせ」で、基準フロアと同じ地点を 2 点指定してください。"}
          </Text>
          {here?.distanceRatio !== undefined && Math.abs(here.distanceRatio - 1) > 0.05 && (
            <Alert color="orange" p={6}>
              <Text size="xs">
                基準点の間の距離が基準フロアと {Math.round(Math.abs(here.distanceRatio - 1) * 100)}%
                違います。どちらかのスケール校正が誤っている可能性があります。
              </Text>
            </Alert>
          )}
          {otherFloors.map((other) => {
            const o = overlays[other.id] ?? { on: false, opacity: 0.4 };
            const set = (patch: Partial<typeof o>) =>
              setOverlays((m) => ({ ...m, [other.id]: { ...o, ...patch } }));
            const there = placements[other.id];
            return (
              <Stack key={other.id} gap={2}>
                <Switch
                  size="xs"
                  label={`${other.name} を重ねる${there && !there.aligned ? "（未位置合わせ）" : ""}`}
                  checked={o.on}
                  disabled={!there || !here}
                  onChange={(e) => set({ on: e.currentTarget.checked })}
                />
                {o.on && (
                  <Slider
                    size="xs"
                    min={0.1}
                    max={0.9}
                    step={0.05}
                    value={o.opacity}
                    onChange={(v) => set({ opacity: v })}
                    label={(v) => `不透明度 ${Math.round(v * 100)}%`}
                    thumbLabel={`${other.name} の不透明度`}
                  />
                )}
              </Stack>
            );
          })}
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
          {!readOnly && !extractionOpen && (
            <Button
              size="compact-xs"
              variant="light"
              leftSection={<IconWand size={14} />}
              onClick={() => setExtractionOpen(true)}
            >
              図面から壁を自動抽出
            </Button>
          )}
          {(selectedWalls.length > 0 ||
            (selectedAps.length === 0 && selectedHoles.length === 0)) && (
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
          {selectedHoles.length > 0 && (
            <Stack gap={4}>
              <Text size="xs">
                吹き抜け {selectedHoles.length} 個を選択中
                {mpu !== undefined &&
                  `（${selectedHoles
                    .reduce((sum, id) => sum + polygonArea(floor.holes[id]!.points) * mpu * mpu, 0)
                    .toFixed(1)} m²）`}
              </Text>
              <Text size="xs" c="dimmed">
                ドラッグで移動、頂点のハンドルで形を変えられます。3D
                ビューではこの範囲の床を抜いて表示します
              </Text>
              {!readOnly && (
                <Button
                  size="compact-xs"
                  variant="light"
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={wallTools.deleteSelection}
                >
                  削除
                </Button>
              )}
            </Stack>
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
      <PhotoPinDrawer
        floorId={floor.id}
        pinId={openPinId}
        onClose={() => setOpenPinId(undefined)}
      />
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

function formatRatio(n: number): string {
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1);
}
