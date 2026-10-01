import {
  Box,
  Button,
  Group,
  Paper,
  SegmentedControl,
  Slider,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { Edges, Line, OrbitControls, TransformControls } from "@react-three/drei";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import {
  type Ap,
  BAND_LABELS,
  BANDS,
  type Band,
  type Floor,
  type FloorPlacement,
  floorPlacements,
  type Material,
  type ProjectDoc,
} from "@wifi-planner/domain";
import { updateAp } from "@wifi-planner/domain/ops";
import {
  type SectionBounds,
  type SectionParams,
  sectionBounds,
  sectionGrid,
  sectionOffsetRange,
} from "@wifi-planner/propagation";
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { fileUrl } from "../../api/client";
import { useSession, useSessionState } from "../../collab/react";
import { composeImage } from "../../propagation/render";
import { useHeatmap, useSectionHeatmap } from "../../propagation/useHeatmap";
import { sortedFloors } from "../FloorPanel";
import {
  apBasis,
  apOrientationFrom,
  heatmapQuad,
  planQuad,
  planToWorld,
  sectionOrigin,
  sectionParamsFrom,
  sectionQuad,
  threeToPlan,
  toThree,
  type Vec3,
  wallGeometry,
} from "./scene";

type Layers = { plan: boolean; walls: boolean; aps: boolean; heatmap: boolean };
/** 図面と壁の不透明度。上の階で下の階が隠れないよう、既定では半透明にする */
type Opacities = { plan: number; walls: number };

/** 高さ方向だけを引き伸ばす倍率の選択肢。フロアの間が狭く見えるときに使う */
const HEIGHT_SCALES = [1, 2, 3, 5] as const;

/** 3D ビューで選んでいるもの。選ぶと、移動と回転のつまみ（ギズモ）を出す（FR-3.6） */
type Selection = { kind: "ap"; floorId: string; apId: string } | { kind: "section" } | undefined;
/** つまみの種類。断面にはチルトがないので、断面では tilt を azimuth（鉛直な軸のまわりの回転）として扱う */
type GizmoMode = "translate" | "azimuth" | "tilt";
type Quat = [number, number, number, number];

/**
 * 全フロアを標高に従って積み重ねた疑似 3D ビュー（FR-3.4〜3.6）。
 * 文書に書き込むのは AP の位置、高さ、方位角、チルトだけで、それ以外の編集は 2D ビューで行う
 */
export function View3D() {
  const { doc } = useSessionState();
  const session = useSession();
  const editable = !session.readOnly;
  const [selection, setSelection] = useState<Selection>();
  const [gizmo, setGizmo] = useState<GizmoMode>("translate");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelection(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [band, setBand] = useState<Band>("5");
  const [layers, setLayers] = useState<Layers>({
    plan: true,
    walls: true,
    aps: true,
    heatmap: true,
  });
  const [heightScale, setHeightScale] = useState<number>(1);
  const [opacity, setOpacity] = useState<Opacities>({ plan: 0.5, walls: 0.55 });
  // 縦の断面（FR-3.9）。向きと位置は表示の設定なので、文書には書かない
  const [section, setSection] = useState({ on: false, angleDeg: 0, offsetM: 0, opacity: 0.8 });
  const sBounds = useMemo(() => sectionBounds({ floors: doc?.floors ?? {} }), [doc?.floors]);
  const [offsetMin, offsetMax] = sBounds ? sectionOffsetRange(sBounds, section.angleDeg) : [0, 0];
  // 向きを変えて範囲が狭まったときは、範囲の中に収める
  const offsetM = Math.min(offsetMax, Math.max(offsetMin, section.offsetM));
  const sectionParams: SectionParams = { angleDeg: section.angleDeg, offsetM };
  const sectionResult = useSectionHeatmap(doc, band, sectionParams, section.on && !!sBounds);
  const floors = sortedFloors(doc?.floors ?? {});
  const placements = useMemo(() => floorPlacements(doc?.floors ?? {}), [doc?.floors]);
  const shown = floors.filter((f) => placements[f.id]);

  // すべてのフロアが収まるように視点を決める
  const bounds = useMemo(() => {
    const box = new THREE.Box3();
    for (const f of shown) {
      const p = placements[f.id]!;
      const plan = f.plan!;
      const extent = plan.crop ?? {
        x: 0,
        y: 0,
        width: plan.widthPx * plan.unitsPerPx,
        height: plan.heightPx * plan.unitsPerPx,
      };
      for (const [x, y] of [
        [extent.x, extent.y],
        [extent.x + extent.width, extent.y + extent.height],
      ]) {
        box.expandByPoint(
          new THREE.Vector3(
            ...toThree(planToWorld(p, { x: x!, y: y! }), f.elevationM * heightScale),
          ),
        );
        box.expandByPoint(
          new THREE.Vector3(
            ...toThree(planToWorld(p, { x: x!, y: y! }), (f.elevationM + f.heightM) * heightScale),
          ),
        );
      }
    }
    return box;
  }, [shown, placements, heightScale]);
  const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
  const size = bounds.isEmpty() ? 20 : bounds.getSize(new THREE.Vector3()).length();

  if (!doc) return null;
  // AP を表示していないときは、つまみも出ないので選んでいないものとして扱う
  const selectedAp =
    selection?.kind === "ap" && layers.aps
      ? doc.floors[selection.floorId]?.aps[selection.apId]
      : undefined;
  const sectionSelected = selection?.kind === "section" && section.on && !!sBounds;
  return (
    <Box pos="relative" h="100%" bg="light-dark(#f8f9fa, #1a1b1e)">
      {shown.length === 0 ? (
        <Stack h="100%" justify="center" align="center">
          <Text c="dimmed">スケールを校正したフロアがありません</Text>
        </Stack>
      ) : (
        <Canvas
          onPointerMissed={() => setSelection(undefined)}
          camera={{
            position: [center.x + size * 0.8, center.y + size * 0.9, center.z + size * 0.8],
            fov: 40,
            near: 0.1,
            far: size * 20,
          }}
        >
          <OrbitControls target={center} makeDefault />
          <FollowBounds center={center} size={size} />
          <ambientLight intensity={1} />
          {shown.map((f) => (
            <FloorMeshes
              key={f.id}
              labelSize={size * 0.04}
              floor={f}
              placement={placements[f.id]!}
              materials={doc.materials}
              band={band}
              layers={layers}
              heightScale={heightScale}
              opacity={opacity}
              selectedApId={
                selection?.kind === "ap" && selection.floorId === f.id ? selection.apId : undefined
              }
              onSelectAp={(apId) => setSelection({ kind: "ap", floorId: f.id, apId })}
              gizmo={editable ? gizmo : undefined}
            />
          ))}
          {section.on && sectionResult.result?.status === "ok" && (
            <SectionMesh
              result={sectionResult.result}
              doc={doc}
              heightScale={heightScale}
              opacity={section.opacity}
              onSelect={() => setSelection({ kind: "section" })}
            />
          )}
          {section.on && sBounds && (
            <SectionHandle
              bounds={sBounds}
              params={sectionParams}
              heightScale={heightScale}
              gizmo={sectionSelected ? (gizmo === "tilt" ? "azimuth" : gizmo) : undefined}
              onSelect={() => setSelection({ kind: "section" })}
              onChange={(p) => setSection((s) => ({ ...s, ...p }))}
            />
          )}
        </Canvas>
      )}
      <Paper pos="absolute" top={8} left={8} maw={380} p="xs" shadow="sm" withBorder>
        <Stack gap={6}>
          {(selectedAp || sectionSelected) && (
            <Group gap={6} wrap="nowrap">
              <Text size="xs" aria-label="3D ビューで選択中">
                {selectedAp ? `AP「${selectedAp.name}」` : "断面"}
              </Text>
              <SegmentedControl
                size="xs"
                aria-label="つまみの種類"
                value={selectedAp || gizmo !== "tilt" ? gizmo : "azimuth"}
                onChange={(v) => setGizmo(v as GizmoMode)}
                data={
                  selectedAp
                    ? [
                        { value: "translate", label: "移動" },
                        { value: "azimuth", label: "方位角" },
                        { value: "tilt", label: "チルト" },
                      ]
                    : [
                        { value: "translate", label: "移動" },
                        { value: "azimuth", label: "回転" },
                      ]
                }
              />
              <Button size="compact-xs" variant="default" onClick={() => setSelection(undefined)}>
                解除
              </Button>
            </Group>
          )}
          <SegmentedControl
            size="xs"
            aria-label="帯域"
            value={band}
            onChange={(v) => setBand(v as Band)}
            data={BANDS.map((b) => ({ value: b, label: BAND_LABELS[b] }))}
          />
          <Group gap="sm">
            {(
              [
                ["plan", "図面"],
                ["walls", "壁"],
                ["aps", "AP"],
                ["heatmap", "ヒートマップ"],
              ] as const
            ).map(([key, label]) => (
              <Switch
                key={key}
                size="xs"
                label={label}
                checked={layers[key]}
                onChange={(e) => {
                  // 更新の関数はあとで呼ばれ、そのときには currentTarget が null になっているので先に読む
                  const checked = e.currentTarget.checked;
                  setLayers((l) => ({ ...l, [key]: checked }));
                }}
              />
            ))}
          </Group>
          <Text size="xs" c="dimmed">
            不透明度
          </Text>
          {(
            [
              ["plan", "図面"],
              ["walls", "壁"],
            ] as const
          ).map(([key, label]) => (
            <Group key={key} gap={6} wrap="nowrap">
              <Text size="xs" w={28}>
                {label}
              </Text>
              <Slider
                size="xs"
                style={{ flex: 1 }}
                min={0.05}
                max={1}
                step={0.05}
                value={opacity[key]}
                disabled={!layers[key]}
                onChange={(v) => setOpacity((o) => ({ ...o, [key]: v }))}
                label={(v) => `不透明度 ${Math.round(v * 100)}%`}
                thumbLabel={`${label}の不透明度`}
              />
            </Group>
          ))}
          <SectionControls
            section={section}
            setSection={setSection}
            offsetM={offsetM}
            offsetRange={[offsetMin, offsetMax]}
            available={!!sBounds}
            status={
              sectionResult.pending
                ? "断面を計算中…"
                : sectionResult.result?.status === "ok"
                  ? `断面：${sectionResult.result.grid.cols}×${sectionResult.result.grid.rows} 点、${sectionResult.result.radios.length} 本のラジオ`
                  : sectionResult.result?.status === "empty"
                    ? "断面が建物に掛かっていません"
                    : ""
            }
          />
          <Group gap={6}>
            <Text size="xs">高さ</Text>
            <SegmentedControl
              size="xs"
              aria-label="高さの倍率"
              value={String(heightScale)}
              onChange={(v) => setHeightScale(Number(v))}
              data={HEIGHT_SCALES.map((k) => ({ value: String(k), label: `×${k}` }))}
            />
          </Group>
          <Text size="xs" aria-label="表示中のフロア">
            表示中のフロア：{shown.map((f) => `${f.name}（床 ${f.elevationM} m）`).join("、")}
          </Text>
          {heightScale !== 1 && (
            <Text size="xs" c="dimmed">
              見やすさのために高さだけを {heightScale} 倍にしています（床の高さの表示は実際の値）
            </Text>
          )}
          {floors.length > shown.length && (
            <Text size="xs" c="orange">
              スケールが未校正のフロアは表示していません
            </Text>
          )}
          {shown.some((f) => !placements[f.id]!.aligned) && (
            <Text size="xs" c="orange">
              位置合わせをしていないフロアは、基準フロアと同じ原点に置いています
            </Text>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}

function FloorMeshes(props: {
  floor: Floor & { id: string };
  placement: FloorPlacement;
  materials: Record<string, Material>;
  band: Band;
  layers: Layers;
  labelSize: number;
  heightScale: number;
  opacity: Opacities;
  selectedApId: string | undefined;
  onSelectAp: (apId: string) => void;
  /** 選んだ AP に出すつまみ。編集できないときは undefined */
  gizmo: GizmoMode | undefined;
}) {
  const { floor, placement, layers, heightScale } = props;
  /** 表示上の高さ。見やすさのために高さ方向だけを引き伸ばす */
  const h = (m: number) => m * heightScale;
  const holes = useMemo(() => Object.values(floor.holes).map((x) => x.points), [floor.holes]);
  const session = useSession();
  const { doc } = useSessionState();
  const plan = floor.plan!;
  const extent = plan.crop ?? {
    x: 0,
    y: 0,
    width: plan.widthPx * plan.unitsPerPx,
    height: plan.heightPx * plan.unitsPerPx,
  };
  const imageSize = {
    width: plan.widthPx * plan.unitsPerPx,
    height: plan.heightPx * plan.unitsPerPx,
  };

  const [texture, setTexture] = useState<THREE.Texture>();
  useEffect(() => {
    const t = new THREE.TextureLoader().load(fileUrl(session.projectId, plan.imageSha256), () =>
      setTexture(t),
    );
    t.colorSpace = THREE.SRGBColorSpace;
    return () => t.dispose();
  }, [session.projectId, plan.imageSha256]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 図面の範囲と置き方、高さ、吹き抜けが変わったときだけ作り直す
  const planGeom = useMemo(() => {
    const q = planQuad(placement, extent, imageSize, floor.elevationM * heightScale, holes);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(q.positions, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(q.uvs, 2));
    return g;
  }, [placement, JSON.stringify(extent), floor.elevationM, heightScale, holes]);

  const wallGeom = useMemo(() => {
    const w = wallGeometry(floor, placement, props.materials, heightScale);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(w.positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(w.colors, 3));
    return g;
  }, [floor, placement, props.materials, heightScale]);

  const { result } = useHeatmap(doc, floor.id, props.band, layers.heatmap);
  const heat = useMemo(() => {
    if (result?.status !== "ok" || result.radios.length === 0 || !doc) return undefined;
    const legend = doc.settings.legend;
    const pixels = composeImage(result.radios, result.grid.cols * result.grid.rows, {
      mode: "rssi",
      apIds: new Set(),
      stops: legend.stops,
      thresholdDbm: legend.goodThresholdDbm,
      hideBelow: legend.hideBelow,
    });
    const tex = new THREE.DataTexture(pixels, result.grid.cols, result.grid.rows, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const q = heatmapQuad(placement, result.grid, floor.elevationM * heightScale + 0.02, holes);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(q.positions, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(q.uvs, 2));
    return { tex, g };
  }, [result, placement, floor.elevationM, doc, heightScale, holes]);

  const labelAt = toThree(
    planToWorld(placement, { x: extent.x, y: extent.y }),
    h(floor.elevationM + floor.heightM),
  );

  return (
    <group>
      {layers.plan && texture && (
        <mesh geometry={planGeom}>
          {/* 上の階の図面で下の階が隠れないよう、既定では半透明にする */}
          <meshBasicMaterial
            map={texture}
            side={THREE.DoubleSide}
            transparent
            opacity={props.opacity.plan}
            depthWrite={false}
          />
        </mesh>
      )}
      {layers.heatmap && heat && (
        <mesh geometry={heat.g}>
          <meshBasicMaterial
            map={heat.tex}
            side={THREE.DoubleSide}
            transparent
            opacity={0.6}
            depthWrite={false}
          />
        </mesh>
      )}
      {layers.walls && (
        <mesh geometry={wallGeom}>
          <meshBasicMaterial
            vertexColors
            side={THREE.DoubleSide}
            transparent
            opacity={props.opacity.walls}
            depthWrite={false}
          />
        </mesh>
      )}
      {layers.aps &&
        Object.entries(floor.aps).map(([id, ap]) => (
          <ApObject
            key={id}
            scale={Math.max(1, props.labelSize)}
            position={toThree(
              planToWorld(placement, ap.position),
              h(floor.elevationM + ap.heightM),
            )}
            basis={apBasis(placement, ap.mount, ap.azimuthDeg, ap.tiltDeg)}
            enabled={ap.radios.some((r) => r.enabled)}
            selected={props.selectedApId === id}
            gizmo={props.selectedApId === id ? props.gizmo : undefined}
            onSelect={() => props.onSelectAp(id)}
            onCommit={(obj) => {
              const patch: Partial<Ap> = {};
              if (props.gizmo !== "translate") {
                // 方位角のつまみは鉛直な軸、チルトのつまみはアンテナの局所 y 軸のまわりだけを回すので、回した方の値だけを書く
                const axis = (x: number, y: number, z: number) =>
                  new THREE.Vector3(x, y, z).applyQuaternion(obj.quaternion).toArray();
                const o = apOrientationFrom(placement, ap.mount, axis(1, 0, 0), axis(0, 1, 0));
                const round = (v: number) => Math.round(v * 10) / 10;
                if (props.gizmo === "azimuth") {
                  const azimuthDeg = round(o.azimuthDeg) % 360;
                  if (Math.abs(azimuthDeg - ap.azimuthDeg) > 1e-6) patch.azimuthDeg = azimuthDeg;
                } else {
                  const tiltDeg = round(o.tiltDeg);
                  if (Math.abs(tiltDeg - ap.tiltDeg) > 1e-6) patch.tiltDeg = tiltDeg;
                }
              } else {
                const p = obj.position;
                const position = threeToPlan(placement, [p.x, p.y, p.z]);
                const heightM = Math.max(
                  0,
                  Math.round((p.y / heightScale - floor.elevationM) * 100) / 100,
                );
                if (Math.hypot(position.x - ap.position.x, position.y - ap.position.y) > 1e-6)
                  patch.position = position;
                if (Math.abs(heightM - ap.heightM) > 1e-6) patch.heightM = heightM;
              }
              if (Object.keys(patch).length > 0)
                session.mutate((ydoc) => updateAp(ydoc, floor.id, id, patch));
              return Object.keys(patch).length > 0;
            }}
          />
        ))}
      <FloorLabel text={floor.name} position={labelAt} size={props.labelSize} />
    </group>
  );
}

/** クリックで物体を選ぶ。奥にある物体や、何もない所のクリック（選択の解除）には伝えない */
const clickToSelect = (onSelect: () => void) => ({
  onClick: (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect();
  },
});

/** three.js の座標の基底（局所座標の x、y、z 軸の向き）を回転にする */
const basisQuat = ([x, y, z]: [Vec3, Vec3, Vec3]): Quat => {
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...x),
    new THREE.Vector3(...y),
    new THREE.Vector3(...z),
  );
  return new THREE.Quaternion().setFromRotationMatrix(m).toArray() as Quat;
};

/** 鉛直な軸のまわりの回転 */
const yawQuat = (yaw: number): Quat =>
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).toArray() as Quat;

/** 3D の物体の置き方を直接書き換える。つまみで動かしている間は、React の描画で物体を戻さないようにするため */
function usePose(ref: RefObject<THREE.Object3D>, position: Vec3, quat: Quat) {
  const [x, y, z] = position;
  const [qx, qy, qz, qw] = quat;
  const apply = () => {
    ref.current?.position.set(x, y, z);
    ref.current?.quaternion.set(qx, qy, qz, qw);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: 置き方の値が変わったときだけ戻す
  useLayoutEffect(apply, [x, y, z, qx, qy, qz, qw]);
  return apply;
}

/**
 * 選んだ物体に、移動か回転のつまみを付ける。つまみを放したら onCommit で値を確定し、
 * 何も変わらなかったとき（範囲の外に動かして元の値に戻ったときを含む）は物体を元の置き方に戻す
 */
function Gizmo(props: {
  target: RefObject<THREE.Object3D>;
  mode: "translate" | "rotate";
  /** 出す軸（回転なら回す軸） */
  axes: { x: boolean; y: boolean; z: boolean };
  space: "world" | "local";
  size: number;
  onCommit: (obj: THREE.Object3D) => boolean;
  reset: () => void;
}) {
  return (
    <TransformControls
      object={props.target}
      mode={props.mode}
      space={props.space}
      showX={props.axes.x}
      showY={props.axes.y}
      showZ={props.axes.z}
      size={props.size}
      onMouseUp={() => {
        const obj = props.target.current;
        if (obj && !props.onCommit(obj)) props.reset();
      }}
    />
  );
}

/**
 * AP の箱。局所座標をアンテナの局所座標（設計書 5.3 節）に合わせ、主ビーム（+x）の向きに正面を向けた薄い箱にする。
 * 正面の先には主ビームの向きを示す円錐を、+z（背面から見た上、天井設置では方位角の向き）の端には白い帯を付ける
 */
function ApObject(props: {
  position: Vec3;
  /** 箱の一辺 0.5 m に対する倍率 */
  scale: number;
  /** three.js の座標で表したアンテナの局所座標の基底（apBasis） */
  basis: [Vec3, Vec3, Vec3];
  enabled: boolean;
  selected: boolean;
  gizmo: GizmoMode | undefined;
  onSelect: () => void;
  onCommit: (obj: THREE.Object3D) => boolean;
}) {
  const ref = useRef<THREE.Group>(null!);
  const reset = usePose(ref, props.position, basisQuat(props.basis));
  const color = props.selected ? "#1c7ed6" : props.enabled ? "#e8590c" : "#868e96";
  return (
    <>
      <group ref={ref} {...clickToSelect(props.onSelect)}>
        {/* 建物が大きくてもクリックしやすいよう、全体の大きさに合わせて大きくする */}
        <group scale={props.scale}>
          <mesh>
            <boxGeometry args={[0.1, 0.5, 0.5]} />
            <meshBasicMaterial color={color} toneMapped={false} />
            <Edges color="#343a40" />
          </mesh>
          <mesh position={[0, 0, 0.22]}>
            <boxGeometry args={[0.12, 0.3, 0.04]} />
            <meshBasicMaterial color="#f8f9fa" toneMapped={false} />
          </mesh>
          <mesh position={[0.17, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.06, 0.2, 12]} />
            <meshBasicMaterial color={color} toneMapped={false} />
          </mesh>
        </group>
      </group>
      {props.gizmo && (
        <Gizmo
          target={ref}
          {...(props.gizmo === "translate"
            ? { mode: "translate", space: "world", axes: { x: true, y: true, z: true } }
            : props.gizmo === "azimuth"
              ? { mode: "rotate", space: "world", axes: { x: false, y: true, z: false } }
              : // チルトはアンテナの局所 y 軸のまわりの回転（antennaFrame）
                { mode: "rotate", space: "local", axes: { x: false, y: true, z: false } })}
          size={0.7}
          onCommit={props.onCommit}
          reset={reset}
        />
      )}
    </>
  );
}

/**
 * 断面の枠と、断面を動かすつまみ（FR-3.9）。枠の局所座標の x を断面の水平の向き、-z を断面に垂直な向きにとり、
 * 移動は断面に垂直な向きだけ、回転は鉛直な軸のまわりだけにする。枠は動かしている間もつまみと一緒に動く
 */
function SectionHandle(props: {
  bounds: SectionBounds;
  params: SectionParams;
  heightScale: number;
  gizmo: GizmoMode | undefined;
  onSelect: () => void;
  onChange: (p: SectionParams) => void;
}) {
  const { bounds, params, heightScale } = props;
  const ref = useRef<THREE.Group>(null!);
  const origin = sectionOrigin(bounds, params);
  const mid = ((bounds.bottom + bounds.top) / 2) * heightScale;
  const half = ((bounds.top - bounds.bottom) / 2) * heightScale;
  const reset = usePose(ref, toThree(origin, mid), yawQuat((params.angleDeg * Math.PI) / 180));
  // 枠の水平の範囲は、断面の直線を建物の外接矩形で切り取った区間
  const grid = sectionGrid(bounds, params, 1);
  const s0 = grid?.s0 ?? 0;
  const s1 = grid ? grid.s0 + (grid.cols - 1) * grid.step : 0;
  return (
    <>
      <group ref={ref}>
        {grid && (
          <>
            <Line
              points={[
                [s0, -half, 0],
                [s1, -half, 0],
                [s1, half, 0],
                [s0, half, 0],
                [s0, -half, 0],
              ]}
              color={props.gizmo ? "#1c7ed6" : "#ae3ec9"}
              lineWidth={props.gizmo ? 2.5 : 1.5}
              // 断面のヒートマップ（renderOrder 5）の後に描き、ヒートマップに隠れないようにする
              renderOrder={6}
              transparent
              toneMapped={false}
            />
            {/* 枠の中をクリックして断面を選ぶための、見えない面 */}
            <mesh position={[(s0 + s1) / 2, 0, 0]} {...clickToSelect(props.onSelect)}>
              <planeGeometry args={[Math.max(s1 - s0, 1e-3), Math.max(half * 2, 1e-3)]} />
              <meshBasicMaterial
                transparent
                opacity={0}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
          </>
        )}
      </group>
      {props.gizmo && (
        <Gizmo
          target={ref}
          {...(props.gizmo === "translate"
            ? { mode: "translate", space: "local", axes: { x: false, y: false, z: true } }
            : { mode: "rotate", space: "world", axes: { x: false, y: true, z: false } })}
          size={0.9}
          reset={reset}
          onCommit={(obj) => {
            const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(obj.quaternion);
            // 向きはスライダーと同じ 1° 刻みに揃えてから位置を求める。後で丸めると、180° の近くで 0° に回り込んだときに位置の符号が逆になる
            const next = sectionParamsFrom(
              bounds,
              { x: obj.position.x, y: -obj.position.z },
              Math.round((Math.atan2(-dir.z, dir.x) * 180) / Math.PI),
            );
            const angleDeg = next.angleDeg;
            // 位置もスライダーと同じ刻みに揃え、建物に掛かる範囲に収める
            const [lo, hi] = sectionOffsetRange(bounds, angleDeg);
            const offsetM = Math.min(hi, Math.max(lo, Math.round(next.offsetM * 10) / 10));
            if (angleDeg === params.angleDeg && Math.abs(offsetM - params.offsetM) < 1e-9)
              return false;
            props.onChange({ angleDeg, offsetM });
            return true;
          }}
        />
      )}
    </>
  );
}

/**
 * 高さの倍率などで全体の範囲が変わったとき、視点の向きを保ったままカメラを新しい範囲に合わせて動かす。
 * カメラの初期位置は Canvas を作るときにしか決められないため
 */
function FollowBounds({ center, size }: { center: THREE.Vector3; size: number }) {
  const camera = useThree((s) => s.camera);
  const prev = useRef<{ center: THREE.Vector3; size: number }>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: center は毎回作り直されるので成分で比べる
  useEffect(() => {
    const p = prev.current;
    if (p && size > 0 && p.size > 0) {
      const offset = camera.position
        .clone()
        .sub(p.center)
        .multiplyScalar(size / p.size);
      camera.position.copy(center).add(offset);
    }
    prev.current = { center: center.clone(), size };
  }, [camera, center.x, center.y, center.z, size]);
  return null;
}

/** フロアの名前。文字を描いたキャンバスをテクスチャにしたスプライトで、常に画面に向けて描く */
function FloorLabel(props: { text: string; position: [number, number, number]; size: number }) {
  const { texture, aspect } = useMemo(() => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const font = "bold 48px sans-serif";
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(props.text).width) + 32;
    canvas.width = w;
    canvas.height = 72;
    ctx.font = font;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(0, 0, w, 72);
    ctx.fillStyle = "#212529";
    ctx.textBaseline = "middle";
    ctx.fillText(props.text, 16, 38);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return { texture: t, aspect: w / 72 };
  }, [props.text]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite position={props.position} scale={[props.size * aspect, props.size, 1]} renderOrder={10}>
      <spriteMaterial map={texture} depthTest={false} transparent />
    </sprite>
  );
}

type SectionState = { on: boolean; angleDeg: number; offsetM: number; opacity: number };

/** 縦の断面（FR-3.9）の表示の切り替え、向き、位置、不透明度 */
function SectionControls(props: {
  section: SectionState;
  setSection: (f: (s: SectionState) => SectionState) => void;
  offsetM: number;
  offsetRange: [number, number];
  available: boolean;
  status: string;
}) {
  const { section, setSection } = props;
  const set = (patch: Partial<SectionState>) => setSection((s) => ({ ...s, ...patch }));
  return (
    <Stack gap={4}>
      <Switch
        size="xs"
        label="縦の断面"
        checked={section.on}
        disabled={!props.available}
        onChange={(e) => {
          const checked = e.currentTarget.checked;
          set({ on: checked });
        }}
      />
      {section.on && (
        <>
          <Group gap={6} wrap="nowrap">
            <Text size="xs" w={28}>
              向き
            </Text>
            <Slider
              size="xs"
              style={{ flex: 1 }}
              min={0}
              max={179}
              step={1}
              value={section.angleDeg}
              onChange={(v) => set({ angleDeg: v })}
              label={(v) => `${v}°`}
              thumbLabel="断面の向き"
            />
            {[0, 90].map((deg) => (
              <Button
                key={deg}
                size="compact-xs"
                variant={section.angleDeg === deg ? "filled" : "default"}
                onClick={() => set({ angleDeg: deg })}
              >
                {deg}°
              </Button>
            ))}
          </Group>
          <Group gap={6} wrap="nowrap">
            <Text size="xs" w={28}>
              位置
            </Text>
            <Slider
              size="xs"
              style={{ flex: 1 }}
              min={props.offsetRange[0]}
              max={props.offsetRange[1]}
              step={0.1}
              value={props.offsetM}
              onChange={(v) => set({ offsetM: v })}
              label={(v) => `${v.toFixed(1)} m`}
              thumbLabel="断面の位置"
            />
          </Group>
          <Group gap={6} wrap="nowrap">
            <Text size="xs" w={28}>
              濃さ
            </Text>
            <Slider
              size="xs"
              style={{ flex: 1 }}
              min={0.1}
              max={1}
              step={0.05}
              value={section.opacity}
              onChange={(v) => set({ opacity: v })}
              label={(v) => `不透明度 ${Math.round(v * 100)}%`}
              thumbLabel="断面の不透明度"
            />
          </Group>
          <Text size="xs" c="dimmed" aria-label="断面の状態">
            {props.status}
          </Text>
        </>
      )}
    </Stack>
  );
}

/** 縦の断面のヒートマップを貼った鉛直な四角形。色は床面のヒートマップと同じ対応表にする */
function SectionMesh(props: {
  result: Extract<ReturnType<typeof useSectionHeatmap>["result"], { status: "ok" }>;
  doc: ProjectDoc;
  heightScale: number;
  opacity: number;
  onSelect: () => void;
}) {
  const { result, heightScale } = props;
  const legend = props.doc.settings.legend;
  const tex = useMemo(() => {
    const pixels = composeImage(result.radios, result.grid.cols * result.grid.rows, {
      mode: "rssi",
      apIds: new Set(),
      stops: legend.stops,
      thresholdDbm: legend.goodThresholdDbm,
      hideBelow: legend.hideBelow,
    });
    const t = new THREE.DataTexture(pixels, result.grid.cols, result.grid.rows, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, [result, legend]);
  const geom = useMemo(() => {
    const q = sectionQuad(result.grid, heightScale);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(q.positions, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(q.uvs, 2));
    return g;
  }, [result.grid, heightScale]);
  useEffect(() => () => tex.dispose(), [tex]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh geometry={geom} renderOrder={5} {...clickToSelect(props.onSelect)}>
      <meshBasicMaterial
        map={tex}
        side={THREE.DoubleSide}
        transparent
        opacity={props.opacity}
        depthWrite={false}
      />
    </mesh>
  );
}
