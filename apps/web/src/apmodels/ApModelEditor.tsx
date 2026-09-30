import {
  ActionIcon,
  Alert,
  Button,
  Code,
  FileButton,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconFileImport, IconPlus, IconTrash } from "@tabler/icons-react";
import type { ApModelEntry } from "@wifi-planner/api-contract";
import {
  AntennaPattern,
  ApModel,
  type ApModelRadio,
  BAND_LABELS,
  BANDS,
  type Band,
  PATTERN_CSV_HEADER,
  parsePatternCsv,
} from "@wifi-planner/domain";
import { useEffect, useState } from "react";
import { useSaveApModel } from "../api/hooks";
import { notifyDone, notifyError } from "../notify";
import { PatternView } from "./PatternView";

const EMPTY_RADIO = (key: string): ApModelRadio => ({
  key,
  bands: ["5"],
  maxTxPowerDbm: { "5": 20 },
  pattern: { kind: "omni", gainDbi: 3 },
});

/** AP モデルの作成と編集（FR-5.1、FR-5.2） */
export function ApModelEditor(props: {
  entry: ApModelEntry | "new" | undefined;
  onClose: () => void;
}) {
  const opened = props.entry !== undefined;
  const save = useSaveApModel();
  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("");
  const [radios, setRadios] = useState<ApModelRadio[]>([]);
  const readOnly = props.entry !== "new" && props.entry !== undefined && !props.entry.canEdit;

  useEffect(() => {
    if (props.entry === "new") {
      setName("");
      setVendor("");
      setRadios([
        { ...EMPTY_RADIO("radio0"), bands: ["2.4"], maxTxPowerDbm: { "2.4": 20 } },
        EMPTY_RADIO("radio1"),
      ]);
    } else if (props.entry) {
      const def = ApModel.parse(props.entry.definition);
      setName(def.name);
      setVendor(def.vendor ?? "");
      setRadios(def.radios);
    }
  }, [props.entry]);

  const submit = () => {
    const parsed = ApModel.safeParse({
      name: name.trim(),
      vendor: vendor.trim() || undefined,
      radios,
    });
    if (!parsed.success || !name.trim()) {
      notifyError(new Error("名前と、1 つ以上のラジオを設定してください"));
      return;
    }
    save.mutate(
      { id: props.entry === "new" ? undefined : props.entry?.id, definition: parsed.data },
      {
        onSuccess: () => {
          notifyDone("AP モデルを保存しました");
          props.onClose();
        },
        onError: notifyError,
      },
    );
  };

  const setRadio = (i: number, r: ApModelRadio) =>
    setRadios((rs) => rs.map((x, j) => (j === i ? r : x)));

  return (
    <Modal
      opened={opened}
      onClose={props.onClose}
      title={props.entry === "new" ? "AP モデルの作成" : "AP モデル"}
      size="xl"
    >
      <Stack>
        <Group grow>
          <TextInput
            label="名前"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            disabled={readOnly}
          />
          <TextInput
            label="メーカー"
            value={vendor}
            onChange={(e) => setVendor(e.currentTarget.value)}
            disabled={readOnly}
          />
        </Group>
        {radios.map((r, i) => (
          <RadioEditor
            key={r.key}
            radio={r}
            readOnly={readOnly}
            onChange={(next) => setRadio(i, next)}
            onRemove={
              radios.length > 1 ? () => setRadios((rs) => rs.filter((_, j) => j !== i)) : undefined
            }
          />
        ))}
        {!readOnly && (
          <Group justify="space-between">
            <Button
              variant="light"
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={() => setRadios((rs) => [...rs, EMPTY_RADIO(`radio${rs.length}`)])}
            >
              ラジオを追加
            </Button>
            <Button onClick={submit} loading={save.isPending}>
              保存
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}

function RadioEditor(props: {
  radio: ApModelRadio;
  readOnly: boolean;
  onChange: (r: ApModelRadio) => void;
  onRemove?: () => void;
}) {
  const { radio, readOnly } = props;
  const [error, setError] = useState<string>();

  const importFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setError(undefined);
    if (file.name.toLowerCase().endsWith(".json")) {
      try {
        const parsed = AntennaPattern.safeParse(JSON.parse(text));
        if (parsed.success) props.onChange({ ...radio, pattern: parsed.data });
        else setError("JSON がアンテナパターンの形になっていません");
      } catch {
        setError("JSON を読めません");
      }
      return;
    }
    const result = parsePatternCsv(text);
    if (result.ok) props.onChange({ ...radio, pattern: result.pattern });
    else setError(result.error);
  };

  return (
    <Paper withBorder p="sm">
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={600} size="sm">
            {radio.key}
          </Text>
          {props.onRemove && !readOnly && (
            <ActionIcon
              variant="subtle"
              color="red"
              onClick={props.onRemove}
              aria-label={`${radio.key} を削除`}
            >
              <IconTrash size={16} />
            </ActionIcon>
          )}
        </Group>
        <Group align="flex-end">
          <MultiSelect
            label="対応帯域"
            data={BANDS.map((b) => ({ value: b, label: BAND_LABELS[b] }))}
            value={radio.bands}
            disabled={readOnly}
            onChange={(v) => {
              if (v.length === 0) return;
              const bands = v as Band[];
              const maxTxPowerDbm = Object.fromEntries(
                bands.map((b) => [b, radio.maxTxPowerDbm[b] ?? 20]),
              );
              props.onChange({ ...radio, bands, maxTxPowerDbm });
            }}
            w={240}
          />
          {radio.bands.map((b) => (
            <NumberInput
              key={b}
              label={`${BAND_LABELS[b]} の最大送信出力`}
              suffix=" dBm"
              w={170}
              value={radio.maxTxPowerDbm[b] ?? 20}
              disabled={readOnly}
              onChange={(v) =>
                typeof v === "number" &&
                props.onChange({ ...radio, maxTxPowerDbm: { ...radio.maxTxPowerDbm, [b]: v } })
              }
            />
          ))}
        </Group>
        <Group align="flex-end">
          <SegmentedControl
            size="xs"
            value={radio.pattern.kind === "omni" ? "omni" : "table"}
            disabled={readOnly}
            onChange={(v) =>
              props.onChange({
                ...radio,
                pattern: v === "omni" ? { kind: "omni", gainDbi: 3 } : radio.pattern,
              })
            }
            data={[
              { value: "omni", label: "無指向性" },
              { value: "table", label: "利得表" },
            ]}
          />
          {radio.pattern.kind === "omni" && (
            <NumberInput
              size="xs"
              label="利得"
              suffix=" dBi"
              w={120}
              value={radio.pattern.gainDbi}
              disabled={readOnly}
              onChange={(v) =>
                typeof v === "number" &&
                props.onChange({ ...radio, pattern: { kind: "omni", gainDbi: v } })
              }
            />
          )}
          {!readOnly && (
            <FileButton onChange={importFile} accept=".csv,.json,text/csv,application/json">
              {(p) => (
                <Button {...p} size="xs" variant="light" leftSection={<IconFileImport size={14} />}>
                  CSV か JSON から取り込む
                </Button>
              )}
            </FileButton>
          )}
        </Group>
        {!readOnly && (
          <Text size="xs" c="dimmed">
            CSV の 1 行目は <Code>{PATTERN_CSV_HEADER}</Code> とし、cut には azimuth と
            elevation（指向性）、または off_axis と
            around_axis（天井設置などの軸対称に近いパターン）を書きます。
          </Text>
        )}
        {error && (
          <Alert color="red" p="xs">
            {error}
          </Alert>
        )}
        <PatternView pattern={radio.pattern} />
      </Stack>
    </Paper>
  );
}
