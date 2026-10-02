import {
  createEmptyProjectDoc,
  type Floor,
  occupiedRange,
  type ProjectDoc,
  rangesOverlap,
} from "@wifi-planner/domain";
import { describe, expect, it } from "vitest";
import { channelCandidates, planChannels } from "./channel-plan.js";

// 図面は 1000 × 1000 単位で、1 単位 = 0.1 m（100 m × 100 m）

const plan = {
  sourceSha256: "s",
  imageSha256: "i",
  widthPx: 1000,
  heightPx: 1000,
  unitsPerPx: 1,
  rotationDeg: 0,
};
const scale = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, distanceM: 1 };

function floor(order: number, over: Partial<Floor> = {}): Floor {
  return {
    name: `${order + 1}F`,
    order,
    elevationM: order * 3,
    heightM: 3,
    plan,
    scale,
    planOffset: { floorId: "f1", rotationDeg: 0, translation: { x: 0, y: 0 } },
    walls: {},
    aps: {},
    photoPins: {},
    holes: {},
    areas: {},
    slabMaterialId: "slab",
    ...over,
  };
}

const ap = (name: string, x: number, y: number, channel = 36) => ({
  name,
  modelId: "m",
  position: { x, y },
  heightM: 2.5,
  mount: "ceiling" as const,
  azimuthDeg: 0,
  tiltDeg: 0,
  radios: [
    {
      key: "r5",
      enabled: true,
      band: "5" as const,
      channel,
      widthMHz: 20 as const,
      txPowerDbm: 17,
    },
  ],
});

function project(floors: Record<string, Floor>): ProjectDoc {
  const doc = createEmptyProjectDoc();
  doc.apModels.m = {
    name: "無指向性",
    radios: [
      {
        key: "r5",
        bands: ["5"],
        maxTxPowerDbm: { "5": 20 },
        pattern: { kind: "omni", gainDbi: 0 },
      },
    ],
  };
  doc.floors = floors;
  return doc;
}

const all = () => true;
const channelOf = (plan: ReturnType<typeof planChannels>, apId: string) =>
  plan.assignments.find((a) => a.apId === apId)?.channel;

describe("候補のチャネル", () => {
  it("同じブロックに入るチャネルは一つにまとめ、組めないものは除く", () => {
    // 160 MHz では 36〜64 が一つのブロックで、132〜144 はブロックを組めない
    const c = channelCandidates("5", [36, 40, 52, 100, 132], 160);
    expect(c.map((x) => x.channel)).toEqual([36, 100]);
  });
});

describe("チャネルの自動割り当て", () => {
  it("近い AP どうしには重ならないチャネルを割り当て、干渉する組が減る", () => {
    const doc = project({
      f1: floor(0, { aps: { a: ap("A", 100, 100), b: ap("B", 150, 100), c: ap("C", 200, 100) } }),
    });
    const plan = planChannels(doc, "5", { channels: [36, 40, 44], widthMHz: 20, isTarget: all });
    const chs = ["a", "b", "c"].map((id) => channelOf(plan, id));
    expect(new Set(chs).size).toBe(3);
    expect(plan.conflictsBefore).toBe(3);
    expect(plan.conflictsAfter).toBe(0);
  });

  it("2.4 GHz では、一部だけ重なる隣のチャネルも避ける", () => {
    const radio24 = (name: string, x: number) => ({
      ...ap(name, x, 100),
      radios: [
        {
          key: "r24",
          enabled: true,
          band: "2.4" as const,
          channel: 1,
          widthMHz: 20 as const,
          txPowerDbm: 17,
        },
      ],
    });
    const doc = project({
      f1: floor(0, { aps: { a: radio24("A", 100), b: radio24("B", 150), c: radio24("C", 200) } }),
    });
    doc.apModels.m!.radios = [
      {
        key: "r24",
        bands: ["2.4"],
        maxTxPowerDbm: { "2.4": 20 },
        pattern: { kind: "omni", gainDbi: 0 },
      },
    ];
    const plan = planChannels(doc, "2.4", {
      channels: Array.from({ length: 13 }, (_, i) => i + 1),
      widthMHz: 20,
      isTarget: all,
    });
    const ranges = plan.assignments.map((a) => occupiedRange("2.4", a.channel, a.widthMHz)!);
    expect(ranges).toHaveLength(3);
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++) expect(rangesOverlap(ranges[i]!, ranges[j]!)).toBe(false);
    expect(plan.conflictsAfter).toBe(0);
  });

  it("候補が足りなければ、最も離れた組に同じチャネルを割り当てる", () => {
    const doc = project({
      f1: floor(0, { aps: { a: ap("A", 100, 100), b: ap("B", 150, 100), c: ap("C", 900, 100) } }),
    });
    const plan = planChannels(doc, "5", { channels: [36, 40], widthMHz: 20, isTarget: all });
    expect(channelOf(plan, "a")).not.toBe(channelOf(plan, "b"));
    expect(channelOf(plan, "c")).toBeDefined();
  });

  it("チャネル幅を書き、同じブロックの候補は一つとして扱う", () => {
    const doc = project({ f1: floor(0, { aps: { a: ap("A", 100, 100), b: ap("B", 150, 100) } }) });
    const plan = planChannels(doc, "5", {
      channels: [36, 40, 52],
      widthMHz: 80,
      isTarget: all,
    });
    expect(plan.assignments.map((a) => [a.channel, a.widthMHz]).sort()).toEqual([
      [36, 80],
      [52, 80],
    ]);
  });

  it("対象でない AP のチャネルは変えず、干渉の相手として避ける", () => {
    const doc = project({
      f1: floor(0, { aps: { a: ap("A", 100, 100, 36), b: ap("B", 150, 100) } }),
    });
    const plan = planChannels(doc, "5", {
      channels: [36, 40],
      widthMHz: 20,
      isTarget: (_, apId) => apId === "b",
    });
    expect(plan.assignments).toEqual([
      { floorId: "f1", apId: "b", radioKey: "r5", channel: 40, widthMHz: 20 },
    ]);
  });

  it("届かない AP どうしでも、候補を偏らせずに散らす", () => {
    // 位置合わせしていないフロアに 1 台ずつ置き、互いに干渉を数えないようにする
    const doc = project(
      Object.fromEntries(
        [0, 1, 2, 3].map((i) => [
          `f${i + 1}`,
          floor(i, { planOffset: undefined, aps: { [`a${i}`]: ap(`A${i}`, 100, 100) } }),
        ]),
      ),
    );
    const plan = planChannels(doc, "5", { channels: [36, 40], widthMHz: 20, isTarget: all });
    const chs = plan.assignments.map((a) => a.channel);
    expect(chs.filter((c) => c === 36)).toHaveLength(2);
    expect(chs.filter((c) => c === 40)).toHaveLength(2);
  });

  it("厚い壁で隔てた近い AP より、壁のない遠い AP を避ける", () => {
    const wall = {
      points: [
        { x: 125, y: 0 },
        { x: 125, y: 1000 },
      ],
      materialId: "concrete",
      openings: [],
    };
    // C から見て、36ch の A は壁を挟んで 5 m、40ch の B は壁なしで 10 m
    const aps = { a: ap("A", 100, 100, 36), b: ap("B", 250, 100, 40), c: ap("C", 150, 100) };
    const options = {
      channels: [36, 40],
      widthMHz: 20 as const,
      isTarget: (_: string, apId: string) => apId === "c",
    };
    const doc = project({ f1: floor(0, { walls: { w: wall }, aps }) });
    doc.materials.concrete = {
      name: "厚い壁",
      color: "#000000",
      lossDb: { "2.4": 60, "5": 60, "6": 60 },
    };
    expect(channelOf(planChannels(doc, "5", options), "c")).toBe(36);
    // 壁がなければ近い A を避ける
    const open = project({ f1: floor(0, { aps }) });
    expect(channelOf(planChannels(open, "5", options), "c")).toBe(40);
  });

  it("位置合わせしていない別のフロアの AP とは干渉を数えない", () => {
    const doc = project({
      f1: floor(0, { aps: { a: ap("A", 100, 100) } }),
      f2: floor(1, { planOffset: undefined, aps: { b: ap("B", 100, 100) } }),
    });
    const plan = planChannels(doc, "5", { channels: [36], widthMHz: 20, isTarget: all });
    expect(plan.assignments).toHaveLength(2);
    expect(plan.conflictsAfter).toBe(0);
  });

  it("スケールが未校正のフロアの AP は割り当てずに知らせる", () => {
    const doc = project({
      f1: floor(0, { aps: { a: ap("A", 100, 100) } }),
      f2: floor(1, { scale: undefined, aps: { b: ap("B", 100, 100) } }),
    });
    const plan = planChannels(doc, "5", { channels: [36, 40], widthMHz: 20, isTarget: all });
    expect(plan.assignments.map((a) => a.apId)).toEqual(["a"]);
    expect(plan.skipped).toEqual([{ floorId: "f2", apId: "b", radioKey: "r5" }]);
  });
});
