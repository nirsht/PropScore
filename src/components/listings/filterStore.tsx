"use client";

import * as React from "react";
import type { FilterInput } from "@/server/api/schemas/filter";
import {
  VALUE_ADD_WEIGHTS,
  WEIGHT_KEYS,
  type WeightKey,
} from "@/server/etl/scoring/valueAdd";

export type FilterStateValue = Omit<FilterInput, "cursor" | "limit">;

const DEFAULT: FilterStateValue = {
  sortBy: "valueAdd",
  sortDir: "desc",
  // SF is the default scope (assessor enrichment is SF-only). Users can
  // uncheck the "SF only" chip in the filter bar to see all cities.
  city: ["San Francisco"],
};

export type ScoringWeights = Record<WeightKey, number>;

const WEIGHTS_STORAGE_KEY = "propscore.scoringWeights.v1";

export const DEFAULT_WEIGHTS: ScoringWeights = { ...VALUE_ADD_WEIGHTS };

function readWeightsFromStorage(): ScoringWeights {
  if (typeof window === "undefined") return DEFAULT_WEIGHTS;
  try {
    const raw = window.localStorage.getItem(WEIGHTS_STORAGE_KEY);
    if (!raw) return DEFAULT_WEIGHTS;
    const parsed = JSON.parse(raw) as Partial<Record<WeightKey, number>>;
    const out: ScoringWeights = { ...DEFAULT_WEIGHTS };
    for (const k of WEIGHT_KEYS) {
      const v = parsed[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
    }
    // Re-normalize defensively so persisted state always sums to 1.
    const sum = WEIGHT_KEYS.reduce((s, k) => s + out[k], 0);
    if (sum > 0 && Math.abs(sum - 1) > 1e-9) {
      for (const k of WEIGHT_KEYS) out[k] = out[k] / sum;
    }
    return out;
  } catch {
    return DEFAULT_WEIGHTS;
  }
}

function weightsAreDefault(w: ScoringWeights): boolean {
  for (const k of WEIGHT_KEYS) {
    if (Math.abs(w[k] - DEFAULT_WEIGHTS[k]) > 1e-9) return false;
  }
  return true;
}

type Ctx = {
  state: FilterStateValue;
  set: (next: Partial<FilterStateValue>) => void;
  replace: (next: FilterStateValue) => void;
  reset: () => void;
  weights: ScoringWeights;
  setWeights: (next: ScoringWeights) => void;
  resetWeights: () => void;
};

const FilterContext = React.createContext<Ctx | null>(null);

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<FilterStateValue>(DEFAULT);
  const [weights, setWeightsState] = React.useState<ScoringWeights>(DEFAULT_WEIGHTS);

  // Hydrate from localStorage after mount to avoid SSR mismatch.
  React.useEffect(() => {
    setWeightsState(readWeightsFromStorage());
  }, []);

  const set = React.useCallback(
    (next: Partial<FilterStateValue>) => setState((prev) => ({ ...prev, ...next })),
    [],
  );
  const replace = React.useCallback((next: FilterStateValue) => setState(next), []);
  const reset = React.useCallback(() => setState(DEFAULT), []);

  const setWeights = React.useCallback((next: ScoringWeights) => {
    setWeightsState(next);
    try {
      if (weightsAreDefault(next)) {
        window.localStorage.removeItem(WEIGHTS_STORAGE_KEY);
      } else {
        window.localStorage.setItem(WEIGHTS_STORAGE_KEY, JSON.stringify(next));
      }
    } catch {
      // Quota / private mode — ignore; in-memory state still works.
    }
  }, []);

  const resetWeights = React.useCallback(() => {
    setWeights(DEFAULT_WEIGHTS);
  }, [setWeights]);

  // Keep `state.scoringWeights` in sync with the weights slice so the existing
  // listings.search query (which serializes the entire filter state) picks up
  // weight changes without every consumer threading them in manually. We send
  // it only when the weights diverge from defaults — keeps the indexed
  // `valueAddWeightedAvg` path active for the common case.
  React.useEffect(() => {
    setState((prev) => {
      if (weightsAreDefault(weights)) {
        if (prev.scoringWeights == null) return prev;
        const { scoringWeights: _omit, ...rest } = prev;
        return rest;
      }
      const next = { ...prev, scoringWeights: weights };
      return next;
    });
  }, [weights]);

  const value = React.useMemo<Ctx>(
    () => ({ state, set, replace, reset, weights, setWeights, resetWeights }),
    [state, set, replace, reset, weights, setWeights, resetWeights],
  );
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilter() {
  const ctx = React.useContext(FilterContext);
  if (!ctx) throw new Error("useFilter must be used within a FilterProvider");
  return ctx;
}

export function useScoringWeights() {
  const { weights, setWeights, resetWeights } = useFilter();
  return { weights, setWeights, resetWeights, isDefault: weightsAreDefault(weights) };
}
