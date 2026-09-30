import { z } from "zod";

export const BANDS = ["2.4", "5", "6"] as const;
export const Band = z.enum(BANDS);
export type Band = z.infer<typeof Band>;

export const BAND_LABELS: Record<Band, string> = {
  "2.4": "2.4 GHz",
  "5": "5 GHz",
  "6": "6 GHz",
};

/** 帯域ごとの値。材質の減衰量や減衰指数に使う。 */
export const PerBand = <T extends z.ZodType>(value: T) =>
  z.object({ "2.4": value, "5": value, "6": value });
export type PerBand<T> = Record<Band, T>;
