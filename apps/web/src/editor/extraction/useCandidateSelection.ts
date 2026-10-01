import type { Vec2 } from "@wifi-planner/domain";
import { useState } from "react";
import type { ToolController } from "../canvas/PlanCanvas";
import { hitTestWall, rectToPolygon, wallsInPolygon } from "../geometry";
import type { Candidate } from "./useExtraction";

/** 画面上で何ピクセル以内を「近い」とみなすか */
const HIT_PX = 8;
/** これより小さいドラッグはクリックとみなす */
const DRAG_PX = 3;

export type CandidateMarquee = { polygon: Vec2[]; pick: boolean };

/**
 * 候補の選択の操作（FR-4.3）。クリックで 1 本の選択を切り替え、左ボタンのドラッグで範囲に触れる候補を選び、
 * 右ボタンのドラッグで範囲に触れる候補の選択を外す
 */
export function useCandidateSelection(
  candidates: readonly Candidate[],
  actions: { toggle: (id: string) => void; setPicked: (ids: string[], on: boolean) => void },
) {
  const [drag, setDrag] = useState<{ start: Vec2; end: Vec2; pick: boolean }>();

  const asWalls = () => candidates.map((c) => ({ ...c, materialId: "", openings: [] }));
  const polygonOf = (d: { start: Vec2; end: Vec2 }) =>
    rectToPolygon({
      x: Math.min(d.start.x, d.end.x),
      y: Math.min(d.start.y, d.end.y),
      width: Math.abs(d.end.x - d.start.x),
      height: Math.abs(d.end.y - d.start.y),
    });

  const controller: ToolController = {
    cursor: "pointer",
    rightButton: true,
    onDown: (e) => setDrag({ start: e.p, end: e.p, pick: e.button !== 2 }),
    onMove: (e) => drag && setDrag({ ...drag, end: e.p }),
    onUp: (e) => {
      if (!drag) return;
      setDrag(undefined);
      const tiny = Math.hypot(e.p.x - drag.start.x, e.p.y - drag.start.y) <= DRAG_PX * e.px;
      if (tiny) {
        const hit = hitTestWall(asWalls(), drag.start, HIT_PX * e.px);
        if (!hit) return;
        // 左クリックは切り替え、右クリックは外す
        if (drag.pick) actions.toggle(hit.wall.id);
        else actions.setPicked([hit.wall.id], false);
        return;
      }
      actions.setPicked(wallsInPolygon(asWalls(), polygonOf({ ...drag, end: e.p })), drag.pick);
    },
    onCancel: () => setDrag(undefined),
  };

  const marquee: CandidateMarquee | undefined =
    drag && (drag.start.x !== drag.end.x || drag.start.y !== drag.end.y)
      ? { polygon: polygonOf(drag), pick: drag.pick }
      : undefined;

  return { controller, marquee };
}
