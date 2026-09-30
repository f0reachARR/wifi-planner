import type { Material } from "./schema.js";

/**
 * 新規プロジェクトに入れる材質。減衰量（dB）は一般的な文献値に基づく初期値で、利用者が調整する前提。
 * キーはプリセットの識別に使い、プロジェクトの材質 ID にもそのまま使う。
 */
export const MATERIAL_PRESETS: Record<string, Material> = {
  concrete: {
    name: "コンクリート壁",
    color: "#6b7280",
    lossDb: { "2.4": 12, "5": 20, "6": 24 },
    presetKey: "concrete",
  },
  block: {
    name: "コンクリートブロック",
    color: "#9ca3af",
    lossDb: { "2.4": 8, "5": 12, "6": 14 },
    presetKey: "block",
  },
  drywall: {
    name: "石膏ボード間仕切り",
    color: "#d97706",
    lossDb: { "2.4": 3, "5": 4, "6": 5 },
    presetKey: "drywall",
  },
  glass: {
    name: "ガラス",
    color: "#38bdf8",
    lossDb: { "2.4": 2, "5": 4, "6": 5 },
    presetKey: "glass",
  },
  lowEGlass: {
    name: "Low-E ガラス",
    color: "#0e7490",
    lossDb: { "2.4": 10, "5": 20, "6": 25 },
    presetKey: "lowEGlass",
  },
  woodDoor: {
    name: "木製ドア",
    color: "#a16207",
    lossDb: { "2.4": 3, "5": 4, "6": 5 },
    presetKey: "woodDoor",
  },
  metalDoor: {
    name: "金属扉",
    color: "#1f2937",
    lossDb: { "2.4": 15, "5": 20, "6": 25 },
    presetKey: "metalDoor",
  },
};

export const DEFAULT_WALL_MATERIAL_ID = "concrete";
