import {
  AppShell,
  Button,
  Center,
  Group,
  Loader,
  Menu,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { IconChevronDown, IconLogout, IconUsers } from "@tabler/icons-react";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useLogout, useMe } from "../api/hooks";

export function RequireLogin() {
  const { data: me, isPending } = useMe();
  const location = useLocation();
  if (isPending) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export function RequireAdmin() {
  const { data: me } = useMe();
  if (!me?.isAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}

export function AppLayout() {
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <UnstyledButton component={Link} to="/">
              <Title order={4}>WiFi 配置計画</Title>
            </UnstyledButton>
            {me?.isAdmin && (
              <Button
                component={Link}
                to="/admin/users"
                variant="subtle"
                size="compact-sm"
                leftSection={<IconUsers size={16} />}
              >
                ユーザー管理
              </Button>
            )}
          </Group>
          <Menu position="bottom-end">
            <Menu.Target>
              <UnstyledButton>
                <Group gap={4}>
                  <Text size="sm">{me?.username}</Text>
                  <IconChevronDown size={14} />
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconLogout size={14} />}
                onClick={() => logout.mutate(undefined, { onSuccess: () => navigate("/login") })}
              >
                ログアウト
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
