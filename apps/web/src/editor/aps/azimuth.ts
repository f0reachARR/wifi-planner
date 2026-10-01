import type { Vec2 } from "@wifi-planner/domain";

/**
 * 方位角（フロア座標の +x から反時計回り）を、回転前の図面座標（y 下向き）の単位ベクトルにする。
 * フロア座標は、図面を planRotationDeg だけ回転して y を反転したもの。
 */
export function azimuthToPlanDir(azimuthDeg: number, planRotationDeg: number): Vec2 {
  const t = ((azimuthDeg + planRotationDeg) * Math.PI) / 180;
  return { x: Math.cos(t), y: -Math.sin(t) };
}

/** azimuthToPlanDir の逆。図面座標の向きを 0 以上 360 未満の方位角にする */
export function planDirToAzimuth(dir: Vec2, planRotationDeg: number): number {
  const deg = (-Math.atan2(dir.y, dir.x) * 180) / Math.PI - planRotationDeg;
  return ((deg % 360) + 360) % 360;
}
