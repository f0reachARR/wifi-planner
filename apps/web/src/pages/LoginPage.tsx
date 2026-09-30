import {
  Alert,
  Button,
  Center,
  Paper,
  PasswordInput,
  Stack,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useLogin, useMe } from "../api/hooks";

export function LoginPage() {
  const { data: me } = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const form = useForm({ initialValues: { username: "", password: "" } });

  if (me) return <Navigate to={from} replace />;

  return (
    <Center h="100vh">
      <Paper withBorder shadow="sm" p="xl" w={360}>
        <form
          onSubmit={form.onSubmit((values) =>
            login.mutate(values, { onSuccess: () => navigate(from, { replace: true }) }),
          )}
        >
          <Stack>
            <Title order={3}>WiFi 配置計画</Title>
            {login.error && <Alert color="red">{login.error.message}</Alert>}
            <TextInput
              label="ユーザー名"
              autoComplete="username"
              required
              {...form.getInputProps("username")}
            />
            <PasswordInput
              label="パスワード"
              autoComplete="current-password"
              required
              {...form.getInputProps("password")}
            />
            <Button type="submit" loading={login.isPending}>
              ログイン
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
