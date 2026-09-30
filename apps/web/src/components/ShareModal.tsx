import { ActionIcon, Button, Group, Modal, Select, Stack, Table, Text } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import type { MemberRole, Project } from "@wifi-planner/api-contract";
import { useState } from "react";
import { useMe, useMembers, useRemoveMember, useSetMember, useUserSummaries } from "../api/hooks";
import { notifyError } from "../notify";

const ROLE_OPTIONS = [
  { value: "editor", label: "編集" },
  { value: "viewer", label: "閲覧" },
];

/** プロジェクトの共有相手と権限を設定する（FR-1.4） */
export function ShareModal({
  project,
  onClose,
}: {
  project: Project | undefined;
  onClose: () => void;
}) {
  return (
    <Modal
      opened={!!project}
      onClose={onClose}
      title={`「${project?.name ?? ""}」の共有`}
      size="lg"
    >
      {project && <ShareBody project={project} />}
    </Modal>
  );
}

function ShareBody({ project }: { project: Project }) {
  const { data: me } = useMe();
  const { data: members = [] } = useMembers(project.id);
  const { data: users = [] } = useUserSummaries();
  const setMember = useSetMember(project.id);
  const removeMember = useRemoveMember(project.id);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<MemberRole>("editor");

  const memberIds = new Set(members.map((m) => m.user.id));
  const candidates = users
    .filter((u) => u.id !== me?.id && u.id !== project.owner.id && !memberIds.has(u.id))
    .map((u) => ({ value: u.id, label: u.username }));

  return (
    <Stack>
      <Group align="flex-end">
        <Select
          label="ユーザー"
          placeholder="選択"
          searchable
          data={candidates}
          value={userId}
          onChange={setUserId}
          style={{ flex: 1 }}
          nothingFoundMessage="該当するユーザーがいません"
        />
        <Select
          label="権限"
          data={ROLE_OPTIONS}
          value={role}
          onChange={(v) => v && setRole(v as MemberRole)}
          allowDeselect={false}
          w={100}
        />
        <Button
          disabled={!userId}
          loading={setMember.isPending}
          onClick={() =>
            userId &&
            setMember.mutate(
              { userId, role },
              { onSuccess: () => setUserId(null), onError: notifyError },
            )
          }
        >
          追加
        </Button>
      </Group>

      <Table>
        <Table.Tbody>
          <Table.Tr>
            <Table.Td>{project.owner.username}</Table.Td>
            <Table.Td>
              <Text size="sm" c="dimmed">
                所有者
              </Text>
            </Table.Td>
            <Table.Td />
          </Table.Tr>
          {members.map((m) => (
            <Table.Tr key={m.user.id}>
              <Table.Td>{m.user.username}</Table.Td>
              <Table.Td>
                <Select
                  size="xs"
                  w={100}
                  data={ROLE_OPTIONS}
                  value={m.role}
                  allowDeselect={false}
                  onChange={(v) =>
                    v &&
                    setMember.mutate(
                      { userId: m.user.id, role: v as MemberRole },
                      { onError: notifyError },
                    )
                  }
                />
              </Table.Td>
              <Table.Td>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label="共有を解除"
                  onClick={() => removeMember.mutate(m.user.id, { onError: notifyError })}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
