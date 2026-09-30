import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Container,
  Group,
  Menu,
  Modal,
  PasswordInput,
  Stack,
  Table,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconDots, IconKey, IconPlus, IconUserCheck, IconUserOff } from "@tabler/icons-react";
import type { User } from "@wifi-planner/api-contract";
import { useState } from "react";
import { useAdminUsers, useCreateUser, useMe, useUpdateUser } from "../api/hooks";
import { notifyDone, notifyError } from "../notify";

/** 管理者によるユーザーの作成と無効化（FR-1.2） */
export function AdminUsersPage() {
  const { data: users = [] } = useAdminUsers();
  const { data: me } = useMe();
  const update = useUpdateUser();
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<User>();

  return (
    <Container size="md">
      <Group justify="space-between" mb="md">
        <Title order={2}>ユーザー管理</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
          ユーザーを作成
        </Button>
      </Group>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>ユーザー名</Table.Th>
            <Table.Th>種別</Table.Th>
            <Table.Th>状態</Table.Th>
            <Table.Th w={40} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.map((u) => (
            <Table.Tr key={u.id} c={u.disabled ? "dimmed" : undefined}>
              <Table.Td>{u.username}</Table.Td>
              <Table.Td>{u.isAdmin ? <Badge>管理者</Badge> : "一般"}</Table.Td>
              <Table.Td>
                {u.disabled ? <Badge color="gray">無効</Badge> : <Badge color="green">有効</Badge>}
              </Table.Td>
              <Table.Td>
                <Menu position="bottom-end">
                  <Menu.Target>
                    <ActionIcon variant="subtle" aria-label="操作">
                      <IconDots size={16} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item leftSection={<IconKey size={14} />} onClick={() => setResetting(u)}>
                      パスワードを再設定
                    </Menu.Item>
                    {u.id !== me?.id && (
                      <Menu.Item
                        leftSection={
                          u.disabled ? <IconUserCheck size={14} /> : <IconUserOff size={14} />
                        }
                        color={u.disabled ? undefined : "red"}
                        onClick={() =>
                          update.mutate(
                            { id: u.id, disabled: !u.disabled },
                            { onError: notifyError },
                          )
                        }
                      >
                        {u.disabled ? "有効にする" : "無効にする"}
                      </Menu.Item>
                    )}
                  </Menu.Dropdown>
                </Menu>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <CreateUserModal opened={creating} onClose={() => setCreating(false)} />
      <ResetPasswordModal user={resetting} onClose={() => setResetting(undefined)} />
    </Container>
  );
}

function CreateUserModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const create = useCreateUser();
  const form = useForm({
    initialValues: { username: "", password: "", isAdmin: false },
    validate: {
      username: (v) =>
        /^[A-Za-z0-9_.-]+$/.test(v) ? null : "英数字と _ . - だけで指定してください",
      password: (v) => (v.length >= 8 ? null : "8 文字以上にしてください"),
    },
  });
  return (
    <Modal opened={opened} onClose={onClose} title="ユーザーの作成">
      <form
        onSubmit={form.onSubmit((values) =>
          create.mutate(values, {
            onSuccess: () => {
              form.reset();
              onClose();
              notifyDone("ユーザーを作成しました");
            },
            onError: notifyError,
          }),
        )}
      >
        <Stack>
          <TextInput label="ユーザー名" data-autofocus {...form.getInputProps("username")} />
          <PasswordInput label="初期パスワード" {...form.getInputProps("password")} />
          <Checkbox label="管理者にする" {...form.getInputProps("isAdmin", { type: "checkbox" })} />
          <Group justify="flex-end">
            <Button type="submit" loading={create.isPending}>
              作成
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: User | undefined; onClose: () => void }) {
  const update = useUpdateUser();
  const form = useForm({
    initialValues: { password: "" },
    validate: { password: (v) => (v.length >= 8 ? null : "8 文字以上にしてください") },
  });
  return (
    <Modal opened={!!user} onClose={onClose} title={`${user?.username ?? ""} のパスワードの再設定`}>
      <form
        onSubmit={form.onSubmit(
          ({ password }) =>
            user &&
            update.mutate(
              { id: user.id, password },
              {
                onSuccess: () => {
                  form.reset();
                  onClose();
                  notifyDone("パスワードを再設定しました");
                },
                onError: notifyError,
              },
            ),
        )}
      >
        <Stack>
          <PasswordInput
            label="新しいパスワード"
            data-autofocus
            {...form.getInputProps("password")}
          />
          <Group justify="flex-end">
            <Button type="submit" loading={update.isPending}>
              再設定
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
