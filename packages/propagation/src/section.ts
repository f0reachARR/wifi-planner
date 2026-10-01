import { applyRigid, type Band, floorPlacements, type ProjectDoc } from "@wifi-planner/domain";
import { type Environment, evaluatePointAt, type RadioSource } from "./field.js";
import {
  buildProjectScene,
  type ProjectFloor,
  type ProjectScene,
  planCorners,
  type SceneRadio,
} from "./scene.js";
import { buildSlabLevels } from "./slabs.js";

// 縦の断面（FR-3.9、設計書 6.5 節）。ワールド座標の水平な直線を含む鉛直な面の上で、点ごとの高さで計算する。

/** 断面の位置。向きはワールド座標の +x 軸から反時計回り、ずれは建物の中心から断面に垂直な向きへの距離 */
export type SectionParams = { angleDeg: number; offsetM: number };

/**
 * 断面の格子。点 (i, j) はワールド座標 (ox + ux·s, oy + uy·s)、s = s0 + i·step、高さ z0 + j·step にある。
 * 値は行優先（j が行、下の行から）で並べる
 */
export type SectionGrid = {
  ox: number;
  oy: number;
  ux: number;
  uy: number;
  s0: number;
  z0: number;
  step: number;
  cols: number;
  rows: number;
};

/** 断面を置ける範囲。計算に含めるフロアの計算範囲をワールド座標に置いた外接矩形と、高さの範囲 */
export type SectionBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  bottom: number;
  top: number;
};

/** 断面の点の数の上限。超えるときは格子の間隔を広げる */
export const MAX_SECTION_POINTS = 40_000;

const includedFloors = (project: ProjectScene) =>
  [...project.floors.values()].filter((f) => f.included && f.placement);

/**
 * 断面を置ける範囲。計算に含めるフロア（スケールを校正済みで、基準フロアか位置合わせ済み）が無ければ undefined。
 * 3D ビューで断面の操作の範囲を決めるのにも使うので、文書から直接求める
 */
export function sectionBounds(doc: Pick<ProjectDoc, "floors">): SectionBounds | undefined {
  const placements = floorPlacements(doc.floors);
  const floors = Object.entries(doc.floors).flatMap(([id, floor]) => {
    const placement = placements[id];
    return placement?.aligned ? [{ floor, placement }] : [];
  });
  if (floors.length === 0) return undefined;
  const points = floors.flatMap(({ floor, placement }) =>
    planCorners(floor).map((p) => applyRigid(placement.toWorld, placement.plan.toFloor(p))),
  );
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
    bottom: Math.min(...floors.map((f) => f.floor.elevationM)),
    top: Math.max(...floors.map((f) => f.floor.elevationM + f.floor.heightM)),
  };
}

/** 断面に垂直な向きのずれの範囲。この範囲の外では断面が建物に掛からない */
export function sectionOffsetRange(bounds: SectionBounds, angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  const nx = -Math.sin(a);
  const ny = Math.cos(a);
  const half =
    (Math.abs(nx) * (bounds.maxX - bounds.minX) + Math.abs(ny) * (bounds.maxY - bounds.minY)) / 2;
  return [-half, half];
}

/**
 * 断面の格子。直線を外接矩形で切り取った区間を、格子の解像度の間隔で区切る。
 * 直線が外接矩形に掛からなければ undefined
 */
export function sectionGrid(
  bounds: SectionBounds,
  params: SectionParams,
  resolutionM: number,
): SectionGrid | undefined {
  const a = (params.angleDeg * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const ox = cx - uy * params.offsetM;
  const oy = cy + ux * params.offsetM;
  // 直線 o + s·u を外接矩形で切り取る
  let lo = Number.NEGATIVE_INFINITY;
  let hi = Number.POSITIVE_INFINITY;
  for (const [o, u, min, max] of [
    [ox, ux, bounds.minX, bounds.maxX],
    [oy, uy, bounds.minY, bounds.maxY],
  ] as const) {
    if (Math.abs(u) < 1e-12) {
      if (o < min || o > max) return undefined;
      continue;
    }
    const t0 = (min - o) / u;
    const t1 = (max - o) / u;
    lo = Math.max(lo, Math.min(t0, t1));
    hi = Math.min(hi, Math.max(t0, t1));
  }
  const height = bounds.top - bounds.bottom;
  if (!(hi > lo) || !(height > 0)) return undefined;
  let step = resolutionM;
  const count = (st: number) => (Math.floor((hi - lo) / st) + 1) * (Math.floor(height / st) + 1);
  if (count(step) > MAX_SECTION_POINTS) step *= Math.sqrt(count(step) / MAX_SECTION_POINTS);
  while (count(step) > MAX_SECTION_POINTS) step *= 1.05;
  return {
    ox,
    oy,
    ux,
    uy,
    s0: lo,
    z0: bounds.bottom,
    step,
    cols: Math.floor((hi - lo) / step) + 1,
    rows: Math.floor(height / step) + 1,
  };
}

export type SectionScene =
  | {
      status: "ok";
      grid: SectionGrid;
      env: Environment;
      radios: SceneRadio[];
      /** 行ごとの、その高さの点が属するフロア（設計書 6.5 節） */
      rowFloors: (ProjectFloor | undefined)[];
    }
  | { status: "empty" };

/** その高さ以下にある床面のうち最も高いフロア。同じ高さなら計算に含めるもの、その中では order の小さいもの */
function floorAt(floors: readonly ProjectFloor[], z: number): ProjectFloor | undefined {
  let best: ProjectFloor | undefined;
  for (const f of floors) {
    if (f.floor.elevationM > z) continue;
    if (
      !best ||
      f.floor.elevationM > best.floor.elevationM ||
      (f.floor.elevationM === best.floor.elevationM &&
        (Number(f.included) > Number(best.included) ||
          (f.included === best.included && f.index < best.index)))
    )
      best = f;
  }
  return best;
}

/** 縦の断面の計算の入力（設計書 6.5 節） */
export function buildSectionScene(
  doc: ProjectDoc,
  band: Band,
  params: SectionParams,
  project: ProjectScene = buildProjectScene(doc, band),
): SectionScene {
  const bounds = sectionBounds(doc);
  const grid = bounds && sectionGrid(bounds, params, doc.settings.gridResolutionM);
  if (!grid) return { status: "empty" };
  const included = includedFloors(project);
  const all = [...project.floors.values()];
  const env: Environment = {
    walls: included.flatMap((f) => (f.walls ? [f.walls] : [])),
    slabs: buildSlabLevels(all.map((f) => f.slab)),
    receiverZ: 0,
    pathLossExponent: doc.settings.pathLossExponent[band],
    rxGainDbi: doc.settings.rxGainDbi,
  };
  const rowFloors = Array.from({ length: grid.rows }, (_, j) =>
    floorAt(all, grid.z0 + j * grid.step),
  );
  const radios = included.flatMap((f) => project.radios.get(f.id) ?? []);
  return { status: "ok", grid, env, radios, rowFloors };
}

/**
 * 断面の格子の各点の推定受信電力。値を持たない点（属するフロアを計算に含めない点や、
 * 対象範囲（FR-7.8）の外のフロアからの電波）は −∞ にする
 */
export function computeSectionField(
  scene: Extract<SectionScene, { status: "ok" }>,
  radio: SceneRadio,
  crossFloorRange: number | null,
  project: ProjectScene,
): Float32Array {
  const { grid, env, rowFloors } = scene;
  const src: RadioSource = radio.source;
  const from = project.floors.get(radio.floorId);
  const out = new Float32Array(grid.cols * grid.rows).fill(Number.NEGATIVE_INFINITY);
  for (let j = 0; j < grid.rows; j++) {
    const here = rowFloors[j];
    if (!here?.included || !from) continue;
    if (crossFloorRange !== null && Math.abs(here.index - from.index) > crossFloorRange) continue;
    const z = grid.z0 + j * grid.step;
    for (let i = 0; i < grid.cols; i++) {
      const s = grid.s0 + i * grid.step;
      out[j * grid.cols + i] = evaluatePointAt(
        src,
        env,
        grid.ox + grid.ux * s,
        grid.oy + grid.uy * s,
        z,
      );
    }
  }
  return out;
}
