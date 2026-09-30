import {
  ActionIcon,
  Badge,
  Button,
  Container,
  Group,
  Menu,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import {
  IconCopy,
  IconDoorExit,
  IconDots,
  IconPencil,
  IconPlus,
  IconShare,
  IconTrash,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import type { Project } from "@wifi-planner/api-contract";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  keys,
  useCreateProject,
  useDeleteProject,
  useDuplicateProject,
  useMe,
  useProjects,
  useRemoveMember,
  useRenameProject,
} from "../api/hooks";
import { NameModal } from "../components/NameModal";
import { ShareModal } from "../components/ShareModal";
import { notifyDone, notifyError } from "../notify";

const ROLE_LABELS = { owner: "所有者", editor: "編集", viewer: "閲覧" } as const;

type Dialog =
  | { kind: "create" }
  | { kind: "rename"; project: Project }
  | { kind: "duplicate"; project: Project }
  | undefined;

export function ProjectsPage() {
  const { data: projects = [], isPending } = useProjects();
  const navigate = useNavigate();
  const create = useCreateProject();
  const rename = useRenameProject();
  const duplicate = useDuplicateProject();
  const [dialog, setDialog] = useState<Dialog>();
  const [sharing, setSharing] = useState<Project>();

  const submit = (name: string) => {
    const close = () => setDialog(undefined);
    if (dialog?.kind === "create") {
      create.mutate(name, {
        onSuccess: (p) => navigate(`/projects/${p.id}`),
        onError: notifyError,
      });
    } else if (dialog?.kind === "rename") {
      rename.mutate({ id: dialog.project.id, name }, { onSuccess: close, onError: notifyError });
    } else if (dialog?.kind === "duplicate") {
      duplicate.mutate(
        { id: dialog.project.id, name },
        { onSuccess: () => (close(), notifyDone("複製しました")), onError: notifyError },
      );
    }
  };

  return (
    <Container size="lg">
      <Group justify="space-between" mb="md">
        <Title order={2}>プロジェクト</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setDialog({ kind: "create" })}>
          新規作成
        </Button>
      </Group>

      {!isPending && projects.length === 0 ? (
        <Text c="dimmed">プロジェクトがありません。「新規作成」から作成してください。</Text>
      ) : (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>名前</Table.Th>
              <Table.Th>所有者</Table.Th>
              <Table.Th>権限</Table.Th>
              <Table.Th>更新日時</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {projects.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>
                  <Text component={Link} to={`/projects/${p.id}`} fw={500} c="blue">
                    {p.name}
                  </Text>
                </Table.Td>
                <Table.Td>{p.owner.username}</Table.Td>
                <Table.Td>
                  <Badge variant="light" color={p.role === "viewer" ? "gray" : "blue"}>
                    {ROLE_LABELS[p.role]}
                  </Badge>
                </Table.Td>
                <Table.Td>{new Date(p.updatedAt).toLocaleString("ja-JP")}</Table.Td>
                <Table.Td>
                  <ProjectMenu
                    project={p}
                    onRename={() => setDialog({ kind: "rename", project: p })}
                    onDuplicate={() => setDialog({ kind: "duplicate", project: p })}
                    onShare={() => setSharing(p)}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <NameModal
        opened={!!dialog}
        title={
          dialog?.kind === "create"
            ? "プロジェクトの作成"
            : dialog?.kind === "rename"
              ? "名前の変更"
              : "プロジェクトの複製"
        }
        initialName={
          dialog?.kind === "rename"
            ? dialog.project.name
            : dialog?.kind === "duplicate"
              ? `${dialog.project.name}（コピー）`
              : ""
        }
        submitLabel={
          dialog?.kind === "create" ? "作成" : dialog?.kind === "rename" ? "変更" : "複製"
        }
        loading={create.isPending || rename.isPending || duplicate.isPending}
        onClose={() => setDialog(undefined)}
        onSubmit={submit}
      />
      <ShareModal project={sharing} onClose={() => setSharing(undefined)} />
    </Container>
  );
}

function ProjectMenu(props: {
  project: Project;
  onRename: () => void;
  onDuplicate: () => void;
  onShare: () => void;
}) {
  const { project } = props;
  const { data: me } = useMe();
  const remove = useDeleteProject();
  const leave = useRemoveMember(project.id);
  const qc = useQueryClient();

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: "プロジェクトの削除",
      children: (
        <Text size="sm">
          「{project.name}」を削除します。共有しているユーザーも開けなくなります。
        </Text>
      ),
      labels: { confirm: "削除", cancel: "キャンセル" },
      confirmProps: { color: "red" },
      onConfirm: () => remove.mutate(project.id, { onError: notifyError }),
    });

  const confirmLeave = () =>
    modals.openConfirmModal({
      title: "共有から抜ける",
      children: <Text size="sm">「{project.name}」の共有から抜けます。</Text>,
      labels: { confirm: "抜ける", cancel: "キャンセル" },
      onConfirm: () =>
        me &&
        leave.mutate(me.id, {
          onSuccess: () => qc.invalidateQueries({ queryKey: keys.projects }),
          onError: notifyError,
        }),
    });

  return (
    <Menu position="bottom-end">
      <Menu.Target>
        <ActionIcon variant="subtle" aria-label="操作">
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {project.role !== "viewer" && (
          <Menu.Item leftSection={<IconPencil size={14} />} onClick={props.onRename}>
            名前を変更
          </Menu.Item>
        )}
        <Menu.Item leftSection={<IconCopy size={14} />} onClick={props.onDuplicate}>
          複製
        </Menu.Item>
        {project.role === "owner" ? (
          <>
            <Menu.Item leftSection={<IconShare size={14} />} onClick={props.onShare}>
              共有
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={confirmDelete}>
              削除
            </Menu.Item>
          </>
        ) : (
          <>
            <Menu.Divider />
            <Menu.Item leftSection={<IconDoorExit size={14} />} onClick={confirmLeave}>
              共有から抜ける
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
