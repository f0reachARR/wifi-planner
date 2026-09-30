import {
  ActionIcon,
  Button,
  ColorInput,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { BAND_LABELS, BANDS, type Material } from "@wifi-planner/domain";
import { addMaterial, deleteMaterial, updateMaterial } from "@wifi-planner/domain/ops";
import { useState } from "react";
import { useSession, useSessionState } from "../collab/react";

/** 材質の管理（FR-4.7、FR-4.9）。減衰量は帯域ごとの dB */
export function MaterialsModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const session = useSession();
  const { doc } = useSessionState();
  const readOnly = session.readOnly;
  const materials = Object.entries(doc?.materials ?? {});
  const [deleting, setDeleting] = useState<string>();

  const update = (id: string, patch: Partial<Material>) =>
    session.mutate((ydoc) => updateMaterial(ydoc, id, patch));

  return (
    <Modal opened={opened} onClose={onClose} title="材質" size="xl">
      <Stack>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>色</Table.Th>
              <Table.Th>名前</Table.Th>
              {BANDS.map((b) => (
                <Table.Th key={b}>{BAND_LABELS[b]}（dB）</Table.Th>
              ))}
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {materials.map(([id, m]) => (
              <Table.Tr key={id}>
                <Table.Td w={130}>
                  <ColorInput
                    size="xs"
                    aria-label={`${m.name} の色`}
                    value={m.color}
                    format="hex"
                    disabled={readOnly}
                    onChangeEnd={(color) =>
                      /^#[0-9a-fA-F]{6}$/.test(color) && update(id, { color })
                    }
                  />
                </Table.Td>
                <Table.Td>
                  <TextInput
                    size="xs"
                    aria-label="名前"
                    defaultValue={m.name}
                    disabled={readOnly}
                    onBlur={(e) =>
                      e.currentTarget.value.trim() &&
                      update(id, { name: e.currentTarget.value.trim() })
                    }
                  />
                </Table.Td>
                {BANDS.map((b) => (
                  <Table.Td key={b} w={100}>
                    <NumberInput
                      size="xs"
                      aria-label={`${m.name} の ${BAND_LABELS[b]} の減衰量`}
                      value={m.lossDb[b]}
                      min={0}
                      max={100}
                      decimalScale={1}
                      disabled={readOnly}
                      onChange={(v) =>
                        typeof v === "number" &&
                        v >= 0 &&
                        update(id, { lossDb: { ...m.lossDb, [b]: v } })
                      }
                    />
                  </Table.Td>
                ))}
                <Table.Td w={40}>
                  {!readOnly && materials.length > 1 && (
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={`${m.name} を削除`}
                      onClick={() => setDeleting(id)}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {!readOnly && (
          <Group>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconPlus size={14} />}
              onClick={() =>
                session.mutate((ydoc) =>
                  addMaterial(ydoc, {
                    name: "新しい材質",
                    color: "#868e96",
                    lossDb: { "2.4": 5, "5": 7, "6": 8 },
                  }),
                )
              }
            >
              材質を追加
            </Button>
          </Group>
        )}
      </Stack>
      <DeleteMaterialModal
        materialId={deleting}
        materials={doc?.materials ?? {}}
        onClose={() => setDeleting(undefined)}
        onConfirm={(replacementId) => {
          if (deleting) session.mutate((ydoc) => deleteMaterial(ydoc, deleting, replacementId));
          setDeleting(undefined);
        }}
      />
    </Modal>
  );
}

function DeleteMaterialModal(props: {
  materialId: string | undefined;
  materials: Record<string, Material>;
  onClose: () => void;
  onConfirm: (replacementId: string) => void;
}) {
  const options = Object.entries(props.materials)
    .filter(([id]) => id !== props.materialId)
    .map(([id, m]) => ({ value: id, label: m.name }));
  const [replacement, setReplacement] = useState<string | null>(null);
  const name = props.materialId ? props.materials[props.materialId]?.name : "";
  return (
    <Modal opened={!!props.materialId} onClose={props.onClose} title={`「${name}」の削除`}>
      <Stack>
        <Text size="sm">この材質を使っている壁とドア、窓は、次の材質に付け替えます。</Text>
        <Select
          data={options}
          value={replacement}
          onChange={setReplacement}
          placeholder="付け替え先"
          aria-label="付け替え先"
        />
        <Group justify="flex-end">
          <Button
            color="red"
            disabled={!replacement}
            onClick={() => replacement && props.onConfirm(replacement)}
          >
            削除
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
