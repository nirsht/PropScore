"use client";

import { Chip, Stack } from "@mui/material";
import type { DealStatus } from "@prisma/client";
import { useFilter } from "../filterStore";

/** Order-independent set equality for two DealStatus arrays. */
function sameStatusSet(a: DealStatus[] | undefined, b: DealStatus[]): boolean {
  if (!a || a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((s) => set.has(s));
}

// "Hide passed" preset = every status except PASS.
const NOT_PASSED: DealStatus[] = ["NEW", "IN_REVIEW", "SUBMIT_OFFER"];

export function QuickChips() {
  const { state, set } = useFilter();
  const sfActive = state.city?.includes("San Francisco") ?? false;
  const chips = [
    {
      key: "sf-only",
      label: "SF only",
      active: sfActive,
      apply: () => {
        // Toggle SF in the city array. Removing the only entry clears the
        // filter entirely so all cities are returned.
        if (sfActive) {
          const remaining = (state.city ?? []).filter((c) => c !== "San Francisco");
          set({ city: remaining.length ? remaining : undefined });
        } else {
          set({ city: [...(state.city ?? []), "San Francisco"] });
        }
      },
    },
    {
      key: "ppsf-600",
      label: "$/Sqft < $600",
      active: state.pricePerSqft?.max === 600,
      apply: () =>
        set({
          pricePerSqft: state.pricePerSqft?.max === 600 ? undefined : { max: 600 },
        }),
    },
    {
      key: "ppu-500k",
      label: "Price/Unit < $500k",
      active: state.pricePerUnit?.max === 500_000,
      apply: () =>
        set({
          pricePerUnit: state.pricePerUnit?.max === 500_000 ? undefined : { max: 500_000 },
        }),
    },
    {
      key: "value-add-70",
      label: "Value-Add ≥ 70",
      active: state.valueAddWeightedAvg?.min === 70,
      apply: () =>
        set({
          valueAddWeightedAvg:
            state.valueAddWeightedAvg?.min === 70 ? undefined : { min: 70 },
        }),
    },
    {
      // Tri-state cycle: undefined → true → false → undefined
      key: "size-diff",
      label:
        state.hasSizeDiscrepancy === true
          ? "Size diff: yes"
          : state.hasSizeDiscrepancy === false
            ? "Size diff: no"
            : "Size diff: any",
      active: state.hasSizeDiscrepancy != null,
      apply: () => {
        const next =
          state.hasSizeDiscrepancy == null
            ? true
            : state.hasSizeDiscrepancy
              ? false
              : undefined;
        set({ hasSizeDiscrepancy: next });
      },
    },
    {
      key: "rent-control",
      label:
        state.rentControlCovered === true
          ? "Rent ctrl: covered"
          : state.rentControlCovered === false
            ? "Rent ctrl: exempt"
            : "Rent ctrl: any",
      active: state.rentControlCovered != null,
      apply: () => {
        const next =
          state.rentControlCovered == null
            ? true
            : state.rentControlCovered
              ? false
              : undefined;
        set({ rentControlCovered: next });
      },
    },
    {
      key: "soft-story",
      label:
        state.softStoryRedFlag === true
          ? "Soft story: yes"
          : state.softStoryRedFlag === false
            ? "Soft story: no"
            : "Soft story: any",
      active: state.softStoryRedFlag != null,
      apply: () => {
        const next =
          state.softStoryRedFlag == null
            ? true
            : state.softStoryRedFlag
              ? false
              : undefined;
        set({ softStoryRedFlag: next });
      },
    },
    {
      key: "status-new",
      label: "New only",
      active: sameStatusSet(state.dealStatus, ["NEW"]),
      apply: () =>
        set({
          dealStatus: sameStatusSet(state.dealStatus, ["NEW"])
            ? undefined
            : ["NEW"],
        }),
    },
    {
      key: "status-hide-passed",
      label: "Hide passed",
      active: sameStatusSet(state.dealStatus, NOT_PASSED),
      apply: () =>
        set({
          dealStatus: sameStatusSet(state.dealStatus, NOT_PASSED)
            ? undefined
            : [...NOT_PASSED],
        }),
    },
    {
      key: "starred-only",
      label: state.starredOnly ? "★ Saved" : "☆ Saved",
      active: !!state.starredOnly,
      apply: () => set({ starredOnly: state.starredOnly ? undefined : true }),
    },
    {
      key: "include-offboarded",
      label: "Show offboarded",
      active: !!state.includeOffboarded,
      apply: () =>
        set({
          includeOffboarded: state.includeOffboarded ? undefined : true,
        }),
    },
  ];

  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      {chips.map((c) => (
        <Chip
          key={c.key}
          size="small"
          label={c.label}
          color={c.active ? "primary" : "default"}
          variant={c.active ? "filled" : "outlined"}
          onClick={c.apply}
        />
      ))}
    </Stack>
  );
}
