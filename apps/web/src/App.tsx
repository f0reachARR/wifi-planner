import { Badge, Container, Group, Title } from "@mantine/core";
import { useEffect, useState } from "react";

type Health = "checking" | "ok" | "error";

export function App() {
  const [health, setHealth] = useState<Health>("checking");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => setHealth(res.ok ? "ok" : "error"))
      .catch(() => setHealth("error"));
  }, []);

  return (
    <Container py="xl">
      <Group>
        <Title order={1}>WiFi 配置計画</Title>
        <Badge color={health === "ok" ? "green" : health === "error" ? "red" : "gray"}>
          {health === "ok"
            ? "サーバ接続中"
            : health === "error"
              ? "サーバに接続できません"
              : "確認中"}
        </Badge>
      </Group>
    </Container>
  );
}
