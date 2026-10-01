import type { Band, ProjectDoc } from "@wifi-planner/domain";
import type { SectionParams } from "@wifi-planner/propagation";
import { useEffect, useRef, useState } from "react";
import type {
  ComputeRequest,
  ComputeResponse,
  SectionRequest,
  SectionResponse,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";

const DEBOUNCE_MS = 150;

let worker: Worker | undefined;
const listeners = new Set<(r: WorkerResponse) => void>();

/** Worker はページで一つを使い回し、ラジオごとの結果のキャッシュを保つ */
function post(request: WorkerRequest) {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      for (const l of listeners) l(e.data);
    };
  }
  worker.postMessage(request);
}

let nextId = 1;

/** 他のフロアの AP、壁、床スラブも計算に使うので全フロアを送る。写真のピンとエリアは計算に効かないので除く */
const forCompute = (doc: ProjectDoc): ProjectDoc => ({
  ...doc,
  floors: Object.fromEntries(
    Object.entries(doc.floors).map(([fid, f]) => [fid, { ...f, photoPins: {}, areas: {} }]),
  ),
});

/** 依頼の id ごとに結果を受け、後から頼んだ計算の結果だけを使う */
function useLatestResult<R extends WorkerResponse>() {
  const [result, setResult] = useState<R>();
  const [pending, setPending] = useState(false);
  const latest = useRef(0);
  useEffect(() => {
    const onResult = (r: WorkerResponse) => {
      if (r.id !== latest.current) return;
      setResult(r as R);
      setPending(false);
    };
    listeners.add(onResult);
    return () => {
      listeners.delete(onResult);
    };
  }, []);
  return { result, setResult, pending, setPending, latest };
}

/**
 * フロアの伝搬計算の結果（FR-8.8）。文書が変わると、少し待ってから計算し直す。
 * 計算は Worker で行うので、計算中も UI の操作は止まらない（NFR-1）。
 */
export function useHeatmap(
  doc: ProjectDoc | undefined,
  floorId: string,
  band: Band,
  enabled: boolean,
) {
  const { result, setResult, pending, setPending, latest } = useLatestResult<ComputeResponse>();

  useEffect(() => {
    if (!enabled || !doc?.floors[floorId]) return;
    setPending(true);
    const timer = setTimeout(() => {
      const id = nextId++;
      latest.current = id;
      const request: ComputeRequest = { kind: "floor", id, doc: forCompute(doc), floorId, band };
      post(request);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [doc, floorId, band, enabled, setPending, latest]);

  // 帯域やフロアを切り替えたら、前の結果は見せない
  // biome-ignore lint/correctness/useExhaustiveDependencies: floorId と band の変化だけを見る
  useEffect(() => setResult(undefined), [floorId, band]);

  return { result, pending };
}

/**
 * 縦の断面の計算の結果（FR-3.9、設計書 6.5 節）。文書か断面の位置が変わると、少し待ってから計算し直す。
 * 断面を動かしている間も、前の結果を見せたままにする
 */
export function useSectionHeatmap(
  doc: ProjectDoc | undefined,
  band: Band,
  section: SectionParams,
  enabled: boolean,
) {
  const { result, setResult, pending, setPending, latest } = useLatestResult<SectionResponse>();
  const { angleDeg, offsetM } = section;
  useEffect(() => {
    if (!enabled || !doc) return;
    setPending(true);
    const timer = setTimeout(() => {
      const id = nextId++;
      latest.current = id;
      const request: SectionRequest = {
        kind: "section",
        id,
        doc: forCompute(doc),
        band,
        section: { angleDeg, offsetM },
      };
      post(request);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [doc, band, angleDeg, offsetM, enabled, setPending, latest]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 帯域の変化だけを見る
  useEffect(() => setResult(undefined), [band]);

  return { result, pending };
}
