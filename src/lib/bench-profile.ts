export interface BenchProfileEntry {
  detail?: BenchProfileDetail;
  durationMs: number;
  endTimeMs: number;
  name: string;
  startTimeMs: number;
}

export interface BenchProfileStore {
  enabled: boolean;
  entries: BenchProfileEntry[];
}

type BenchProfileScalar = boolean | null | number | string;
export type BenchProfileDetail = Record<string, BenchProfileScalar | undefined>;

declare global {
  interface Window {
    __length3BenchProfile?: BenchProfileStore;
  }
}

export function startBenchProfile(name: string, detail?: BenchProfileDetail) {
  const store = getBenchProfileStore();
  if (!store) {
    return () => {};
  }

  const startTimeMs = performance.now();
  let finished = false;

  return () => {
    if (finished) return;
    finished = true;

    const endTimeMs = performance.now();
    store.entries.push({
      ...(detail ? { detail } : {}),
      durationMs: Number((endTimeMs - startTimeMs).toFixed(3)),
      endTimeMs: Number(endTimeMs.toFixed(3)),
      name,
      startTimeMs: Number(startTimeMs.toFixed(3)),
    });
  };
}

function getBenchProfileStore() {
  if (typeof window === 'undefined') {
    return null;
  }

  const store = window.__length3BenchProfile;
  if (!store?.enabled) {
    return null;
  }

  return store;
}
