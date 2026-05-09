/**
 * Compute the SF rent-control coverage flag for every Listing. Pure derivation
 * from already-populated columns (`yearBuilt`, `units`, `assessorUnits`,
 * `landUseResUnits`, `landUseCategory`) — no external fetch.
 *
 * SF rent ordinance (Chapter 37) covers buildings with:
 *   - 2+ residential units, AND
 *   - certificate of occupancy issued before 1979-06-13.
 *
 * Single-family homes, condos in a structure < 1979 only when sold post-2014
 * trigger Costa-Hawkins decontrol but base coverage tracks year+units, so the
 * flag here is the gross "is this a covered building?" check; UI surfaces it
 * as exposure, not as a definitive legal opinion.
 *
 * Idempotent: only touches rows where `rentControlComputedAt IS NULL` OR the
 * inputs have changed since last compute (we re-run every time `--force`
 * is passed or unconditionally after a yearBuilt/units backfill).
 *
 * Usage:
 *   pnpm compute:rent-control            # only rows that haven't been computed yet
 *   pnpm compute:rent-control --force    # recompute all
 *   pnpm compute:rent-control --limit=100
 */
import { db } from "@/lib/db";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
const force = args.includes("--force");

const RENT_CONTROL_CUTOFF_YEAR = 1979;
const COVERED_LAND_USE = new Set(["RESIDENT", "MIXRES"]);

function deriveFlag(l: {
  yearBuilt: number | null;
  assessorYearBuilt: number | null;
  units: number | null;
  assessorUnits: number | null;
  landUseResUnits: number | null;
  landUseCategory: string | null;
}): boolean | null {
  // Prefer assessor year over MLS year — assessor reflects the actual COO date.
  const year = l.assessorYearBuilt ?? l.yearBuilt;
  // Maximum signal across all unit-count sources — even "1-unit MLS" can be
  // a 4-unit building per assessor or land-use rolls.
  const units = Math.max(
    l.assessorUnits ?? 0,
    l.units ?? 0,
    l.landUseResUnits ?? 0,
  );

  if (year == null && units === 0 && !l.landUseCategory) return null;
  if (year == null) return null;

  const oldEnough = year < RENT_CONTROL_CUTOFF_YEAR;
  const multiUnit = units >= 2;
  const residential = l.landUseCategory
    ? COVERED_LAND_USE.has(l.landUseCategory.toUpperCase())
    // No land-use data yet: don't reject on that alone — fall back to units.
    : multiUnit;

  return oldEnough && multiUnit && residential;
}

async function main() {
  const where = {
    city: "San Francisco",
    ...(force ? {} : { rentControlComputedAt: null }),
  };

  const total = await db.listing.count({ where });
  console.log(
    `[rent-control] candidates: ${total}${limit ? ` (limited to ${limit})` : ""}${force ? " (force)" : ""}`,
  );

  let processed = 0;
  let covered = 0;
  let exempt = 0;
  let unknown = 0;
  let cursor: string | undefined;
  const cap = limit ?? Number.POSITIVE_INFINITY;
  const BATCH = 500;

  while (processed < cap) {
    const remaining = Math.min(BATCH, cap - processed);
    const batch = await db.listing.findMany({
      where,
      take: remaining,
      ...(cursor ? { skip: 1, cursor: { mlsId: cursor } } : {}),
      orderBy: { mlsId: "asc" },
      select: {
        mlsId: true,
        yearBuilt: true,
        assessorYearBuilt: true,
        units: true,
        assessorUnits: true,
        landUseResUnits: true,
        landUseCategory: true,
      },
    });
    if (batch.length === 0) break;

    const now = new Date();
    await Promise.all(
      batch.map(async (l) => {
        const flag = deriveFlag(l);
        await db.listing.update({
          where: { mlsId: l.mlsId },
          data: { rentControlCovered: flag, rentControlComputedAt: now },
        });
        if (flag === true) covered += 1;
        else if (flag === false) exempt += 1;
        else unknown += 1;
      }),
    );

    processed += batch.length;
    cursor = batch[batch.length - 1]?.mlsId;
    console.log(
      `[rent-control] processed=${processed}/${total}, covered=${covered}, exempt=${exempt}, unknown=${unknown}`,
    );
  }

  console.log(
    `[rent-control] done — processed=${processed}, covered=${covered}, exempt=${exempt}, unknown=${unknown}`,
  );
}

main()
  .catch((err) => {
    console.error("[rent-control] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
