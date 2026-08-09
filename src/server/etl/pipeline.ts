import type { Prisma, SyncStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { mapWithConcurrency } from "@/lib/concurrency";
import { searchProperties } from "./bridge-client";
import { normalizeListing, type NormalizedListing } from "./normalize";
import { computeHeuristicScore } from "./scoring";

const BATCH_SIZE = 200;
const FLUSH_CONCURRENCY = 10;
const MAX_LOG_ENTRIES = 500;

type LogEntry = { ts: string; level: "info" | "warn" | "error"; message: string };

function makeLogger(syncRunId: string) {
  const buffer: LogEntry[] = [];
  let lastFlush = 0;

  async function flush(force = false) {
    const now = Date.now();
    if (!force && now - lastFlush < 750) return;
    lastFlush = now;
    await db.syncRun.update({
      where: { id: syncRunId },
      data: { logs: buffer.slice(-MAX_LOG_ENTRIES) as Prisma.InputJsonValue },
    });
  }

  function append(level: LogEntry["level"], message: string) {
    buffer.push({ ts: new Date().toISOString(), level, message });
    if (buffer.length > MAX_LOG_ENTRIES) buffer.shift();
    // eslint-disable-next-line no-console
    console.log(`[etl:${level}] ${message}`);
  }

  return {
    info: async (m: string) => {
      append("info", m);
      await flush();
    },
    warn: async (m: string) => {
      append("warn", m);
      await flush();
    },
    error: async (m: string) => {
      append("error", m);
      await flush(true);
    },
    finalFlush: () => flush(true),
  };
}

export type SyncOptions = {
  /**
   * If provided, only listings modified after this timestamp are pulled.
   * Default: the `cursorTo` of the last SUCCEEDED SyncRun, or null (full pull).
   */
  since?: Date;
  /** Hard cap on rows for testing. */
  maxRows?: number;
};

export type SyncSummary = {
  syncRunId: string;
  status: SyncStatus;
  recordsUpserted: number;
  recordsScored: number;
  cursorFrom: Date | null;
  cursorTo: Date;
  durationMs: number;
};

export async function runSync(opts: SyncOptions = {}): Promise<SyncSummary> {
  const startedAt = new Date();

  const cursorFrom =
    opts.since ??
    (
      await db.syncRun.findFirst({
        where: { status: "SUCCEEDED" },
        orderBy: { startedAt: "desc" },
      })
    )?.cursorTo ??
    null;

  const run = await db.syncRun.create({
    data: { startedAt, status: "RUNNING", cursorFrom, progressCurrent: 0 },
  });

  const log = makeLogger(run.id);

  let upserted = 0;
  let scored = 0;
  let lastSeenMod: Date = cursorFrom ?? new Date(0);

  try {
    const filter = buildFilter(cursorFrom);
    await log.info(
      `Starting sync — dataset=sfar, since=${cursorFrom?.toISOString() ?? "<full pull>"}, filter=${filter}`,
    );

    const buffer: NormalizedListing[] = [];

    for await (const raw of searchProperties({ filter, maxRows: opts.maxRows })) {
      const norm = normalizeListing(raw);
      if (!norm) continue;
      buffer.push(norm);
      if (norm.bridgeModificationTimestamp > lastSeenMod) {
        lastSeenMod = norm.bridgeModificationTimestamp;
      }

      if (buffer.length >= BATCH_SIZE) {
        await log.info(`Upserting batch of ${buffer.length} (${upserted + buffer.length} total)…`);
        const flushed = await flush(buffer);
        upserted += flushed.upserted;
        scored += flushed.scored;
        buffer.length = 0;
        await db.syncRun.update({
          where: { id: run.id },
          data: {
            progressCurrent: upserted,
            progressMessage: `Upserted ${upserted} listings (${scored} scored)…`,
          },
        });
      }
    }

    if (buffer.length > 0) {
      await log.info(`Upserting final batch of ${buffer.length}…`);
      const flushed = await flush(buffer);
      upserted += flushed.upserted;
      scored += flushed.scored;
    }

    // Ingestion is complete and the DB is confirmed healthy here, so commit
    // the run as SUCCEEDED and advance the cursor NOW — before the finalization
    // steps below. Those steps (neighborhood backfill + MV refresh) are
    // idempotent and re-derived on the next run, so a transient DB outage
    // during them must not discard the (expensive, potentially hours-long)
    // fetch/upsert work or force a full Bridge re-fetch next night. This is
    // the P1017 / "database system is in recovery mode" incident: the DB
    // restarted mid-finalization and the whole run was marked FAILED, losing
    // the cursor advance.
    const finishedAt = new Date();
    const cursorTo = lastSeenMod > new Date(0) ? lastSeenMod : finishedAt;
    await db.syncRun.update({
      where: { id: run.id },
      data: {
        finishedAt,
        status: "SUCCEEDED",
        recordsUpserted: upserted,
        recordsScored: scored,
        cursorTo,
        progressCurrent: upserted,
        progressMessage: `Done — upserted ${upserted}, scored ${scored}.`,
      },
    });
    await log.info(`Sync complete: upserted=${upserted}, scored=${scored}.`);

    // Best-effort finalization. Failures here are logged but never fail the
    // run: the neighborhood backfill only touches rows whose neighborhood is
    // still NULL, and the MV refresh runs every night, so both self-heal on
    // the next sync. Backfill Listing.neighborhood via a single set-based
    // PostGIS query against the Neighborhood.boundary GIST index.
    await runFinalizationStep(log, `Resolving neighborhood polygons…`, async () => {
      const nbhdResult = await resolveNeighborhoods();
      if (nbhdResult.matched > 0 || nbhdResult.unmatched > 0) {
        await log.info(
          `Neighborhood join: matched=${nbhdResult.matched}, unmatched=${nbhdResult.unmatched}`,
        );
      }
    });
    await runFinalizationStep(log, `Refreshing materialized view…`, () =>
      refreshMaterializedView(),
    );

    // Already committed as SUCCEEDED above; a flush failure here must not flip
    // the run back to FAILED via the outer catch.
    try {
      await log.finalFlush();
    } catch {
      /* best-effort */
    }

    return {
      syncRunId: run.id,
      status: "SUCCEEDED",
      recordsUpserted: upserted,
      recordsScored: scored,
      cursorFrom,
      cursorTo,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log.error(message);
    await db.syncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: "FAILED",
        recordsUpserted: upserted,
        recordsScored: scored,
        error: message,
        progressMessage: `Failed: ${message}`,
      },
    });
    throw err;
  }
}

function buildFilter(since: Date | null): string {
  // Ingest ALL listing statuses (Active, Pending, Contingent, Coming Soon,
  // Sold, Withdrawn, …) so nothing the user sees in the MLS is missing from
  // the system. We used to restrict to `StandardStatus eq 'Active'`, which is
  // why some assets never appeared. Non-active listings still get heuristic
  // scoring but are skipped by the nightly AI-scoring job (see
  // scripts/ai-score-changed.ts) to avoid spending on inactive assets.
  //
  // We still exclude lease/rental listings — their ListPrice is a monthly rent
  // (e.g. $2,500/mo for a retail space) not a sale price, which corrupts every
  // downstream ratio (price, $/Sqft, Value-Add) when treated as for-sale.
  const parts = ["not contains(PropertyType, 'Lease')"];
  if (since) {
    parts.push(`BridgeModificationTimestamp gt ${since.toISOString()}`);
  }
  return parts.join(" and ");
}

async function flush(rows: NormalizedListing[]): Promise<{ upserted: number; scored: number }> {
  // Bounded parallelism — distinct mlsIds, no row contention. Concurrency
  // is capped low to stay friendly to the shared Render Postgres pool.
  const seenAt = new Date();
  const results = await mapWithConcurrency(rows, FLUSH_CONCURRENCY, async (r) => {
    await db.listing.upsert({
      where: { mlsId: r.mlsId },
      create: {
        mlsId: r.mlsId,
        address: r.address,
        city: r.city,
        state: r.state,
        postalCode: r.postalCode,
        lat: r.lat,
        lng: r.lng,
        price: r.price,
        daysOnMls: r.daysOnMls,
        postDate: r.postDate,
        listingUpdatedAt: r.listingUpdatedAt,
        status: r.status,
        propertyType: r.propertyType,
        sqft: r.sqft,
        lotSizeSqft: r.lotSizeSqft,
        units: r.units,
        beds: r.beds,
        baths: r.baths,
        occupancy: r.occupancy,
        yearBuilt: r.yearBuilt,
        stories: r.stories,
        bridgeModificationTimestamp: r.bridgeModificationTimestamp,
        isAuction: r.isAuction,
        auctionDate: r.auctionDate,
        raw: r.raw as Prisma.InputJsonValue,
        lastSeenAt: seenAt,
      },
      update: {
        address: r.address,
        city: r.city,
        state: r.state,
        postalCode: r.postalCode,
        lat: r.lat,
        lng: r.lng,
        price: r.price,
        daysOnMls: r.daysOnMls,
        postDate: r.postDate,
        listingUpdatedAt: r.listingUpdatedAt,
        status: r.status,
        propertyType: r.propertyType,
        sqft: r.sqft,
        lotSizeSqft: r.lotSizeSqft,
        units: r.units,
        beds: r.beds,
        baths: r.baths,
        occupancy: r.occupancy,
        yearBuilt: r.yearBuilt,
        stories: r.stories,
        bridgeModificationTimestamp: r.bridgeModificationTimestamp,
        isAuction: r.isAuction,
        auctionDate: r.auctionDate,
        raw: r.raw as Prisma.InputJsonValue,
        // Bridge is currently showing this ListingKey. Bump lastSeenAt so
        // `offboard-stale` knows the row is alive, and clear deletedAt if
        // the listing was previously offboarded (Bridge re-listed it).
        lastSeenAt: seenAt,
        deletedAt: null,
      },
    });

    // Heuristic columns are always safe to refresh during routine ETL —
    // AI scores live in parallel ai* columns and are untouched here.
    const score = computeHeuristicScore(r);
    await db.score.upsert({
      where: { listingMlsId: r.mlsId },
      create: {
        listingMlsId: r.mlsId,
        densityScore: score.densityScore,
        vacancyScore: score.vacancyScore,
        motivationScore: score.motivationScore,
        locationScore: score.locationScore,
        aduScore: score.aduScore,
        rehabScore: score.rehabScore,
        assessmentDeltaScore: score.assessmentDeltaScore,
        zoningUpsideScore: score.zoningUpsideScore,
        marketUpsideScore: score.marketUpsideScore,
        valueAddWeightedAvg: score.valueAddWeightedAvg,
        breakdown: score.breakdown as Prisma.InputJsonValue,
        computedBy: "HEURISTIC",
      },
      update: {
        densityScore: score.densityScore,
        vacancyScore: score.vacancyScore,
        motivationScore: score.motivationScore,
        locationScore: score.locationScore,
        aduScore: score.aduScore,
        rehabScore: score.rehabScore,
        assessmentDeltaScore: score.assessmentDeltaScore,
        zoningUpsideScore: score.zoningUpsideScore,
        marketUpsideScore: score.marketUpsideScore,
        valueAddWeightedAvg: score.valueAddWeightedAvg,
        breakdown: score.breakdown as Prisma.InputJsonValue,
        computedBy: "HEURISTIC",
        computedAt: new Date(),
      },
    });
    return { upserted: 1, scored: 1 };
  });

  let upserted = 0;
  let scored = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      upserted += r.value.upserted;
      scored += r.value.scored;
    } else {
      // eslint-disable-next-line no-console
      console.error("[etl] flush row failed:", r.reason);
    }
  }
  return { upserted, scored };
}

/**
 * Run a best-effort finalization step. Logs the start message, runs `fn`, and
 * swallows any failure (logging it as a warning) so a transient DB outage
 * during a re-derivable step can't fail an already-committed sync. Logging
 * itself is best-effort too, since the DB may be the very thing that's down.
 */
async function runFinalizationStep(
  log: ReturnType<typeof makeLogger>,
  startMessage: string,
  fn: () => Promise<void>,
): Promise<void> {
  await safeLog(log, "info", startMessage);
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await safeLog(log, "warn", `${startMessage} failed (will retry next run): ${message}`);
  }
}

async function safeLog(
  log: ReturnType<typeof makeLogger>,
  level: "info" | "warn",
  message: string,
): Promise<void> {
  try {
    await log[level](message);
  } catch {
    // eslint-disable-next-line no-console
    console.error(`[etl:${level}] ${message}`);
  }
}

async function refreshMaterializedView(): Promise<void> {
  // CONCURRENTLY needs a unique index (we created one) and won't lock readers.
  await db.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_listing_search"`);
}

/**
 * Backfill Listing.neighborhood by point-in-polygon against Neighborhood
 * boundaries. Idempotent: only touches rows where neighborhood is still
 * NULL or where the listing's geom changed since the last assignment.
 *
 * Returns counts for telemetry. The "unmatched" count excludes listings
 * with no geom (those can't be located regardless of polygon coverage).
 */
async function resolveNeighborhoods(): Promise<{ matched: number; unmatched: number }> {
  const matched = await db.$executeRaw`
    UPDATE "Listing" l
       SET "neighborhood" = n."name"
      FROM "Neighborhood" n
     WHERE l."geom" IS NOT NULL
       AND l."neighborhood" IS NULL
       AND ST_Intersects(n."boundary", l."geom")
  `;

  const unmatchedRows = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
      FROM "Listing"
     WHERE "geom" IS NOT NULL
       AND "neighborhood" IS NULL
  `;
  const unmatched = Number(unmatchedRows[0]?.count ?? 0n);

  return { matched: Number(matched), unmatched };
}
