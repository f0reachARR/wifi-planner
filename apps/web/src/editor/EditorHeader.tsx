import { ActionIcon, Avatar, Badge, Group, SegmentedControl, Text, Tooltip } from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import { IconArrowBackUp, IconArrowForwardUp, IconChevronLeft } from "@tabler/icons-react";
import type { Project } from "@wifi-planner/api-contract";
import { Link } from "react-router";
import { useSession, useSessionState } from "../collab/react";
import type { ConnectionState } from "../collab/session";

const STATE_LABELS: Record<ConnectionState, { label: string; color: string }> = {
  connecting: { label: "接続中", color: "yellow" },
  connected: { label: "同期済み", color: "green" },
  offline: { label: "オフライン", color: "gray" },
  denied: { label: "権限なし", color: "red" },
};

export type EditorView = "2d" | "3d";

export function EditorHeader(props: {
  project: Project;
  view: EditorView;
  onViewChange: (v: EditorView) => void;
}) {
  const { project } = props;
  const session = useSession();
  const { state, canUndo, canRedo, peers } = useSessionState();
  const readOnly = session.readOnly;

  useHotkeys(
    readOnly
      ? []
      : [
          ["mod+Z", session.undo],
          ["mod+shift+Z", session.redo],
          ["mod+Y", session.redo],
        ],
  );

  const status = STATE_LABELS[state];
  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <Group gap="xs" wrap="nowrap">
        <ActionIcon component={Link} to="/" variant="subtle" aria-label="プロジェクトの一覧に戻る">
          <IconChevronLeft size={18} />
        </ActionIcon>
        <Text fw={600} truncate>
          {project.name}
        </Text>
        <SegmentedControl
          size="xs"
          aria-label="表示の切り替え"
          value={props.view}
          onChange={(v) => props.onViewChange(v as EditorView)}
          data={[
            { value: "2d", label: "2D（編集）" },
            { value: "3d", label: "3D" },
          ]}
        />
        {readOnly && (
          <Badge color="gray" variant="light">
            閲覧のみ
          </Badge>
        )}
      </Group>
      <Group gap="sm" wrap="nowrap">
        {!readOnly && (
          <Group gap={4}>
            <Tooltip label="元に戻す（Ctrl+Z）">
              <ActionIcon
                variant="subtle"
                disabled={!canUndo}
                onClick={session.undo}
                aria-label="元に戻す"
              >
                <IconArrowBackUp size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="やり直す（Ctrl+Shift+Z）">
              <ActionIcon
                variant="subtle"
                disabled={!canRedo}
                onClick={session.redo}
                aria-label="やり直す"
              >
                <IconArrowForwardUp size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
        <Avatar.Group>
          {peers.map((p) => (
            <Tooltip key={p.clientId} label={p.user.name}>
              <Avatar
                size="sm"
                color={p.user.color}
                variant="filled"
                aria-label={`${p.user.name} が参加中`}
              >
                {p.user.name.slice(0, 2)}
              </Avatar>
            </Tooltip>
          ))}
        </Avatar.Group>
        <Badge color={status.color} variant="dot" aria-label="接続の状態">
          {status.label}
        </Badge>
      </Group>
    </Group>
  );
}
