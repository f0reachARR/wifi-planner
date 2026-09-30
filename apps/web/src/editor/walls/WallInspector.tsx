import {
  ActionIcon,
  Button,
  Divider,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { IconArrowMerge, IconSelectAll, IconTrash } from "@tabler/icons-react";
import { type Material, type OpeningKind, polylineLength } from "@wifi-planner/domain";
import { mergeWallsById, setWallsMaterial, updateWall } from "@wifi-planner/domain/ops";
import { useSession } from "../../collab/react";
import { notifyError } from "../../notify";
import type { WallEntry } from "../geometry";

const KIND_OPTIONS = [
  { value: "door", label: "ドア" },
  { value: "window", label: "窓" },
  { value: "other", label: "その他" },
];

/** 選んだ壁の属性（FR-4.5、FR-4.6、FR-4.8） */
export function WallInspector(props: {
  floorId: string;
  walls: WallEntry[];
  materials: Record<string, Material>;
  selection: string[];
  setSelection: (ids: string[]) => void;
  onDelete: () => void;
  metersPerUnit: number | undefined;
}) {
  const { floorId, walls, materials, selection, metersPerUnit: mpu } = props;
  const session = useSession();
  const readOnly = session.readOnly;
  const selected = walls.filter((w) => selection.includes(w.id));
  const materialOptions = Object.entries(materials).map(([id, m]) => ({
    value: id,
    label: m.name,
  }));
  const unit = mpu ? "m" : "単位";
  const toDisplay = (v: number) => (mpu ? v * mpu : v);
  const fromDisplay = (v: number) => (mpu ? v / mpu : v);

  const selectSameMaterial = () => {
    const ids = new Set(selected.map((w) => w.materialId));
    props.setSelection(walls.filter((w) => ids.has(w.materialId)).map((w) => w.id));
  };

  if (selected.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        壁をクリックするか、ドラッグで囲んで選んでください。Shift
        を押しながらクリックすると選択に加えます。
      </Text>
    );
  }

  const materialIds = new Set(selected.map((w) => w.materialId));
  const commonMaterial = materialIds.size === 1 ? [...materialIds][0]! : null;
  const single = selected.length === 1 ? selected[0]! : undefined;

  return (
    <Stack gap="sm">
      <Text size="sm" fw={600}>
        {selected.length} 本の壁を選択中
      </Text>
      <Select
        label="材質"
        placeholder={commonMaterial ? undefined : "（複数の材質）"}
        data={materialOptions}
        value={commonMaterial}
        disabled={readOnly}
        allowDeselect={false}
        onChange={(v) =>
          v && session.mutate((ydoc) => setWallsMaterial(ydoc, floorId, selection, v))
        }
      />
      <Group gap="xs">
        <Button
          size="compact-xs"
          variant="light"
          leftSection={<IconSelectAll size={14} />}
          onClick={selectSameMaterial}
        >
          同じ材質を選択
        </Button>
        {!readOnly && selected.length === 2 && (
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconArrowMerge size={14} />}
            onClick={() => {
              let id: string | undefined;
              // 端点が画面上で重なって見える程度のずれは同じ点とみなす
              const tolerance = mpu ? 0.01 / mpu : 0.5;
              session.mutate((ydoc) => {
                id = mergeWallsById(ydoc, floorId, selected[0]!.id, selected[1]!.id, tolerance);
              });
              if (id) props.setSelection([id]);
              else notifyError(new Error("端点を共有し、材質が同じ 2 本だけを結合できます"));
            }}
          >
            結合
          </Button>
        )}
        {!readOnly && (
          <Button
            size="compact-xs"
            variant="light"
            color="red"
            leftSection={<IconTrash size={14} />}
            onClick={props.onDelete}
          >
            削除
          </Button>
        )}
      </Group>

      {single && (
        <>
          <Divider />
          <Text size="xs">
            長さ {toDisplay(polylineLength(single.points)).toFixed(2)} {unit}／頂点{" "}
            {single.points.length}
          </Text>
          <Text size="sm" fw={600}>
            ドアと窓
          </Text>
          {single.openings.length === 0 && (
            <Text size="xs" c="dimmed">
              「ドア・窓」の道具で壁をクリックすると追加できます。
            </Text>
          )}
          {single.openings.map((o) => {
            const setOpening = (patch: Partial<typeof o>, coalesce = false) =>
              session.mutate(
                (ydoc) =>
                  updateWall(ydoc, floorId, single.id, {
                    openings: single.openings.map((x) => (x.id === o.id ? { ...x, ...patch } : x)),
                  }),
                { coalesce },
              );
            const total = polylineLength(single.points);
            return (
              <Stack
                key={o.id}
                gap={4}
                p={6}
                style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 4 }}
              >
                <Group gap={4} wrap="nowrap">
                  <Select
                    size="xs"
                    aria-label="種類"
                    data={KIND_OPTIONS}
                    value={o.kind}
                    disabled={readOnly}
                    allowDeselect={false}
                    onChange={(v) => v && setOpening({ kind: v as OpeningKind })}
                    w={80}
                  />
                  <Select
                    size="xs"
                    aria-label="開口部の材質"
                    data={materialOptions}
                    value={o.materialId}
                    disabled={readOnly}
                    allowDeselect={false}
                    onChange={(v) => v && setOpening({ materialId: v })}
                    style={{ flex: 1 }}
                  />
                  {!readOnly && (
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="red"
                      aria-label="開口部を削除"
                      onClick={() =>
                        session.mutate((ydoc) =>
                          updateWall(ydoc, floorId, single.id, {
                            openings: single.openings.filter((x) => x.id !== o.id),
                          }),
                        )
                      }
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  )}
                </Group>
                <Group gap={4} grow>
                  <NumberInput
                    size="xs"
                    label={`始点（${unit}）`}
                    decimalScale={2}
                    value={Number(toDisplay(o.start).toFixed(3))}
                    disabled={readOnly}
                    onChange={(v) => {
                      const start = fromDisplay(Number(v));
                      if (start >= 0 && start < o.end) setOpening({ start }, true);
                    }}
                  />
                  <NumberInput
                    size="xs"
                    label={`終点（${unit}）`}
                    decimalScale={2}
                    value={Number(toDisplay(o.end).toFixed(3))}
                    disabled={readOnly}
                    onChange={(v) => {
                      const end = fromDisplay(Number(v));
                      if (end > o.start && end <= total) setOpening({ end }, true);
                    }}
                  />
                </Group>
              </Stack>
            );
          })}
        </>
      )}
    </Stack>
  );
}
