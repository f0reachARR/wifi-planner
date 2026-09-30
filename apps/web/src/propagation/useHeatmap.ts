import type { Band, ProjectDoc } from "@wifi-planner/domain";
import { useEffect, useRef, useState } from "react";
import type { ComputeRequest, ComputeResponse } from "./protocol";

const DEBOUNCE_MS = 150;

let worker: Worker | undefined;
const listeners = new Set<(r: ComputeResponse) => void>();

/** Worker はページで一つを使い回し、ラジオごとの結果のキャッシュを保つ */
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<ComputeResponse>) => {
      for (const l of listeners) l(e.data);
    };
  }
  return worker;
}

let nextId = 1;

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
  const [result, setResult] = useState<ComputeResponse>();
  const [pending, setPending] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const onResult = (r: ComputeResponse) => {
      // 後から頼んだ計算の結果だけを使う
      if (r.id !== latest.current) return;
      setResult(r);
      setPending(false);
    };
    listeners.add(onResult);
    return () => {
      listeners.delete(onResult);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !doc?.floors[floorId]) return;
    setPending(true);
    const timer = setTimeout(() => {
      const id = nextId++;
      latest.current = id;
      const floor = doc.floors[floorId]!;
      const request: ComputeRequest = {
        id,
        doc: { ...doc, floors: { [floorId]: floor } },
        floorId,
        band,
      };
      getWorker().postMessage(request);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [doc, floorId, band, enabled]);

  // 帯域やフロアを切り替えたら、前の結果は見せない
  // biome-ignore lint/correctness/useExhaustiveDependencies: floorId と band の変化だけを見る
  useEffect(() => setResult(undefined), [floorId, band]);

  return { result, pending };
}
