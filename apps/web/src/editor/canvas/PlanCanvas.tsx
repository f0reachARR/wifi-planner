import { Box, VisuallyHidden } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import type { Rect, Vec2 } from "@wifi-planner/domain";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  Group,
  Image as KonvaImage,
  Rect as KonvaRect,
  Label,
  Layer,
  Line,
  Stage,
  Tag,
  Text,
} from "react-konva";
import { fileUrl } from "../../api/client";
import { useSession, useSessionState } from "../../collab/react";
import type { FloorEntry } from "../FloorPanel";

export type CanvasTool = "pan" | "calibrate" | "crop" | "select" | "wall" | "split" | "opening";

/** 道具に渡すポインタの情報。p は図面座標、px は画面の 1 ピクセルが図面座標でいくつか */
export type PointerInfo = {
  p: Vec2;
  px: number;
  shift: boolean;
  mod: boolean;
  alt: boolean;
  /** ブラウザが数えた連続クリックの回数。離れた位置のクリックは数えない */
  clickCount: number;
};

/** パン、スケール校正、トリミング以外の道具の操作 */
export type ToolController = {
  cursor?: string;
  onDown?(e: PointerInfo): void;
  onMove?(e: PointerInfo): void;
  onUp?(e: PointerInfo): void;
  onDoubleClick?(e: PointerInfo): void;
  /** ポインタがキャンバスの外に出たとき。作りかけのドラッグを捨てる */
  onCancel?(): void;
};

export type View = { x: number; y: number; scale: number };

const MIN_SCALE = 0.01;
const MAX_SCALE = 50;

/** 図面の表示範囲（図面座標）。トリミングしていればその範囲 */
export function planExtent(floor: FloorEntry): Rect | undefined {
  const plan = floor.plan;
  if (!plan) return undefined;
  return (
    plan.crop ?? {
      x: 0,
      y: 0,
      width: plan.widthPx * plan.unitsPerPx,
      height: plan.heightPx * plan.unitsPerPx,
    }
  );
}

/** 範囲が画面に収まる表示位置と倍率 */
function fitView(extent: Rect, rotationDeg: number, size: { width: number; height: number }): View {
  const t = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const corners = [
    [extent.x, extent.y],
    [extent.x + extent.width, extent.y],
    [extent.x, extent.y + extent.height],
    [extent.x + extent.width, extent.y + extent.height],
  ].map(([x, y]) => ({ x: c * x! - s * y!, y: s * x! + c * y! }));
  const minX = Math.min(...corners.map((p) => p.x));
  const maxX = Math.max(...corners.map((p) => p.x));
  const minY = Math.min(...corners.map((p) => p.y));
  const maxY = Math.max(...corners.map((p) => p.y));
  const margin = 40;
  const scale = Math.min(
    (size.width - margin * 2) / (maxX - minX),
    (size.height - margin * 2) / (maxY - minY),
  );
  return {
    scale,
    x: (size.width - (maxX - minX) * scale) / 2 - minX * scale,
    y: (size.height - (maxY - minY) * scale) / 2 - minY * scale,
  };
}

function useHtmlImage(src: string | undefined) {
  const [image, setImage] = useState<HTMLImageElement>();
  useEffect(() => {
    if (!src) {
      setImage(undefined);
      return;
    }
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.src = src;
    return () => {
      img.onload = null;
    };
  }, [src]);
  return image;
}

const normalizeRect = (a: Vec2, b: Vec2): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

export type CanvasHandlers = {
  /** スケール校正の 2 点目を置いたとき */
  onCalibrate?: (a: Vec2, b: Vec2) => void;
  /** トリミングの範囲を決めたとき */
  onCrop?: (rect: Rect) => void;
};

/**
 * フロアの 2D ビュー。子要素は図面座標で描く。
 * 図面の回転は子要素を包むグループの回転で表すので、子要素は回転を意識せずに図面座標で描ける。
 */
export function PlanCanvas(props: {
  floor: FloorEntry;
  tool: CanvasTool;
  handlers?: CanvasHandlers;
  controller?: ToolController;
  /** 図面座標で描く重ね描き。引数は画面の 1 ピクセルが図面座標でいくつか */
  children?: (px: number) => ReactNode;
}) {
  const { floor, tool, handlers, controller } = props;
  const session = useSession();
  const { peers } = useSessionState();
  const { ref: boxRef, width, height } = useElementSize();
  const planGroup = useRef<Konva.Group>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [panning, setPanning] = useState<{ start: Vec2; view: View }>();
  const [draft, setDraft] = useState<{ a: Vec2; b: Vec2 }>();

  const plan = floor.plan;
  const rotation = plan?.rotationDeg ?? 0;
  const extent = planExtent(floor);
  const image = useHtmlImage(plan ? fileUrl(session.projectId, plan.imageSha256) : undefined);

  // フロアを切り替えたとき、図面を差し替えたとき、画面の大きさが決まったときに全体を表示する
  const fitKey = `${floor.id}:${plan?.imageSha256}:${width > 0 && height > 0}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: fitKey が変わったときだけ合わせ直す
  useEffect(() => {
    if (extent && width > 0 && height > 0) setView(fitView(extent, rotation, { width, height }));
  }, [fitKey]);

  // 道具を切り替えたら作りかけの操作を捨てる
  // biome-ignore lint/correctness/useExhaustiveDependencies: tool の変化だけを見る
  useEffect(() => setDraft(undefined), [tool]);

  const pointerPlan = useCallback((): Vec2 | undefined => {
    return planGroup.current?.getRelativePointerPosition() ?? undefined;
  }, []);

  // 自分のカーソルの位置をほかのユーザーに見せる（FR-10.3）。
  // 送りすぎないよう 50 ms に 1 回に間引き、間引いた最後の位置は後から送って、止めた位置が必ず届くようにする
  const cursorThrottle = useRef<{ last: number; timer?: ReturnType<typeof setTimeout> }>({
    last: 0,
  });
  const sendCursor = (p: Vec2 | undefined) => {
    const t = cursorThrottle.current;
    clearTimeout(t.timer);
    const send = () => {
      t.last = performance.now();
      session.setPresence({
        cursor: p && { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 },
      });
    };
    const wait = 50 - (performance.now() - t.last);
    if (wait <= 0) send();
    else t.timer = setTimeout(send, wait);
  };
  useEffect(() => () => clearTimeout(cursorThrottle.current.timer), []);

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const factor = Math.exp(-e.evt.deltaY * 0.0015);
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const k = scale / v.scale;
      return { scale, x: pointer.x - (pointer.x - v.x) * k, y: pointer.y - (pointer.y - v.y) * k };
    });
  };

  const info = (e: MouseEvent, p: Vec2): PointerInfo => ({
    p,
    px: 1 / view.scale,
    shift: e.shiftKey,
    mod: e.ctrlKey || e.metaKey,
    alt: e.altKey,
    clickCount: e.detail,
  });

  const onMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    // 中ボタンはどの道具でもパン。パンの道具では左ボタンでもパン
    if (e.evt.button === 1 || (e.evt.button === 0 && tool === "pan")) {
      e.evt.preventDefault();
      setPanning({ start: pointer, view });
      return;
    }
    if (e.evt.button !== 0) return;
    const p = pointerPlan();
    if (!p) return;
    if (tool === "calibrate") {
      if (!draft) setDraft({ a: p, b: p });
      else {
        handlers?.onCalibrate?.(draft.a, p);
        setDraft(undefined);
      }
    } else if (tool === "crop") {
      setDraft({ a: p, b: p });
    } else {
      controller?.onDown?.(info(e.evt, p));
    }
  };

  const onMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    const pointer = e.target.getStage()?.getPointerPosition();
    if (panning && pointer) {
      setView({
        ...panning.view,
        x: panning.view.x + pointer.x - panning.start.x,
        y: panning.view.y + pointer.y - panning.start.y,
      });
      return;
    }
    const p = pointerPlan();
    sendCursor(p);
    if (draft && p) setDraft({ ...draft, b: p });
    if (p) controller?.onMove?.(info(e.evt, p));
  };

  const onMouseUp = (e: KonvaEventObject<MouseEvent>) => {
    if (panning) {
      setPanning(undefined);
      return;
    }
    const p = pointerPlan();
    if (p) controller?.onUp?.(info(e.evt, p));
    if (tool === "crop" && draft) {
      const rect = normalizeRect(draft.a, draft.b);
      // クリックしただけのような小さな範囲は無視する
      if (rect.width * view.scale > 8 && rect.height * view.scale > 8) handlers?.onCrop?.(rect);
      setDraft(undefined);
    }
  };

  const px = 1 / view.scale; // 画面上の 1 ピクセルが図面座標でいくつか
  const peerCursors = useMemo(
    () => peers.filter((p) => p.floorId === floor.id && p.cursor),
    [peers, floor.id],
  );

  return (
    <Box
      ref={boxRef}
      h="100%"
      w="100%"
      // キーボード操作（Enter、Delete など）を受けるため、キャンバスを押したらフォーカスを移す
      tabIndex={0}
      aria-label="図面"
      onMouseDown={(e) => e.currentTarget.focus({ preventScroll: true })}
      style={{
        overflow: "hidden",
        cursor: panning ? "grabbing" : tool === "pan" ? "grab" : "crosshair",
      }}
    >
      <VisuallyHidden>
        <ul aria-label="ほかのユーザーのカーソル">
          {peerCursors.map((p) => (
            <li key={p.clientId}>
              {p.user.name}（{Math.round(p.cursor!.x)}, {Math.round(p.cursor!.y)}）
            </li>
          ))}
        </ul>
      </VisuallyHidden>
      {width > 0 && height > 0 && (
        <Stage
          width={width}
          height={height}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onDblClick={(e) => {
            const p = pointerPlan();
            if (p) controller?.onDoubleClick?.(info(e.evt, p));
          }}
          onMouseLeave={() => {
            setPanning(undefined);
            sendCursor(undefined);
            controller?.onCancel?.();
          }}
          onContextMenu={(e) => e.evt.preventDefault()}
        >
          <Layer>
            <Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
              <Group ref={planGroup} rotation={rotation}>
                {plan && image && extent && (
                  <Group
                    clipX={extent.x}
                    clipY={extent.y}
                    clipWidth={extent.width}
                    clipHeight={extent.height}
                  >
                    <KonvaImage
                      image={image}
                      width={plan.widthPx * plan.unitsPerPx}
                      height={plan.heightPx * plan.unitsPerPx}
                      listening={false}
                    />
                  </Group>
                )}
                {props.children?.(px)}

                {tool === "calibrate" && floor.scale && !draft && (
                  <Line
                    points={[floor.scale.a.x, floor.scale.a.y, floor.scale.b.x, floor.scale.b.y]}
                    stroke="#1971c2"
                    strokeWidth={2 * px}
                    dash={[6 * px, 4 * px]}
                    listening={false}
                  />
                )}
                {tool === "calibrate" && draft && (
                  <>
                    <Line
                      points={[draft.a.x, draft.a.y, draft.b.x, draft.b.y]}
                      stroke="#e03131"
                      strokeWidth={2 * px}
                      listening={false}
                    />
                    <Circle
                      x={draft.a.x}
                      y={draft.a.y}
                      radius={4 * px}
                      fill="#e03131"
                      listening={false}
                    />
                  </>
                )}
                {tool === "crop" && draft && (
                  <KonvaRect
                    {...normalizeRect(draft.a, draft.b)}
                    stroke="#1971c2"
                    strokeWidth={2 * px}
                    dash={[6 * px, 4 * px]}
                    listening={false}
                  />
                )}

                {peerCursors.map((p) => (
                  <Group
                    key={p.clientId}
                    x={p.cursor!.x}
                    y={p.cursor!.y}
                    scaleX={px}
                    scaleY={px}
                    rotation={-rotation}
                    listening={false}
                  >
                    <Circle radius={5} fill={p.user.color} stroke="#fff" strokeWidth={1.5} />
                    <Label x={8} y={6}>
                      <Tag fill={p.user.color} cornerRadius={3} />
                      <Text text={p.user.name} fontSize={12} padding={3} fill="#fff" />
                    </Label>
                  </Group>
                ))}
              </Group>
            </Group>
          </Layer>
        </Stage>
      )}
    </Box>
  );
}
