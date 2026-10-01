import {
  ActionIcon,
  Button,
  ColorInput,
  Divider,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { BAND_LABELS, BANDS, type LegendStop } from "@wifi-planner/domain";
import { updateSettings } from "@wifi-planner/domain/ops";
import { useSession, useSessionState } from "../../collab/react";

/** 他のフロアの AP を計算に含める範囲（FR-7.8）の選択肢。値は crossFloorRange を文字列にしたもの */
const CROSS_FLOOR_OPTIONS = [
  { value: "all", label: "全フロア" },
  ...[1, 2, 3].map((n) => ({ value: String(n), label: `上下 ${n} フロアまで` })),
  { value: "0", label: "同じフロアだけ" },
];

/** 伝搬計算と凡例の設定（FR-7.3、FR-7.4、FR-7.8、FR-8.4） */
export function PropagationSettingsModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const session = useSession();
  const { doc } = useSessionState();
  const readOnly = session.readOnly;
  if (!doc) return null;
  const s = doc.settings;
  const set = (patch: Parameters<typeof updateSettings>[1]) =>
    session.mutate((ydoc) => updateSettings(ydoc, patch), { coalesce: true });
  const setStops = (stops: LegendStop[]) => set({ legend: { ...s.legend, stops } });
  const num = (f: (v: number) => void) => (v: number | string) => typeof v === "number" && f(v);

  return (
    <Modal opened={opened} onClose={onClose} title="電波の計算と表示の設定" size="lg">
      <Stack>
        <Group grow>
          <NumberInput
            label="受信高さ"
            suffix=" m"
            decimalScale={2}
            min={0}
            value={s.receiverHeightM}
            disabled={readOnly}
            onChange={num((v) => set({ receiverHeightM: v }))}
          />
          <NumberInput
            label="格子の間隔"
            suffix=" m"
            decimalScale={2}
            min={0.1}
            max={5}
            value={s.gridResolutionM}
            disabled={readOnly}
            onChange={num((v) => v >= 0.1 && set({ gridResolutionM: v }))}
          />
          <NumberInput
            label="受信側のアンテナ利得"
            suffix=" dBi"
            decimalScale={1}
            value={s.rxGainDbi}
            disabled={readOnly}
            onChange={num((v) => set({ rxGainDbi: v }))}
          />
        </Group>
        <Select
          label="計算に含める他のフロアの AP"
          description="壁と床スラブは範囲によらずすべてのフロアのものを使います。位置合わせをしていないフロアは、そのフロアだけで計算します"
          data={
            s.crossFloorRange !== null && s.crossFloorRange > 3
              ? [
                  ...CROSS_FLOOR_OPTIONS,
                  {
                    value: String(s.crossFloorRange),
                    label: `上下 ${s.crossFloorRange} フロアまで`,
                  },
                ]
              : CROSS_FLOOR_OPTIONS
          }
          value={s.crossFloorRange === null ? "all" : String(s.crossFloorRange)}
          disabled={readOnly}
          allowDeselect={false}
          onChange={(v) => v && set({ crossFloorRange: v === "all" ? null : Number(v) })}
        />
        <Text size="sm" fw={600}>
          距離減衰の減衰指数
        </Text>
        <Text size="xs" c="dimmed">
          2.0 で自由空間と同じです。家具や人が多い屋内では 2.5〜3.5
          程度にすると、実測に近づくことがあります。
        </Text>
        <Group grow>
          {BANDS.map((b) => (
            <NumberInput
              key={b}
              label={BAND_LABELS[b]}
              decimalScale={2}
              min={1}
              max={6}
              step={0.1}
              value={s.pathLossExponent[b]}
              disabled={readOnly}
              onChange={num(
                (v) => v > 0 && set({ pathLossExponent: { ...s.pathLossExponent, [b]: v } }),
              )}
            />
          ))}
        </Group>
        <Divider />
        <Text size="sm" fw={600}>
          凡例
        </Text>
        <Group grow align="flex-end">
          <NumberInput
            label="良好とみなす受信電力"
            suffix=" dBm"
            value={s.legend.goodThresholdDbm}
            disabled={readOnly}
            onChange={num((v) => set({ legend: { ...s.legend, goodThresholdDbm: v } }))}
            description="AP 数と同一チャネル干渉もこの値で数えます"
          />
          <Switch
            label="良好に満たない所を塗らない"
            checked={s.legend.hideBelow}
            disabled={readOnly}
            onChange={(e) => set({ legend: { ...s.legend, hideBelow: e.currentTarget.checked } })}
          />
        </Group>
        {[...s.legend.stops]
          .map((stop, i) => ({ stop, i }))
          .sort((a, b) => b.stop.dbm - a.stop.dbm)
          .map(({ stop, i }) => (
            <Group key={i} gap="xs">
              <NumberInput
                size="xs"
                w={120}
                aria-label="区切りの値"
                suffix=" dBm"
                value={stop.dbm}
                disabled={readOnly}
                onChange={num((v) =>
                  setStops(s.legend.stops.map((x, j) => (j === i ? { ...x, dbm: v } : x))),
                )}
              />
              <Text size="xs">以上</Text>
              <ColorInput
                size="xs"
                w={130}
                aria-label="色"
                format="hex"
                value={stop.color}
                disabled={readOnly}
                onChangeEnd={(c) =>
                  /^#[0-9a-fA-F]{6}$/.test(c) &&
                  setStops(s.legend.stops.map((x, j) => (j === i ? { ...x, color: c } : x)))
                }
              />
              {!readOnly && s.legend.stops.length > 1 && (
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label="区切りを削除"
                  onClick={() => setStops(s.legend.stops.filter((_, j) => j !== i))}
                >
                  <IconTrash size={14} />
                </ActionIcon>
              )}
            </Group>
          ))}
        {!readOnly && (
          <Group>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconPlus size={14} />}
              onClick={() => {
                const lowest = Math.min(...s.legend.stops.map((x) => x.dbm));
                setStops([...s.legend.stops, { dbm: lowest - 5, color: "#7f1d1d" }]);
              }}
            >
              区切りを追加
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
