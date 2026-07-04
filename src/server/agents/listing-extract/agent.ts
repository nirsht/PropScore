import { z } from "zod";
import { BaseAgent } from "../base/BaseAgent";
import { db } from "@/lib/db";
import { LISTING_EXTRACT_SYSTEM_PROMPT, listingExtractUserMessage } from "./prompt";
import { ListingExtractOutput, type ListingExtractOutput as Output } from "./schema";
import { Prisma } from "@prisma/client";

const InternalInput = z.object({
  mlsId: z.string(),
  publicRemarks: z.string().nullable(),
  privateRemarks: z.string().nullable(),
  propertyType: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
  units: z.number().nullable(),
  buildingSqft: z.number().nullable(),
  lotSqft: z.number().nullable(),
  stories: z.number().nullable(),
  basementSqft: z.number().nullable(),
  aiHasBasement: z.boolean().nullable(),
  // Precomputed by deriveDetachedAduFromHeuristic / deriveAttachedAduFromHeuristic
  // below — the model anchors to these instead of re-deriving lot geometry itself.
  detachedAduBaseScore: z.number().int().min(0).max(100).nullable(),
  detachedAduBaseRationale: z.string(),
  attachedAduBaseScore: z.number().int().min(0).max(100).nullable(),
  attachedAduBaseRationale: z.string(),
});

// Pinned to gpt-5-mini — chosen for cost. Bump to "gpt-5.4-mini" or
// "gpt-5.5" if extraction quality regresses on tabular rent rolls.
const internal = new BaseAgent({
  name: "listing-extract",
  model: "gpt-5-mini",
  systemPrompt: LISTING_EXTRACT_SYSTEM_PROMPT,
  inputSchema: InternalInput,
  outputSchema: ListingExtractOutput,
  userMessage: (i) => listingExtractUserMessage(i),
  tools: [],
  maxSteps: 1,
});

/**
 * Extract unit mix, rent roll, capex, ADU potential from a listing's remarks.
 * Single OpenAI call (model = OPENAI_MODEL, default gpt-4o). Persists
 * denormalized highlights onto Listing and the full output into AIEnrichment.
 */
export async function runListingExtract(mlsId: string, userId: string | null): Promise<Output> {
  const listing = await db.listing.findUnique({
    where: { mlsId },
    select: {
      mlsId: true,
      address: true,
      city: true,
      state: true,
      postalCode: true,
      propertyType: true,
      units: true,
      assessorUnits: true,
      sqft: true,
      assessorBuildingSqft: true,
      lotSizeSqft: true,
      assessorLotSqft: true,
      stories: true,
      assessorStories: true,
      assessorBasementSqft: true,
      aiHasBasement: true,
      raw: true,
    },
  });
  if (!listing) throw new Error(`Listing not found: ${mlsId}`);

  const raw = (listing.raw ?? {}) as Record<string, unknown>;
  const publicRemarks = (raw.PublicRemarks as string | undefined) ?? null;
  const privateRemarks = (raw.PrivateRemarks as string | undefined) ?? null;

  const input = {
    mlsId,
    publicRemarks,
    privateRemarks,
    propertyType: listing.propertyType,
    address: listing.address,
    city: listing.city,
    state: listing.state,
    postalCode: listing.postalCode,
    units: listing.units ?? listing.assessorUnits ?? null,
    buildingSqft: listing.assessorBuildingSqft ?? listing.sqft ?? null,
    lotSqft: listing.assessorLotSqft ?? listing.lotSizeSqft ?? null,
    stories: listing.assessorStories ?? listing.stories ?? null,
    basementSqft: listing.assessorBasementSqft,
    aiHasBasement: listing.aiHasBasement,
  };

  // Geometry-derived base — computed deterministically in code (not left to the
  // model's free-form arithmetic) so setback/lot-shape math is actually correct.
  // The LLM anchors to this and only layers remark-driven bumps/drops on top.
  const detachedBase = deriveDetachedAduFromHeuristic(input);
  const attachedBase = deriveAttachedAduFromHeuristic(input);

  // If there's no text at all, skip the model call and write a heuristic-only result.
  if (!publicRemarks && !privateRemarks) {
    const detached = detachedBase;
    const attached = attachedBase;
    const converted = deriveConvertedAduFromHeuristic(input);
    const empty: Output = {
      unitMix: null,
      unitMixEvidence: null,
      rentRoll: null,
      aiRentEstimate: null,
      postRenovationRentEstimate: null,
      totalMonthlyRent: null,
      occupancy: null,
      recentCapex: null,
      parkingNotes: null,
      basementNotes: null,
      viewNotes: null,
      detachedAduScore: detached.score,
      detachedAduRationale: detached.rationale,
      attachedAduScore: attached.score,
      attachedAduRationale: attached.rationale,
      convertedAduScore: converted.score,
      convertedAduRationale: converted.rationale,
      convertedAduSource: converted.source,
      rationale: "No remarks available — emitted heuristic ADU read only.",
    };
    await persist(mlsId, empty);
    return empty;
  }

  const result = await internal.run({
    input: {
      ...input,
      detachedAduBaseScore: detachedBase.score,
      detachedAduBaseRationale: detachedBase.rationale,
      attachedAduBaseScore: attachedBase.score,
      attachedAduBaseRationale: attachedBase.rationale,
    },
    userId,
  });
  await persist(mlsId, result.output);
  return result.output;
}

async function persist(mlsId: string, out: Output) {
  // Prisma's nullable JSON columns require Prisma.JsonNull (DB null) or
  // Prisma.DbNull as a sentinel — passing JS `null` is rejected at compile.
  await db.listing.update({
    where: { mlsId },
    data: {
      extractedUnitMix: out.unitMix
        ? (out.unitMix as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      extractedRentRoll: out.rentRoll
        ? (out.rentRoll as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      aiRentEstimate: out.aiRentEstimate
        ? (out.aiRentEstimate as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      postRenovationRentEstimate: out.postRenovationRentEstimate
        ? (out.postRenovationRentEstimate as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      extractedTotalMonthlyRent:
        out.totalMonthlyRent != null ? Math.round(out.totalMonthlyRent) : null,
      extractedOccupancy: out.occupancy,
      recentCapex: out.recentCapex
        ? (out.recentCapex as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      detachedAduScore: out.detachedAduScore,
      detachedAduRationale: out.detachedAduRationale,
      attachedAduScore: out.attachedAduScore,
      attachedAduRationale: out.attachedAduRationale,
      convertedAduScore: out.convertedAduScore,
      convertedAduRationale: out.convertedAduRationale,
      convertedAduSource: out.convertedAduSource,
      extractFetchedAt: new Date(),
    },
  });

  await db.aIEnrichment.create({
    data: {
      listingMlsId: mlsId,
      agentName: "listing-extract",
      output: out as object,
    },
  });
}

/**
 * Local fallback heuristic for the DETACHED-ADU score (vacant-yard play)
 * when there are no remarks at all. Mirrors the rule documented in the
 * system prompt so the empty-remarks path still emits a sane read.
 *
 * SF lots are deep-narrow and the building usually spans nearly the full
 * lot width, so usable yard is a rear STRIP, not residual lot area. We
 * estimate lot width from the SF-typical 4:1 depth:width ratio (clamped to
 * 15–40 ft), then subtract 4 ft side setbacks from the usable width.
 */
export function deriveDetachedAduFromHeuristic(input: {
  units: number | null;
  buildingSqft: number | null;
  lotSqft: number | null;
  stories: number | null;
}): { score: number | null; rationale: string } {
  const { lotSqft, buildingSqft, units, stories } = input;
  if (lotSqft == null || lotSqft <= 0) {
    return { score: null, rationale: "No lot size on file." };
  }

  const lotWidth = Math.max(15, Math.min(40, Math.sqrt(lotSqft / 4)));
  const lotDepth = lotSqft / lotWidth;
  const storiesInput = stories ?? 2;
  // Top floor in SF buildings ≥ 3 stories is usually smaller (mansard,
  // setback). Trim 0.3 off the divisor so footprint isn't underestimated.
  const storyDivisor = Math.max(
    1,
    storiesInput <= 2 ? storiesInput : storiesInput - 0.3,
  );
  const footprint =
    buildingSqft != null && buildingSqft > 0
      ? buildingSqft / storyDivisor
      : lotSqft * 0.55;
  const buildingDepth = footprint / lotWidth;
  const rearYardDepth = Math.max(0, lotDepth - buildingDepth);
  const usableWidth = Math.max(0, lotWidth - 8);
  const rearYardArea = Math.round(rearYardDepth * usableWidth);

  // Dense multifamily with no real yard.
  if (units != null && units > 6 && rearYardArea < 1200) {
    return {
      score: 0,
      rationale: `Dense lot (${units} units, ~${rearYardArea} sqft rear yard) leaves no detached-ADU envelope.`,
    };
  }

  const score = scoreRearYardArea(rearYardArea);

  if (score >= 80) {
    return {
      score,
      rationale: `~${rearYardArea} sqft rear yard after side setbacks — clears SF ADU envelope (4 ft rear, 6 ft separation).`,
    };
  }
  if (score >= 40) {
    return {
      score,
      rationale: `~${rearYardArea} sqft rear yard after side setbacks — tight but plausible for a small detached ADU.`,
    };
  }
  return {
    score,
    rationale: `Only ~${rearYardArea} sqft rear yard after side setbacks — minimal envelope for a detached ADU.`,
  };
}

/**
 * Piecewise-linear mapping from usable rear-yard area (sqft, already net
 * of 4 ft side setbacks) to a 0–100 detached-ADU score. Anchors: 300→0,
 * 500→30, 800→60, 1200→85, 1600+→100. See the system prompt for the
 * narrative version used by the LLM.
 */
function scoreRearYardArea(area: number): number {
  if (area <= 300) return 0;
  if (area <= 500) return Math.round((area - 300) * 0.15);
  if (area <= 800) return Math.round(30 + (area - 500) * 0.1);
  if (area <= 1200) return Math.round(60 + (area - 800) * 0.0625);
  if (area <= 1600) return Math.round(85 + (area - 1200) * 0.0375);
  return 100;
}

/**
 * Local fallback heuristic for the ATTACHED-ADU score (new addition sharing a
 * wall with the primary residence). Same SF lot geometry as detached, but:
 *   - rear 4 ft setback is subtracted explicitly from depth
 *   - no 6 ft separation buffer (the ADU is physically attached)
 *   - score ladder is more permissive — an attached addition can be narrower
 *     / longer and doesn't need to stand alone as a footprint.
 */
export function deriveAttachedAduFromHeuristic(input: {
  units: number | null;
  buildingSqft: number | null;
  lotSqft: number | null;
  stories: number | null;
}): { score: number | null; rationale: string } {
  const { lotSqft, buildingSqft, units, stories } = input;
  if (lotSqft == null || lotSqft <= 0) {
    return { score: null, rationale: "No lot size on file." };
  }

  const lotWidth = Math.max(15, Math.min(40, Math.sqrt(lotSqft / 4)));
  const lotDepth = lotSqft / lotWidth;
  const storiesInput = stories ?? 2;
  const storyDivisor = Math.max(
    1,
    storiesInput <= 2 ? storiesInput : storiesInput - 0.3,
  );
  const footprint =
    buildingSqft != null && buildingSqft > 0
      ? buildingSqft / storyDivisor
      : lotSqft * 0.55;
  const buildingDepth = footprint / lotWidth;
  // Explicit 4 ft rear setback (detached bakes it into the ladder; attached
  // makes it explicit so we can later add the 0-ft exception toggle).
  const rearYardDepth = Math.max(0, lotDepth - buildingDepth - 4);
  const usableWidth = Math.max(0, lotWidth - 8);
  const attachedEnvelope = Math.round(rearYardDepth * usableWidth);

  if (units != null && units > 6 && attachedEnvelope < 600) {
    return {
      score: 0,
      rationale: `Dense lot (${units} units, ~${attachedEnvelope} sqft rear envelope) leaves no attached-ADU build-out.`,
    };
  }

  const score = scoreAttachedEnvelope(attachedEnvelope);

  if (score >= 80) {
    return {
      score,
      rationale: `~${attachedEnvelope} sqft rear envelope after setbacks — clears SF attached-ADU build-out (4 ft rear, 4 ft side).`,
    };
  }
  if (score >= 40) {
    return {
      score,
      rationale: `~${attachedEnvelope} sqft rear envelope after setbacks — tight but plausible for a small rear addition.`,
    };
  }
  return {
    score,
    rationale: `Only ~${attachedEnvelope} sqft rear envelope after setbacks — minimal room for an attached ADU.`,
  };
}

/**
 * Piecewise-linear mapping from usable attached-envelope area (sqft, net of
 * 4 ft rear + 4 ft side setbacks) to a 0–100 attached-ADU score. Anchors:
 * 200→0, 350→30, 600→60, 900→85, 1200+→100. Looser than detached because an
 * attached addition has no 6 ft separation buffer and can be narrower/longer.
 */
function scoreAttachedEnvelope(area: number): number {
  if (area <= 200) return 0;
  if (area <= 350) return Math.round((area - 200) * 0.2);
  if (area <= 600) return Math.round(30 + (area - 350) * 0.12);
  if (area <= 900) return Math.round(60 + (area - 600) * (25 / 300));
  if (area <= 1200) return Math.round(85 + (area - 900) * (15 / 300));
  return 100;
}

/**
 * Local fallback heuristic for the CONVERTED-ADU score (repurpose existing
 * interior space). Uses assessor basement_area first, then falls back to the
 * AI vision boolean. The agent supersedes this when remarks are present.
 */
export function deriveConvertedAduFromHeuristic(input: {
  basementSqft: number | null;
  aiHasBasement: boolean | null;
}): {
  score: number | null;
  rationale: string;
  source: "basement" | "garage" | "unfinished-space" | null;
} {
  const { basementSqft, aiHasBasement } = input;

  if (basementSqft != null && basementSqft > 0) {
    if (basementSqft >= 500) {
      return {
        score: 80,
        rationale: `Assessor records ${basementSqft} sqft basement — ample envelope to legalize as a unit.`,
        source: "basement",
      };
    }
    if (basementSqft >= 300) {
      return {
        score: 55,
        rationale: `Assessor records ${basementSqft} sqft basement — workable for a studio/1BR conversion.`,
        source: "basement",
      };
    }
    return {
      score: 25,
      rationale: `Only ${basementSqft} sqft basement on the assessor record — too small for a real unit.`,
      source: "basement",
    };
  }

  if (aiHasBasement === true) {
    return {
      score: 50,
      rationale: "Vision photo shows a partially-exposed lower level — unsized basement is a plausible conversion.",
      source: "basement",
    };
  }

  return {
    score: null,
    rationale: "No basement signal on the assessor or vision record.",
    source: null,
  };
}
