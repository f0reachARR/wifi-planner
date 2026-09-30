import type { ApModel, Floor, Material } from "@wifi-planner/domain";
import { Group, Image as KonvaImage } from "react-konva";
import { fileUrl } from "../../api/client";
import { ApLayer } from "../aps/ApLayer";
import { useHtmlImage } from "../canvas/useHtmlImage";
import { WallLayer } from "../walls/WallLayer";
import type { similarityNode } from "./similarity";

const NONE = new Set<string>();

/** ほかのフロアの図面、壁、AP を、今のフロアの図面座標に移して半透明で描く（FR-3.3） */
export function OverlayFloor(props: {
  projectId: string;
  floor: Floor;
  node: ReturnType<typeof similarityNode>;
  opacity: number;
  materials: Record<string, Material>;
  models: Record<string, ApModel>;
  /** 今のフロアの画面の 1 ピクセル。重ねるフロアの座標では拡大の分だけ割る */
  px: number;
  /** 今のフロアの図面の回転 */
  currentRotationDeg: number;
}) {
  const { floor, node } = props;
  const plan = floor.plan;
  const image = useHtmlImage(plan ? fileUrl(props.projectId, plan.imageSha256) : undefined);
  const extent =
    plan &&
    (plan.crop ?? {
      x: 0,
      y: 0,
      width: plan.widthPx * plan.unitsPerPx,
      height: plan.heightPx * plan.unitsPerPx,
    });
  const px = props.px / Math.abs(node.scaleX);
  const walls = Object.entries(floor.walls).map(([id, w]) => ({ ...w, id }));
  const aps = Object.entries(floor.aps).map(([id, a]) => ({ ...a, id }));
  return (
    <Group {...node} opacity={props.opacity} listening={false}>
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
          />
        </Group>
      )}
      <WallLayer
        walls={walls}
        materials={props.materials}
        selection={NONE}
        peers={[]}
        drafts={{}}
        px={px}
        showHandles={false}
      />
      <ApLayer
        aps={aps}
        models={props.models}
        selection={NONE}
        peers={[]}
        px={px}
        // 向きは重ねるフロアの図面の回転で求め、名前は画面上の回転（今のフロアの回転と重ね表示の回転の和）を打ち消す
        planRotationDeg={plan?.rotationDeg ?? 0}
        labelRotationDeg={props.currentRotationDeg + node.rotation}
      />
    </Group>
  );
}
