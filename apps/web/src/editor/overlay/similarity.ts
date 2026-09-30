import type { Vec2 } from "@wifi-planner/domain";

/**
 * 相似変換（回転、一様な拡大、平行移動）を、Konva のノードの変換にする。
 * 別のフロアの図面座標から今のフロアの図面座標への写像は、y 軸の反転が行きと帰りで打ち消し合うので相似変換になる。
 * 原点と (1, 0) の写り先から回転と拡大を求め、(0, 1) の写り先で反転がないことを確かめる。
 */
export function similarityNode(map: (p: Vec2) => Vec2) {
  const o = map({ x: 0, y: 0 });
  const ex = map({ x: 1, y: 0 });
  const ey = map({ x: 0, y: 1 });
  const ux = ex.x - o.x;
  const uy = ex.y - o.y;
  const scale = Math.hypot(ux, uy);
  const rotation = (Math.atan2(uy, ux) * 180) / Math.PI;
  // (1, 0) を 90 度回した向きに (0, 1) が写れば反転はない
  const reflected = (ey.x - o.x) * -uy + (ey.y - o.y) * ux < 0;
  return { x: o.x, y: o.y, rotation, scaleX: scale, scaleY: reflected ? -scale : scale };
}
