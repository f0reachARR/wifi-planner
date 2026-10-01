import { Anchor, AppShell, Box, Center, Loader, Stack, Text } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import type { Project } from "@wifi-planner/api-contract";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { keys, useMe, useProject } from "../api/hooks";
import { ProjectSessionProvider, useSession, useSessionState } from "../collab/react";
import { colorForUser } from "../collab/session";
import { EditorHeader, type EditorView } from "../editor/EditorHeader";
import { FloorPanel, sortedFloors } from "../editor/FloorPanel";
import { type ApPlacementDefaults, FloorView, INITIAL_AP_PLACEMENT } from "../editor/FloorView";
import { View3D } from "../editor/view3d/View3D";

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
  const [view, setView] = useState<EditorView>("2d");
  const [apPlacement, setApPlacement] = useState<ApPlacementDefaults>(INITIAL_AP_PLACEMENT);
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
        <EditorHeader project={project} view={view} onViewChange={setView} />
      </AppShell.Header>
      <AppShell.Navbar>
        <FloorPanel selectedId={floorId} onSelect={setFloorId} />
      </AppShell.Navbar>
      <AppShell.Main h="100vh">
        <Box h="calc(100vh - 48px)">
          {!doc && !synced ? (
            <Center h="100%">
              <Loader />
            </Center>
          ) : view === "3d" ? (
            <View3D />
          ) : floor ? (
            <FloorView
              key={floor.id}
              floor={floor}
              apPlacement={apPlacement}
              onApPlacementChange={(patch) => setApPlacement((p) => ({ ...p, ...patch }))}
            />
          ) : (
            <Center h="100%">
              <Text c="dimmed">左の「追加」からフロアを作成してください</Text>
            </Center>
          )}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
