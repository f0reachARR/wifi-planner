import { Alert, Box, Button, Group, Modal, Select, Stack, Switch, Text } from "@mantine/core";
import {
  type Floor,
  floorPlacements,
  planOffsetFromPoints,
  planTransform,
  type Vec2,
} from "@wifi-planner/domain";
import { updateFloor } from "@wifi-planner/domain/ops";
import { useMemo, useState } from "react";
import { Circle, Group as KonvaGroup, Text as KonvaText } from "react-konva";
import { useSession } from "../collab/react";
import { notifyDone } from "../notify";
import { PlanCanvas } from "./canvas/PlanCanvas";
import { type FloorEntry, sortedFloors } from "./FloorPanel";
import { SNAP_PX, snapPoint, type WallEntry } from "./geometry";
import { useSnapGuides } from "./snap/useSnapGuides";

type Pair = { a: Vec2; b: Vec2 };

/** 基準点間の実距離の食い違いがこれを超えたら、スケール校正の誤りを疑う */
const DISTANCE_TOLERANCE = 0.05;

/**
 * フロア間の位置合わせ（FR-3.2）。2 つのフロアの図面を並べ、それぞれで共通の地点を 2 点ずつ指定する。
 * 求めた変換だけを動かす側のフロアに書き、基準点は保存しない
 */
export function AlignFloorsModal(props: {
  opened: boolean;
  floors: Record<string, Floor>;
  /** 初めに動かす側として選ぶフロア */
  floorId: string;
  onClose: () => void;
}) {
  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title="フロアの位置合わせ"
      size="calc(100vw - 64px)"
    >
      {props.opened && <AlignBody {...props} />}
    </Modal>
  );
}

function AlignBody({ floors, floorId, onClose }: Parameters<typeof AlignFloorsModal>[0]) {
  const session = useSession();
  const placements = useMemo(() => floorPlacements(floors), [floors]);
  // 図面があり、スケールを校正したフロアだけが位置を合わせられる
  const candidates = sortedFloors(floors).filter((f) => f.plan && planTransform(f.plan, f.scale));
  const [ownId, setOwnId] = useState<string | undefined>(
    candidates.some((f) => f.id === floorId) ? floorId : candidates[0]?.id,
  );
  const [targetId, setTargetId] = useState(() => defaultTarget(candidates, placements, ownId));
  const [ownPts, setOwnPts] = useState<Pair>();
  const [targetPts, setTargetPts] = useState<Pair>();
  const [snap, setSnap] = useState(false);

  const own = candidates.find((f) => f.id === ownId);
  const target = candidates.find((f) => f.id === targetId && f.id !== ownId);
  const result =
    own && target && ownPts && targetPts
      ? planOffsetFromPoints({ ...own, ...ownPts }, { ...target, ...targetPts })
      : undefined;
  const mismatch = result && Math.abs(result.distanceRatio - 1);

  if (candidates.length < 2) {
    return (
      <Text size="sm">
        位置を合わせるには、図面を取り込んでスケールを校正したフロアが 2 つ以上必要です。
      </Text>
    );
  }

  const options = candidates.map((f) => ({ value: f.id, label: f.name }));
  const submit = () => {
    if (!own || !target || !result) return;
    session.mutate((ydoc) => {
      updateFloor(ydoc, own.id, {
        planOffset: {
          floorId: target.id,
          rotationDeg: result.rotationDeg,
          translation: result.translation,
        },
      });
      // 相手がこのフロアに合わせてあれば、同じ組の古い結果なので消す
      if (target.planOffset?.floorId === own.id) {
        updateFloor(ydoc, target.id, { planOffset: undefined });
      }
    });
    notifyDone(`${own.name} を ${target.name} に合わせました`);
    onClose();
  };

  return (
    <Stack>
      <Group align="flex-end">
        <Select
          label="動かすフロア"
          data={options}
          value={ownId ?? null}
          allowDeselect={false}
          onChange={(v) => {
            if (!v) return;
            setOwnId(v);
            setOwnPts(undefined);
            if (v === targetId) {
              setTargetId(defaultTarget(candidates, placements, v));
              setTargetPts(undefined);
            }
          }}
          w={180}
        />
        <Text size="sm" pb={8}>
          を
        </Text>
        <Select
          label="合わせる先のフロア"
          data={options.filter((o) => o.value !== ownId)}
          value={target?.id ?? null}
          allowDeselect={false}
          onChange={(v) => {
            if (!v) return;
            setTargetId(v);
            setTargetPts(undefined);
          }}
          w={180}
        />
        <Text size="sm" pb={8}>
          に合わせる
        </Text>
        <Switch
          ml="auto"
          pb={8}
          size="xs"
          label="壁と図面の線にスナップ"
          checked={snap}
          onChange={(e) => setSnap(e.currentTarget.checked)}
        />
      </Group>
      <Text size="xs" c="dimmed">
        両方の図面に写っている同じ地点（柱の角など）を、左右で同じ順に 2
        点ずつクリックしてください。2
        点は離れているほど正確に合います。もう一度クリックすると指定し直します。
      </Text>
      <Group grow align="stretch" wrap="nowrap">
        {own && <PointPicker floor={own} points={ownPts} onPick={setOwnPts} snap={snap} />}
        {target && (
          <PointPicker floor={target} points={targetPts} onPick={setTargetPts} snap={snap} />
        )}
      </Group>
      {target && !placements[target.id]?.aligned && (
        <Alert color="orange" p={6}>
          <Text size="xs">
            {target.name}{" "}
            はまだ基準フロアにつながっていません。合わせても、どちらかが基準フロアにつながるまでは、ほかのフロアとの位置関係は決まりません。
          </Text>
        </Alert>
      )}
      {mismatch !== undefined && mismatch > DISTANCE_TOLERANCE && (
        <Alert color="orange" p={6}>
          <Text size="xs">
            2 点の間の距離が {Math.round(mismatch * 100)}%
            違います。どちらかのスケール校正が誤っているか、違う地点を指定している可能性があります。
          </Text>
        </Alert>
      )}
      {own?.planOffset &&
        own.planOffset.floorId !== target?.id &&
        floors[own.planOffset.floorId] && (
          <Text size="xs" c="dimmed">
            {own.name} は今 {floors[own.planOffset.floorId]!.name}{" "}
            に合わせてあります。合わせると、その結果は置き換わります。
          </Text>
        )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          キャンセル
        </Button>
        <Button disabled={!result} onClick={submit}>
          合わせる
        </Button>
      </Group>
    </Stack>
  );
}

/** 合わせる先の既定。今の結果の相手、位置の決まった近いフロア、近いフロアの順に選ぶ */
function defaultTarget(
  candidates: readonly FloorEntry[],
  placements: ReturnType<typeof floorPlacements>,
  ownId: string | undefined,
): string | undefined {
  const own = candidates.find((f) => f.id === ownId);
  const others = candidates.filter((f) => f.id !== ownId);
  const current = others.find((f) => f.id === own?.planOffset?.floorId);
  if (current) return current.id;
  const byDistance = [...others].sort(
    (a, b) => Math.abs(a.order - (own?.order ?? 0)) - Math.abs(b.order - (own?.order ?? 0)),
  );
  return (byDistance.find((f) => placements[f.id]?.aligned) ?? byDistance[0])?.id;
}

function PointPicker(props: {
  floor: FloorEntry;
  points: Pair | undefined;
  onPick: (p: Pair) => void;
  snap: boolean;
}) {
  const { floor, points } = props;
  const session = useSession();
  const guides = useSnapGuides(session.projectId, floor.plan, props.snap);
  const walls: WallEntry[] = useMemo(
    () => Object.entries(floor.walls).map(([id, w]) => ({ ...w, id })),
    [floor.walls],
  );
  const rotation = floor.plan?.rotationDeg ?? 0;
  return (
    <Stack gap={4} miw={0}>
      <Text size="sm" fw={600}>
        {floor.name}
        <Text span size="xs" c={points ? "dimmed" : "orange"} fw={400} ml="xs">
          {points ? "2 点を指定済み" : "2 点をクリックしてください"}
        </Text>
      </Text>
      <Box
        h="60vh"
        aria-label={`${floor.name} の図面`}
        style={{ border: "1px solid var(--mantine-color-default-border)" }}
      >
        <PlanCanvas
          floor={floor}
          tool="align"
          shareCursor={false}
          snap={
            props.snap
              ? (p, px) => snapPoint(p, { walls, guides: guides.guides, tolerance: SNAP_PX * px })
              : undefined
          }
          handlers={{ onAlign: (a, b) => props.onPick({ a, b }) }}
        >
          {(px) =>
            points &&
            (["a", "b"] as const).map((k) => (
              <KonvaGroup
                key={k}
                x={points[k].x}
                y={points[k].y}
                scaleX={px}
                scaleY={px}
                rotation={-rotation}
                listening={false}
              >
                <Circle radius={6} stroke="#9c36b5" strokeWidth={2} />
                <KonvaText text={k === "a" ? "1" : "2"} x={8} y={-6} fontSize={12} fill="#9c36b5" />
              </KonvaGroup>
            ))
          }
        </PlanCanvas>
      </Box>
    </Stack>
  );
}
