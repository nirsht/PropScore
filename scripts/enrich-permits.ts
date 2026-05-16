/**
 * Enrich every SF Listing with ADU/reconfiguration permit precedent signals
 * from SF DBI's Building Permits dataset (Socrata i98e-djp9).
 *
 * Two phases per run:
 *
 *   Phase 1 — Hydrate `BuildingPermit` rows by block. We pull every permit
 *   on each distinct `Listing.block` filed in the last 10 years, then
 *   upsert into `BuildingPermit` keyed on `permit_number`. Each block is
 *   re-fetched at most every 7 days (Socrata refreshes daily but a permit
 *   filing rarely changes ADU/legalization signals once issued).
 *
 *   Phase 2 — Recompute `Listing.permits*` summary counts: own-parcel
 *   permits, same-block ADU precedent in last 5y, within-500ft ADU
 *   precedent in last 5y. Phase 2 is fast (DB-only aggregation) and runs
 *   every time, so a re-pull from a single refreshed block immediately
 *   benefits every listing on that block.
 *
 * Idempotent + resumable. Listings without `blockLot` are skipped.
 *
 * Usage:
 *   pnpm enrich:permits                    # full sweep
 *   pnpm enrich:permits --limit=50         # cap listings (still hydrates blocks)
 *   pnpm enrich:permits --concurrency=2    # back off Socrata
 *   pnpm enrich:permits --force            # re-fetch every block + every listing
 *   pnpm enrich:permits --listings-only    # skip phase 1, just recompute summaries
 */
import { db } from "@/lib/db";
import { fetchPermitsByBlock } from "@/server/etl/permits-client";
import { mapWithConcurrency } from "@/lib/concurrency";
import { Prisma } from "@prisma/client";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
const concurrency = concurrencyArg
  ? Math.max(1, Math.min(8, Number(concurrencyArg.split("=")[1])))
  : 3;
const force = args.includes("--force");
const listingsOnly = args.includes("--listings-only");

const BLOCK_REFRESH_DAYS = 7;
const PRECEDENT_RECENT_YEARS = 5;
const RADIUS_METERS = 152.4; // ~500 ft

async function phase1(): Promise<void> {
  console.log(`[permits] phase 1 — hydrate BuildingPermit by block`);

  // Distinct `block` values across SF listings (with blockLot populated).
  const blocks = await db.listing.findMany({
    where: { city: "San Francisco", block: { not: null } },
    select: { block: true },
    distinct: ["block"],
  });
  const blockList = blocks
    .map((b) => b.block)
    .filter((b): b is string => b != null && b.length > 0);
  console.log(`[permits] distinct blocks: ${blockList.length}`);

  // Skip blocks refreshed within the staleness window (unless --force). We
  // gauge per-block freshness by max(fetchedAt) on permits already in DB.
  let blocksToFetch = blockList;
  if (!force) {
    const cutoff = new Date(Date.now() - BLOCK_REFRESH_DAYS * 86_400_000);
    const fresh = await db.buildingPermit.groupBy({
      by: ["block"],
      _max: { fetchedAt: true },
      where: { block: { in: blockList } },
    });
    const freshSet = new Set(
      fresh
        .filter((r) => (r._max.fetchedAt ?? new Date(0)) > cutoff)
        .map((r) => r.block),
    );
    blocksToFetch = blockList.filter((b) => !freshSet.has(b));
    console.log(
      `[permits] ${blockList.length - blocksToFetch.length} blocks fresh (within ${BLOCK_REFRESH_DAYS}d), ${blocksToFetch.length} to fetch`,
    );
  }

  let blockIdx = 0;
  let permitsUpserted = 0;
  let blocksErrored = 0;

  const results = await mapWithConcurrency(blocksToFetch, concurrency, async (block) => {
    const records = await fetchPermitsByBlock(block, 10);
    if (records.length === 0) return 0;

    // Upsert in chunks. Distinct permitNumbers, no row contention.
    const inner = await mapWithConcurrency(records, 5, async (rec) => {
      await db.buildingPermit.upsert({
        where: { permitNumber: rec.permitNumber },
        create: {
          permitNumber: rec.permitNumber,
          blockLot: rec.blockLot,
          block: rec.block,
          lot: rec.lot,
          filedDate: rec.filedDate,
          issuedDate: rec.issuedDate,
          status: rec.status,
          description: rec.description,
          aduFlag: rec.aduFlag,
          aduKeyword: rec.aduKeyword,
          existingUnits: rec.existingUnits,
          proposedUnits: rec.proposedUnits,
          existingConstructionType: rec.existingConstructionType,
          proposedConstructionType: rec.proposedConstructionType,
          existingUse: rec.existingUse,
          proposedUse: rec.proposedUse,
          lat: rec.lat,
          lng: rec.lng,
          raw: rec.raw as Prisma.InputJsonValue,
        },
        update: {
          blockLot: rec.blockLot,
          block: rec.block,
          lot: rec.lot,
          filedDate: rec.filedDate,
          issuedDate: rec.issuedDate,
          status: rec.status,
          description: rec.description,
          aduFlag: rec.aduFlag,
          aduKeyword: rec.aduKeyword,
          existingUnits: rec.existingUnits,
          proposedUnits: rec.proposedUnits,
          existingConstructionType: rec.existingConstructionType,
          proposedConstructionType: rec.proposedConstructionType,
          existingUse: rec.existingUse,
          proposedUse: rec.proposedUse,
          lat: rec.lat,
          lng: rec.lng,
          raw: rec.raw as Prisma.InputJsonValue,
          fetchedAt: new Date(),
        },
      });
      return 1;
    });
    const upserted = inner.reduce(
      (s, r) => s + (r.status === "fulfilled" ? r.value : 0),
      0,
    );

    // Backfill the PostGIS point for newly inserted rows. Cheap set-based
    // raw query — only touches rows missing geom on this block.
    await db.$executeRaw`
      UPDATE "BuildingPermit"
         SET "geom" = ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography
       WHERE "block" = ${block}
         AND "geom" IS NULL
         AND "lat" IS NOT NULL
         AND "lng" IS NOT NULL
    `;
    return upserted;
  });

  for (const r of results) {
    blockIdx += 1;
    if (r.status === "fulfilled") {
      permitsUpserted += r.value;
    } else {
      blocksErrored += 1;
      console.error(`[permits] block fetch failed:`, r.reason);
    }
    if (blockIdx % 25 === 0) {
      console.log(
        `[permits] phase 1 progress: ${blockIdx}/${blocksToFetch.length} blocks, permits upserted=${permitsUpserted}, errored=${blocksErrored}`,
      );
    }
  }
  console.log(
    `[permits] phase 1 done — blocks fetched=${blocksToFetch.length}, permits upserted=${permitsUpserted}, errored=${blocksErrored}`,
  );
}

async function phase2(): Promise<void> {
  console.log(`[permits] phase 2 — recompute Listing.permits* summary counts`);

  const where = {
    city: "San Francisco",
    blockLot: { not: null },
    ...(force ? {} : { permitsFetchedAt: null }),
  };
  const total = await db.listing.count({ where });
  console.log(
    `[permits] phase 2 candidates: ${total}${limit ? ` (limited to ${limit})` : ""}${force ? " (force)" : ""}`,
  );

  let cursor: string | undefined;
  let processed = 0;
  let updated = 0;
  let errored = 0;
  const cap = limit ?? Number.POSITIVE_INFINITY;
  const BATCH = 200;

  const recentCutoff = new Date();
  recentCutoff.setFullYear(recentCutoff.getFullYear() - PRECEDENT_RECENT_YEARS);

  while (processed < cap) {
    const remaining = Math.min(BATCH, cap - processed);
    const batch = await db.listing.findMany({
      where,
      take: remaining,
      ...(cursor ? { skip: 1, cursor: { mlsId: cursor } } : {}),
      orderBy: { mlsId: "asc" },
      select: { mlsId: true, blockLot: true, block: true },
    });
    if (batch.length === 0) break;

    const results = await mapWithConcurrency(batch, 8, async (l) => {
      if (!l.blockLot || !l.block) {
        await db.listing.update({
          where: { mlsId: l.mlsId },
          data: { permitsFetchedAt: new Date() },
        });
        return false;
      }

      // Own-parcel: lifetime counts (any age).
      const ownTotal = await db.buildingPermit.count({
        where: { blockLot: l.blockLot },
      });
      const ownAdu = await db.buildingPermit.count({
        where: {
          blockLot: l.blockLot,
          OR: [{ aduFlag: true }, { aduKeyword: true }],
        },
      });

      // Block precedent (excluding own parcel), last N years.
      const blockAdu = await db.buildingPermit.count({
        where: {
          block: l.block,
          blockLot: { not: l.blockLot },
          OR: [{ aduFlag: true }, { aduKeyword: true }],
          filedDate: { gte: recentCutoff },
        },
      });

      // Latest same-block ADU permit (precedent breadcrumb).
      const latest = await db.buildingPermit.findFirst({
        where: {
          block: l.block,
          blockLot: { not: l.blockLot },
          OR: [{ aduFlag: true }, { aduKeyword: true }],
          filedDate: { gte: recentCutoff },
        },
        orderBy: { filedDate: "desc" },
        select: {
          permitNumber: true,
          filedDate: true,
          description: true,
          raw: true,
        },
      });

      const latestSummary = latest
        ? ({
            permitNumber: latest.permitNumber,
            filedDate: latest.filedDate?.toISOString() ?? null,
            description: latest.description,
            address: extractAddressFromRaw(latest.raw),
          } as Prisma.InputJsonValue)
        : null;

      // Radius precedent — PostGIS ST_DWithin against Listing.geom. Run as
      // a single set-based raw query so we don't move geometries through
      // the Node process.
      const radiusRow = await db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
          FROM "BuildingPermit" bp, "Listing" l
         WHERE l."mlsId" = ${l.mlsId}
           AND l."geom" IS NOT NULL
           AND bp."geom" IS NOT NULL
           AND bp."blockLot" <> ${l.blockLot}
           AND (bp."aduFlag" = TRUE OR bp."aduKeyword" = TRUE)
           AND bp."filedDate" >= ${recentCutoff}
           AND ST_DWithin(bp."geom", l."geom", ${RADIUS_METERS})
      `;
      const radiusCount = Number(radiusRow[0]?.count ?? 0n);

      await db.listing.update({
        where: { mlsId: l.mlsId },
        data: {
          permitsOwnParcelCount: ownTotal,
          permitsOwnParcelAduCount: ownAdu,
          permitsBlockAduRecentCount: blockAdu,
          permitsRadiusAduRecentCount: radiusCount,
          latestAduPermitOnBlock: latestSummary ?? Prisma.JsonNull,
          permitsFetchedAt: new Date(),
        },
      });
      return true;
    });

    for (let i = 0; i < results.length; i++) {
      processed += 1;
      const r = results[i]!;
      if (r.status === "fulfilled") {
        if (r.value) updated += 1;
      } else {
        errored += 1;
        console.error(`[permits] phase 2 mlsId=${batch[i]!.mlsId}:`, r.reason);
      }
    }

    cursor = batch[batch.length - 1]?.mlsId;
    console.log(
      `[permits] phase 2 progress: processed=${processed}/${total}, updated=${updated}, errored=${errored}`,
    );
  }

  console.log(
    `[permits] phase 2 done — processed=${processed}, updated=${updated}, errored=${errored}`,
  );
}

function extractAddressFromRaw(raw: unknown): string | null {
  if (raw == null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = typeof r.street_number === "string" ? r.street_number : null;
  const name = typeof r.street_name === "string" ? r.street_name : null;
  const suf = typeof r.street_suffix === "string" ? r.street_suffix : null;
  const parts = [num, name, suf].filter((p): p is string => p != null && p.length > 0);
  return parts.length > 0 ? parts.join(" ") : null;
}

async function main() {
  if (!listingsOnly) {
    await phase1();
  } else {
    console.log(`[permits] --listings-only: skipping phase 1`);
  }
  await phase2();
}

main()
  .catch((err) => {
    console.error("[permits] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
