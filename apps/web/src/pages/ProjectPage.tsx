import { Anchor, AppShell, Center, Loader, Stack, Text, Title } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import type { Project } from "@wifi-planner/api-contract";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { keys, useMe, useProject } from "../api/hooks";
import { ProjectSessionProvider, useSession, useSessionState } from "../collab/react";
import { colorForUser } from "../collab/session";
import { EditorHeader } from "../editor/EditorHeader";
import { FloorPanel, sortedFloors } from "../editor/FloorPanel";

export function ProjectPage() {
  const { projectId = "" } = useParams();
  const { data: me } = useMe();
  const { data: project, error, isPending } = useProject(projectId);
  const qc = useQueryClient();

  if (isPending || !me) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }
  if (error || !project)
    return <Unavailable message={error?.message ?? "プロジェクトが見つかりません"} />;

  return (
    <ProjectSessionProvider
      projectId={project.id}
      user={{ id: me.id, name: me.username, color: colorForUser(me.id) }}
      readOnly={project.role === "viewer"}
      onAccessChanged={() => qc.invalidateQueries({ queryKey: keys.project(project.id) })}
    >
      <Editor project={project} />
    </ProjectSessionProvider>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <Center h="100vh">
      <Stack align="center">
        <Text c="red">{message}</Text>
        <Anchor component={Link} to="/">
          プロジェクトの一覧に戻る
        </Anchor>
      </Stack>
    </Center>
  );
}

function Editor({ project }: { project: Project }) {
  const session = useSession();
  const { doc, state, synced } = useSessionState();
  const [floorId, setFloorId] = useState<string>();
  const floors = sortedFloors(doc?.floors ?? {});
  const floor = floors.find((f) => f.id === floorId);

  // 選んでいたフロアが消えたら、一番下のフロアを選び直す
  useEffect(() => {
    if (!floor && floors.length > 0) setFloorId(floors[0]!.id);
  }, [floor, floors]);

  useEffect(() => session.setPresence({ floorId }), [session, floorId]);

  useEffect(() => {
    if (state === "denied") void session.clearLocalCopy();
  }, [state, session]);

  if (state === "denied") return <Unavailable message="このプロジェクトを開く権限がありません" />;

  return (
    <AppShell header={{ height: 48 }} navbar={{ width: 240, breakpoint: 0 }}>
      <AppShell.Header>
        <EditorHeader project={project} />
      </AppShell.Header>
      <AppShell.Navbar>
        <FloorPanel selectedId={floorId} onSelect={setFloorId} />
      </AppShell.Navbar>
      <AppShell.Main h="100vh">
        <Center h="calc(100vh - 48px)">
          {!doc && !synced ? (
            <Loader />
          ) : floor ? (
            <Stack align="center" gap="xs">
              <Title order={3}>{floor.name}</Title>
              <Text c="dimmed" size="sm">
                図面がまだありません
              </Text>
            </Stack>
          ) : (
            <Text c="dimmed">左の「追加」からフロアを作成してください</Text>
          )}
        </Center>
      </AppShell.Main>
    </AppShell>
  );
}
