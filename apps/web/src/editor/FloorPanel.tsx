import {
  ActionIcon,
  Button,
  Group,
  Menu,
  Modal,
  NavLink,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { modals } from "@mantine/modals";
import {
  IconArrowDown,
  IconArrowUp,
  IconDots,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { type Floor, slabMaterialOf } from "@wifi-planner/domain";
import { addFloor, deleteFloor, reorderFloors, updateFloor } from "@wifi-planner/domain/ops";
import { useEffect, useState } from "react";
import { useSession, useSessionState } from "../collab/react";

export type FloorEntry = Floor & { id: string };

/** 下の階から順に並べたフロア */
export function sortedFloors(floors: Record<string, Floor>): FloorEntry[] {
  return Object.entries(floors)
    .map(([id, f]) => ({ ...f, id }))
    .sort((a, b) => a.order - b.order);
}

/** フロアの一覧と追加、編集、並べ替え、削除（FR-3.1） */
export function FloorPanel(props: {
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const session = useSession();
  const { doc, peers } = useSessionState();
  const [editing, setEditing] = useState<FloorEntry>();
  const floors = sortedFloors(doc?.floors ?? {});
  const readOnly = session.readOnly;

  const add = () => {
    const top = floors.at(-1);
    let id = "";
    session.mutate((ydoc) => {
      id = addFloor(ydoc, {
        name: `${floors.length + 1}F`,
        elevationM: top ? top.elevationM + top.heightM : 0,
        heightM: 3,
      });
    });
    if (id) props.onSelect(id);
  };

  const move = (index: number, delta: number) => {
    const ids = floors.map((f) => f.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved!);
    session.mutate((ydoc) => reorderFloors(ydoc, ids));
  };

  const remove = (floor: FloorEntry) =>
    modals.openConfirmModal({
      title: "フロアの削除",
      children: <Text size="sm">「{floor.name}」と、その上の壁、AP、写真をすべて削除します。</Text>,
      labels: { confirm: "削除", cancel: "キャンセル" },
      confirmProps: { color: "red" },
      onConfirm: () => session.mutate((ydoc) => deleteFloor(ydoc, floor.id)),
    });

  return (
    <Stack gap="xs" p="xs">
      <Group justify="space-between">
        <Text fw={600} size="sm">
          フロア
        </Text>
        {!readOnly && (
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconPlus size={14} />}
            onClick={add}
          >
            追加
          </Button>
        )}
      </Group>
      {floors.length === 0 && (
        <Text size="xs" c="dimmed">
          フロアがありません
        </Text>
      )}
      {/* 建物と同じく上の階を上に並べる */}
      {floors
        .map((floor, index) => ({ floor, index }))
        .reverse()
        .map(({ floor, index }) => {
          const here = peers.filter((p) => p.floorId === floor.id);
          return (
            <Group key={floor.id} gap={0} wrap="nowrap">
              <NavLink
                component="button"
                aria-label={floor.name}
                aria-current={floor.id === props.selectedId ? "true" : undefined}
                active={floor.id === props.selectedId}
                label={floor.name}
                description={`床 ${floor.elevationM} m／階高 ${floor.heightM} m${here.length ? `／${here.map((p) => p.user.name).join("、")}` : ""}`}
                onClick={() => props.onSelect(floor.id)}
                style={{ flex: 1 }}
              />
              {!readOnly && (
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <ActionIcon variant="subtle" size="sm" aria-label={`${floor.name} の操作`}>
                      <IconDots size={14} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item
                      leftSection={<IconPencil size={14} />}
                      onClick={() => setEditing(floor)}
                    >
                      設定
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconArrowUp size={14} />}
                      disabled={index === floors.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      上へ
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconArrowDown size={14} />}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      下へ
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Item
                      color="red"
                      leftSection={<IconTrash size={14} />}
                      onClick={() => remove(floor)}
                    >
                      削除
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              )}
            </Group>
          );
        })}
      <FloorSettingsModal floor={editing} onClose={() => setEditing(undefined)} />
    </Stack>
  );
}

function FloorSettingsModal({
  floor,
  onClose,
}: {
  floor: FloorEntry | undefined;
  onClose: () => void;
}) {
  const session = useSession();
  const { doc } = useSessionState();
  const materials = doc?.materials ?? {};
  const form = useForm({
    initialValues: { name: "", elevationM: 0, heightM: 3, slabMaterialId: null as string | null },
    validate: {
      name: (v) => (v.trim() ? null : "名前を入力してください"),
      heightM: (v) => (v > 0 ? null : "0 より大きい値にしてください"),
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: 開いたときだけ初期値を入れ直す
  useEffect(() => {
    if (floor)
      form.setValues({
        name: floor.name,
        elevationM: floor.elevationM,
        heightM: floor.heightM,
        slabMaterialId: slabMaterialOf(materials, floor) ?? null,
      });
  }, [floor?.id]);

  return (
    <Modal opened={!!floor} onClose={onClose} title="フロアの設定">
      <form
        onSubmit={form.onSubmit((values) => {
          if (floor)
            session.mutate((ydoc) =>
              updateFloor(ydoc, floor.id, {
                ...values,
                name: values.name.trim(),
                slabMaterialId: values.slabMaterialId ?? undefined,
              }),
            );
          onClose();
        })}
      >
        <Stack>
          <TextInput label="名前" data-autofocus {...form.getInputProps("name")} />
          <NumberInput
            label="床面の標高"
            suffix=" m"
            decimalScale={2}
            {...form.getInputProps("elevationM")}
          />
          <NumberInput
            label="階高"
            suffix=" m"
            decimalScale={2}
            min={0.1}
            {...form.getInputProps("heightM")}
          />
          <Select
            label="床スラブの材質"
            description="下のフロアとの間の床の減衰に使います（吹き抜けの範囲は除く）。床を抜くには減衰 0 dB の材質を選んでください"
            placeholder="未設定（減衰 0 dB）"
            allowDeselect={false}
            data={Object.entries(materials).map(([id, m]) => ({ value: id, label: m.name }))}
            {...form.getInputProps("slabMaterialId")}
          />
          <Group justify="flex-end">
            <Button type="submit">保存</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
