import type { DealStatus, RenovationLevel } from "@prisma/client";
import type { ChipColor } from "@/components/common/MultiSelectFilter";
import type { useFilter } from "../filterStore";

export const RENO_OPTIONS: Array<{
  value: RenovationLevel;
  label: string;
  color: "error" | "warning" | "info" | "success";
}> = [
  { value: "DISTRESSED", label: "Distressed", color: "error" },
  { value: "ORIGINAL", label: "Original", color: "warning" },
  { value: "UPDATED", label: "Updated", color: "info" },
  { value: "RENOVATED", label: "Renovated", color: "success" },
];

/**
 * Deal-workspace pipeline statuses, in pipeline order. Shared by the filter
 * multi-select, the grid's inline status dropdown, and the drawer selector so
 * the label + color for each stage is defined once.
 */
export const STATUS_OPTIONS: Array<{
  value: DealStatus;
  label: string;
  color: ChipColor;
}> = [
  { value: "NEW", label: "New", color: "info" },
  { value: "IN_REVIEW", label: "In review", color: "warning" },
  { value: "SUBMIT_OFFER", label: "Submit offer", color: "success" },
  { value: "PASS", label: "Pass", color: "default" },
];

export const STATUS_OPTION_BY_VALUE: Record<
  DealStatus,
  (typeof STATUS_OPTIONS)[number]
> = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o])) as Record<
  DealStatus,
  (typeof STATUS_OPTIONS)[number]
>;

export function countActive(s: ReturnType<typeof useFilter>["state"]): number {
  let n = 0;
  if (s.q) n++;
  if (s.city?.length) n++;
  if (s.propertyTypes?.length) n++;
  if (s.renovationLevel?.length) n++;
  if (s.dealStatus?.length) n++;
  for (const k of [
    "price",
    "pricePerSqft",
    "pricePerUnit",
    "sqft",
    "units",
    "beds",
    "baths",
    "yearBuilt",
    "daysOnMls",
    "occupancy",
    "densityScore",
    "vacancyScore",
    "motivationScore",
    "valueAddWeightedAvg",
    "codeViolationsOpenCount",
    "housingNetUnitChange5y",
  ] as const) {
    const v = s[k];
    if (v && (v.min != null || v.max != null)) n++;
  }
  if (s.postDate && (s.postDate.min || s.postDate.max)) n++;
  if (s.hasSizeDiscrepancy != null) n++;
  if (s.rentControlCovered != null) n++;
  if (s.softStoryRedFlag != null) n++;
  if (s.starredOnly) n++;
  if (s.includeOffboarded) n++;
  if (s.radius) n++;
  if (s.polygon) n++;
  return n;
}
