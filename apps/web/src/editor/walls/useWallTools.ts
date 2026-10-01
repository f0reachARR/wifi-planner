import {
  canPlaceOpening,
  DEFAULT_WALL_MATERIAL_ID,
  type OpeningKind,
  polylineLength,
  type Vec2,
} from "@wifi-planner/domain";
import {
  addArea,
  addHole,
  addWall,
  deleteAps,
  deleteAreas,
  deleteHoles,
  deleteWalls,
  moveAps,
  moveAreas,
  moveHoles,
  moveWalls,
  newId,
  readArea,
  readHole,
  readWall,
  splitWallAt,
  updateAp,
  updateArea,
  updateHole,
  updateWall,
} from "@wifi-planner/domain/ops";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../../collab/react";
import { notifyError } from "../../notify";
import { AP_ARROW_PX, type ApEntry } from "../aps/ApLayer";
import { azimuthToPlanDir, planDirToAzimuth } from "../aps/azimuth";
import type { AreaEntry } from "../areas/stats";
import type { CanvasTool, PointerInfo, ToolController } from "../canvas/PlanCanvas";
import {
  type HoleEntry,
  hitTestHole,
  hitTestWall,
  holesInPolygon,
  pointInPolygon,
  rectToPolygon,
  SNAP_PX,
  type SnapKind,
  snapPoint,
  type WallEntry,
  wallsInPolygon,
} from "../geometry";
import type { SnapGuides } from "../snap/guides";
import type { WallDrafts } from "./WallLayer";

/** 画面上で何ピクセル以内を「近い」とみなすか */
const HIT_PX = 8;
const AP_HIT_PX = 12;
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
  | {
      kind: "vertex";
      /** 頂点を動かしている壁、吹き抜け、エリアの ID */
      wallId: string;
      target: "wall" | "hole" | "area";
      index: number;
      point: Vec2;
      snap: SnapKind;
    }
  | { kind: "rotate"; apId: string; azimuthDeg: number };

/** 開口部の既定の幅（メートル） */
const OPENING_WIDTH_M: Record<OpeningKind, number> = { door: 0.9, window: 1.8, other: 1.0 };
const OPENING_MATERIAL: Record<OpeningKind, string> = {
  door: "woodDoor",
  window: "glass",
  other: "drywall",
};

/**
 * 2D ビューの編集の道具（FR-4.4〜4.6、FR-4.8、FR-6.1、FR-11.1）。壁と AP と吹き抜けとエリアを同じ選択で扱う。
 * 選択はユーザーごとのローカル状態とし、awareness でほかのユーザーに見せる。ID は UUID なので種類が違っても重ならない。
 */
export function useWallTools(opts: {
  floorId: string;
  walls: WallEntry[];
  aps: ApEntry[];
  holes: HoleEntry[];
  areas: AreaEntry[];
  tool: CanvasTool;
  metersPerUnit: number | undefined;
  /** 図面の回転。AP の方位角と図面座標の向きを相互に直すのに使う */
  planRotationDeg: number;
  materialIds: ReadonlySet<string>;
  /** スナップ用の図面の線 */
  guides?: SnapGuides;
  /** AP の道具でクリックしたとき。置いた AP の ID を返す */
  onPlaceAp?: (p: Vec2) => string | undefined;
}) {
  const { floorId, walls, aps, holes, areas, tool } = opts;
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

  // 消えた要素を選択から外す（ほかのユーザーが消した場合など）
  useEffect(() => {
    const ids = new Set([
      ...walls.map((w) => w.id),
      ...aps.map((a) => a.id),
      ...holes.map((h) => h.id),
      ...areas.map((a) => a.id),
    ]);
    if (selection.some((id) => !ids.has(id))) setSelection((s) => s.filter((id) => ids.has(id)));
  }, [walls, aps, holes, areas, selection]);

  const hitTestAp = (p: Vec2, px: number) => {
    let best: ApEntry | undefined;
    let bestDist = AP_HIT_PX * px;
    for (const ap of aps) {
      const d = Math.hypot(ap.position.x - p.x, ap.position.y - p.y);
      if (d <= bestDist) {
        best = ap;
        bestDist = d;
      }
    }
    return best;
  };

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

  /** Alt を押している間はスナップしない */
  const snap = (e: PointerInfo, previous?: Vec2, excludeWallIds?: ReadonlySet<string>) =>
    e.alt
      ? { point: e.p, kind: "none" as const }
      : snapPoint(e.p, {
          walls,
          extraEndpoints: drawing.length > 2 ? [drawing[0]!] : [],
          guides: opts.guides,
          previous,
          tolerance: SNAP_PX * e.px,
          excludeWallIds,
        });

  const finishDrawing = (points: Vec2[] = drawingRef.current) => {
    // ダブルクリックで同じ点が 2 回入ることがあるので、連続する重複を除く
    const pts = points.filter(
      (p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y,
    );
    if (tool === "hole" || tool === "area") {
      // 吹き抜けとエリアは閉じた多角形として持つので、最初の点に戻った点は除く
      const first = pts[0];
      const last = pts.at(-1);
      if (pts.length > 1 && first && last && first.x === last.x && first.y === last.y) pts.pop();
      if (pts.length >= 3) {
        let id = "";
        session.mutate((ydoc) => {
          id =
            tool === "hole"
              ? addHole(ydoc, floorId, { points: pts })
              : addArea(ydoc, floorId, {
                  name: nextAreaName(areas),
                  points: pts,
                  headcount: 0,
                });
        });
        if (id) setSelection([id]);
      }
      setDrawing([]);
      return;
    }
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
    session.mutate((ydoc) => {
      deleteWalls(ydoc, floorId, selection);
      deleteAps(ydoc, floorId, selection);
      deleteHoles(ydoc, floorId, selection);
      deleteAreas(ydoc, floorId, selection);
    });
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

  const controller: ToolController = {
    onCancel: () => {
      if (gesture?.kind === "move" && gesture.moved) session.setPresence({ drag: undefined });
      setGesture(undefined);
      setHover(undefined);
      setWallHover(undefined);
    },
  };

  if ((tool === "wall" || tool === "hole" || tool === "area") && !readOnly) {
    controller.cursor = "crosshair";
    controller.onMove = (e) => {
      const s = snap(e, drawing.at(-1));
      setHover({ point: s.point, snap: s.kind });
    };
    controller.onDown = (e) => {
      const current = drawingRef.current;
      // ダブルクリックの 2 回目は点を足さずに確定する（1 回目で点は置いてある）
      if (e.clickCount >= 2) {
        finishDrawing();
        return;
      }
      const s = snap(e, current.at(-1));
      // 最初の点に戻ったら閉じて確定する
      if (current.length > 2 && s.point.x === current[0]!.x && s.point.y === current[0]!.y) {
        finishDrawing([...current, s.point]);
        return;
      }
      setDrawing([...current, s.point]);
    };
  }

  if (tool === "ap" && !readOnly) {
    controller.cursor = "copy";
    controller.onDown = (e) => {
      const id = opts.onPlaceAp?.(e.p);
      if (id) setSelection([id]);
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
      // 選んだ AP が 1 つなら回転のハンドルを、壁か吹き抜けかエリアが 1 つなら頂点のハンドルを先に調べる
      if (!readOnly && selection.length === 1) {
        const ap = aps.find((a) => a.id === selection[0]);
        if (ap) {
          const dir = azimuthToPlanDir(ap.azimuthDeg, opts.planRotationDeg);
          const tip = {
            x: ap.position.x + dir.x * AP_ARROW_PX * e.px,
            y: ap.position.y + dir.y * AP_ARROW_PX * e.px,
          };
          if (Math.hypot(tip.x - e.p.x, tip.y - e.p.y) <= HIT_PX * e.px) {
            setGesture({ kind: "rotate", apId: ap.id, azimuthDeg: ap.azimuthDeg });
            return;
          }
        }
        const wall = walls.find((w) => w.id === selection[0]);
        const hole = holes.find((h) => h.id === selection[0]);
        const area = areas.find((a) => a.id === selection[0]);
        const target = wall ?? hole ?? area;
        const index =
          target?.points.findIndex((p) => Math.hypot(p.x - e.p.x, p.y - e.p.y) <= HIT_PX * e.px) ??
          -1;
        if (target && index >= 0) {
          setGesture({
            kind: "vertex",
            wallId: target.id,
            target: wall ? "wall" : hole ? "hole" : "area",
            index,
            point: target.points[index]!,
            snap: "none",
          });
          return;
        }
      }
      // AP は壁の上に置かれることが多いので、先に調べる。吹き抜けとエリアの輪郭は壁と重なりやすいので後に調べる
      const apHit = hitTestAp(e.p, e.px);
      const hit = apHit ? undefined : hitTestWall(walls, e.p, HIT_PX * e.px);
      const holeHit = apHit || hit ? undefined : hitTestHole(holes, e.p, HIT_PX * e.px);
      const areaHit = apHit || hit || holeHit ? undefined : hitTestHole(areas, e.p, HIT_PX * e.px);
      if (apHit || hit || holeHit || areaHit) {
        const id = apHit ? apHit.id : hit ? hit.wall.id : (holeHit ?? areaHit)!.id;
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
        const points = (
          gesture.target === "wall" ? walls : gesture.target === "hole" ? holes : areas
        ).find((w) => w.id === gesture.wallId)?.points;
        const neighbor =
          gesture.target !== "wall"
            ? points?.at(gesture.index - 1)
            : points?.[gesture.index === 0 ? 1 : gesture.index - 1];
        const s = snap(e, neighbor, new Set([gesture.wallId]));
        setGesture({ ...gesture, point: s.point, snap: s.kind });
      } else if (gesture.kind === "rotate") {
        const ap = aps.find((a) => a.id === gesture.apId);
        if (!ap) return;
        const dir = { x: e.p.x - ap.position.x, y: e.p.y - ap.position.y };
        if (dir.x === 0 && dir.y === 0) return;
        // 1° 単位に丸める。Shift を押している間は 15° 単位
        const step = e.shift ? 15 : 1;
        const deg = Math.round(planDirToAzimuth(dir, opts.planRotationDeg) / step) * step;
        setGesture({ ...gesture, azimuthDeg: deg % 360 });
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
        const picked = tiny
          ? []
          : [
              ...wallsInPolygon(walls, polygon),
              ...aps.filter((a) => pointInPolygon(a.position, polygon)).map((a) => a.id),
              ...holesInPolygon(holes, polygon),
              // エリアは部屋を覆うので、触れるだけで選ぶと壁を囲むたびに選ばれる。すべての頂点が範囲の中にあるものだけを選ぶ
              ...areas
                .filter((a) => a.points.every((p) => pointInPolygon(p, polygon)))
                .map((a) => a.id),
            ];
        setSelection((s) => (gesture.additive ? [...new Set([...s, ...picked])] : picked));
      } else if (gesture.kind === "move") {
        if (gesture.moved) {
          session.mutate((ydoc) => {
            moveWalls(ydoc, floorId, gesture.ids, gesture.dx, gesture.dy);
            moveAps(ydoc, floorId, gesture.ids, gesture.dx, gesture.dy);
            moveHoles(ydoc, floorId, gesture.ids, gesture.dx, gesture.dy);
            moveAreas(ydoc, floorId, gesture.ids, gesture.dx, gesture.dy);
          });
          session.setPresence({ drag: undefined });
        } else {
          // 選択中の壁をドラッグせずにクリックしたときは、その壁だけを選ぶ
          setSelection([gesture.clicked]);
        }
      } else if (gesture.kind === "rotate") {
        if (gesture.azimuthDeg !== aps.find((a) => a.id === gesture.apId)?.azimuthDeg)
          session.mutate((ydoc) =>
            updateAp(ydoc, floorId, gesture.apId, { azimuthDeg: gesture.azimuthDeg }),
          );
      } else if (gesture.kind === "vertex" && gesture.target === "hole") {
        session.mutate((ydoc) => {
          const hole = readHole(ydoc, floorId, gesture.wallId);
          if (!hole) return;
          updateHole(ydoc, floorId, gesture.wallId, {
            points: hole.points.map((p, i) => (i === gesture.index ? gesture.point : p)),
          });
        });
      } else if (gesture.kind === "vertex" && gesture.target === "area") {
        session.mutate((ydoc) => {
          const area = readArea(ydoc, floorId, gesture.wallId);
          if (!area) return;
          updateArea(ydoc, floorId, gesture.wallId, {
            points: area.points.map((p, i) => (i === gesture.index ? gesture.point : p)),
          });
        });
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
      (tool === "wall" || tool === "hole" || tool === "area") && (drawing.length > 0 || hover)
        ? {
            points: drawing,
            hover: hover?.point,
            snap: hover?.snap ?? "none",
            closed: tool !== "wall",
          }
        : undefined,
    marquee: gesture?.kind === "marquee" ? marqueePolygon(gesture, selectMode) : undefined,
    move:
      gesture?.kind === "move" && gesture.moved ? { dx: gesture.dx, dy: gesture.dy } : undefined,
    vertex: gesture?.kind === "vertex" ? gesture : undefined,
    rotate: gesture?.kind === "rotate" ? gesture : undefined,
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

/** 「エリア 3」のような、使われていない次の番号の名前 */
function nextAreaName(areas: readonly AreaEntry[]): string {
  const names = new Set(areas.map((a) => a.name));
  let n = areas.length + 1;
  while (names.has(`エリア ${n}`)) n++;
  return `エリア ${n}`;
}
