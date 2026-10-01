import type { ExtractionParams } from "@wifi-planner/api-contract";
import type { PlanImage } from "@wifi-planner/domain";
import { useEffect, useMemo, useState } from "react";
import { notifyError } from "../../notify";
import { runExtractionJob } from "../extraction/useExtraction";
import { buildSnapGuides, type GuideSegment, type SnapGuides } from "./guides";

/** スナップ用の線の抽出。輪郭を抽出してから Hough 変換で線分を得る。壁の両側の線にスナップできるよう、平行な線はまとめない */
const GUIDE_PARAMS: Partial<ExtractionParams> = {
  method: "hough",
  preprocess: "contour",
  minLineLengthPx: 20,
  mergeParallel: false,
};

/**
 * スナップ用の図面の線（FR-4.4）。ユーザーごとのローカル状態とし、文書には入れない。
 * 有効にしたときに初めて抽出し、図面の画像かトリミングが変わるまでは結果を使い回す
 */
export function useSnapGuides(projectId: string, plan: PlanImage | undefined, enabled: boolean) {
  // 線は図面座標で持つので、画像とトリミングのほか、ピクセルあたりの図面座標が変わっても取り直す
  const key = plan && `${plan.imageSha256}:${plan.unitsPerPx}:${JSON.stringify(plan.crop ?? null)}`;
  const [loaded, setLoaded] = useState<{ key: string; segments: GuideSegment[] }>();
  const [loading, setLoading] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: key が図面の画像、縮尺、トリミングを表す
  useEffect(() => {
    if (!enabled || !plan || !key || loaded?.key === key) return;
    const abort = new AbortController();
    setLoading(true);
    runExtractionJob(projectId, plan, GUIDE_PARAMS, abort.signal)
      .then(({ polylines }) => {
        const segments = polylines.flatMap((pl) => pl.slice(1).map((b, i) => ({ a: pl[i]!, b })));
        setLoaded({ key, segments });
      })
      .catch((e) => {
        if (!abort.signal.aborted) notifyError(e);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => {
      abort.abort();
      setLoading(false);
    };
  }, [enabled, key, projectId]);

  const upp = plan?.unitsPerPx ?? 1;
  const current = loaded && loaded.key === key ? loaded.segments : undefined;
  const guides = useMemo<SnapGuides | undefined>(
    () =>
      current &&
      // 長さは画像のピクセルで決め、図面座標に直す
      buildSnapGuides(current, { extend: 4 * upp, minAngleDeg: 15, mergeDistance: 1 * upp }),
    [current, upp],
  );

  return { guides: enabled ? guides : undefined, loading: enabled && loading };
}
