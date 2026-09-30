import { Button, Group, Modal, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useEffect } from "react";

/** 名前を一つ入力するモーダル。プロジェクトの作成、名前の変更、複製に使う */
export function NameModal(props: {
  opened: boolean;
  title: string;
  label?: string;
  initialName?: string;
  submitLabel: string;
  loading?: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const form = useForm({
    initialValues: { name: props.initialName ?? "" },
    validate: { name: (v) => (v.trim() ? null : "名前を入力してください") },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: 開いたときだけ初期値を入れ直す
  useEffect(() => {
    if (props.opened) form.setValues({ name: props.initialName ?? "" });
  }, [props.opened]);

  return (
    <Modal opened={props.opened} onClose={props.onClose} title={props.title}>
      <form onSubmit={form.onSubmit(({ name }) => props.onSubmit(name.trim()))}>
        <TextInput label={props.label ?? "名前"} data-autofocus {...form.getInputProps("name")} />
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={props.onClose}>
            キャンセル
          </Button>
          <Button type="submit" loading={props.loading}>
            {props.submitLabel}
          </Button>
        </Group>
      </form>
    </Modal>
  );
}
