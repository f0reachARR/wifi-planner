import { Box, Group, Paper, SegmentedControl, Stack, Switch, Text } from "@mantine/core";
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import {
  BAND_LABELS,
  BANDS,
  type Band,
  type Floor,
  type FloorPlacement,
  floorPlacements,
  type Material,
} from "@wifi-planner/domain";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { fileUrl } from "../../api/client";
import { useSession, useSessionState } from "../../collab/react";
import { composeImage } from "../../propagation/render";
import { useHeatmap } from "../../propagation/useHeatmap";
import { sortedFloors } from "../FloorPanel";
import { heatmapQuad, planQuad, planToWorld, toThree, wallGeometry } from "./scene";

type Layers = { plan: boolean; walls: boolean; aps: boolean; heatmap: boolean };

/** 全フロアを標高に従って積み重ねた疑似 3D ビュー（FR-3.4〜3.6）。表示専用で、文書には書き込まない */
export function View3D() {
  const { doc } = useSessionState();
  const [band, setBand] = useState<Band>("5");
  const [layers, setLayers] = useState<Layers>({
    plan: true,
    walls: true,
    aps: true,
    heatmap: true,
  });
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
          new THREE.Vector3(...toThree(planToWorld(p, { x: x!, y: y! }), f.elevationM)),
        );
        box.expandByPoint(
          new THREE.Vector3(...toThree(planToWorld(p, { x: x!, y: y! }), f.elevationM + f.heightM)),
        );
      }
    }
    return box;
  }, [shown, placements]);
  const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
  const size = bounds.isEmpty() ? 20 : bounds.getSize(new THREE.Vector3()).length();

  if (!doc) return null;
  return (
    <Box pos="relative" h="100%" bg="light-dark(#f8f9fa, #1a1b1e)">
      {shown.length === 0 ? (
        <Stack h="100%" justify="center" align="center">
          <Text c="dimmed">スケールを校正したフロアがありません</Text>
        </Stack>
      ) : (
        <Canvas
          camera={{
            position: [center.x + size * 0.8, center.y + size * 0.9, center.z + size * 0.8],
            fov: 40,
            near: 0.1,
            far: size * 20,
          }}
        >
          <OrbitControls target={center} makeDefault />
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
            />
          ))}
        </Canvas>
      )}
      <Paper pos="absolute" top={8} left={8} p="xs" shadow="sm" withBorder>
        <Stack gap={6}>
          <Text size="xs" c="dimmed">
            ドラッグで回転、右ドラッグでパン、ホイールでズーム。編集は 2D ビューで行います。
          </Text>
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
                onChange={(e) => setLayers((l) => ({ ...l, [key]: e.currentTarget.checked }))}
              />
            ))}
          </Group>
          <Text size="xs" aria-label="表示中のフロア">
            表示中のフロア：{shown.map((f) => `${f.name}（床 ${f.elevationM} m）`).join("、")}
          </Text>
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
}) {
  const { floor, placement, layers } = props;
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: 図面の範囲と置き方が変わったときだけ作り直す
  const planGeom = useMemo(() => {
    const q = planQuad(placement, extent, imageSize, floor.elevationM);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(q.positions, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(q.uvs, 2));
    return g;
  }, [placement, JSON.stringify(extent), floor.elevationM]);

  const wallGeom = useMemo(() => {
    const w = wallGeometry(floor, placement, props.materials);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(w.positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(w.colors, 3));
    return g;
  }, [floor, placement, props.materials]);

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
    const q = heatmapQuad(placement, result.grid, floor.elevationM + 0.02);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(q.positions, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(q.uvs, 2));
    return { tex, g };
  }, [result, placement, floor.elevationM, doc]);

  const labelAt = toThree(
    planToWorld(placement, { x: extent.x, y: extent.y }),
    floor.elevationM + floor.heightM,
  );

  return (
    <group>
      {layers.plan && texture && (
        <mesh geometry={planGeom}>
          {/* 上の階の図面で下の階が隠れないよう、半透明にする */}
          <meshBasicMaterial
            map={texture}
            side={THREE.DoubleSide}
            transparent
            opacity={0.5}
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
            opacity={0.55}
            depthWrite={false}
          />
        </mesh>
      )}
      {layers.aps &&
        Object.entries(floor.aps).map(([id, ap]) => (
          <mesh
            key={id}
            position={toThree(planToWorld(placement, ap.position), floor.elevationM + ap.heightM)}
          >
            <sphereGeometry args={[0.25, 16, 12]} />
            <meshBasicMaterial color={ap.radios.some((r) => r.enabled) ? "#e8590c" : "#868e96"} />
          </mesh>
        ))}
      <FloorLabel text={floor.name} position={labelAt} size={props.labelSize} />
    </group>
  );
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
