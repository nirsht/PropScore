"use client";

import * as React from "react";
import type { FilterInput } from "@/server/api/schemas/filter";

export type FilterStateValue = Omit<FilterInput, "cursor" | "limit">;

const DEFAULT: FilterStateValue = {
  sortBy: "valueAdd",
  sortDir: "desc",
  // SF is the default scope (assessor enrichment is SF-only). Users can
  // uncheck the "SF only" chip in the filter bar to see all cities.
  city: ["San Francisco"],
};

type Ctx = {
  state: FilterStateValue;
  set: (next: Partial<FilterStateValue>) => void;
  replace: (next: FilterStateValue) => void;
  reset: () => void;
};

const FilterContext = React.createContext<Ctx | null>(null);

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<FilterStateValue>(DEFAULT);

  const set = React.useCallback(
    (next: Partial<FilterStateValue>) => setState((prev) => ({ ...prev, ...next })),
    [],
  );
  const replace = React.useCallback((next: FilterStateValue) => setState(next), []);
  const reset = React.useCallback(() => setState(DEFAULT), []);

  const value = React.useMemo(() => ({ state, set, replace, reset }), [state, set, replace, reset]);
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilter() {
  const ctx = React.useContext(FilterContext);
  if (!ctx) throw new Error("useFilter must be used within a FilterProvider");
  return ctx;
}
