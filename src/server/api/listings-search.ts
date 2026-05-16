import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { FILTER_DEFAULTS, type FilterInput } from "./schemas/filter";
import { resolveWeights } from "@/server/etl/scoring/valueAdd";
import { buildWhere } from "./listing-filters";
import {
  SORT_COLUMN,
  extractSortValue,
  weightedValueAddExpr,
  weightsDifferFromDefault,
} from "./listing-sorting";
import type { ListingRow, SearchResult } from "./listing-types";

export type { ListingRow, SearchResult } from "./listing-types";

export async function searchListings(input: FilterInput, userId?: string): Promise<SearchResult> {
  const sortBy = input.sortBy ?? FILTER_DEFAULTS.sortBy;
  const sortDir = input.sortDir ?? FILTER_DEFAULTS.sortDir;
  const pageSize = input.limit ?? FILTER_DEFAULTS.limit;

  // When the user supplied custom weights for a value-add sort, build a
  // SQL expression that mirrors `weightedValueAdd` and use it for both
  // ORDER BY and the cursor predicate. Otherwise fall back to the
  // precomputed (and indexed) `valueAddWeightedAvg` column.
  const resolvedWeights = resolveWeights(input.scoringWeights);
  const useDynamic =
    sortBy === "valueAdd" &&
    !!input.scoringWeights &&
    weightsDifferFromDefault(resolvedWeights);
  const dynamicExpr = useDynamic ? weightedValueAddExpr(resolvedWeights) : null;
  const sortExpr = dynamicExpr ?? Prisma.raw(SORT_COLUMN[sortBy]);

  const { sql: whereSql } = buildWhere(input, {
    includeCursor: true,
    sortExpr: useDynamic ? dynamicExpr! : undefined,
    userId,
  });
  const dir = Prisma.raw(sortDir === "asc" ? "ASC" : "DESC");
  const limit = pageSize + 1;

  // When using a dynamic expression, surface its value as `valueAddWeightedAvg`
  // in the result so the cursor read-back works against the same number.
  const valueAddSelect = dynamicExpr
    ? Prisma.sql`${dynamicExpr} AS "valueAddWeightedAvg"`
    : Prisma.sql`"valueAddWeightedAvg"`;

  const rows = await db.$queryRaw<ListingRow[]>(
    Prisma.sql`
      SELECT
        "mlsId", "address", "city", "state", "postalCode",
        "lat", "lng",
        "price", "daysOnMls", "postDate", "listingUpdatedAt", "status", "propertyType",
        "sqft", "units", "beds", "baths", "occupancy", "yearBuilt", "stories",
        "effectiveSqft", "effectiveLotSizeSqft", "effectiveStories", "effectiveUnits",
        "assessorBuildingSqft", "assessorLotSqft", "assessorUnits",
        "assessorYearBuilt", "assessorStories",
        "assessorBuildingValue", "assessorLandValue",
        "renovationLevel", "renovationConfidence",
        "aiStories", "aiHasBasement", "aiHasPenthouse",
        "detachedAduScore", "convertedAduScore",
        "extractedTotalMonthlyRent", "extractedOccupancy",
        "pricePerSqft", "pricePerUnit", "sqftPerUnit",
        "hasSizeDiscrepancy",
        "densityScore", "vacancyScore", "motivationScore",
        "locationScore", "aduScore",
        ${valueAddSelect},
        "aiDensityScore", "aiVacancyScore", "aiMotivationScore",
        "aiValueAddWeightedAvg", "aiComputedAt",
        "scoreComputedBy"
      FROM "mv_listing_search"
      ${whereSql}
      ORDER BY ${sortExpr} ${dir} NULLS LAST, "mlsId" ${dir}
      LIMIT ${limit}
    `,
  );

  let nextCursor: SearchResult["nextCursor"] = null;
  let trimmed = rows;
  if (rows.length > pageSize) {
    trimmed = rows.slice(0, pageSize);
    const last = trimmed[trimmed.length - 1]!;
    nextCursor = {
      sortValue: extractSortValue(last, sortBy),
      mlsId: last.mlsId,
    };
  }

  // Pull a few fields that aren't in `mv_listing_search` yet so the grid can
  // display assessor / AI fallbacks (Beds, Baths, Units). Indexed PK lookup
  // for ≤50 rows — cheap.
  if (trimmed.length) {
    const ids = trimmed.map((r) => r.mlsId);
    const extras = await db.listing.findMany({
      where: { mlsId: { in: ids } },
      select: {
        mlsId: true,
        assessorBedrooms: true,
        assessorBathrooms: true,
        extractedUnitMix: true,
      },
    });
    const byId = new Map(extras.map((e) => [e.mlsId, e]));
    trimmed = trimmed.map((r) => ({
      ...r,
      assessorBedrooms: byId.get(r.mlsId)?.assessorBedrooms ?? null,
      assessorBathrooms: byId.get(r.mlsId)?.assessorBathrooms ?? null,
      extractedUnitMix: byId.get(r.mlsId)?.extractedUnitMix ?? null,
    }));
  }

  return { rows: trimmed, nextCursor };
}

/**
 * Count the rows matching `input` ignoring cursor / sort / limit. Used to
 * power the "1–50 of N" footer in the grid.
 */
export async function countListings(input: FilterInput, userId?: string): Promise<number> {
  const { sql: whereSql } = buildWhere(input, { includeCursor: false, userId });
  const rows = await db.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`SELECT COUNT(*)::bigint AS count FROM "mv_listing_search" ${whereSql}`,
  );
  return Number(rows[0]?.count ?? 0n);
}
