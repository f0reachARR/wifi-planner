export type Point = { x: number; y: number };
export type Segment = { a: Point; b: Point };

/**
 * ほぼ同一直線上にあり、端どうしが近い線分を 1 本にまとめる。
 * Hough 変換は 1 本の壁を途切れた複数の線分として返すことが多いため、その断片をつなぐ。
 */
export function mergeCollinear(
  segments: readonly Segment[],
  opts: { angleToleranceDeg: number; perpendicularTolerance: number; joinGap: number },
): Segment[] {
  const cosTol = Math.cos((opts.angleToleranceDeg * Math.PI) / 180);
  let current = segments.map((s) => ({ a: { ...s.a }, b: { ...s.b } }));
  let merged = true;
  while (merged) {
    merged = false;
    const used = new Array<boolean>(current.length).fill(false);
    const next: Segment[] = [];
    for (let i = 0; i < current.length; i++) {
      if (used[i]) continue;
      let base = current[i]!;
      for (let j = i + 1; j < current.length; j++) {
        if (used[j]) continue;
        const joined = tryJoin(
          base,
          current[j]!,
          cosTol,
          opts.perpendicularTolerance,
          opts.joinGap,
        );
        if (joined) {
          base = joined;
          used[j] = true;
          merged = true;
        }
      }
      next.push(base);
    }
    current = next;
  }
  return current;
}

function tryJoin(
  s: Segment,
  t: Segment,
  cosTol: number,
  perpendicularTolerance: number,
  joinGap: number,
): Segment | undefined {
  const sLen = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  const tLen = Math.hypot(t.b.x - t.a.x, t.b.y - t.a.y);
  if (sLen === 0 || tLen === 0) return undefined;
  // 長いほうの向きを基準にする
  const [base, other, baseLen] = sLen >= tLen ? [s, t, sLen] : [t, s, tLen];
  const ux = (base.b.x - base.a.x) / baseLen;
  const uy = (base.b.y - base.a.y) / baseLen;
  const oLen = Math.min(sLen, tLen);
  const ox = (other.b.x - other.a.x) / oLen;
  const oy = (other.b.y - other.a.y) / oLen;
  if (Math.abs(ux * ox + uy * oy) < cosTol) return undefined;

  // 基準線からの垂直距離
  const perp = (p: Point) => Math.abs((p.x - base.a.x) * -uy + (p.y - base.a.y) * ux);
  if (perp(other.a) > perpendicularTolerance || perp(other.b) > perpendicularTolerance) {
    return undefined;
  }

  // 基準線上に射影した区間どうしの隙間
  const proj = (p: Point) => (p.x - base.a.x) * ux + (p.y - base.a.y) * uy;
  const o0 = Math.min(proj(other.a), proj(other.b));
  const o1 = Math.max(proj(other.a), proj(other.b));
  if (o0 > baseLen + joinGap || o1 < -joinGap) return undefined;

  const lo = Math.min(0, o0);
  const hi = Math.max(baseLen, o1);
  return {
    a: { x: base.a.x + ux * lo, y: base.a.y + uy * lo },
    b: { x: base.a.x + ux * hi, y: base.a.y + uy * hi },
  };
}

/**
 * 近くに並ぶほぼ平行な線分を、その間の 1 本にまとめる。
 * 壁を 2 本の線で描いた図面では、壁の両側の線が別々の線分になるので、それを壁の中心線にする。
 * 線に沿った方向の重なりが短いほうの線分の minOverlap に満たない組（向かい合っていない線）はまとめない。
 */
export function mergeParallel(
  segments: readonly Segment[],
  opts: { angleToleranceDeg: number; maxDistance: number; minOverlap: number },
): Segment[] {
  const cosTol = Math.cos((opts.angleToleranceDeg * Math.PI) / 180);
  let current = segments.map((s) => ({ a: { ...s.a }, b: { ...s.b } }));
  let merged = true;
  while (merged) {
    merged = false;
    const used = new Array<boolean>(current.length).fill(false);
    const next: Segment[] = [];
    for (let i = 0; i < current.length; i++) {
      if (used[i]) continue;
      let base = current[i]!;
      for (let j = i + 1; j < current.length; j++) {
        if (used[j]) continue;
        const joined = tryPair(base, current[j]!, cosTol, opts.maxDistance, opts.minOverlap);
        if (joined) {
          base = joined;
          used[j] = true;
          merged = true;
        }
      }
      next.push(base);
    }
    current = next;
  }
  return current;
}

function tryPair(
  s: Segment,
  t: Segment,
  cosTol: number,
  maxDistance: number,
  minOverlap: number,
): Segment | undefined {
  const sLen = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  const tLen = Math.hypot(t.b.x - t.a.x, t.b.y - t.a.y);
  if (sLen === 0 || tLen === 0) return undefined;
  const [base, other, baseLen, otherLen] = sLen >= tLen ? [s, t, sLen, tLen] : [t, s, tLen, sLen];
  const ux = (base.b.x - base.a.x) / baseLen;
  const uy = (base.b.y - base.a.y) / baseLen;
  const ox = (other.b.x - other.a.x) / otherLen;
  const oy = (other.b.y - other.a.y) / otherLen;
  if (Math.abs(ux * ox + uy * oy) < cosTol) return undefined;

  // 基準線からの符号つきの垂直距離
  const perp = (p: Point) => (p.x - base.a.x) * -uy + (p.y - base.a.y) * ux;
  const da = perp(other.a);
  const db = perp(other.b);
  if (Math.abs(da) > maxDistance || Math.abs(db) > maxDistance) return undefined;

  const proj = (p: Point) => (p.x - base.a.x) * ux + (p.y - base.a.y) * uy;
  const o0 = Math.min(proj(other.a), proj(other.b));
  const o1 = Math.max(proj(other.a), proj(other.b));
  const overlap = Math.min(baseLen, o1) - Math.max(0, o0);
  if (overlap < otherLen * minOverlap) return undefined;

  // 2 本の真ん中へずらし、両方の範囲を覆うよう伸ばす
  const offset = (da + db) / 4;
  const nx = -uy * offset;
  const ny = ux * offset;
  const lo = Math.min(0, o0);
  const hi = Math.max(baseLen, o1);
  return {
    a: { x: base.a.x + ux * lo + nx, y: base.a.y + uy * lo + ny },
    b: { x: base.a.x + ux * hi + nx, y: base.a.y + uy * hi + ny },
  };
}
