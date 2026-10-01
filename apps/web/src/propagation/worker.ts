/// <reference lib="webworker" />
// 伝搬計算の Worker（設計書 6.2 節、6.3 節）。
// 計算の入力（コンパイルしたアンテナパターンなど）は Worker 間で受け渡せないので、文書から Worker の中で組み立てる。
import { type Material, type ProjectDoc, slabMaterialOf } from "@wifi-planner/domain";
import {
  buildFloorScene,
  buildProjectScene,
  buildSectionScene,
  computeField,
  computeSectionField,
  type ProjectScene,
  relevantFloorIds,
  type SceneRadio,
} from "@wifi-planner/propagation";
import type {
  ComputeRequest,
  ComputeResponse,
  RadioField,
  SectionRequest,
  SectionResponse,
  WorkerRequest,
} from "./protocol";

/** 受信するフロアと帯域ごとの、組の計算結果。キーはその組の計算に効く値を並べた文字列 */
const caches = new Map<string, Map<string, Float32Array>>();

/**
 * フロアごとの環境（壁、吹き抜け、床スラブ、図面の変換、位置合わせ、標高、階高）の版。
 * 要約が変わるたびに版を進め、組のキーには要約そのものではなく版を入れて短くする
 */
const floorVersions = new Map<string, { summary: string; version: number }>();

function floorVersion(
  project: ProjectScene,
  floorId: string,
  materials: Record<string, Material>,
): number {
  const f = project.floors.get(floorId);
  if (!f) return -1;
  const { floor } = f;
  const summary = JSON.stringify([
    f.placement?.toWorld,
    f.included,
    floor.elevationM,
    floor.heightM,
    floor.walls,
    floor.holes,
    slabMaterialOf(materials, floor),
    floor.plan,
    floor.scale,
  ]);
  const prev = floorVersions.get(floorId);
  if (prev?.summary === summary) return prev.version;
  const version = (prev?.version ?? 0) + 1;
  floorVersions.set(floorId, { summary, version });
  return version;
}

/** 計算の依頼一回分の、キャッシュのキーを作る材料 */
function keyContext(doc: ProjectDoc, project: ProjectScene) {
  // 材質と設定は全組に効く。凡例は表示だけの設定なので除く
  const { legend: _, ...settings } = doc.settings;
  const global = JSON.stringify([doc.materials, settings]);
  const versions = new Map<string, number>();
  const versionOf = (fid: string) => {
    let v = versions.get(fid);
    if (v === undefined) {
      v = floorVersion(project, fid, doc.materials);
      versions.set(fid, v);
    }
    return v;
  };
  /** ラジオの計算に効く値と、効くフロアの版と、全体の設定から作るキー */
  const radioKey = (r: SceneRadio, floorIds: readonly string[], extra: unknown = null) => {
    const ap = doc.floors[r.floorId]!.aps[r.apId]!;
    const modelRadio = doc.apModels[ap.modelId]?.radios.find((m) => m.key === r.radioKey);
    return JSON.stringify([
      r.floorId,
      ap.position,
      ap.heightM,
      ap.mount,
      ap.azimuthDeg,
      ap.tiltDeg,
      ap.radios.find((x) => x.key === r.radioKey),
      modelRadio?.pattern,
      [...floorIds].sort().map((fid) => `${fid}@${versionOf(fid)}`),
      global,
      extra,
    ]);
  };
  return { radioKey };
}

/** キャッシュから引き、無ければ計算する。使わなくなったキーは最後に捨てる */
function cachedFields(
  cacheKey: string,
  radios: readonly SceneRadio[],
  keyOf: (r: SceneRadio) => string,
  compute: (r: SceneRadio) => Float32Array,
) {
  let cache = caches.get(cacheKey);
  if (!cache) {
    cache = new Map();
    caches.set(cacheKey, cache);
  }
  const used = new Set<string>();
  let computed = 0;
  const out: RadioField[] = radios.map((r) => {
    const key = keyOf(r);
    used.add(key);
    let field = cache.get(key);
    if (!field) {
      field = compute(r);
      cache.set(key, field);
      computed++;
    }
    // キャッシュの配列を手放さないよう、写しを送る
    return {
      floorId: r.floorId,
      apId: r.apId,
      radioKey: r.radioKey,
      channel: r.channel,
      widthMHz: r.widthMHz,
      range: r.range,
      field: field.slice(),
    };
  });
  // 消えたラジオと、環境が変わった組の結果は捨てる
  for (const key of cache.keys()) if (!used.has(key)) cache.delete(key);
  return { radios: out, computed };
}

function computeFloor({ id, doc, floorId, band }: ComputeRequest) {
  const start = performance.now();
  const project = buildProjectScene(doc, band);
  const scene = buildFloorScene(doc, floorId, band, project);
  if (scene.status !== "ok") {
    self.postMessage({ id, status: scene.status } satisfies ComputeResponse);
    return;
  }
  const { radioKey } = keyContext(doc, project);
  const { radios, computed } = cachedFields(
    `${floorId}:${band}`,
    scene.radios,
    (r) => radioKey(r, relevantFloorIds(project, scene, floorId, r)),
    (r) => computeField(r.source, scene.env, scene.grid, scene.toWorld),
  );
  const response: ComputeResponse = {
    id,
    status: "ok",
    grid: scene.grid,
    radios,
    notes: scene.notes,
    computed,
    elapsedMs: performance.now() - start,
  };
  self.postMessage(response, { transfer: radios.map((r) => r.field.buffer) });
}

/** 縦の断面（設計書 6.5 節）。どのフロアの変更でも値が変わりうるので、全フロアの版をキーに入れる */
function computeSection({ id, doc, band, section }: SectionRequest) {
  const start = performance.now();
  const project = buildProjectScene(doc, band);
  const scene = buildSectionScene(doc, band, section, project);
  if (scene.status !== "ok") {
    self.postMessage({ id, status: "empty" } satisfies SectionResponse);
    return;
  }
  const { radioKey } = keyContext(doc, project);
  const allFloors = [...project.floors.keys()];
  const { radios, computed } = cachedFields(
    `section:${band}`,
    scene.radios,
    (r) => radioKey(r, allFloors, scene.grid),
    (r) => computeSectionField(scene, r, doc.settings.crossFloorRange, project),
  );
  const response: SectionResponse = {
    id,
    status: "ok",
    grid: scene.grid,
    radios,
    computed,
    elapsedMs: performance.now() - start,
  };
  self.postMessage(response, { transfer: radios.map((r) => r.field.buffer) });
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  if (e.data.kind === "section") computeSection(e.data);
  else computeFloor(e.data);
};
