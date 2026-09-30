/// <reference lib="webworker" />
// 伝搬計算の Worker（設計書 6.2 節、6.3 節）。
// 計算の入力（コンパイルしたアンテナパターンなど）は Worker 間で受け渡せないので、文書から Worker の中で組み立てる。
import { buildFloorScene, computeField } from "@wifi-planner/propagation";
import type { ComputeRequest, ComputeResponse, RadioField } from "./protocol";

/** フロアと帯域ごとの、ラジオの計算結果。キーはラジオの計算に効く値を並べた文字列 */
const caches = new Map<string, { environment: string; fields: Map<string, Float32Array> }>();

self.onmessage = (e: MessageEvent<ComputeRequest>) => {
  const { id, doc, floorId, band } = e.data;
  const start = performance.now();
  const scene = buildFloorScene(doc, floorId, band);
  if (scene.status !== "ok") {
    self.postMessage({ id, status: scene.status } satisfies ComputeResponse);
    return;
  }
  const floor = doc.floors[floorId]!;
  // 壁、材質、設定、図面の変換が変わったら、すべてのラジオを計算し直す
  const environment = JSON.stringify([
    floor.walls,
    doc.materials,
    doc.settings,
    floor.scale,
    floor.plan,
  ]);
  // 疑似 3D ビューでは全フロアを続けて計算するので、フロアと帯域ごとにキャッシュを分ける
  const cacheKey = `${floorId}:${band}`;
  let entry = caches.get(cacheKey);
  if (!entry || entry.environment !== environment) {
    entry = { environment, fields: new Map() };
    caches.set(cacheKey, entry);
  }
  const cache = entry.fields;
  const used = new Set<string>();
  let computed = 0;
  const radios: RadioField[] = scene.radios.map((r) => {
    const ap = floor.aps[r.apId]!;
    const modelRadio = doc.apModels[ap.modelId]?.radios.find((m) => m.key === r.radioKey);
    const key = JSON.stringify([
      ap.position,
      ap.heightM,
      ap.mount,
      ap.azimuthDeg,
      ap.tiltDeg,
      ap.radios.find((x) => x.key === r.radioKey),
      modelRadio?.pattern,
    ]);
    used.add(key);
    let field = cache.get(key);
    if (!field) {
      field = computeField(r.source, scene.env, scene.grid);
      cache.set(key, field);
      computed++;
    }
    // キャッシュの配列を手放さないよう、写しを送る
    return {
      apId: r.apId,
      radioKey: r.radioKey,
      channel: r.channel,
      widthMHz: r.widthMHz,
      range: r.range,
      field: field.slice(),
    };
  });
  // 消えたラジオの結果は捨てる
  for (const key of cache.keys()) if (!used.has(key)) cache.delete(key);

  const response: ComputeResponse = {
    id,
    status: "ok",
    grid: scene.grid,
    radios,
    computed,
    elapsedMs: performance.now() - start,
  };
  self.postMessage(response, { transfer: radios.map((r) => r.field.buffer) });
};
