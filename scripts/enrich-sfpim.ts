/**
 * Enrich every SF Listing with the Assessor's record from the Socrata
 * Secured Property Tax Roll dataset (wv5m-vpq2). Idempotent + resumable:
 * only touches rows where `assessorFetchedAt IS NULL` (or `--force` is passed).
 *
 * Usage:
 *   pnpm tsx scripts/enrich-sfpim.ts                  # full sweep, concurrency 10
 *   pnpm tsx scripts/enrich-sfpim.ts --limit=50       # cap rows this run
 *   pnpm tsx scripts/enrich-sfpim.ts --concurrency=5  # back off
 *   pnpm tsx scripts/enrich-sfpim.ts --force          # re-fetch even if already populated
 */
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  parseAddress,
  searchByParts,
  type AddressParts,
} from "@/server/etl/sfpim-client";
import { mapWithConcurrency } from "@/lib/concurrency";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
const concurrency = concurrencyArg
  ? Math.max(1, Math.min(20, Number(concurrencyArg.split("=")[1])))
  : 10;
const force = args.includes("--force");

const ASSESSOR_FIELDS = {
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

function buildParts(
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

async function main() {
  const where = {
    city: "San Francisco",
    ...(force ? {} : { assessorFetchedAt: null }),
  };

  const total = await db.listing.count({ where });
  console.log(
    `[sfpim] candidates: ${total}${limit ? ` (limited to ${limit})` : ""}${force ? " (force)" : ""} concurrency=${concurrency}`,
  );

  let processed = 0;
  let matched = 0;
  let skipped = 0;
  let errored = 0;
  let cursor: string | undefined;
  const cap = limit ?? Number.POSITIVE_INFINITY;
  const BATCH = 100;

  while (processed < cap) {
    const remaining = Math.min(BATCH, cap - processed);
    const batch = await db.listing.findMany({
      where,
      take: remaining,
      ...(cursor ? { skip: 1, cursor: { mlsId: cursor } } : {}),
      orderBy: { mlsId: "asc" },
      select: {
        mlsId: true,
        address: true,
        sqft: true,
        units: true,
        raw: true,
      },
    });
    if (batch.length === 0) break;

    const started = Date.now();
    const results = await mapWithConcurrency(batch, concurrency, async (l) => {
      const raw = (l.raw ?? {}) as Record<string, unknown>;
      const parts = buildParts(l.address, raw, l.sqft, l.units);
      const match = parts ? await searchByParts(parts) : null;
      const attemptedAt = new Date().toISOString();

      if (!match) {
        // Clear any stale assessor data and record the no-match attempt so
        // the resume-skip semantics still work (next run skips this row).
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
        return "skipped" as const;
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
      return "matched" as const;
    });

    for (let i = 0; i < results.length; i++) {
      processed += 1;
      const r = results[i]!;
      if (r.status === "fulfilled") {
        if (r.value === "matched") matched += 1;
        else skipped += 1;
      } else {
        errored += 1;
        console.error(`[sfpim] mlsId=${batch[i]!.mlsId} address="${batch[i]!.address}":`, r.reason);
      }
    }

    cursor = batch[batch.length - 1]?.mlsId;
    const dur = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `[sfpim] processed=${processed}/${total}, matched=${matched}, skipped=${skipped}, errored=${errored} (batch ${dur}s)`,
    );
  }

  console.log(`[sfpim] refreshing materialized view…`);
  await db.$executeRawUnsafe(
    `REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_listing_search"`,
  );

  console.log(
    `[sfpim] done — processed=${processed}, matched=${matched}, skipped=${skipped}, errored=${errored}`,
  );
}

main()
  .catch((err) => {
    console.error("[sfpim] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
