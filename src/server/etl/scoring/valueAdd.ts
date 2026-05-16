import type { RenovationLevel } from "@prisma/client";

/**
 * Value-Add weighted average — the default sort key for the grid.
 *
 * Updated 2026-05-08: collapsed to a 5-component scheme aligned with how
 * we actually pitch deals (vacancy is king, location and density tie for
 * second, ADU is a tiebreaker, motivation is a small thumb on the scale).
 * Renovation upside, size discrepancy, and land ratio are still computed
 * for the breakdown but no longer move the weighted average.
 *
 * Weights are exposed so the UI can let users re-rank with their own.
 * Null components drop out of the divisor so unscored listings aren't
 * penalized.
 */
export const VALUE_ADD_WEIGHTS = {
  vacancy: 0.35,
  location: 0.25,
  density: 0.25,
  adu: 0.10,
  motivation: 0.05,
} as const;

export type WeightKey = keyof typeof VALUE_ADD_WEIGHTS;

export const WEIGHT_KEYS: ReadonlyArray<WeightKey> = [
  "vacancy",
  "location",
  "density",
  "adu",
  "motivation",
];

/**
 * Higher = more value-add upside available. RENOVATED is a near-zero floor
 * because there's nothing left to reposition; DISTRESSED is the ceiling.
 */
export const RENOVATION_UPSIDE: Record<RenovationLevel, number> = {
  DISTRESSED: 100,
  ORIGINAL: 75,
  UPDATED: 35,
  RENOVATED: 10,
};

export function renovationUpsideScore(level: RenovationLevel | null | undefined): number | null {
  if (level == null) return null;
  return RENOVATION_UPSIDE[level];
}

export function sizeDiscrepancyScore(
  mlsSqft: number | null | undefined,
  assessorSqft: number | null | undefined,
): number | null {
  if (mlsSqft == null || assessorSqft == null) return null;
  if (mlsSqft <= 0 || assessorSqft <= 0) return null;
  const ratio = assessorSqft / mlsSqft;
  if (ratio < 1.05) return 20;
  if (ratio < 1.15) return 50;
  if (ratio < 1.30) return 80;
  return 95;
}

export function landRatioScore(
  landValue: number | null | undefined,
  buildingValue: number | null | undefined,
): number | null {
  if (landValue == null || buildingValue == null) return null;
  if (landValue <= 0 && buildingValue <= 0) return null;
  const total = landValue + buildingValue;
  if (total <= 0) return null;
  const landPct = landValue / total;
  if (landPct > 0.85) return 100;
  if (landPct > 0.70) return 75;
  if (landPct > 0.55) return 50;
  return 25;
}

/**
 * AI ADU base score: max of the two 0–100 reads emitted by the listing-extract
 * agent. detached = vacant-yard play; converted = repurpose-existing-space.
 *
 * The contribution to value-add is the MAX of the two — either path adds a
 * single unit of cash flow, so we don't double-count and we don't average
 * them down. Returns null only when both reads are missing.
 *
 * The output feeds `applyAduFeasibilityBoosts` below, which layers in parcel-
 * level structural evidence (construction type / land use / permit precedent).
 */
export function aduCombinedScore(
  detached: number | null | undefined,
  converted: number | null | undefined,
): number | null {
  const candidates = [detached, converted].filter(
    (v): v is number => v != null,
  );
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

export type AduFeasibilityCtx = {
  /** From assessor (sfpim). Wood frame / type V is reconfiguration-friendly. */
  assessorConstructionType?: string | null;
  /** From DataSF Land Use 2023. MIXRES enables ground-floor conversions. */
  landUseCategory?: string | null;
  /** Counts from BuildingPermit (filled by `enrich:permits`). */
  permitsOwnParcelAduCount?: number | null;
  permitsBlockAduRecentCount?: number | null;
  permitsRadiusAduRecentCount?: number | null;
};

export type AduScoreBreakdown = {
  aiBase: number | null;
  base: number;
  boosts: {
    construction: number;
    landUse: number;
    ownParcel: number;
    blockPrecedent: number;
    radius: number;
  };
  final: number;
};

function isWoodFrame(constructionType: string | null | undefined): boolean {
  if (!constructionType) return false;
  // SF assessor `construction_type` values: "Wood Frame", "Type V", "Frame".
  // Permits use "wood frame (5)". Match liberally.
  return /\b(wood\s*frame|type\s*v|^frame$)\b/i.test(constructionType);
}

/**
 * Augment the AI ADU base read with parcel-level feasibility evidence:
 *   - Construction type (wood frame ⇒ easier reconfiguration)
 *   - Land use category (MIXRES ⇒ flexible / RESIDENT ⇒ baseline)
 *   - Permit precedent on the parcel, the block, and within ~500ft
 *
 * The AI base (`aduCombinedScore(detached, converted)`) is the anchor;
 * structural data confirms or weakens it. A null AI base still yields a
 * score (baseline 40) when at least one structural signal is available —
 * structural feasibility alone is informative. When *no* signal is present
 * (no AI, no land use, no construction type, no permits), returns null so
 * the listing drops out of the weighted-avg divisor.
 */
export function applyAduFeasibilityBoosts(
  aiBase: number | null,
  ctx: AduFeasibilityCtx = {},
): { score: number | null; breakdown: AduScoreBreakdown } {
  const hasStructural =
    ctx.assessorConstructionType != null ||
    ctx.landUseCategory != null ||
    ctx.permitsOwnParcelAduCount != null ||
    ctx.permitsBlockAduRecentCount != null ||
    ctx.permitsRadiusAduRecentCount != null;

  // AI base passes through directly when available. The synthetic 40 only
  // fires when the AI read is null but structural evidence is present —
  // legacy behaviour preserved from the LOW/MEDIUM/HIGH days.
  const base = aiBase != null ? aiBase : 40;

  const construction = isWoodFrame(ctx.assessorConstructionType) ? 10 : 0;

  const cat = ctx.landUseCategory?.toUpperCase() ?? null;
  const landUse = cat === "MIXRES" ? 15 : cat === "RESIDENT" ? 5 : 0;

  const ownParcel = (ctx.permitsOwnParcelAduCount ?? 0) > 0 ? 10 : 0;
  const blockPrecedent = (ctx.permitsBlockAduRecentCount ?? 0) > 0 ? 20 : 0;
  // Radius precedent only adds when there's no same-block precedent — same-
  // block already captures the strongest signal, so don't double-count.
  const radius =
    blockPrecedent === 0 && (ctx.permitsRadiusAduRecentCount ?? 0) > 0 ? 10 : 0;

  const final = Math.max(
    0,
    Math.min(100, base + construction + landUse + ownParcel + blockPrecedent + radius),
  );

  return {
    score: aiBase == null && !hasStructural ? null : final,
    breakdown: {
      aiBase,
      base,
      boosts: { construction, landUse, ownParcel, blockPrecedent, radius },
      final,
    },
  };
}

export type WeightedComponents = {
  vacancyScore: number | null;
  locationScore: number | null;
  densityScore: number | null;
  aduScore: number | null;
  motivationScore: number | null;
};

export type WeightOverrides = Partial<Record<WeightKey, number>>;

/**
 * Normalize a partial weight set so the present keys sum to 1, mirroring
 * how `weightedValueAdd` drops null components from the divisor. Returns
 * the canonical defaults when no overrides are supplied.
 */
export function resolveWeights(overrides?: WeightOverrides): Record<WeightKey, number> {
  if (!overrides) return { ...VALUE_ADD_WEIGHTS };
  const merged: Record<WeightKey, number> = { ...VALUE_ADD_WEIGHTS };
  for (const k of WEIGHT_KEYS) {
    const v = overrides[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) merged[k] = v;
  }
  const sum = WEIGHT_KEYS.reduce((s, k) => s + merged[k], 0);
  if (sum <= 0) return { ...VALUE_ADD_WEIGHTS };
  if (Math.abs(sum - 1) < 1e-9) return merged;
  const norm: Record<WeightKey, number> = { ...merged };
  for (const k of WEIGHT_KEYS) norm[k] = merged[k] / sum;
  return norm;
}

export function weightedValueAdd(
  scores: WeightedComponents,
  overrides?: WeightOverrides,
): number {
  const w = resolveWeights(overrides);
  const components: Array<{ value: number; weight: number }> = [];
  if (scores.vacancyScore != null) components.push({ value: scores.vacancyScore, weight: w.vacancy });
  if (scores.locationScore != null) components.push({ value: scores.locationScore, weight: w.location });
  if (scores.densityScore != null) components.push({ value: scores.densityScore, weight: w.density });
  if (scores.aduScore != null) components.push({ value: scores.aduScore, weight: w.adu });
  if (scores.motivationScore != null) components.push({ value: scores.motivationScore, weight: w.motivation });

  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight <= 0) return 0;
  const weighted = components.reduce((sum, c) => sum + c.value * c.weight, 0);
  return weighted / totalWeight;
}
