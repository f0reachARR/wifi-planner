import type { Band, FrequencyRange, ProjectDoc } from "@wifi-planner/domain";
import type { GridSpec, SceneNotes, SectionGrid, SectionParams } from "@wifi-planner/propagation";

/** 床面のヒートマップの計算の依頼 */
export type ComputeRequest = {
  kind: "floor";
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

/** 縦の断面（FR-3.9、設計書 6.5 節）の計算の依頼 */
export type SectionRequest = {
  kind: "section";
  id: number;
  /** ComputeRequest と同じく、全フロアを含む文書 */
  doc: ProjectDoc;
  band: Band;
  section: SectionParams;
};

export type SectionResponse =
  | {
      id: number;
      status: "ok";
      grid: SectionGrid;
      radios: RadioField[];
      computed: number;
      elapsedMs: number;
    }
  | { id: number; status: "empty" };

export type WorkerRequest = ComputeRequest | SectionRequest;
export type WorkerResponse = ComputeResponse | SectionResponse;
