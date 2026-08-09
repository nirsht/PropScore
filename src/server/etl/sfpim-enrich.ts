/**
 * Per-listing SF Assessor (SFPIM) enrichment. Extracted from
 * scripts/enrich-sfpim.ts so the nightly batch sweep and the drawer's
 * "Calculate now" button (listingReviews.enrichAssessor) share one code path —
 * a manual fetch produces exactly the same fields the nightly run would.
 *
 * Source: Socrata Secured Property Tax Roll dataset (wv5m-vpq2), via
 * sfpim-client. No OpenAI calls — this is a free Socrata lookup.
 */
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  parseAddress,
  searchByParts,
  type AddressParts,
} from "@/server/etl/sfpim-client";

// Cleared when a listing fails to match, so a stale assessor record from a
// prior match doesn't linger on the row.
export const ASSESSOR_FIELDS = {
  blockLot: null,
  block: null,
  lot: null,
  assessorBuildingSqft: null,
  assessorLotSqft: null,
  assessorYearBuilt: null,
  assessorStories: null,
  assessorUnits: null,
  assessorRooms: null,
  assessorBedrooms: null,
  assessorBathrooms: null,
  assessorUseType: null,
  assessorConstructionType: null,
  assessorBasement: null,
  assessorBuildingValue: null,
  assessorLandValue: null,
} as const;

export function buildParts(
  address: string,
  raw: Record<string, unknown> | undefined,
  listingSqft: number | null,
  listingUnits: number | null,
): AddressParts | null {
  const fromAddr = parseAddress(address);
  // Bridge gives us StreetNumber and StreetName cleanly; suffix/unit/zip are
  // always missing from the Bridge feed so we fall back to parsing the
  // assembled address for those.
  const bridgeNum = typeof raw?.StreetNumber === "string" ? raw.StreetNumber.trim() : "";
  const bridgeName = typeof raw?.StreetName === "string" ? raw.StreetName.trim() : "";
  const bridgeZip = typeof raw?.PostalCode === "string" ? raw.PostalCode.trim() : "";
  const streetNumber = bridgeNum || fromAddr?.streetNumber || "";
  const streetName = (bridgeName || fromAddr?.streetName || "").toUpperCase();
  if (!streetNumber || !streetName) return null;
  return {
    streetNumber,
    streetName,
    streetSuffix: fromAddr?.streetSuffix ?? null,
    unitNumber: fromAddr?.unitNumber ?? null,
    postalCode: bridgeZip || fromAddr?.postalCode || null,
    listingSqft: listingSqft && listingSqft > 0 ? listingSqft : null,
    listingUnits: listingUnits && listingUnits > 0 ? listingUnits : null,
  };
}

export type SfpimEnrichRow = {
  mlsId: string;
  address: string;
  sqft: number | null;
  units: number | null;
  raw: Prisma.JsonValue | null;
};

export type SfpimEnrichResult = "matched" | "skipped";

/**
 * Fetch + persist the assessor record for one already-loaded listing row.
 * Always stamps `assessorFetchedAt` (even on a no-match) so the resume-skip
 * semantics of the nightly sweep keep working.
 */
export async function enrichListingSfpimRow(
  l: SfpimEnrichRow,
): Promise<SfpimEnrichResult> {
  const raw = (l.raw ?? {}) as Record<string, unknown>;
  const parts = buildParts(l.address, raw, l.sqft, l.units);
  const match = parts ? await searchByParts(parts) : null;
  const attemptedAt = new Date().toISOString();

  if (!match) {
    // Clear any stale assessor data and record the no-match attempt.
    const mergedRaw: Prisma.InputJsonValue = {
      ...raw,
      assessor: null,
      assessorMatch: { score: 0, reasons: ["no-match"], attemptedAt },
    };
    await db.listing.update({
      where: { mlsId: l.mlsId },
      data: {
        ...ASSESSOR_FIELDS,
        assessorFetchedAt: new Date(),
        raw: mergedRaw,
      },
    });
    return "skipped";
  }

  const { record, score, reasons } = match;
  const mergedRaw: Prisma.InputJsonValue = {
    ...raw,
    assessor: record.raw as unknown as Prisma.InputJsonValue,
    assessorMatch: { score, reasons, attemptedAt },
  };

  await db.listing.update({
    where: { mlsId: l.mlsId },
    data: {
      blockLot: record.blockLot,
      block: record.block,
      lot: record.lot,
      assessorBuildingSqft: record.buildingSqft,
      assessorLotSqft: record.lotSqft,
      assessorYearBuilt: record.yearBuilt,
      assessorStories: record.stories,
      assessorUnits: record.units,
      assessorRooms: record.rooms,
      assessorBedrooms: record.bedrooms,
      assessorBathrooms: record.bathrooms,
      assessorUseType: record.useType,
      assessorConstructionType: record.constructionType,
      assessorBasement: record.basement,
      assessorBuildingValue: record.buildingValue,
      assessorLandValue: record.landValue,
      assessorFetchedAt: new Date(),
      raw: mergedRaw,
    },
  });
  return "matched";
}

/** Load one listing by id and enrich it. Used by the on-demand UI mutation. */
export async function enrichListingSfpim(
  mlsId: string,
): Promise<SfpimEnrichResult> {
  const l = await db.listing.findUniqueOrThrow({
    where: { mlsId },
    select: { mlsId: true, address: true, sqft: true, units: true, raw: true },
  });
  return enrichListingSfpimRow(l);
}
