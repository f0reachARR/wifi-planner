import { MATERIAL_PRESETS } from "./materials.js";
import { type ProjectDoc, type ProjectSettings, SCHEMA_VERSION } from "./schema.js";

export function defaultSettings(): ProjectSettings {
  return {
    receiverHeightM: 1.0,
    gridResolutionM: 0.5,
    pathLossExponent: { "2.4": 2.0, "5": 2.0, "6": 2.0 },
    rxGainDbi: 0,
    legend: {
      stops: [
        { dbm: -50, color: "#15803d" },
        { dbm: -60, color: "#22c55e" },
        { dbm: -67, color: "#a3e635" },
        { dbm: -70, color: "#facc15" },
        { dbm: -75, color: "#f97316" },
        { dbm: -80, color: "#ef4444" },
        { dbm: -90, color: "#7f1d1d" },
      ],
      goodThresholdDbm: -67,
      hideBelow: false,
    },
    crossFloorRange: null,
  };
}

export function createEmptyProjectDoc(): ProjectDoc {
  return {
    meta: { schemaVersion: SCHEMA_VERSION },
    settings: defaultSettings(),
    materials: JSON.parse(JSON.stringify(MATERIAL_PRESETS)),
    apModels: {},
    floors: {},
  };
}
