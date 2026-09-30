import {
  canPlaceOpening,
  DEFAULT_WALL_MATERIAL_ID,
  type OpeningKind,
  polylineLength,
  type Vec2,
} from "@wifi-planner/domain";
import {
  addWall,
  deleteWalls,
  moveWalls,
  newId,
  readWall,
  splitWallAt,
  updateWall,
} from "@wifi-planner/domain/ops";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../../collab/react";
import { notifyError } from "../../notify";
import type { CanvasTool, ToolController } from "../canvas/PlanCanvas";
import { hitTestWall, rectToPolygon, snapPoint, type WallEntry, wallsInPolygon } from "../geometry";
import type { WallDrafts } from "./WallLayer";

/** 画面上で何ピクセル以内を「近い」とみなすか */
const HIT_PX = 8;
const SNAP_PX = 10;
/** これより小さいドラッグはクリックとみなす */
const DRAG_PX = 3;

export type SelectMode = "rect" | "lasso";

type Gesture =
  | { kind: "marquee"; start: Vec2; points: Vec2[]; additive: boolean }
  | {
      kind: "move";
      start: Vec2;
      ids: string[];
      clicked: string;
      dx: number;
      dy: number;
      moved: boolean;
    }
  | { kind: "vertex"; wallId: string; index: number; point: Vec2 };

/** 開口部の既定の幅（メートル） */
const OPENING_WIDTH_M: Record<OpeningKind, number> = { door: 0.9, window: 1.8, other: 1.0 };
const OPENING_MATERIAL: Record<OpeningKind, string> = {
  door: "woodDoor",
  window: "glass",
  other: "drywall",
};

/**
 * 壁の編集の道具（FR-4.4〜4.6、FR-4.8）。選択はユーザーごとのローカル状態とし、awareness でほかのユーザーに見せる。
 */
export function useWallTools(opts: {
  floorId: string;
  walls: WallEntry[];
  tool: CanvasTool;
  metersPerUnit: number | undefined;
  materialIds: ReadonlySet<string>;
}) {
  const { floorId, walls, tool } = opts;
  const session = useSession();
  const readOnly = session.readOnly;
  const [selection, setSelection] = useState<string[]>([]);
  const [drawing, setDrawingState] = useState<Vec2[]>([]);
  // 同じイベントの中で続けて読んでも最新の点列が見えるよう、ref にも持つ
  const drawingRef = useRef<Vec2[]>([]);
  const setDrawing = (next: Vec2[] | ((prev: Vec2[]) => Vec2[])) => {
    drawingRef.current = typeof next === "function" ? next(drawingRef.current) : next;
    setDrawingState(drawingRef.current);
  };
  const [hover, setHover] = useState<{ point: Vec2; snap: ReturnType<typeof snapPoint>["kind"] }>();
  const [wallHover, setWallHover] = useState<{ wallId: string; point: Vec2 }>();
  const [gesture, setGesture] = useState<Gesture>();
  const [selectMode, setSelectMode] = useState<SelectMode>("rect");
  const [drawMaterialId, setDrawMaterialId] = useState(DEFAULT_WALL_MATERIAL_ID);
  const [openingKind, setOpeningKind] = useState<OpeningKind>("door");

  const selectionSet = useMemo(() => new Set(selection), [selection]);

  // 消えた壁を選択から外す（ほかのユーザーが消した場合など）
  useEffect(() => {
    const ids = new Set(walls.map((w) => w.id));
    if (selection.some((id) => !ids.has(id))) setSelection((s) => s.filter((id) => ids.has(id)));
  }, [walls, selection]);

  useEffect(() => session.setPresence({ selection }), [session, selection]);

  // 道具を切り替えたら作りかけの操作を捨てる
  // biome-ignore lint/correctness/useExhaustiveDependencies: tool の変化だけを見る
  useEffect(() => {
    setDrawing([]);
    setGesture(undefined);
    setHover(undefined);
    setWallHover(undefined);
  }, [tool]);

  // 描画する材質が消えたら既定に戻す
  useEffect(() => {
    if (!opts.materialIds.has(drawMaterialId))
      setDrawMaterialId([...opts.materialIds][0] ?? DEFAULT_WALL_MATERIAL_ID);
  }, [opts.materialIds, drawMaterialId]);

  const snap = (p: Vec2, px: number, previous?: Vec2, excludeWallIds?: ReadonlySet<string>) =>
    snapPoint(p, {
      walls,
      extraEndpoints: drawing.length > 2 ? [drawing[0]!] : [],
      previous,
      tolerance: SNAP_PX * px,
      excludeWallIds,
    });

  const finishDrawing = (points: Vec2[] = drawingRef.current) => {
    // ダブルクリックで同じ点が 2 回入ることがあるので、連続する重複を除く
    const pts = points.filter(
      (p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y,
    );
    if (pts.length >= 2) {
      let id = "";
      session.mutate((ydoc) => {
        id = addWall(ydoc, floorId, { points: pts, materialId: drawMaterialId, openings: [] });
      });
      if (id) setSelection([id]);
    }
    setDrawing([]);
  };

  const deleteSelection = () => {
    if (selection.length === 0) return;
    session.mutate((ydoc) => deleteWalls(ydoc, floorId, selection));
    setSelection([]);
  };

  const placeOpening = (wall: WallEntry, s: number) => {
    const total = polylineLength(wall.points);
    const mpu = opts.metersPerUnit;
    // スケールが未校正なら、壁の長さに対する割合で幅を決める
    const width = Math.min(total, mpu ? OPENING_WIDTH_M[openingKind] / mpu : total * 0.1);
    const start = Math.min(Math.max(0, s - width / 2), total - width);
    const end = start + width;
    if (!canPlaceOpening(wall, start, end)) {
      notifyError(new Error("ほかの開口部と重なるため置けません"));
      return;
    }
    const materialId = opts.materialIds.has(OPENING_MATERIAL[openingKind])
      ? OPENING_MATERIAL[openingKind]
      : wall.materialId;
    session.mutate((ydoc) =>
      updateWall(ydoc, floorId, wall.id, {
        openings: [...wall.openings, { id: newId(), kind: openingKind, start, end, materialId }],
      }),
    );
    setSelection([wall.id]);
  };

  const controller: ToolController = {};

  if (tool === "wall" && !readOnly) {
    controller.cursor = "crosshair";
    controller.onMove = (e) => {
      const s = snap(e.p, e.px, drawing.at(-1));
      setHover({ point: s.point, snap: s.kind });
    };
    controller.onDown = (e) => {
      const current = drawingRef.current;
      // ダブルクリックの 2 回目は点を足さずに確定する（1 回目で点は置いてある）
      if (e.clickCount >= 2) {
        finishDrawing();
        return;
      }
      const s = snap(e.p, e.px, current.at(-1));
      // 最初の点に戻ったら閉じて確定する
      if (current.length > 2 && s.point.x === current[0]!.x && s.point.y === current[0]!.y) {
        finishDrawing([...current, s.point]);
        return;
      }
      setDrawing([...current, s.point]);
    };
  }

  if (tool === "split" || tool === "opening") {
    controller.cursor = "pointer";
    controller.onMove = (e) => {
      const hit = hitTestWall(walls, e.p, HIT_PX * e.px);
      setWallHover(hit && { wallId: hit.wall.id, point: hit.point });
    };
    controller.onDown = (e) => {
      if (readOnly) return;
      const hit = hitTestWall(walls, e.p, HIT_PX * e.px);
      if (!hit) return;
      if (tool === "split") {
        let ids: [string, string] | undefined;
        session.mutate((ydoc) => {
          ids = splitWallAt(ydoc, floorId, hit.wall.id, hit.s);
        });
        if (ids) setSelection(ids);
      } else {
        placeOpening(hit.wall, hit.s);
      }
    };
  }

  if (tool === "select") {
    controller.cursor = "default";
    controller.onDown = (e) => {
      // 選んだ壁が 1 本なら、頂点のハンドルを先に調べる
      if (!readOnly && selection.length === 1) {
        const wall = walls.find((w) => w.id === selection[0]);
        const index =
          wall?.points.findIndex((p) => Math.hypot(p.x - e.p.x, p.y - e.p.y) <= HIT_PX * e.px) ??
          -1;
        if (wall && index >= 0) {
          setGesture({ kind: "vertex", wallId: wall.id, index, point: wall.points[index]! });
          return;
        }
      }
      const hit = hitTestWall(walls, e.p, HIT_PX * e.px);
      if (hit) {
        const id = hit.wall.id;
        if (e.shift || e.mod) {
          setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
          return;
        }
        const ids = selectionSet.has(id) ? selection : [id];
        setSelection(ids);
        setGesture({ kind: "move", start: e.p, ids, clicked: id, dx: 0, dy: 0, moved: false });
        return;
      }
      setGesture({ kind: "marquee", start: e.p, points: [e.p], additive: e.shift || e.mod });
    };
    controller.onMove = (e) => {
      if (!gesture) return;
      if (gesture.kind === "marquee") {
        setGesture({
          ...gesture,
          points: selectMode === "lasso" ? [...gesture.points, e.p] : [gesture.start, e.p],
        });
      } else if (gesture.kind === "move") {
        if (readOnly) return;
        const dx = e.p.x - gesture.start.x;
        const dy = e.p.y - gesture.start.y;
        const moved = gesture.moved || Math.hypot(dx, dy) > DRAG_PX * e.px;
        setGesture({ ...gesture, dx, dy, moved });
        if (moved) session.setPresence({ drag: { wallIds: gesture.ids, dx, dy } });
      } else if (gesture.kind === "vertex") {
        const wall = walls.find((w) => w.id === gesture.wallId);
        const neighbor = wall?.points[gesture.index === 0 ? 1 : gesture.index - 1];
        const s = snap(e.p, e.px, neighbor, new Set([gesture.wallId]));
        setGesture({ ...gesture, point: s.point });
      }
    };
    controller.onUp = (e) => {
      if (!gesture) return;
      if (gesture.kind === "marquee") {
        const polygon =
          selectMode === "lasso"
            ? gesture.points
            : rectToPolygon({
                x: Math.min(gesture.start.x, e.p.x),
                y: Math.min(gesture.start.y, e.p.y),
                width: Math.abs(e.p.x - gesture.start.x),
                height: Math.abs(e.p.y - gesture.start.y),
              });
        const tiny = Math.hypot(e.p.x - gesture.start.x, e.p.y - gesture.start.y) <= DRAG_PX * e.px;
        const picked = tiny ? [] : wallsInPolygon(walls, polygon);
        setSelection((s) => (gesture.additive ? [...new Set([...s, ...picked])] : picked));
      } else if (gesture.kind === "move") {
        if (gesture.moved) {
          session.mutate((ydoc) => moveWalls(ydoc, floorId, gesture.ids, gesture.dx, gesture.dy));
          session.setPresence({ drag: undefined });
        } else {
          // 選択中の壁をドラッグせずにクリックしたときは、その壁だけを選ぶ
          setSelection([gesture.clicked]);
        }
      } else if (gesture.kind === "vertex") {
        session.mutate((ydoc) => {
          const wall = readWall(ydoc, floorId, gesture.wallId);
          if (!wall) return;
          const points = wall.points.map((p, i) => (i === gesture.index ? gesture.point : p));
          // 頂点を動かすと長さが変わるので、壁からはみ出した開口部は外す
          const total = polylineLength(points);
          updateWall(ydoc, floorId, gesture.wallId, {
            points,
            openings: wall.openings.filter((o) => o.end <= total),
          });
        });
      }
      setGesture(undefined);
    };
  }

  const drafts: WallDrafts = {
    drawing:
      tool === "wall" && (drawing.length > 0 || hover)
        ? { points: drawing, hover: hover?.point, snap: hover?.snap ?? "none" }
        : undefined,
    marquee: gesture?.kind === "marquee" ? marqueePolygon(gesture, selectMode) : undefined,
    move:
      gesture?.kind === "move" && gesture.moved ? { dx: gesture.dx, dy: gesture.dy } : undefined,
    vertex: gesture?.kind === "vertex" ? gesture : undefined,
    hover: (tool === "split" || tool === "opening") && wallHover ? wallHover : undefined,
  };

  return {
    controller,
    drafts,
    selection,
    selectionSet,
    setSelection,
    selectMode,
    setSelectMode,
    drawMaterialId,
    setDrawMaterialId,
    openingKind,
    setOpeningKind,
    drawing,
    finishDrawing,
    cancelDrawing: () => setDrawing([]),
    undoLastPoint: () => setDrawing((d) => d.slice(0, -1)),
    deleteSelection,
  };
}

function marqueePolygon(g: Extract<Gesture, { kind: "marquee" }>, mode: SelectMode): Vec2[] {
  if (mode === "lasso") return g.points;
  const end = g.points.at(-1) ?? g.start;
  return rectToPolygon({
    x: Math.min(g.start.x, end.x),
    y: Math.min(g.start.y, end.y),
    width: Math.abs(end.x - g.start.x),
    height: Math.abs(end.y - g.start.y),
  });
}
