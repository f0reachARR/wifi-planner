import type { Vec2 } from "@wifi-planner/domain";

/** カーソルの図面座標。フロアの画面全体を描き直さずに、読み取りの表示だけを更新するための小さなストア */
export function createHoverStore() {
  let value: Vec2 | undefined;
  const listeners = new Set<() => void>();
  return {
    set(p: Vec2 | undefined) {
      value = p;
      for (const l of listeners) l();
    },
    get: () => value,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

export type HoverStore = ReturnType<typeof createHoverStore>;
