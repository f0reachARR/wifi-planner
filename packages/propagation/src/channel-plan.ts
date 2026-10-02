import {
  type Band,
  type ChannelWidth,
  channelWidths,
  type FrequencyRange,
  occupiedRange,
  type ProjectDoc,
} from "@wifi-planner/domain";
import { type Environment, evaluatePointAt } from "./field.js";
import { buildProjectScene, type ProjectFloor, type SceneRadio } from "./scene.js";
import { buildSlabLevels } from "./slabs.js";

// チャネルの自動割り当て（FR-6.6、設計書 5.6 節）。

/**
 * 互いにこの強さ以上で届く AP の組を、同じチャネルで干渉しうる組として数える。
 * 802.11 の 20 MHz のプリアンブルを検出する感度（-82 dBm）とした
 */
export const CHANNEL_PLAN_HEARING_DBM = -82;

export type RadioRef = { floorId: string; apId: string; radioKey: string };
export type ChannelAssignment = RadioRef & { channel: number; widthMHz: ChannelWidth };

export type ChannelPlanOptions = {
  /** 割り当てる候補の主チャネル。チャネル幅で組めないものと、同じブロックに入る 2 つ目以降は使わない */
  channels: readonly number[];
  widthMHz: ChannelWidth;
  /** 割り当て直す AP。他の AP のラジオはいまのチャネルのまま、干渉の相手として数える */
  isTarget: (floorId: string, apId: string) => boolean;
};

export type ChannelPlan = {
  assignments: ChannelAssignment[];
  /** 割り当てられなかった対象のラジオ（スケールが未校正のフロアのもの、いまのチャネルが組めないもの） */
  skipped: RadioRef[];
  /** 互いに届き、占有周波数が重なる組の数。割り当ての前と後 */
  conflictsBefore: number;
  conflictsAfter: number;
};

/** チャネル幅で組める候補を、占有周波数が同じものを除いて返す */
export function channelCandidates(
  band: Band,
  channels: readonly number[],
  widthMHz: ChannelWidth,
): { channel: number; range: FrequencyRange }[] {
  const out: { channel: number; range: FrequencyRange }[] = [];
  for (const channel of channels) {
    if (!channelWidths(band, channel).includes(widthMHz)) continue;
    const range = occupiedRange(band, channel, widthMHz)!;
    if (out.some((c) => c.range.lowMHz === range.lowMHz && c.range.highMHz === range.highMHz))
      continue;
    out.push({ channel, range });
  }
  return out;
}

/** 占有周波数の重なりの割合（0〜1）。狭いほうの幅に対する重なった幅 */
function overlapRatio(a: FrequencyRange, b: FrequencyRange): number {
  const overlap = Math.min(a.highMHz, b.highMHz) - Math.max(a.lowMHz, b.lowMHz);
  if (overlap <= 0) return 0;
  return overlap / Math.min(a.highMHz - a.lowMHz, b.highMHz - b.lowMHz);
}

/**
 * ラジオの組ごとの結合（dBm）。互いの AP の位置での受信電力の大きいほうとする。
 * 計算に含めない組（届く範囲の外のフロア、位置合わせしていない別のフロア）は -Infinity
 */
function couplingMatrix(
  doc: ProjectDoc,
  band: Band,
  floors: Map<string, ProjectFloor>,
  radios: SceneRadio[],
) {
  const range = doc.settings.crossFloorRange;
  const base = {
    pathLossExponent: doc.settings.pathLossExponent[band],
    rxGainDbi: doc.settings.rxGainDbi,
    receiverZ: 0,
  };
  // 位置合わせ済みのフロアどうしは全フロアの壁と床スラブで、位置合わせしていないフロアはそのフロアの壁だけで計算する
  const included = [...floors.values()].filter((f) => f.included);
  const shared: Environment = {
    ...base,
    walls: included.flatMap((f) => (f.walls ? [f.walls] : [])),
    slabs: buildSlabLevels([...floors.values()].map((f) => f.slab)),
  };
  const isolated = new Map<string, Environment>();
  const envFor = (a: ProjectFloor, b: ProjectFloor): Environment | undefined => {
    if (a.included && b.included) {
      if (range !== null && Math.abs(a.index - b.index) > range) return undefined;
      return shared;
    }
    if (a.id !== b.id) return undefined;
    let env = isolated.get(a.id);
    if (!env) {
      env = { ...base, walls: a.walls ? [a.walls] : [], slabs: [] };
      isolated.set(a.id, env);
    }
    return env;
  };

  const n = radios.length;
  const m: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(-Infinity));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = radios[i]!;
      const b = radios[j]!;
      const s = a.source;
      const t = b.source;
      let db: number;
      if (a.apId === b.apId && a.floorId === b.floorId) {
        // 同じ AP の 2 本のラジオは隣り合うので、送信出力のまま届くものとみなす
        db = Math.max(s.txPowerDbm, t.txPowerDbm);
      } else {
        const env = envFor(floors.get(a.floorId)!, floors.get(b.floorId)!);
        if (!env) continue;
        db = Math.max(
          evaluatePointAt(s, env, t.x, t.y, t.z),
          evaluatePointAt(t, env, s.x, s.y, s.z),
        );
      }
      m[i]![j] = db;
      m[j]![i] = db;
    }
  }
  return m;
}

function countConflicts(m: number[][], ranges: readonly FrequencyRange[]): number {
  let count = 0;
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      if (m[i]![j]! >= CHANNEL_PLAN_HEARING_DBM && overlapRatio(ranges[i]!, ranges[j]!) > 0)
        count++;
    }
  }
  return count;
}

/**
 * 選んだ帯域で、対象の AP の有効なラジオに候補のチャネルを割り当てる（FR-6.6）。
 * 互いの位置での受信電力（壁と床スラブの減衰を含む）を結合の強さとし、占有周波数の重なりで重みを付けた
 * 結合の和が小さくなるように選ぶ。結合の強いラジオから順に貪欲に決め、そのあと一つずつ選び直して改善する。
 * 結合の和が同じ候補では、使われている数の少ないものを選んで、離れた AP どうしでもチャネルを散らす。
 */
export function planChannels(
  doc: ProjectDoc,
  band: Band,
  options: ChannelPlanOptions,
): ChannelPlan {
  const candidates = channelCandidates(band, options.channels, options.widthMHz);
  const project = buildProjectScene(doc, band);
  const order = (floorId: string) => project.floors.get(floorId)?.index ?? 0;
  const apName = (r: RadioRef) => doc.floors[r.floorId]?.aps[r.apId]?.name ?? "";
  // 結果が実行ごとに変わらないよう、フロアの順、AP の名前、ラジオの key で並べる
  const byOrder = (a: RadioRef, b: RadioRef) =>
    order(a.floorId) - order(b.floorId) ||
    apName(a).localeCompare(apName(b), "ja", { numeric: true }) ||
    a.apId.localeCompare(b.apId) ||
    a.radioKey.localeCompare(b.radioKey);

  const radios = [...project.radios.values()].flat().sort(byOrder);
  const planned = new Set(radios.map((r) => `${r.floorId}/${r.apId}/${r.radioKey}`));
  const skipped: RadioRef[] = [];
  for (const [floorId, floor] of Object.entries(doc.floors)) {
    for (const [apId, ap] of Object.entries(floor.aps)) {
      if (!options.isTarget(floorId, apId)) continue;
      for (const r of ap.radios) {
        if (!r.enabled || r.band !== band) continue;
        if (!planned.has(`${floorId}/${apId}/${r.key}`))
          skipped.push({ floorId, apId, radioKey: r.key });
      }
    }
  }
  skipped.sort(byOrder);

  const targets = radios.flatMap((r, i) => (options.isTarget(r.floorId, r.apId) ? [i] : []));
  if (candidates.length === 0 || targets.length === 0) {
    return { assignments: [], skipped, conflictsBefore: 0, conflictsAfter: 0 };
  }

  const m = couplingMatrix(doc, band, project.floors, radios);
  const conflictsBefore = countConflicts(
    m,
    radios.map((r) => r.range),
  );
  // 結合は線形の電力（mW）で足す。強い組ほど大きく効く
  const w = m.map((row) => row.map((db) => (db === -Infinity ? 0 : 10 ** (db / 10))));

  const ranges: (FrequencyRange | undefined)[] = radios.map((r) => r.range);
  const isTarget = new Set(targets);
  for (const i of targets) ranges[i] = undefined;
  const usage = new Array<number>(candidates.length).fill(0);

  const costOf = (i: number, range: FrequencyRange) => {
    let c = 0;
    for (let j = 0; j < radios.length; j++) {
      const other = ranges[j];
      if (j === i || !other || w[i]![j] === 0) continue;
      c += w[i]![j]! * overlapRatio(range, other);
    }
    return c;
  };
  const choose = (i: number): number => {
    let best = 0;
    let bestCost = costOf(i, candidates[0]!.range);
    for (let k = 1; k < candidates.length; k++) {
      const cost = costOf(i, candidates[k]!.range);
      // 浮動小数の誤差で散らし方が揺れないよう、相対的にごく小さい差は同じとみなす
      const tie = Math.abs(cost - bestCost) <= 1e-9 * Math.max(cost, bestCost);
      if (tie ? usage[k]! < usage[best]! : cost < bestCost) {
        best = k;
        bestCost = cost;
      }
    }
    return best;
  };

  const strength = (i: number) => w[i]!.reduce((s, v) => s + v, 0);
  const greedy = [...targets].sort((a, b) => strength(b) - strength(a) || a - b);
  const chosen = new Map<number, number>();
  for (const i of greedy) {
    const k = choose(i);
    chosen.set(i, k);
    ranges[i] = candidates[k]!.range;
    usage[k]!++;
  }
  // 一つずつ選び直す。結合の和は単調に減るので、変わらなくなるか上限の回数で止める
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (const i of greedy) {
      const prev = chosen.get(i)!;
      usage[prev]!--;
      ranges[i] = undefined;
      const cur = costOf(i, candidates[prev]!.range);
      let k = choose(i);
      if (costOf(i, candidates[k]!.range) >= cur) k = prev;
      chosen.set(i, k);
      ranges[i] = candidates[k]!.range;
      usage[k]!++;
      if (k !== prev) changed = true;
    }
    if (!changed) break;
  }

  const conflictsAfter = countConflicts(m, ranges as FrequencyRange[]);
  const assignments = radios.flatMap((r, i): ChannelAssignment[] =>
    isTarget.has(i)
      ? [
          {
            floorId: r.floorId,
            apId: r.apId,
            radioKey: r.radioKey,
            channel: candidates[chosen.get(i)!]!.channel,
            widthMHz: options.widthMHz,
          },
        ]
      : [],
  );
  return { assignments, skipped, conflictsBefore, conflictsAfter };
}
