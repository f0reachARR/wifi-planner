import { Anchor, Center, Loader, Stack, Text, Title } from "@mantine/core";
import { Link, useParams } from "react-router";
import { useProject } from "../api/hooks";

/** プロジェクトのエディタ。M3 以降で中身を作る */
export function ProjectPage() {
  const { projectId = "" } = useParams();
  const { data: project, error, isPending } = useProject(projectId);

  if (isPending) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }
  return (
    <Center h="100vh">
      <Stack align="center">
        {error ? <Text c="red">{error.message}</Text> : <Title order={2}>{project?.name}</Title>}
        <Anchor component={Link} to="/">
          プロジェクトの一覧に戻る
        </Anchor>
      </Stack>
    </Center>
  );
}
