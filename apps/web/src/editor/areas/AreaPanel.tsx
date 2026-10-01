import { Alert, Button, NumberInput, Stack, Table, Text, TextInput } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { updateArea, updateSettings } from "@wifi-planner/domain/ops";
import { useSession } from "../../collab/react";
import { AREA_WARNING_COLOR } from "./AreaLayer";
import { type AreaEntry, type AreaStat, formatPeoplePerAp } from "./stats";

/** エリアの目安の設定、選んだエリアの編集、一覧（FR-11.1〜11.5、設計書 5.5 節） */
export function AreaPanel(props: {
  floorId: string;
  areas: readonly AreaEntry[];
  stats: ReadonlyMap<string, AreaStat>;
  selection: readonly string[];
  setSelection: (ids: string[]) => void;
  onDelete: () => void;
  peoplePerApTarget: number;
}) {
  const { floorId, areas, stats, selection } = props;
  const session = useSession();
  const readOnly = session.readOnly;
  const selected = areas.filter((a) => selection.includes(a.id));
  const single = selected.length === 1 ? selected[0] : undefined;
  const overlapIds = areas.filter((a) => stats.get(a.id)?.overlapping).map((a) => a.id);
  const warned = (a: AreaEntry) => !!stats.get(a.id)?.warning || !!stats.get(a.id)?.overlapping;
  // 警告のあるエリアを先に、その中では名前の順に並べる
  const sorted = [...areas].sort(
    (a, b) => Number(warned(b)) - Number(warned(a)) || a.name.localeCompare(b.name, "ja"),
  );

  return (
    <Stack gap="xs">
      <NumberInput
        size="xs"
        label="AP 1 台あたりの人数の目安"
        suffix=" 人"
        min={1}
        decimalScale={0}
        value={props.peoplePerApTarget}
        disabled={readOnly}
        onChange={(v) =>
          typeof v === "number" &&
          v > 0 &&
          session.mutate((ydoc) => updateSettings(ydoc, { peoplePerApTarget: v }), {
            coalesce: true,
          })
        }
      />
      {overlapIds.length > 0 && (
        <Alert color="orange" p={6}>
          <Stack gap={4} align="flex-start">
            <Text size="xs">
              重なっているエリアが {overlapIds.length} 個あります。重なった範囲の AP
              は両方のエリアで数えます。
            </Text>
            <Button
              size="compact-xs"
              variant="light"
              color="orange"
              onClick={() => props.setSelection(overlapIds)}
            >
              重なるエリアを選択
            </Button>
          </Stack>
        </Alert>
      )}
      {single && (
        <AreaInspector
          floorId={floorId}
          area={single}
          stat={stats.get(single.id)}
          peoplePerApTarget={props.peoplePerApTarget}
          onDelete={props.onDelete}
        />
      )}
      {selected.length > 1 && (
        <Stack gap={4}>
          <Text size="xs">エリア {selected.length} 個を選択中</Text>
          {!readOnly && (
            <Button
              size="compact-xs"
              variant="light"
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={props.onDelete}
            >
              削除
            </Button>
          )}
        </Stack>
      )}
      {areas.length === 0 ? (
        <Text size="xs" c="dimmed">
          「エリア」の道具で範囲を囲み、人数を入れると、エリアの中に置いた AP 1
          台あたりの人数を示します。
        </Text>
      ) : (
        <Table fz="xs" verticalSpacing={2} horizontalSpacing={4} highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>名前</Table.Th>
              <Table.Th ta="right">人数</Table.Th>
              <Table.Th ta="right">AP</Table.Th>
              <Table.Th ta="right">人/AP</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sorted.map((a) => {
              const stat = stats.get(a.id);
              const color = warned(a) ? AREA_WARNING_COLOR : undefined;
              return (
                <Table.Tr
                  key={a.id}
                  onClick={() => props.setSelection([a.id])}
                  bg={selection.includes(a.id) ? "var(--mantine-color-blue-light)" : undefined}
                  style={{ cursor: "pointer" }}
                >
                  <Table.Td c={color}>{a.name}</Table.Td>
                  <Table.Td ta="right">{a.headcount}</Table.Td>
                  <Table.Td ta="right">{stat?.apIds.length ?? 0}</Table.Td>
                  <Table.Td ta="right" c={color}>
                    {stat?.peoplePerAp === undefined ? "なし" : stat.peoplePerAp.toFixed(1)}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

function AreaInspector(props: {
  floorId: string;
  area: AreaEntry;
  stat: AreaStat | undefined;
  peoplePerApTarget: number;
  onDelete: () => void;
}) {
  const { floorId, area, stat } = props;
  const session = useSession();
  const readOnly = session.readOnly;
  return (
    <Stack gap={6}>
      <TextInput
        size="xs"
        label="名前"
        defaultValue={area.name}
        key={area.id}
        disabled={readOnly}
        onBlur={(e) => {
          const name = e.currentTarget.value.trim();
          if (name && name !== area.name)
            session.mutate((ydoc) => updateArea(ydoc, floorId, area.id, { name }));
        }}
      />
      <NumberInput
        size="xs"
        label="人数"
        suffix=" 人"
        min={0}
        decimalScale={0}
        allowNegative={false}
        value={area.headcount}
        disabled={readOnly}
        onChange={(v) =>
          typeof v === "number" &&
          Number.isInteger(v) &&
          v >= 0 &&
          session.mutate((ydoc) => updateArea(ydoc, floorId, area.id, { headcount: v }), {
            coalesce: true,
          })
        }
      />
      {stat && (
        <Stack gap={0}>
          <Text size="xs">エリア内の AP：{stat.apIds.length} 台</Text>
          <Text size="xs" c={stat.warning ? AREA_WARNING_COLOR : undefined}>
            AP 1 台あたり：{formatPeoplePerAp(stat)}
            {stat.warning === "overTarget" &&
              `（目安の ${props.peoplePerApTarget} 人を超えています）`}
            {stat.warning === "noAp" && "（人がいるのに AP がありません）"}
          </Text>
          {stat.areaM2 !== undefined && (
            <Text size="xs">
              面積：{stat.areaM2.toFixed(1)} m²
              {stat.m2PerPerson !== undefined && `（1 人あたり ${stat.m2PerPerson.toFixed(1)} m²）`}
            </Text>
          )}
        </Stack>
      )}
      <Text size="xs" c="dimmed">
        位置がこの範囲の中にある AP を数えます。ドラッグで移動、頂点のハンドルで形を変えられます。
      </Text>
      {!readOnly && (
        <Button
          size="compact-xs"
          variant="light"
          color="red"
          leftSection={<IconTrash size={14} />}
          onClick={props.onDelete}
        >
          削除
        </Button>
      )}
    </Stack>
  );
}
