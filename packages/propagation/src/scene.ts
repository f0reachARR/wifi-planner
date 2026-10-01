import {
  applyRigid,
  type Band,
  effectiveFrequencyMHz,
  type Floor,
  type FloorPlacement,
  type FrequencyRange,
  floorPlacements,
  occupiedRange,
  openingHeightRange,
  type PlanTransform,
  type ProjectDoc,
  type RigidTransform,
  slabMaterialOf,
  wallHeightRange,
} from "@wifi-planner/domain";
import { antennaFrame, compilePattern, rotateFrame } from "./antenna.js";
import { type Environment, type GridSpec, gridForExtent, type RadioSource } from "./field.js";
import { buildSlabLevels, polygon, type SlabRegion } from "./slabs.js";
import { buildSegments, type SegmentSet, type WallInput } from "./walls.js";

export type SceneRadio = {
  /** AP を置いたフロア */
  floorId: string;
  apId: string;
  radioKey: string;
  channel: number;
  widthMHz: number;
  range: FrequencyRange;
  source: RadioSource;
};

/** 計算に含めなかったフロアの扱い（設計書 6.4 節）。画面で知らせるのに使う */
export type SceneNotes = {
  /** 受信するフロアを位置合わせしていないので、そのフロアだけで計算した */
  isolated: boolean;
  /** 位置が分からないので、床スラブが全面にあるものとして扱ったフロア */
  fullSlabFloorIds: string[];
  /** 床スラブの材質が無いので、減衰を 0 dB としたフロア */
  noSlabMaterialFloorIds: string[];
};

export type FloorScene =
  | {
      status: "ok";
      /** 受信するフロアのフロア座標の格子 */
      grid: GridSpec;
      /** 格子のフロア座標をワールド座標に移す変換 */
      toWorld: RigidTransform;
      env: Environment;
      radios: SceneRadio[];
      transform: PlanTransform;
      notes: SceneNotes;
    }
  | { status: "noPlan" }
  | { status: "uncalibrated" };

type ProjectFloor = {
  id: string;
  floor: Floor;
  /** order の順に並べたときの位置。フロアをまたぐ範囲（FR-7.8）の距離に使う */
  index: number;
  placement?: FloorPlacement;
  /** フロアをまたぐ計算に含めるか（スケールを校正済みで、基準フロアか位置合わせ済み） */
  included: boolean;
  /** ワールド座標の壁区間（校正済みのフロアだけ） */
  walls?: SegmentSet;
  /** 床スラブ。位置の分からないフロアは全面 */
  slab: SlabRegion & { z: number };
  slabMaterialMissing: boolean;
};

/** 全フロアに共通の計算の入力（設計書 6.2 節）。受信するフロアによらないので、帯域ごとに一度作れば使い回せる */
export type ProjectScene = {
  floors: Map<string, ProjectFloor>;
  radios: Map<string, SceneRadio[]>;
};

/** 計算の座標（ワールド座標）での壁の入力 */
function wallInputs(
  floor: Floor,
  placement: FloorPlacement,
  lossOf: (materialId: string) => number,
): WallInput[] {
  const mpu = placement.plan.metersPerUnit;
  const toWorld = (p: { x: number; y: number }) =>
    applyRigid(placement.toWorld, placement.plan.toFloor(p));
  return Object.values(floor.walls).map((w) => {
    const r = wallHeightRange(w, floor.heightM);
    const range = { bottom: floor.elevationM + r.bottom, top: floor.elevationM + r.top };
    return {
      points: w.points.map(toWorld),
      lossDb: lossOf(w.materialId),
      range,
      openings: w.openings.map((o) => ({
        start: o.start * mpu,
        end: o.end * mpu,
        lossDb: lossOf(o.materialId),
        range: openingHeightRange(o, range),
      })),
    };
  });
}

/** 計算範囲（トリミング範囲、なければ図面全体、設計書 6.2 節）の図面座標の 4 隅 */
function planCorners(floor: Floor) {
  const plan = floor.plan!;
  const rect = plan.crop ?? {
    x: 0,
    y: 0,
    width: plan.widthPx * plan.unitsPerPx,
    height: plan.heightPx * plan.unitsPerPx,
  };
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

function sceneRadios(
  doc: ProjectDoc,
  floorId: string,
  floor: Floor,
  placement: FloorPlacement,
  band: Band,
): SceneRadio[] {
  const radios: SceneRadio[] = [];
  const { cos, sin } = placement.toWorld;
  for (const [apId, ap] of Object.entries(floor.aps)) {
    const model = doc.apModels[ap.modelId];
    if (!model) continue;
    const pos = applyRigid(placement.toWorld, placement.plan.toFloor(ap.position));
    // 方位角はフロア座標で測るので、基底をワールド座標に回しておく（設計書 6.1 節）
    const frame = rotateFrame(antennaFrame(ap.mount, ap.azimuthDeg, ap.tiltDeg), cos, sin);
    for (const radio of ap.radios) {
      if (!radio.enabled || radio.band !== band) continue;
      const modelRadio = model.radios.find((r) => r.key === radio.key);
      const range = occupiedRange(band, radio.channel, radio.widthMHz);
      if (!modelRadio || !range) continue;
      radios.push({
        floorId,
        apId,
        radioKey: radio.key,
        channel: radio.channel,
        widthMHz: radio.widthMHz,
        range,
        source: {
          x: pos.x,
          y: pos.y,
          z: floor.elevationM + ap.heightM,
          frame,
          pattern: compilePattern(modelRadio.pattern, band),
          txPowerDbm: radio.txPowerDbm,
          frequencyMHz: effectiveFrequencyMHz(band, radio.channel, radio.widthMHz),
        },
      });
    }
  }
  return radios;
}

/** 全フロアの壁、床スラブ、ラジオをワールド座標に置く（設計書 6.1 節、6.4 節） */
export function buildProjectScene(doc: ProjectDoc, band: Band): ProjectScene {
  const lossOf = (materialId: string) => doc.materials[materialId]?.lossDb[band] ?? 0;
  const placements = floorPlacements(doc.floors);
  const ordered = Object.entries(doc.floors).sort((a, b) => a[1].order - b[1].order);
  const floors = new Map<string, ProjectFloor>();
  const radios = new Map<string, SceneRadio[]>();
  ordered.forEach(([id, floor], index) => {
    const placement = placements[id];
    const included = placement?.aligned ?? false;
    const slabMaterial = slabMaterialOf(doc.materials, floor);
    const lossDb = slabMaterial ? lossOf(slabMaterial) : 0;
    const slab: SlabRegion & { z: number } = { z: floor.elevationM, lossDb, holes: [] };
    if (placement && included) {
      const toWorld = (p: { x: number; y: number }) =>
        applyRigid(placement.toWorld, placement.plan.toFloor(p));
      slab.outline = polygon(planCorners(floor).map(toWorld));
      slab.holes = Object.values(floor.holes).map((h) => polygon(h.points.map(toWorld)));
    }
    floors.set(id, {
      id,
      floor,
      index,
      placement,
      included,
      walls: placement ? buildSegments(wallInputs(floor, placement, lossOf)) : undefined,
      slab,
      slabMaterialMissing: !slabMaterial,
    });
    if (placement) radios.set(id, sceneRadios(doc, id, floor, placement, band));
  });
  return { floors, radios };
}

/**
 * 組の計算に効くフロア（設計書 6.2 節）。受信するフロアと AP のフロアに加え、
 * AP と受信点の高さの範囲に、計算に使う壁の高さの範囲か床面が重なるフロア。キャッシュの環境のキーに使う
 */
export function relevantFloorIds(
  project: ProjectScene,
  scene: Extract<FloorScene, { status: "ok" }>,
  receiverFloorId: string,
  radio: SceneRadio,
): string[] {
  const minZ = Math.min(radio.source.z, scene.env.receiverZ);
  const maxZ = Math.max(radio.source.z, scene.env.receiverZ);
  const out = new Set([receiverFloorId, radio.floorId]);
  if (scene.notes.isolated) return [...out];
  for (const f of project.floors.values()) {
    const wallsHit = f.included && f.walls && f.walls.top > minZ && f.walls.bottom <= maxZ;
    const slabHit = f.slab.z > minZ && f.slab.z <= maxZ;
    if (wallsHit || slabHit) out.add(f.id);
  }
  return [...out];
}

/**
 * 1 フロア、1 帯域の伝搬計算の入力を組み立てる（FR-7.5〜7.8）。
 * 計算の対象は、受信するフロアと対象範囲のフロアに置いた AP の有効なラジオのうち、指定した帯域のものに限る。
 */
export function buildFloorScene(
  doc: ProjectDoc,
  floorId: string,
  band: Band,
  project: ProjectScene = buildProjectScene(doc, band),
): FloorScene {
  const floor = doc.floors[floorId];
  if (!floor?.plan) return { status: "noPlan" };
  const here = project.floors.get(floorId);
  const placement = here?.placement;
  if (!here || !placement) return { status: "uncalibrated" };

  const receiverZ = floor.elevationM + doc.settings.receiverHeightM;
  const range = doc.settings.crossFloorRange;
  // 位置合わせをしていないフロアは、そのフロアの AP と壁だけで計算する（設計書 6.4 節）
  const isolated = !here.included;
  const sources = isolated
    ? [here]
    : [...project.floors.values()].filter(
        (f) => f.included && (range === null || Math.abs(f.index - here.index) <= range),
      );
  const radios = sources.flatMap((f) => project.radios.get(f.id) ?? []);

  const walls: SegmentSet[] = [];
  const slabs: (SlabRegion & { z: number })[] = [];
  const notes: SceneNotes = { isolated, fullSlabFloorIds: [], noSlabMaterialFloorIds: [] };
  if (isolated) {
    if (here.walls) walls.push(here.walls);
  } else {
    // 経路が床面を横切りうるフロアだけを知らせる
    const zs = [receiverZ, ...radios.map((r) => r.source.z)];
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    for (const f of project.floors.values()) {
      if (f.included && f.walls) walls.push(f.walls);
      slabs.push(f.slab);
      if (f.slab.z <= minZ || f.slab.z > maxZ) continue;
      if (!f.included) notes.fullSlabFloorIds.push(f.id);
      if (f.slabMaterialMissing) notes.noSlabMaterialFloorIds.push(f.id);
    }
  }

  const env: Environment = {
    walls,
    slabs: buildSlabLevels(slabs),
    receiverZ,
    pathLossExponent: doc.settings.pathLossExponent[band],
    rxGainDbi: doc.settings.rxGainDbi,
  };

  // 計算範囲はトリミング範囲、なければ図面全体（設計書 6.2 節）
  const corners = planCorners(floor).map(placement.plan.toFloor);
  const grid = gridForExtent(
    {
      minX: Math.min(...corners.map((c) => c.x)),
      minY: Math.min(...corners.map((c) => c.y)),
      maxX: Math.max(...corners.map((c) => c.x)),
      maxY: Math.max(...corners.map((c) => c.y)),
    },
    doc.settings.gridResolutionM,
  );

  return {
    status: "ok",
    grid,
    toWorld: placement.toWorld,
    env,
    radios,
    transform: placement.plan,
    notes,
  };
}
