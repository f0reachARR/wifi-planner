import type { Band, FrequencyRange, ProjectDoc } from "@wifi-planner/domain";
import type { GridSpec } from "@wifi-planner/propagation";

export type ComputeRequest = {
  id: number;
  /** 対象のフロアだけを含む文書 */
  doc: ProjectDoc;
  floorId: string;
  band: Band;
};

export type RadioField = {
  apId: string;
  radioKey: string;
  channel: number;
  widthMHz: number;
  range: FrequencyRange;
  field: Float32Array;
};

export type ComputeResponse =
  | {
      id: number;
      status: "ok";
      grid: GridSpec;
      radios: RadioField[];
      computed: number;
      elapsedMs: number;
    }
  | { id: number; status: "noPlan" | "uncalibrated" };
