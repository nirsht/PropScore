import type { RenovationLevel } from "@prisma/client";

export const RENO_COLOR: Record<RenovationLevel, "error" | "warning" | "info" | "success"> = {
  DISTRESSED: "error",
  ORIGINAL: "warning",
  UPDATED: "info",
  RENOVATED: "success",
};

export const RENO_LABEL: Record<RenovationLevel, string> = {
  DISTRESSED: "Distressed",
  ORIGINAL: "Original",
  UPDATED: "Updated",
  RENOVATED: "Renovated",
};

export const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;

export const fmtDecimal = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : Number(n).toFixed(digits);

export function sumUnitMix(mix: unknown): number | null {
  if (!Array.isArray(mix) || mix.length === 0) return null;
  let total = 0;
  for (const entry of mix) {
    if (entry && typeof entry === "object" && "count" in entry) {
      const c = (entry as { count?: unknown }).count;
      if (typeof c === "number" && Number.isFinite(c)) total += c;
    }
  }
  return total > 0 ? total : null;
}
