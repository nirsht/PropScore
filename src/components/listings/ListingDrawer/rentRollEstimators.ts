import type { RentCompBucketUI } from "./types";

export function bedsBathsLabel(beds: number | null, baths: number | null): string {
  if (beds == null && baths == null) return "—";
  if (beds === 0) return baths != null ? `Studio · ${baths}BA` : "Studio";
  const b = beds != null ? `${beds}BR` : "?BR";
  const ba = baths != null ? `${baths}BA` : "?BA";
  return `${b} · ${ba}`;
}

export function compEstimateFor(
  buckets: RentCompBucketUI[],
  target: { beds: number | null; baths: number | null; sqft?: number | null },
): { rent: number; rationale: string } | null {
  const match = buckets.find(
    (b) => b.beds === target.beds && b.baths === target.baths,
  );
  if (!match || match.count === 0) return null;
  if (target.sqft && match.medianPricePerSqft != null) {
    const rent = Math.round((match.medianPricePerSqft * target.sqft) / 50) * 50;
    const ppsf = match.medianPricePerSqft.toFixed(2);
    return {
      rent,
      rationale: `${match.count} closed SFAR lease${match.count === 1 ? "" : "s"} · median $${ppsf}/sf × ${target.sqft.toLocaleString()} sf`,
    };
  }
  if (match.medianRent != null) {
    return {
      rent: Math.round(match.medianRent / 50) * 50,
      rationale: `${match.count} closed SFAR lease${match.count === 1 ? "" : "s"} · median $${Math.round(match.medianRent).toLocaleString()}/mo`,
    };
  }
  return null;
}

export function matchEstimate<
  T extends {
    beds: number | null;
    baths: number | null;
    sqft?: number | null;
    unitLabel?: string | null;
  },
>(
  estimates: T[] | null | undefined,
  target: {
    beds: number | null;
    baths: number | null;
    sqft?: number | null;
    unitLabel?: string | null;
    index: number;
  },
): T | null {
  if (!estimates?.length) return null;
  // 1. Same unit label (most specific)
  if (target.unitLabel) {
    const m = estimates.find(
      (e) => !!e.unitLabel && e.unitLabel === target.unitLabel,
    );
    if (m) return m;
  }
  // 2. Same index (when the agent emitted estimates in lockstep with rent roll)
  const indexed = estimates[target.index];
  if (indexed && indexed.beds === target.beds && indexed.baths === target.baths) {
    return indexed;
  }
  // 3. Same (beds, baths) and sqft within ±15%
  if (target.sqft) {
    const m = estimates.find(
      (e) =>
        e.beds === target.beds &&
        e.baths === target.baths &&
        !!e.sqft &&
        Math.abs(e.sqft - target.sqft!) / target.sqft! < 0.15,
    );
    if (m) return m;
  }
  // 4. First (beds, baths) match
  return (
    estimates.find((e) => e.beds === target.beds && e.baths === target.baths) ??
    null
  );
}
