import type { ExtractionJob, ExtractionParams } from "@wifi-planner/api-contract";
import type { PlanImage, Vec2 } from "@wifi-planner/domain";
import { useState } from "react";
import { api } from "../../api/client";
import { notifyError } from "../../notify";

export type Candidate = { id: string; points: Vec2[] };

/** 壁の自動抽出の実行と候補（FR-4.1〜4.3）。候補はこのユーザーのローカル状態にだけ持つ */
export function useExtraction(projectId: string, plan: PlanImage | undefined) {
  const [running, setRunning] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [elapsedMs, setElapsedMs] = useState<number>();

  const run = async (params: Partial<ExtractionParams>) => {
    if (!plan) return;
    setRunning(true);
    try {
      const upp = plan.unitsPerPx;
      // トリミングしていれば、その範囲だけを処理する。範囲は画像のピクセルで渡す
      const region = plan.crop && {
        x: plan.crop.x / upp,
        y: plan.crop.y / upp,
        width: plan.crop.width / upp,
        height: plan.crop.height / upp,
      };
      const created = await api.post<ExtractionJob>(`/projects/${projectId}/extractions`, {
        imageSha256: plan.imageSha256,
        region,
        params,
      });
      let job = created;
      while (job.status === "running") {
        await new Promise((r) => setTimeout(r, 400));
        job = await api.get<ExtractionJob>(`/projects/${projectId}/extractions/${created.id}`);
      }
      if (job.status === "failed") throw new Error(job.error ?? "抽出に失敗しました");
      const next = (job.polylines ?? []).map((pl, i) => ({
        id: `c${i}`,
        points: pl.map((p) => ({ x: p.x * upp, y: p.y * upp })),
      }));
      setCandidates(next);
      // 最初はすべて選んだ状態にし、要らないものを外してもらう
      setPicked(new Set(next.map((c) => c.id)));
      setElapsedMs(job.elapsedMs);
    } catch (e) {
      notifyError(e);
    } finally {
      setRunning(false);
    }
  };

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** 候補を一覧から外す（採用した候補と却下した候補） */
  const remove = (ids: ReadonlySet<string>) => {
    setCandidates((cs) => cs.filter((c) => !ids.has(c.id)));
    setPicked((s) => new Set([...s].filter((id) => !ids.has(id))));
  };

  return {
    running,
    candidates,
    picked,
    elapsedMs,
    run,
    toggle,
    remove,
    pickAll: () => setPicked(new Set(candidates.map((c) => c.id))),
    pickNone: () => setPicked(new Set()),
    clear: () => {
      setCandidates([]);
      setPicked(new Set());
    },
  };
}
