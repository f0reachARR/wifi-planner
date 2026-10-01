import {
  applyRigid,
  type Floor,
  floorPlacements,
  overlappingWalls,
  type WallSpan,
  wallHeightRange,
} from "@wifi-planner/domain";

/**
 * 表示中のフロアの壁と、高さの範囲が重なる壁の組（FR-4.11、設計書 4.1.1 節）。
 * 位置合わせ済みなら、他の位置合わせ済みのフロアの壁（階高より高い下のフロアの壁など）との組も含める。
 * 他のフロアの壁のキーは「フロア ID/壁 ID」、表示中のフロアの壁のキーは壁 ID とする
 */
export function floorWallOverlaps(
  floors: Record<string, Floor>,
  floorId: string,
): { pairs: [string, string][]; ownIds: Set<string> } {
  const placements = floorPlacements(floors);
  const here = placements[floorId];
  const floor = floors[floorId];
  if (!here || !floor) return { pairs: [], ownIds: new Set() };
  const spansOf = (f: Floor, fid: string, key: (wallId: string) => string): WallSpan[] => {
    const p = placements[fid]!;
    return Object.entries(f.walls).map(([id, w]) => {
      const r = wallHeightRange(w, f.heightM);
      return {
        key: key(id),
        points: w.points.map((q) => applyRigid(p.toWorld, p.plan.toFloor(q))),
        range: { bottom: f.elevationM + r.bottom, top: f.elevationM + r.top },
      };
    });
  };
  const own = spansOf(floor, floorId, (id) => id);
  const spans = [...own];
  if (here.aligned && own.length > 0) {
    // 表示中のフロアの壁と高さが重なりうる壁だけを調べる
    const bottom = Math.min(...own.map((s) => s.range.bottom));
    const top = Math.max(...own.map((s) => s.range.top));
    for (const [fid, f] of Object.entries(floors)) {
      if (fid === floorId || !placements[fid]?.aligned) continue;
      for (const s of spansOf(f, fid, (id) => `${fid}/${id}`))
        if (s.range.bottom < top && s.range.top > bottom) spans.push(s);
    }
  }
  const ownKeys = new Set(own.map((s) => s.key));
  const pairs = overlappingWalls(spans).filter(([a, b]) => ownKeys.has(a) || ownKeys.has(b));
  return { pairs, ownIds: new Set(pairs.flat().filter((k) => ownKeys.has(k))) };
}
