import {
  Alert,
  Button,
  Divider,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { IconAlertTriangle, IconCopy, IconRefresh, IconTrash } from "@tabler/icons-react";
import type { ApModelEntry } from "@wifi-planner/api-contract";
import {
  ApModel,
  BAND_LABELS,
  type Band,
  type ChannelWidth,
  channelWidths,
  isAllowedInJapan,
  listChannels,
  type MountType,
  type RadioConfig,
} from "@wifi-planner/domain";
import {
  defaultChannelFor,
  deleteAps,
  duplicateAps,
  putApModelSnapshot,
  updateAp,
  updateRadio,
} from "@wifi-planner/domain/ops";
import { useSession, useSessionState } from "../../collab/react";
import type { ApEntry } from "./ApLayer";

export const MOUNT_OPTIONS: { value: MountType; label: string }[] = [
  { value: "ceiling", label: "天井設置" },
  { value: "wall", label: "壁設置" },
];

/** 設置方法のボタンで書く向きのプリセット。チルトを 0° に戻し、方位角は変えない（FR-6.2） */
export function mountPreset(mount: MountType): { mount: MountType; tiltDeg: number } {
  return { mount, tiltDeg: 0 };
}

/** 方位角を 0 以上 360 未満にする */
export function normalizeAzimuth(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** チャネルの選択肢。国内で使えないものには印を付ける（FR-6.4 を緩めた扱い、設計書 5.4 節） */
export function channelOptions(band: Band) {
  return listChannels(band).map((ch) => ({
    value: String(ch),
    label: `${ch}${isAllowedInJapan(band, ch, 20) ? "" : "（国内不可）"}`,
  }));
}

/** チャネルを変えたとき、組めなくなったチャネル幅を組める中で最も広いものにする */
export function fitWidth(band: Band, channel: number, width: ChannelWidth): ChannelWidth {
  const widths = channelWidths(band, channel);
  if (widths.includes(width)) return width;
  return widths.filter((w) => w <= width).at(-1) ?? widths[0] ?? 20;
}

/** AP の属性（FR-6.2、FR-6.3） */
export function ApInspector(props: {
  floorId: string;
  aps: ApEntry[];
  selection: string[];
  setSelection: (ids: string[]) => void;
  library: ApModelEntry[];
  metersPerUnit: number | undefined;
}) {
  const session = useSession();
  const { doc } = useSessionState();
  const readOnly = session.readOnly;
  const selected = props.aps.filter((a) => props.selection.includes(a.id));
  if (selected.length === 0) return null;
  const single = selected.length === 1 ? selected[0]! : undefined;
  const floorId = props.floorId;

  const mutateAll = (patch: Partial<ApEntry>) =>
    session.mutate(
      (ydoc) => {
        for (const ap of selected) updateAp(ydoc, floorId, ap.id, patch);
      },
      { coalesce: true },
    );

  const duplicate = () => {
    const offset = props.metersPerUnit ? 1 / props.metersPerUnit : 20;
    let ids: string[] = [];
    session.mutate((ydoc) => {
      ids = duplicateAps(
        ydoc,
        floorId,
        selected.map((a) => a.id),
        { x: offset, y: offset },
      );
    });
    props.setSelection(ids);
  };

  const common = <K extends keyof ApEntry>(key: K) =>
    selected.every((a) => a[key] === selected[0]![key]) ? selected[0]![key] : undefined;

  return (
    <Stack gap="sm">
      <Text size="sm" fw={600}>
        {single ? single.name : `${selected.length} 台の AP を選択中`}
      </Text>
      {single && (
        <TextInput
          label="名前"
          defaultValue={single.name}
          key={single.id}
          disabled={readOnly}
          onBlur={(e) => {
            const name = e.currentTarget.value.trim();
            if (name && name !== single.name)
              session.mutate((ydoc) => updateAp(ydoc, floorId, single.id, { name }));
          }}
        />
      )}
      <Group grow align="flex-end">
        <NumberInput
          label="設置高さ"
          suffix=" m"
          decimalScale={2}
          min={0}
          value={common("heightM") ?? ""}
          placeholder="（複数）"
          disabled={readOnly}
          onChange={(v) => typeof v === "number" && mutateAll({ heightM: v })}
        />
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            設置方法
          </Text>
          <Button.Group>
            {MOUNT_OPTIONS.map((o) => (
              <Button
                key={o.value}
                size="xs"
                flex={1}
                variant={common("mount") === o.value ? "filled" : "default"}
                aria-pressed={common("mount") === o.value}
                disabled={readOnly}
                onClick={() => mutateAll(mountPreset(o.value))}
              >
                {o.label}
              </Button>
            ))}
          </Button.Group>
        </Stack>
      </Group>
      <Group grow>
        <NumberInput
          label="方位角"
          suffix="°"
          decimalScale={1}
          value={common("azimuthDeg") ?? ""}
          placeholder="（複数）"
          disabled={readOnly}
          onChange={(v) => typeof v === "number" && mutateAll({ azimuthDeg: normalizeAzimuth(v) })}
        />
        <NumberInput
          label="チルト"
          suffix="°"
          decimalScale={1}
          min={-90}
          max={90}
          value={common("tiltDeg") ?? ""}
          placeholder="（複数）"
          disabled={readOnly}
          onChange={(v) => typeof v === "number" && mutateAll({ tiltDeg: v })}
        />
      </Group>
      <Text size="xs" c="dimmed">
        方位角は図面の右を 0° とした反時計回り。図面上で AP を 1
        つ選び、矢印の先のハンドルをドラッグしても変えられます（Shift で 15°
        刻み）。天井設置のチルトは真下からの傾き、壁設置のチルトは下向きの角度です。設置方法のボタンを押すと、チルトを
        0° に戻します。
      </Text>
      {!readOnly && (
        <Group gap="xs">
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconCopy size={14} />}
            onClick={duplicate}
          >
            複製
          </Button>
          <Button
            size="compact-xs"
            variant="light"
            color="red"
            leftSection={<IconTrash size={14} />}
            onClick={() => {
              session.mutate((ydoc) =>
                deleteAps(
                  ydoc,
                  floorId,
                  selected.map((a) => a.id),
                ),
              );
              props.setSelection([]);
            }}
          >
            削除
          </Button>
        </Group>
      )}
      {single && doc && <RadioSettings ap={single} floorId={floorId} library={props.library} />}
    </Stack>
  );
}

function RadioSettings({
  ap,
  floorId,
  library,
}: {
  ap: ApEntry;
  floorId: string;
  library: ApModelEntry[];
}) {
  const session = useSession();
  const { doc } = useSessionState();
  const readOnly = session.readOnly;
  const model = doc?.apModels[ap.modelId];
  if (!model) return <Text c="red">AP モデルがプロジェクトにありません</Text>;
  const libraryEntry = library.find((m) => m.id === model.source?.libraryId);
  const outdated =
    libraryEntry && model.source && libraryEntry.updatedAt > Date.parse(model.source.updatedAt);

  const setRadio = (key: string, patch: Partial<RadioConfig>, coalesce = false) =>
    session.mutate((ydoc) => updateRadio(ydoc, floorId, ap.id, key, patch), { coalesce });

  return (
    <Stack gap="xs">
      <Divider />
      <Group justify="space-between">
        <Text size="sm" fw={600}>
          ラジオ（{model.name}）
        </Text>
      </Group>
      {outdated && !readOnly && (
        <Button
          size="compact-xs"
          variant="light"
          leftSection={<IconRefresh size={14} />}
          onClick={() => {
            const def = ApModel.parse(libraryEntry.definition);
            session.mutate((ydoc) =>
              putApModelSnapshot(ydoc, ap.modelId, {
                ...def,
                source: {
                  libraryId: libraryEntry.id,
                  updatedAt: new Date(libraryEntry.updatedAt).toISOString(),
                },
              }),
            );
          }}
        >
          ライブラリの新しい定義を反映
        </Button>
      )}
      {ap.radios.map((r) => {
        const modelRadio = model.radios.find((m) => m.key === r.key);
        const maxPower = modelRadio?.maxTxPowerDbm[r.band];
        const allowed = isAllowedInJapan(r.band, r.channel, r.widthMHz);
        return (
          <Stack
            key={r.key}
            gap={4}
            p={6}
            style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 4 }}
          >
            <Group justify="space-between">
              <Text size="xs" fw={600}>
                {r.key}
              </Text>
              <Switch
                size="xs"
                label="有効"
                checked={r.enabled}
                disabled={readOnly}
                onChange={(e) => setRadio(r.key, { enabled: e.currentTarget.checked })}
              />
            </Group>
            {(modelRadio?.bands.length ?? 0) > 1 && (
              <SegmentedControl
                size="xs"
                value={r.band}
                disabled={readOnly}
                onChange={(v) => {
                  const band = v as Band;
                  setRadio(r.key, {
                    band,
                    ...defaultChannelFor(band),
                    txPowerDbm: Math.min(
                      r.txPowerDbm,
                      modelRadio?.maxTxPowerDbm[band] ?? r.txPowerDbm,
                    ),
                  });
                }}
                data={(modelRadio?.bands ?? []).map((b) => ({ value: b, label: BAND_LABELS[b] }))}
              />
            )}
            <Group grow gap={4}>
              <Select
                size="xs"
                label={`${BAND_LABELS[r.band]} チャネル`}
                data={channelOptions(r.band)}
                value={String(r.channel)}
                searchable
                allowDeselect={false}
                disabled={readOnly}
                onChange={(v) => {
                  if (!v) return;
                  const channel = Number(v);
                  setRadio(r.key, { channel, widthMHz: fitWidth(r.band, channel, r.widthMHz) });
                }}
              />
              <Select
                size="xs"
                label="チャネル幅"
                data={channelWidths(r.band, r.channel).map((w) => ({
                  value: String(w),
                  label: `${w} MHz`,
                }))}
                value={String(r.widthMHz)}
                allowDeselect={false}
                disabled={readOnly}
                onChange={(v) => v && setRadio(r.key, { widthMHz: Number(v) as ChannelWidth })}
              />
            </Group>
            <NumberInput
              size="xs"
              label="送信出力"
              suffix=" dBm"
              min={-10}
              max={maxPower}
              // 上限を超える値は打ち込めないようにする。超えた値を文書だけで丸めると、入力欄に打った値が残って見える
              clampBehavior="strict"
              decimalScale={1}
              value={r.txPowerDbm}
              disabled={readOnly}
              onChange={(v) => {
                if (typeof v !== "number") return;
                setRadio(
                  r.key,
                  { txPowerDbm: maxPower === undefined ? v : Math.min(v, maxPower) },
                  true,
                );
              }}
              description={
                maxPower !== undefined ? `このモデルの最大は ${maxPower} dBm` : undefined
              }
            />
            {!allowed && (
              <Alert color="yellow" p={4} icon={<IconAlertTriangle size={14} />}>
                <Text size="xs">このチャネルとチャネル幅は国内では使えません</Text>
              </Alert>
            )}
          </Stack>
        );
      })}
    </Stack>
  );
}
