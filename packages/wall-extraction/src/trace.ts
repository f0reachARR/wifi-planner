import type { Point } from "./merge.js";

// 細線化した画像（1 画素幅の中心線）を、画素をたどって折れ線にする。
// 分岐点と端点（8 近傍の前景の数が 2 でない画素）を節点とし、節点の間の画素の列を 1 本の枝とする。

const OFFSETS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

export function traceSkeleton(img: Uint8Array, width: number, height: number): Point[][] {
  const fg = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && img[y * width + x] !== 0;
  const neighbors = (idx: number): number[] => {
    const x = idx % width;
    const y = (idx - x) / width;
    const out: number[] = [];
    for (const [dx, dy] of OFFSETS) {
      if (!fg(x + dx, y + dy)) continue;
      // 縦か横の隣を経由してつながる斜めの隣は数えない。数えると、角や交点の近くに偽の分岐点ができる
      if (dx !== 0 && dy !== 0 && (fg(x + dx, y) || fg(x, y + dy))) continue;
      out.push((y + dy) * width + x + dx);
    }
    return out;
  };

  // 辺を二重にたどらないよう、たどった画素の組を覚える
  const visitedEdge = new Set<string>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const toPoint = (idx: number): Point => ({ x: idx % width, y: Math.floor(idx / width) });
  const chains: Point[][] = [];

  const walk = (start: number, next: number) => {
    const chain = [start];
    let prev = start;
    let cur = next;
    visitedEdge.add(edgeKey(prev, cur));
    for (;;) {
      chain.push(cur);
      const ns = neighbors(cur);
      if (ns.length !== 2) break; // 節点に着いた
      const forward = ns[0] === prev ? ns[1]! : ns[0]!;
      if (visitedEdge.has(edgeKey(cur, forward))) break; // 輪を一周した
      visitedEdge.add(edgeKey(cur, forward));
      prev = cur;
      cur = forward;
    }
    chains.push(chain.map(toPoint));
  };

  const nodes: number[] = [];
  const loops: number[] = [];
  for (let i = 0; i < img.length; i++) {
    if (img[i] === 0) continue;
    const n = neighbors(i).length;
    if (n !== 2) nodes.push(i);
    else loops.push(i);
  }
  for (const node of nodes) {
    for (const n of neighbors(node)) if (!visitedEdge.has(edgeKey(node, n))) walk(node, n);
  }
  // 節点のない輪（閉じた部屋の輪郭など）
  for (const p of loops) {
    const ns = neighbors(p);
    if (!visitedEdge.has(edgeKey(p, ns[0]!))) walk(p, ns[0]!);
  }
  return chains;
}

/** Douglas-Peucker 法で、許容誤差 tolerance 以内に収まるよう頂点を間引く */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const pa = points[a]!;
    const pb = points[b]!;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy);
    let maxDist = 0;
    let index = -1;
    for (let i = a + 1; i < b; i++) {
      const p = points[i]!;
      const d =
        len === 0
          ? Math.hypot(p.x - pa.x, p.y - pa.y)
          : Math.abs(dy * (p.x - pa.x) - dx * (p.y - pa.y)) / len;
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export function polylineLengthPx(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return total;
}
