import {
  Button,
  CloseButton,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import type { ExtractionParams } from "@wifi-planner/api-contract";
import type { Material } from "@wifi-planner/domain";
import { addWalls } from "@wifi-planner/domain/ops";
import { useState } from "react";
import { useSession } from "../../collab/react";
import type { useExtraction } from "./useExtraction";

/** 自動抽出の感度の調整と、候補の採用と却下（FR-4.2、FR-4.3） */
export function ExtractionPanel(props: {
  floorId: string;
  extraction: ReturnType<typeof useExtraction>;
  materials: Record<string, Material>;
  onClose: () => void;
}) {
  const session = useSession();
  const x = props.extraction;
  const [method, setMethod] = useState<"trace" | "hough">("trace");
  const [contour, setContour] = useState(false);
  const [autoThreshold, setAutoThreshold] = useState(true);
  const [threshold, setThreshold] = useState(128);
  const [minThicknessPx, setMinThickness] = useState(5);
  const [minLineLengthPx, setMinLength] = useState(40);
  const [joinGapPx, setJoinGap] = useState(30);
  const [mergeParallel, setMergeParallel] = useState(false);
  const [parallelDistancePx, setParallelDistance] = useState(20);
  const [materialId, setMaterialId] = useState<string | null>(
    props.materials.concrete ? "concrete" : (Object.keys(props.materials)[0] ?? null),
  );

  const params: Partial<ExtractionParams> = {
    method,
    preprocess: contour ? "contour" : "skeleton",
    threshold: autoThreshold ? undefined : threshold,
    minThicknessPx,
    minLineLengthPx,
    joinGapPx,
    mergeParallel,
    parallelDistancePx,
  };

  const adopt = (ids: ReadonlySet<string>) => {
    if (!materialId || ids.size === 0) return;
    const walls = x.candidates
      .filter((c) => ids.has(c.id))
      .map((c) => ({ points: c.points, materialId, openings: [] }));
    // 採用した候補はまとめて 1 回の操作にし、一度の undo で戻せるようにする
    session.mutate((ydoc) => addWalls(ydoc, props.floorId, walls));
    x.remove(ids);
  };

  const num = (f: (v: number) => void) => (v: number | string) => typeof v === "number" && f(v);

  return (
    <Paper shadow="md" p="sm" withBorder w={300}>
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={600} size="sm">
            壁の自動抽出
          </Text>
          <CloseButton aria-label="自動抽出を閉じる" onClick={props.onClose} />
        </Group>
        <SegmentedControl
          size="xs"
          value={method}
          onChange={(v) => setMethod(v as "trace" | "hough")}
          data={[
            { value: "trace", label: "中心線をたどる" },
            { value: "hough", label: "直線を探す" },
          ]}
        />
        <Switch
          size="xs"
          label="輪郭を抽出してから検出する"
          description="壁を 2 本の細い線で描いた図面向け。壁の中心線ではなく両側の線が候補になります"
          checked={contour}
          onChange={(e) => setContour(e.currentTarget.checked)}
        />
        <Switch
          size="xs"
          label="二値化の閾値を自動で決める"
          checked={autoThreshold}
          onChange={(e) => setAutoThreshold(e.currentTarget.checked)}
        />
        {!autoThreshold && (
          <NumberInput
            size="xs"
            label="二値化の閾値（0〜255、小さいほど濃い線だけ）"
            min={0}
            max={255}
            value={threshold}
            onChange={num(setThreshold)}
          />
        )}
        <Group grow gap="xs">
          {!contour && (
            <NumberInput
              size="xs"
              label="最小の壁の厚さ（px）"
              min={1}
              max={50}
              value={minThicknessPx}
              onChange={num(setMinThickness)}
            />
          )}
          <NumberInput
            size="xs"
            label="最小の長さ（px）"
            min={1}
            max={2000}
            value={minLineLengthPx}
            onChange={num(setMinLength)}
          />
        </Group>
        {method === "hough" && (
          <>
            <NumberInput
              size="xs"
              label="線分をつなぐ隙間（px）"
              min={0}
              max={500}
              value={joinGapPx}
              onChange={num(setJoinGap)}
            />
            <Switch
              size="xs"
              label="近くに並ぶ平行な線分をまとめる"
              description="壁の両側の線を、その間の中心線 1 本にします"
              checked={mergeParallel}
              onChange={(e) => setMergeParallel(e.currentTarget.checked)}
            />
            {mergeParallel && (
              <NumberInput
                size="xs"
                label="まとめる線どうしの最大の間隔（px、壁の厚さより少し大きく）"
                min={1}
                max={200}
                value={parallelDistancePx}
                onChange={num(setParallelDistance)}
              />
            )}
          </>
        )}
        <Text size="xs" c="dimmed">
          {contour
            ? "最小の長さの 2 倍より短い輪郭（文字、記号）は消えます。"
            : "最小の壁の厚さより細い線（寸法線、文字、ハッチング）は消えます。"}
          トリミングしていれば、その範囲だけを処理します。
        </Text>
        <Button size="xs" onClick={() => x.run(params)} loading={x.running}>
          抽出する
        </Button>

        {x.candidates.length > 0 && (
          <>
            <Text size="xs" aria-live="polite">
              候補 {x.candidates.length} 本（選択中 {x.picked.size} 本）
              {x.elapsedMs !== undefined && `、${(x.elapsedMs / 1000).toFixed(1)} 秒`}
              。候補をクリックすると選択を切り替えます。
            </Text>
            <Group gap={4}>
              <Button size="compact-xs" variant="subtle" onClick={x.pickAll}>
                すべて選ぶ
              </Button>
              <Button size="compact-xs" variant="subtle" onClick={x.pickNone}>
                選択を外す
              </Button>
            </Group>
            <Select
              size="xs"
              label="採用する壁の材質"
              data={Object.entries(props.materials).map(([id, m]) => ({
                value: id,
                label: m.name,
              }))}
              value={materialId}
              onChange={setMaterialId}
              allowDeselect={false}
            />
            <Group gap={4} grow>
              <Button size="xs" onClick={() => adopt(x.picked)} disabled={x.picked.size === 0}>
                選んだ候補を採用
              </Button>
              <Button
                size="xs"
                variant="light"
                onClick={() => adopt(new Set(x.candidates.map((c) => c.id)))}
              >
                すべて採用
              </Button>
            </Group>
            <Group gap={4} grow>
              <Button
                size="xs"
                variant="light"
                color="gray"
                onClick={() => x.remove(x.picked)}
                disabled={x.picked.size === 0}
              >
                選んだ候補を却下
              </Button>
              <Button size="xs" variant="light" color="gray" onClick={x.clear}>
                すべて却下
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}
