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
  };

  // If there's no text at all, skip the model call and write a heuristic-only result.
  if (!publicRemarks && !privateRemarks) {
    const adu = deriveAduFromHeuristic(input);
    const empty: Output = {
      unitMix: null,
      rentRoll: null,
      aiRentEstimate: null,
      postRenovationRentEstimate: null,
      totalMonthlyRent: null,
      occupancy: null,
      recentCapex: null,
      parkingNotes: null,
      basementNotes: null,
      viewNotes: null,
      aduPotential: adu.potential,
      aduConfidence: adu.potential ? 0.4 : 0.0,
      aduRationale: adu.rationale,
      rationale: "No remarks available — emitted heuristic ADU read only.",
    };
    await persist(mlsId, empty);
    return empty;
  }

  const result = await internal.run({ input, userId });
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
      aduPotential: out.aduPotential,
      aduConfidence: out.aduConfidence,
      aduRationale: out.aduRationale,
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
 * Local fallback heuristic for ADU potential when there are no remarks at all.
 * Mirrors the rule in the system prompt so the empty-remarks path still emits
 * a sane read.
 */
export function deriveAduFromHeuristic(input: {
  propertyType: string | null;
  units: number | null;
  buildingSqft: number | null;
  lotSqft: number | null;
  stories: number | null;
}): { potential: "LOW" | "MEDIUM" | "HIGH" | null; rationale: string } {
  const { lotSqft, buildingSqft, units, stories } = input;
  if (lotSqft == null) return { potential: null, rationale: "No lot size on file." };

  const storiesClamped = Math.max(1, Math.min(4, stories ?? 2));
  const footprint =
    buildingSqft != null ? buildingSqft / storiesClamped : lotSqft * 0.55;
  const unused = lotSqft - footprint;

  if (units != null && units > 6 && unused < 1200) {
    return {
      potential: "LOW",
      rationale: `Dense lot (${units} units, ~${Math.round(unused)} sqft yard) leaves no ADU envelope.`,
    };
  }
  if (unused >= 800) {
    return {
      potential: "HIGH",
      rationale: `~${Math.round(unused)} sqft of unused lot — clears SF setback envelope (4 ft side/rear, 6 ft separation).`,
    };
  }
  if (unused >= 400) {
    return {
      potential: "MEDIUM",
      rationale: `~${Math.round(unused)} sqft of unused lot — tight but plausible after setbacks.`,
    };
  }
  return {
    potential: "LOW",
    rationale: `Only ~${Math.round(unused)} sqft of unused lot — no ADU envelope after SF setbacks.`,
  };
}
