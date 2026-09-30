import { Group, Line } from "react-konva";
import type { Candidate } from "./useExtraction";

/** 抽出した壁の候補。選んだ候補は実線、外した候補は薄い点線で描く */
export function CandidateLayer(props: {
  candidates: Candidate[];
  picked: ReadonlySet<string>;
  px: number;
}) {
  return (
    <Group listening={false}>
      {props.candidates.map((c) => {
        const on = props.picked.has(c.id);
        return (
          <Line
            key={c.id}
            points={c.points.flatMap((p) => [p.x, p.y])}
            stroke={on ? "#e8590c" : "#adb5bd"}
            strokeWidth={(on ? 4 : 2) * props.px}
            dash={on ? undefined : [4 * props.px, 3 * props.px]}
            opacity={on ? 0.9 : 0.8}
            lineCap="round"
            lineJoin="round"
          />
        );
      })}
    </Group>
  );
}
