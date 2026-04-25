import type { Prisma, SyncStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { searchProperties } from "./bridge-client";
import { normalizeListing, type NormalizedListing } from "./normalize";
import { computeHeuristicScore } from "./scoring";

const BATCH_SIZE = 200;
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

    await log.info(`Refreshing materialized view…`);
    await refreshMaterializedView();
    await log.info(`Sync complete: upserted=${upserted}, scored=${scored}.`);

    const finishedAt = new Date();
    await db.syncRun.update({
      where: { id: run.id },
      data: {
        finishedAt,
        status: "SUCCEEDED",
        recordsUpserted: upserted,
        recordsScored: scored,
        cursorTo: lastSeenMod > new Date(0) ? lastSeenMod : finishedAt,
        progressCurrent: upserted,
        progressMessage: `Done — upserted ${upserted}, scored ${scored}.`,
      },
    });
    await log.finalFlush();

    return {
      syncRunId: run.id,
      status: "SUCCEEDED",
      recordsUpserted: upserted,
      recordsScored: scored,
      cursorFrom,
      cursorTo: lastSeenMod > new Date(0) ? lastSeenMod : finishedAt,
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
  const parts = ["StandardStatus eq 'Active'"];
  if (since) {
    parts.push(`BridgeModificationTimestamp gt ${since.toISOString()}`);
  }
  return parts.join(" and ");
}

async function flush(rows: NormalizedListing[]): Promise<{ upserted: number; scored: number }> {
  let upserted = 0;
  let scored = 0;

  // Sequential per-row upsert keeps things simple and lets generated columns
  // re-derive on each write. With BATCH_SIZE=200 this is still fast enough; if
  // it ever isn't, swap in a $executeRaw bulk INSERT ... ON CONFLICT.
  for (const r of rows) {
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
        raw: r.raw as Prisma.InputJsonValue,
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
        raw: r.raw as Prisma.InputJsonValue,
      },
    });
    upserted += 1;

    const score = computeHeuristicScore(r);
    // Never overwrite an AI-enriched score during routine ETL.
    const existing = await db.score.findUnique({
      where: { listingMlsId: r.mlsId },
      select: { computedBy: true },
    });
    if (existing?.computedBy === "AI") continue;

    await db.score.upsert({
      where: { listingMlsId: r.mlsId },
      create: {
        listingMlsId: r.mlsId,
        densityScore: score.densityScore,
        vacancyScore: score.vacancyScore,
        motivationScore: score.motivationScore,
        valueAddWeightedAvg: score.valueAddWeightedAvg,
        breakdown: score.breakdown as Prisma.InputJsonValue,
        computedBy: "HEURISTIC",
      },
      update: {
        densityScore: score.densityScore,
        vacancyScore: score.vacancyScore,
        motivationScore: score.motivationScore,
        valueAddWeightedAvg: score.valueAddWeightedAvg,
        breakdown: score.breakdown as Prisma.InputJsonValue,
        computedBy: "HEURISTIC",
        computedAt: new Date(),
      },
    });
    scored += 1;
  }

  return { upserted, scored };
}

async function refreshMaterializedView(): Promise<void> {
  // CONCURRENTLY needs a unique index (we created one) and won't lock readers.
  await db.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_listing_search"`);
}
