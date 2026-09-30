import { notifications } from "@mantine/notifications";

export const notifyError = (e: unknown) =>
  notifications.show({
    color: "red",
    title: "エラー",
    message: e instanceof Error ? e.message : String(e),
  });

export const notifyDone = (message: string) => notifications.show({ color: "green", message });
