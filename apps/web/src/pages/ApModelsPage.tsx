import { ActionIcon, Button, Container, Group, Menu, Table, Text, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconDots, IconPlus, IconTrash } from "@tabler/icons-react";
import type { ApModelEntry } from "@wifi-planner/api-contract";
import { ApModel, BAND_LABELS } from "@wifi-planner/domain";
import { useState } from "react";
import { useApModels, useDeleteApModel } from "../api/hooks";
import { ApModelEditor } from "../apmodels/ApModelEditor";
import { notifyError } from "../notify";

/** 全ユーザーで共有する AP モデルのライブラリ（FR-5.4） */
export function ApModelsPage() {
  const { data: models = [], isPending } = useApModels();
  const remove = useDeleteApModel();
  const [editing, setEditing] = useState<ApModelEntry | "new">();

  return (
    <Container size="lg">
      <Group justify="space-between" mb="md">
        <Title order={2}>AP モデル</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing("new")}>
          AP モデルを作成
        </Button>
      </Group>
      {!isPending && models.length === 0 ? (
        <Text c="dimmed">
          AP モデルがありません。製品ごとに作成すると、どのプロジェクトからも使えます。
        </Text>
      ) : (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>名前</Table.Th>
              <Table.Th>メーカー</Table.Th>
              <Table.Th>ラジオ</Table.Th>
              <Table.Th>作成者</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {models.map((m) => {
              const def = ApModel.safeParse(m.definition);
              if (!def.success) return null;
              return (
                <Table.Tr key={m.id} style={{ cursor: "pointer" }} onClick={() => setEditing(m)}>
                  <Table.Td fw={500}>{def.data.name}</Table.Td>
                  <Table.Td>{def.data.vendor}</Table.Td>
                  <Table.Td>
                    {def.data.radios
                      .map((r) => r.bands.map((b) => BAND_LABELS[b]).join("/"))
                      .join("、")}
                  </Table.Td>
                  <Table.Td>{m.createdBy.username}</Table.Td>
                  <Table.Td onClick={(e) => e.stopPropagation()}>
                    {m.canEdit && (
                      <Menu position="bottom-end">
                        <Menu.Target>
                          <ActionIcon variant="subtle" aria-label={`${def.data.name} の操作`}>
                            <IconDots size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item
                            color="red"
                            leftSection={<IconTrash size={14} />}
                            onClick={() =>
                              modals.openConfirmModal({
                                title: "AP モデルの削除",
                                children: (
                                  <Text size="sm">
                                    「{def.data.name}」をライブラリから削除します。配置済みの AP
                                    はプロジェクト内の写しを使うので、影響を受けません。
                                  </Text>
                                ),
                                labels: { confirm: "削除", cancel: "キャンセル" },
                                confirmProps: { color: "red" },
                                onConfirm: () => remove.mutate(m.id, { onError: notifyError }),
                              })
                            }
                          >
                            削除
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}
      <ApModelEditor entry={editing} onClose={() => setEditing(undefined)} />
    </Container>
  );
}
