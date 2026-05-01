/**
 * Source priority + divergence helpers for MLS / Assessor / AI data.
 *
 * The "good buys" thesis in PropScore: when sources disagree, the discrepancy
 * itself is a signal. Lazy MLS measurement vs accurate Assessor data → priced
 * below true sqft → opportunity. We surface the diff in both the drawer and
 * the table.
 */

/**
 * Source priority chain for value resolution. Edit the order to flip the
 * preferred source globally. The SQL generated columns mirror this order in
 * `prisma/migrations/.../migration.sql`; keeping them aligned avoids the
 * drawer and the table disagreeing on which value is "preferred".
 */
export const SOURCE_PRIORITY = ["assessor", "mls", "ai"] as const;
export type Source = (typeof SOURCE_PRIORITY)[number];

export const SOURCE_LABEL: Record<Source, string> = {
  assessor: "Assessor",
  mls: "MLS",
  ai: "AI",
};

const DEFAULT_THRESHOLD = 0.05;

/**
 * Returns true when `a` and `b` differ by more than `threshold` (default 5%).
 * Both values must be non-null/non-zero for the comparison to fire — missing
 * data does not count as divergence.
 */
export function isDiverging(
  a: number | null | undefined,
  b: number | null | undefined,
  threshold = DEFAULT_THRESHOLD,
): boolean {
  if (a == null || b == null) return false;
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return false;
  return Math.abs(a - b) / max > threshold;
}

export type Tone = "neutral" | "positive" | "negative";

/**
 * Tone of the discrepancy from the buyer's perspective:
 *  - positive (green): assessor sees MORE building / lot / units than MLS
 *    listed → asking price under-represents the asset → upside.
 *  - negative (red): assessor sees less than MLS listed → MLS overstates →
 *    likely overpriced.
 *  - neutral: no diff or one side missing.
 */
export function getDiscrepancyTone(
  mls: number | null | undefined,
  assessor: number | null | undefined,
  threshold = DEFAULT_THRESHOLD,
): Tone {
  if (!isDiverging(mls, assessor, threshold)) return "neutral";
  return (assessor as number) > (mls as number) ? "positive" : "negative";
}

/**
 * Walks SOURCE_PRIORITY (or a custom override) and returns the first
 * non-null/non-zero value. Used by the drawer to display a single resolved
 * value with its provenance chip.
 */
export function resolvePreferred<T extends number | string | null | undefined>(
  sources: Partial<Record<Source, T>>,
  priority: readonly Source[] = SOURCE_PRIORITY,
): { value: NonNullable<T> | null; source: Source | null } {
  for (const s of priority) {
    const v = sources[s];
    if (v != null && v !== 0) {
      return { value: v as NonNullable<T>, source: s };
    }
  }
  return { value: null, source: null };
}

/**
 * Returns true if any pair of values in `values` differs by more than
 * threshold. Used by the building-details grid to highlight whole rows when
 * any source disagrees with another.
 */
export function rowDiverges(
  values: Array<number | null | undefined>,
  threshold = DEFAULT_THRESHOLD,
): boolean {
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      if (isDiverging(values[i], values[j], threshold)) return true;
    }
  }
  return false;
}
