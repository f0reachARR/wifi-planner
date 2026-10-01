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
import { IconArrowBackUp, IconArrowMerge, IconSelectAll, IconTrash } from "@tabler/icons-react";
import {
  type Material,
  type OpeningKind,
  openingHeightRange,
  polylineLength,
  wallHeightRange,
} from "@wifi-planner/domain";
import {
  mergeWallsById,
  setWallsHeight,
  setWallsMaterial,
  updateWall,
} from "@wifi-planner/domain/ops";
import { useSession } from "../../collab/react";
import { notifyError } from "../../notify";
import type { WallEntry } from "../geometry";

const KIND_OPTIONS = [
  { value: "door", label: "ドア" },
  { value: "window", label: "窓" },
  { value: "other", label: "その他" },
];

type HeightKey = "bottomM" | "topM";

/** 高さの入力欄の値。選んだ要素で値がそろっていなければ mixed、どれも既定なら undefined */
function commonHeight(items: readonly Partial<Record<HeightKey, number>>[], key: HeightKey) {
  const values = new Set(items.map((x) => x[key]));
  return values.size === 1 ? { value: [...values][0] } : { mixed: true as const };
}

/** 選んだ壁の属性（FR-4.5、FR-4.6、FR-4.8、FR-4.10） */
export function WallInspector(props: {
  floorId: string;
  /** 階高。高さを指定していない壁の上端になる */
  floorHeightM: number;
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
  const heightM = props.floorHeightM;

  /** 選んだ壁すべてで下端が上端より下になるときだけ書く */
  const setHeight = (key: HeightKey, value: number) => {
    const valid = selected.every((w) => {
      const r = wallHeightRange({ ...w, [key]: value }, heightM);
      return r.bottom >= 0 && r.top > r.bottom;
    });
    if (valid)
      session.mutate((ydoc) => setWallsHeight(ydoc, floorId, selection, { [key]: value }), {
        coalesce: true,
      });
  };
  const heightField = (key: HeightKey, label: string, fallback: number) => {
    const common = commonHeight(selected, key);
    return (
      <NumberInput
        size="xs"
        label={label}
        min={0}
        step={0.1}
        decimalScale={2}
        value={"value" in common && common.value !== undefined ? common.value : ""}
        placeholder={"mixed" in common ? "混在" : `既定 ${fallback}`}
        disabled={readOnly}
        onChange={(v) => v !== "" && setHeight(key, Number(v))}
      />
    );
  };
  const anyHeight = selected.some((w) => w.bottomM !== undefined || w.topM !== undefined);

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
      <Group gap={4} grow align="flex-end">
        {heightField("bottomM", "下端（床から m）", 0)}
        {heightField("topM", "上端（床から m）", heightM)}
      </Group>
      {!readOnly && anyHeight && (
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<IconArrowBackUp size={14} />}
          onClick={() =>
            session.mutate((ydoc) =>
              setWallsHeight(ydoc, floorId, selection, { bottomM: undefined, topM: undefined }),
            )
          }
        >
          高さを床から天井までに戻す
        </Button>
      )}
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
              else notifyError(new Error("端点を共有し、材質と高さが同じ 2 本だけを結合できます"));
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
            const wallRange = wallHeightRange(single, heightM);
            /** 開口部の高さ。壁の範囲で切り取ったあとに空にならないときだけ書く */
            const setOpeningHeight = (key: HeightKey, value: number) => {
              const r = openingHeightRange({ ...o, [key]: value }, wallRange);
              if (value >= 0 && r.top > r.bottom) setOpening({ [key]: value }, true);
            };
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
                <Group gap={4} grow>
                  {(
                    [
                      ["bottomM", "下端（m）", wallRange.bottom],
                      ["topM", "上端（m）", wallRange.top],
                    ] as const
                  ).map(([key, label, fallback]) => (
                    <NumberInput
                      key={key}
                      size="xs"
                      label={label}
                      min={0}
                      step={0.1}
                      decimalScale={2}
                      value={o[key] ?? ""}
                      placeholder={`壁と同じ ${fallback}`}
                      disabled={readOnly}
                      onChange={(v) => v !== "" && setOpeningHeight(key, Number(v))}
                    />
                  ))}
                </Group>
              </Stack>
            );
          })}
        </>
      )}
    </Stack>
  );
}
