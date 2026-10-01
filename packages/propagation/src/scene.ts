import {
  type Band,
  effectiveFrequencyMHz,
  type FrequencyRange,
  occupiedRange,
  openingHeightRange,
  type PlanTransform,
  type ProjectDoc,
  planTransform,
  wallHeightRange,
} from "@wifi-planner/domain";
import { antennaFrame, compilePattern } from "./antenna.js";
import { type Environment, type GridSpec, gridForExtent, type RadioSource } from "./field.js";
import { buildSegments, type WallInput } from "./walls.js";

export type SceneRadio = {
  apId: string;
  radioKey: string;
  channel: number;
  widthMHz: number;
  range: FrequencyRange;
  source: RadioSource;
};

export type FloorScene =
  | {
      status: "ok";
      grid: GridSpec;
      env: Environment;
      radios: SceneRadio[];
      transform: PlanTransform;
    }
  | { status: "noPlan" }
  | { status: "uncalibrated" };

/**
 * 1 フロア、1 帯域の伝搬計算の入力を組み立てる。
 * 計算の対象は、このフロアに置いた AP の有効なラジオのうち、指定した帯域のものに限る（FR-7.5）。
 */
export function buildFloorScene(doc: ProjectDoc, floorId: string, band: Band): FloorScene {
  const floor = doc.floors[floorId];
  if (!floor?.plan) return { status: "noPlan" };
  const transform = planTransform(floor.plan, floor.scale);
  if (!transform) return { status: "uncalibrated" };

  const mpu = transform.metersPerUnit;
  const lossOf = (materialId: string) => doc.materials[materialId]?.lossDb[band] ?? 0;
  const walls: WallInput[] = Object.values(floor.walls).map((w) => {
    const range = wallHeightRange(w, floor.heightM);
    return {
      points: w.points.map(transform.toFloor),
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

  const env: Environment = {
    segments: buildSegments(walls),
    receiverHeightM: doc.settings.receiverHeightM,
    pathLossExponent: doc.settings.pathLossExponent[band],
    rxGainDbi: doc.settings.rxGainDbi,
  };

  const radios: SceneRadio[] = [];
  for (const [apId, ap] of Object.entries(floor.aps)) {
    const model = doc.apModels[ap.modelId];
    if (!model) continue;
    const pos = transform.toFloor(ap.position);
    const frame = antennaFrame(ap.mount, ap.azimuthDeg, ap.tiltDeg);
    for (const radio of ap.radios) {
      if (!radio.enabled || radio.band !== band) continue;
      const modelRadio = model.radios.find((r) => r.key === radio.key);
      const range = occupiedRange(band, radio.channel, radio.widthMHz);
      if (!modelRadio || !range) continue;
      radios.push({
        apId,
        radioKey: radio.key,
        channel: radio.channel,
        widthMHz: radio.widthMHz,
        range,
        source: {
          x: pos.x,
          y: pos.y,
          heightM: ap.heightM,
          frame,
          pattern: compilePattern(modelRadio.pattern, band),
          txPowerDbm: radio.txPowerDbm,
          frequencyMHz: effectiveFrequencyMHz(band, radio.channel, radio.widthMHz),
        },
      });
    }
  }

  // 計算範囲はトリミング範囲、なければ図面全体（設計書 6.2 節）
  const plan = floor.plan;
  const rect = plan.crop ?? {
    x: 0,
    y: 0,
    width: plan.widthPx * plan.unitsPerPx,
    height: plan.heightPx * plan.unitsPerPx,
  };
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ].map(transform.toFloor);
  const grid = gridForExtent(
    {
      minX: Math.min(...corners.map((c) => c.x)),
      minY: Math.min(...corners.map((c) => c.y)),
      maxX: Math.max(...corners.map((c) => c.x)),
      maxY: Math.max(...corners.map((c) => c.y)),
    },
    doc.settings.gridResolutionM,
  );

  return { status: "ok", grid, env, radios, transform };
}
