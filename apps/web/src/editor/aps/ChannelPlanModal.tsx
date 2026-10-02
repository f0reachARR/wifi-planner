import {
  Alert,
  Button,
  Chip,
  Group,
  Modal,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import {
  BAND_LABELS,
  BANDS,
  type Band,
  type ChannelWidth,
  channelWidths,
  isAllowedInJapan,
  listChannels,
  type ProjectDoc,
} from "@wifi-planner/domain";
import { defaultChannelFor, updateRadio } from "@wifi-planner/domain/ops";
import {
  CHANNEL_PLAN_HEARING_DBM,
  type ChannelPlan,
  channelCandidates,
  planChannels,
} from "@wifi-planner/propagation";
import { useState } from "react";
import { useSession, useSessionState } from "../../collab/react";
import { notifyDone } from "../../notify";

type Scope = "floor" | "all" | "selection";

/** 帯域とチャネル幅で選べる候補（占有周波数の同じものは一つ）。国内で使えないものには印を付ける */
function candidateOptions(band: Band, width: ChannelWidth) {
  return channelCandidates(band, listChannels(band), width).map(({ channel }) => ({
    value: String(channel),
    label: `${channel}${isAllowedInJapan(band, channel, width) ? "" : "（国内不可）"}`,
  }));
}

/** 初めに選んでおく候補。2.4 GHz は重ならない組、ほかは国内で使えるもの */
function defaultChannels(band: Band, width: ChannelWidth): string[] {
  if (band === "2.4") return width === 20 ? ["1", "6", "11"] : ["1", "9"];
  return channelCandidates(band, listChannels(band), width)
    .filter(({ channel }) => isAllowedInJapan(band, channel, width))
    .map(({ channel }) => String(channel));
}

/** 帯域の有効なラジオで最も多いチャネル幅。ラジオがなければ配置したときの初期値 */
function commonWidth(doc: ProjectDoc, band: Band): ChannelWidth {
  const counts = new Map<ChannelWidth, number>();
  for (const f of Object.values(doc.floors))
    for (const ap of Object.values(f.aps))
      for (const r of ap.radios)
        if (r.enabled && r.band === band) counts.set(r.widthMHz, (counts.get(r.widthMHz) ?? 0) + 1);
  let best = defaultChannelFor(band).widthMHz;
  for (const [w, c] of counts) if (c > (counts.get(best) ?? 0)) best = w;
  return best;
}

const widthsOf = (band: Band) =>
  ([20, 40, 80, 160, 320] as const).filter((w) =>
    listChannels(band).some((ch) => channelWidths(band, ch).includes(w)),
  );

/** チャネルの自動割り当て（FR-6.6、設計書 5.6 節） */
export function ChannelPlanModal(props: {
  opened: boolean;
  onClose: () => void;
  floorId: string;
  selectedApIds: string[];
  initialBand: Band;
}) {
  const { doc } = useSessionState();
  if (!doc) return null;
  return (
    <Modal opened={props.opened} onClose={props.onClose} title="チャネルの自動割り当て" size="lg">
      {/* 開くたびに、そのときの帯域と文書から初期値を作り直す */}
      {props.opened && <ChannelPlanForm {...props} doc={doc} />}
    </Modal>
  );
}

function ChannelPlanForm({
  onClose,
  floorId,
  selectedApIds,
  initialBand,
  doc,
}: {
  onClose: () => void;
  floorId: string;
  selectedApIds: string[];
  initialBand: Band;
  doc: ProjectDoc;
}) {
  const session = useSession();
  const [band, setBandState] = useState<Band>(initialBand);
  const [width, setWidthState] = useState<ChannelWidth>(() => commonWidth(doc, initialBand));
  const [channels, setChannels] = useState<string[]>(() => defaultChannels(initialBand, width));
  const [scope, setScope] = useState<Scope>(selectedApIds.length > 0 ? "selection" : "floor");
  const [plan, setPlan] = useState<ChannelPlan>();

  const setBand = (b: Band) => {
    const w = commonWidth(doc, b);
    setBandState(b);
    setWidthState(w);
    setChannels(defaultChannels(b, w));
    setPlan(undefined);
  };
  const setWidth = (w: ChannelWidth) => {
    setWidthState(w);
    setChannels(defaultChannels(band, w));
    setPlan(undefined);
  };

  const isTarget = (fid: string, apId: string) =>
    scope === "all" || (fid === floorId && (scope === "floor" || selectedApIds.includes(apId)));

  const compute = () =>
    setPlan(planChannels(doc, band, { channels: channels.map(Number), widthMHz: width, isTarget }));

  const apply = () => {
    if (!plan) return;
    session.mutate((ydoc) => {
      for (const a of plan.assignments)
        updateRadio(ydoc, a.floorId, a.apId, a.radioKey, {
          channel: a.channel,
          widthMHz: a.widthMHz,
        });
    });
    notifyDone(`${plan.assignments.length} 本のラジオにチャネルを割り当てました`);
    onClose();
  };

  const radioOf = (floorId: string, apId: string, key: string) =>
    doc.floors[floorId]?.aps[apId]?.radios.find((r) => r.key === key);
  const nameOf = (floorId: string, apId: string) => doc.floors[floorId]?.aps[apId]?.name ?? "";

  return (
    <Stack>
      <Text size="xs" c="dimmed">
        選んだチャネルを、対象の AP の有効なラジオに割り当てます。AP
        どうしの位置での推定受信電力（壁と床スラブの減衰を含む）を干渉の強さとし、強く届く組ほど周波数が重ならないように選びます。対象でない
        AP はいまのチャネルのまま、避ける相手として数えます。
      </Text>
      <Group grow align="flex-end">
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            帯域
          </Text>
          <SegmentedControl
            size="xs"
            value={band}
            onChange={(v) => setBand(v as Band)}
            data={BANDS.map((b) => ({ value: b, label: BAND_LABELS[b] }))}
          />
        </Stack>
        <Select
          size="xs"
          label="チャネル幅"
          data={widthsOf(band).map((w) => ({ value: String(w), label: `${w} MHz` }))}
          value={String(width)}
          allowDeselect={false}
          onChange={(v) => v && setWidth(Number(v) as ChannelWidth)}
        />
      </Group>
      <Stack gap={4}>
        <Group justify="space-between">
          <Text size="sm" fw={500}>
            使うチャネル
          </Text>
          <Group gap={4}>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => {
                setChannels(defaultChannels(band, width));
                setPlan(undefined);
              }}
            >
              初期の選択に戻す
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => {
                setChannels([]);
                setPlan(undefined);
              }}
            >
              すべて外す
            </Button>
          </Group>
        </Group>
        <Chip.Group
          multiple
          value={channels}
          onChange={(v) => {
            setChannels(v);
            setPlan(undefined);
          }}
        >
          <Group gap={4}>
            {candidateOptions(band, width).map((o) => (
              <Chip key={o.value} value={o.value} size="xs">
                {o.label}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
        {width > 20 && (
          <Text size="xs" c="dimmed">
            {width} MHz で同じブロックになるチャネルは、先頭のものだけを出しています。
          </Text>
        )}
      </Stack>
      <Stack gap={4}>
        <Text size="sm" fw={500}>
          対象
        </Text>
        <SegmentedControl
          size="xs"
          value={scope}
          onChange={(v) => {
            setScope(v as Scope);
            setPlan(undefined);
          }}
          data={[
            {
              value: "selection",
              label: `選んだ AP（${selectedApIds.length} 台）`,
              disabled: selectedApIds.length === 0,
            },
            { value: "floor", label: "このフロア" },
            { value: "all", label: "すべてのフロア" },
          ]}
        />
      </Stack>
      <Group justify="flex-end">
        <Button variant="light" disabled={channels.length === 0} onClick={compute}>
          割り当てを計算
        </Button>
      </Group>
      {plan && (
        <Stack gap="xs">
          {plan.assignments.length === 0 ? (
            <Text size="sm" c="dimmed">
              対象に {BAND_LABELS[band]} の有効なラジオがありません
            </Text>
          ) : (
            <>
              <Text size="sm" aria-live="polite">
                {CHANNEL_PLAN_HEARING_DBM} dBm 以上で届き、周波数が重なる AP の組：
                {plan.conflictsBefore} → {plan.conflictsAfter}
              </Text>
              <ScrollArea.Autosize mah="40vh">
                <Table striped stickyHeader>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>AP</Table.Th>
                      <Table.Th>フロア</Table.Th>
                      <Table.Th>ラジオ</Table.Th>
                      <Table.Th>いま</Table.Th>
                      <Table.Th>割り当て</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {plan.assignments.map((a) => {
                      const cur = radioOf(a.floorId, a.apId, a.radioKey);
                      const same = cur?.channel === a.channel && cur.widthMHz === a.widthMHz;
                      return (
                        <Table.Tr key={`${a.floorId}/${a.apId}/${a.radioKey}`}>
                          <Table.Td>{nameOf(a.floorId, a.apId)}</Table.Td>
                          <Table.Td>{doc.floors[a.floorId]?.name}</Table.Td>
                          <Table.Td>{a.radioKey}</Table.Td>
                          <Table.Td>{cur ? `${cur.channel}ch / ${cur.widthMHz} MHz` : ""}</Table.Td>
                          <Table.Td fw={same ? undefined : 600}>
                            {a.channel}ch / {a.widthMHz} MHz
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            </>
          )}
          {plan.skipped.length > 0 && (
            <Alert color="yellow" p={6} icon={<IconAlertTriangle size={14} />}>
              <Text size="xs">
                スケールを校正していないフロアの AP
                や、いまのチャネルが組めないラジオには割り当てません：
                {plan.skipped
                  .map((s) => `${nameOf(s.floorId, s.apId)}（${s.radioKey}）`)
                  .join("、")}
              </Text>
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              やめる
            </Button>
            <Button disabled={plan.assignments.length === 0} onClick={apply}>
              適用
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
