import { Group, Line } from "react-konva";
import type { CandidateMarquee } from "./useCandidateSelection";
import type { Candidate } from "./useExtraction";

/** 抽出した壁の候補。選んだ候補は実線、外した候補は薄い点線で描く。範囲選択中はその範囲も描く */
export function CandidateLayer(props: {
  candidates: Candidate[];
  picked: ReadonlySet<string>;
  marquee?: CandidateMarquee;
  px: number;
}) {
  const m = props.marquee;
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
      {m && (
        // 選ぶ範囲は候補と同じ橙、外す範囲は灰色
        <Line
          points={m.polygon.flatMap((p) => [p.x, p.y])}
          closed
          stroke={m.pick ? "#e8590c" : "#868e96"}
          strokeWidth={1.5 * props.px}
          dash={[6 * props.px, 4 * props.px]}
          fill={m.pick ? "rgba(232,89,12,0.08)" : "rgba(134,142,150,0.12)"}
        />
      )}
    </Group>
  );
}
