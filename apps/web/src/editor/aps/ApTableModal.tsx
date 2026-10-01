import {
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Text,
} from "@mantine/core";
import {
  BAND_LABELS,
  BANDS,
  type Band,
  type ChannelWidth,
  channelWidths,
  type MountType,
  type RadioConfig,
} from "@wifi-planner/domain";
import { updateAp, updateRadio } from "@wifi-planner/domain/ops";
import { useState } from "react";
import { useSession, useSessionState } from "../../collab/react";
import { sortedFloors } from "../FloorPanel";
import {
  channelOptions,
  fitWidth,
  MOUNT_OPTIONS,
  mountPreset,
  normalizeAzimuth,
} from "./ApInspector";

type Row = { floorId: string; floorName: string; apId: string };

/** AP の一覧と一括変更（FR-6.5） */
export function ApTableModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const session = useSession();
  const { doc } = useSessionState();
  const readOnly = session.readOnly;
  const [checked, setChecked] = useState<Set<string>>(new Set());
  if (!doc) return null;

  const rows: Row[] = sortedFloors(doc.floors).flatMap((f) =>
    Object.entries(f.aps)
      .sort(([, a], [, b]) => a.name.localeCompare(b.name, "ja", { numeric: true }))
      .map(([apId]) => ({ floorId: f.id, floorName: f.name, apId })),
  );
  const apOf = (r: Row) => doc.floors[r.floorId]!.aps[r.apId]!;
  const toggle = (id: string) =>
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectedRows = rows.filter((r) => checked.has(r.apId));

  return (
    <Modal opened={opened} onClose={onClose} title="AP の一覧" size="95%">
      <Stack>
        {!readOnly && selectedRows.length > 0 && <BulkEditor rows={selectedRows} />}
        <ScrollArea.Autosize mah="60vh">
          <Table striped highlightOnHover stickyHeader style={{ whiteSpace: "nowrap" }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={32}>
                  <Checkbox
                    aria-label="すべて選ぶ"
                    checked={rows.length > 0 && checked.size === rows.length}
                    indeterminate={checked.size > 0 && checked.size < rows.length}
                    onChange={(e) =>
                      setChecked(
                        e.currentTarget.checked ? new Set(rows.map((r) => r.apId)) : new Set(),
                      )
                    }
                  />
                </Table.Th>
                <Table.Th>名前</Table.Th>
                <Table.Th>フロア</Table.Th>
                <Table.Th>モデル</Table.Th>
                <Table.Th w={110}>設置高さ</Table.Th>
                <Table.Th w={100}>方位角</Table.Th>
                <Table.Th w={100}>チルト</Table.Th>
                {BANDS.map((b) => (
                  <Table.Th key={b}>{BAND_LABELS[b]}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => {
                const ap = apOf(row);
                return (
                  <Table.Tr key={row.apId}>
                    <Table.Td>
                      <Checkbox
                        aria-label={`${ap.name} を選ぶ`}
                        checked={checked.has(row.apId)}
                        onChange={() => toggle(row.apId)}
                      />
                    </Table.Td>
                    <Table.Td>{ap.name}</Table.Td>
                    <Table.Td>{row.floorName}</Table.Td>
                    <Table.Td>{doc.apModels[ap.modelId]?.name}</Table.Td>
                    <Table.Td>
                      <NumberInput
                        size="xs"
                        aria-label={`${ap.name} の設置高さ`}
                        suffix=" m"
                        decimalScale={2}
                        value={ap.heightM}
                        disabled={readOnly}
                        onChange={(v) =>
                          typeof v === "number" &&
                          session.mutate(
                            (ydoc) => updateAp(ydoc, row.floorId, row.apId, { heightM: v }),
                            { coalesce: true },
                          )
                        }
                      />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput
                        size="xs"
                        aria-label={`${ap.name} の方位角`}
                        suffix="°"
                        decimalScale={1}
                        value={ap.azimuthDeg}
                        disabled={readOnly}
                        onChange={(v) =>
                          typeof v === "number" &&
                          session.mutate(
                            (ydoc) =>
                              updateAp(ydoc, row.floorId, row.apId, {
                                azimuthDeg: normalizeAzimuth(v),
                              }),
                            { coalesce: true },
                          )
                        }
                      />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput
                        size="xs"
                        aria-label={`${ap.name} のチルト`}
                        suffix="°"
                        decimalScale={1}
                        min={-90}
                        max={90}
                        value={ap.tiltDeg}
                        disabled={readOnly}
                        onChange={(v) =>
                          typeof v === "number" &&
                          session.mutate(
                            (ydoc) => updateAp(ydoc, row.floorId, row.apId, { tiltDeg: v }),
                            { coalesce: true },
                          )
                        }
                      />
                    </Table.Td>
                    {BANDS.map((b) => (
                      <Table.Td key={b}>
                        {ap.radios
                          .filter((r) => r.band === b)
                          .map((r) => (
                            <RadioCell
                              key={r.key}
                              row={row}
                              apName={ap.name}
                              radio={r}
                              readOnly={readOnly}
                            />
                          ))}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
        {rows.length === 0 && (
          <Text size="sm" c="dimmed">
            AP がありません
          </Text>
        )}
      </Stack>
    </Modal>
  );
}

function RadioCell({
  row,
  apName,
  radio,
  readOnly,
}: {
  row: Row;
  apName: string;
  radio: RadioConfig;
  readOnly: boolean;
}) {
  const session = useSession();
  const set = (patch: Partial<RadioConfig>, coalesce = false) =>
    session.mutate((ydoc) => updateRadio(ydoc, row.floorId, row.apId, radio.key, patch), {
      coalesce,
    });
  return (
    <Group gap={4} wrap="nowrap">
      <Switch
        size="xs"
        aria-label={`${apName} の ${radio.key} を有効にする`}
        checked={radio.enabled}
        disabled={readOnly}
        onChange={(e) => set({ enabled: e.currentTarget.checked })}
      />
      <Select
        size="xs"
        w={120}
        aria-label={`${apName} の ${radio.key} のチャネル`}
        data={channelOptions(radio.band)}
        value={String(radio.channel)}
        allowDeselect={false}
        searchable
        disabled={readOnly}
        onChange={(v) => {
          if (!v) return;
          const channel = Number(v);
          set({ channel, widthMHz: fitWidth(radio.band, channel, radio.widthMHz) });
        }}
      />
      <Select
        size="xs"
        w={90}
        aria-label={`${apName} の ${radio.key} のチャネル幅`}
        data={channelWidths(radio.band, radio.channel).map((w) => ({
          value: String(w),
          label: `${w} MHz`,
        }))}
        value={String(radio.widthMHz)}
        allowDeselect={false}
        disabled={readOnly}
        onChange={(v) => v && set({ widthMHz: Number(v) as ChannelWidth })}
      />
      <NumberInput
        size="xs"
        w={80}
        aria-label={`${apName} の ${radio.key} の送信出力`}
        suffix=" dBm"
        value={radio.txPowerDbm}
        disabled={readOnly}
        onChange={(v) => typeof v === "number" && set({ txPowerDbm: v }, true)}
      />
    </Group>
  );
}

/** 選んだ AP にまとめて値を適用する。空欄の項目は変えない */
function BulkEditor({ rows }: { rows: Row[] }) {
  const session = useSession();
  const { doc } = useSessionState();
  const [height, setHeight] = useState<number | string>("");
  const [mount, setMount] = useState<string | null>(null);
  const [azimuth, setAzimuth] = useState<number | string>("");
  const [tilt, setTilt] = useState<number | string>("");
  const [band, setBand] = useState<Band>("5");
  const [enabled, setEnabled] = useState<string | null>(null);
  const [channel, setChannel] = useState<string | null>(null);
  const [power, setPower] = useState<number | string>("");

  const apply = () =>
    session.mutate((ydoc) => {
      for (const row of rows) {
        const ap = doc?.floors[row.floorId]?.aps[row.apId];
        if (!ap) continue;
        const model = doc?.apModels[ap.modelId];
        // 設置方法のプリセットはチルトを 0° に戻すので、チルトの指定より先に書く
        updateAp(ydoc, row.floorId, row.apId, {
          ...(typeof height === "number" ? { heightM: height } : {}),
          ...(mount ? mountPreset(mount as MountType) : {}),
          ...(typeof azimuth === "number" ? { azimuthDeg: normalizeAzimuth(azimuth) } : {}),
          ...(typeof tilt === "number" ? { tiltDeg: tilt } : {}),
        });
        for (const r of ap.radios.filter((x) => x.band === band)) {
          const patch: Partial<RadioConfig> = {};
          if (enabled) patch.enabled = enabled === "on";
          if (channel) {
            patch.channel = Number(channel);
            patch.widthMHz = fitWidth(band, Number(channel), r.widthMHz);
          }
          if (typeof power === "number") {
            const max = model?.radios.find((m) => m.key === r.key)?.maxTxPowerDbm[band];
            patch.txPowerDbm = max === undefined ? power : Math.min(power, max);
          }
          updateRadio(ydoc, row.floorId, row.apId, r.key, patch);
        }
      }
    });

  return (
    <Paper withBorder p="sm">
      <Text size="sm" fw={600} mb="xs">
        選んだ {rows.length} 台にまとめて適用（空欄の項目は変えません）
      </Text>
      <Group align="flex-end">
        <NumberInput
          label="設置高さ"
          suffix=" m"
          w={110}
          decimalScale={2}
          value={height}
          onChange={setHeight}
        />
        <Select
          label="設置方法"
          w={110}
          data={MOUNT_OPTIONS}
          value={mount}
          onChange={setMount}
          clearable
        />
        <NumberInput
          label="方位角"
          suffix="°"
          w={90}
          decimalScale={1}
          value={azimuth}
          onChange={setAzimuth}
        />
        <NumberInput
          label="チルト"
          suffix="°"
          w={90}
          decimalScale={1}
          min={-90}
          max={90}
          value={tilt}
          onChange={setTilt}
        />
        <Select
          label="帯域"
          w={110}
          data={BANDS.map((b) => ({ value: b, label: BAND_LABELS[b] }))}
          value={band}
          allowDeselect={false}
          onChange={(v) => {
            if (!v) return;
            setBand(v as Band);
            setChannel(null);
          }}
        />
        <Select
          label="有効／無効"
          w={110}
          data={[
            { value: "on", label: "有効" },
            { value: "off", label: "無効" },
          ]}
          value={enabled}
          onChange={setEnabled}
          clearable
        />
        <Select
          label="チャネル"
          w={140}
          data={channelOptions(band)}
          value={channel}
          onChange={setChannel}
          searchable
          clearable
        />
        <NumberInput label="送信出力" suffix=" dBm" w={110} value={power} onChange={setPower} />
        <Button onClick={apply}>適用</Button>
      </Group>
    </Paper>
  );
}
