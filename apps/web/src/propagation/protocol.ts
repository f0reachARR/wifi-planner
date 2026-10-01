import type { Band, FrequencyRange, ProjectDoc } from "@wifi-planner/domain";
import type { GridSpec, SceneNotes } from "@wifi-planner/propagation";

export type ComputeRequest = {
  id: number;
  /** 全フロアを含み、写真のピンなど計算に効かないものを除いた文書（設計書 6.3 節） */
  doc: ProjectDoc;
  floorId: string;
  band: Band;
};

export type RadioField = {
  /** AP を置いたフロア。受信するフロアと違えば、他のフロアの AP */
  floorId: string;
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
      notes: SceneNotes;
      computed: number;
      elapsedMs: number;
    }
  | { id: number; status: "noPlan" | "uncalibrated" };
