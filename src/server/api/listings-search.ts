import { Prisma, type RenovationLevel } from "@prisma/client";
import { db } from "@/lib/db";
import { FILTER_DEFAULTS, type FilterInput, type SortKey } from "./schemas/filter";
import { resolveWeights, VALUE_ADD_WEIGHTS } from "@/server/etl/scoring/valueAdd";

export type ListingRow = {
  mlsId: string;
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  price: number;
  daysOnMls: number;
  postDate: Date;
  listingUpdatedAt: Date;
  status: string;
  propertyType: string;
  sqft: number | null;
  units: number | null;
  beds: number | null;
  baths: number | null;
  occupancy: number | null;
  yearBuilt: number | null;
  stories: number | null;
  effectiveSqft: number | null;
  effectiveLotSizeSqft: number | null;
  effectiveStories: number | null;
  effectiveUnits: number | null;
  assessorBuildingSqft: number | null;
  assessorLotSqft: number | null;
  assessorUnits: number | null;
  assessorBedrooms: number | null;
  assessorBathrooms: number | null;
  assessorYearBuilt: number | null;
  assessorStories: number | null;
  extractedUnitMix: unknown;
  assessorBuildingValue: number | null;
  assessorLandValue: number | null;
  renovationLevel: RenovationLevel | null;
  renovationConfidence: number | null;
  aiStories: number | null;
  aiHasBasement: boolean | null;
  aiHasPenthouse: boolean | null;
  detachedAduScore: number | null;
  convertedAduScore: number | null;
  extractedTotalMonthlyRent: number | null;
  extractedOccupancy: number | null;
  pricePerSqft: number | null;
  pricePerUnit: number | null;
  sqftPerUnit: number | null;
  hasSizeDiscrepancy: boolean;
  densityScore: number | null;
  vacancyScore: number | null;
  motivationScore: number | null;
  valueAddWeightedAvg: number | null;
  locationScore: number | null;
  aduScore: number | null;
  scoreComputedBy: "HEURISTIC" | "AI" | null;
};

export type SearchResult = {
  rows: ListingRow[];
  nextCursor: { sortValue: number | null; mlsId: string } | null;
};

const SORT_COLUMN: Record<SortKey, string> = {
  valueAdd: '"valueAddWeightedAvg"',
  price: '"price"',
  pricePerSqft: '"pricePerSqft"',
  pricePerUnit: '"pricePerUnit"',
  daysOnMls: '"daysOnMls"',
  postDate: '"postDate"',
  yearBuilt: '"yearBuilt"',
  density: '"densityScore"',
  vacancy: '"vacancyScore"',
  motivation: '"motivationScore"',
};

/**
 * SQL mirror of `weightedValueAdd` from scoring/valueAdd.ts: weighted blend
 * of 5 component scores with null components dropped from the divisor.
 * Returns NULL when no components are present.
 *
 * Returned as a Prisma.Sql so callers can splice it into ORDER BY *and*
 * the SELECT list (so cursor pagination can read the same value back).
 */
function weightedValueAddExpr(
  weights: ReturnType<typeof resolveWeights>,
  alias?: string,
): Prisma.Sql {
  const wV = weights.vacancy;
  const wL = weights.location;
  const wD = weights.density;
  const wA = weights.adu;
  const wM = weights.motivation;
  const expr = Prisma.sql`(
    COALESCE(${wV}::float * "vacancyScore", 0) +
    COALESCE(${wL}::float * "locationScore", 0) +
    COALESCE(${wD}::float * "densityScore", 0) +
    COALESCE(${wA}::float * "aduScore", 0) +
    COALESCE(${wM}::float * "motivationScore", 0)
  ) / NULLIF(
    (CASE WHEN "vacancyScore"    IS NOT NULL THEN ${wV}::float ELSE 0 END) +
    (CASE WHEN "locationScore"   IS NOT NULL THEN ${wL}::float ELSE 0 END) +
    (CASE WHEN "densityScore"    IS NOT NULL THEN ${wD}::float ELSE 0 END) +
    (CASE WHEN "aduScore"        IS NOT NULL THEN ${wA}::float ELSE 0 END) +
    (CASE WHEN "motivationScore" IS NOT NULL THEN ${wM}::float ELSE 0 END),
    0
  )`;
  return alias ? Prisma.sql`${expr} AS ${Prisma.raw(`"${alias}"`)}` : expr;
}

/** True when the supplied weights differ from VALUE_ADD_WEIGHTS by >1e-9. */
function weightsDifferFromDefault(
  weights: ReturnType<typeof resolveWeights>,
): boolean {
  const keys = ["vacancy", "location", "density", "adu", "motivation"] as const;
  for (const k of keys) {
    if (Math.abs(weights[k] - VALUE_ADD_WEIGHTS[k]) > 1e-9) return true;
  }
  return false;
}

/**
 * Build the WHERE clause used by both `searchListings` (with keyset cursor)
 * and `countListings` (no cursor — we want the total of the filtered set,
 * not the remainder after the current cursor).
 */
function buildWhere(
  input: FilterInput,
  opts: { includeCursor: boolean; sortExpr?: Prisma.Sql },
): { sql: Prisma.Sql } {
  const where: Prisma.Sql[] = [];

  if (input.q && input.q.length >= 2) {
    // Fuzzy match: pg_trgm's `<%` (word similarity, indexed by the GIN we
    // built on `address` and `city`) catches typos like "misson" → "Mission",
    // while ILIKE with leading-wildcard pattern matching also rides the same
    // GIN index for substring matches like "mission" → "1234 Mission St".
    const ilike = `%${input.q}%`;
    where.push(
      Prisma.sql`(
        "address" ILIKE ${ilike}
        OR "city" ILIKE ${ilike}
        OR "address" <% ${input.q}
        OR "city" <% ${input.q}
      )`,
    );
  }

  if (input.city?.length) {
    where.push(Prisma.sql`"city" = ANY(${input.city}::text[])`);
  }

  if (input.propertyTypes?.length) {
    where.push(Prisma.sql`"propertyType" = ANY(${input.propertyTypes}::text[])`);
  }

  if (input.renovationLevel?.length) {
    where.push(
      Prisma.sql`"renovationLevel" = ANY(${input.renovationLevel}::"RenovationLevel"[])`,
    );
  }

  pushRange(where, '"price"', input.price);
  pushRange(where, '"pricePerSqft"', input.pricePerSqft);
  pushRange(where, '"pricePerUnit"', input.pricePerUnit);
  pushRange(where, 'COALESCE("effectiveSqft", "effectiveLotSizeSqft")', input.sqft);
  pushRange(where, '"effectiveUnits"', input.units);
  pushRange(where, '"beds"', input.beds);
  pushRange(where, '"baths"', input.baths);
  pushRange(where, '"yearBuilt"', input.yearBuilt);
  pushRange(where, '"daysOnMls"', input.daysOnMls);
  pushRange(where, '"occupancy"', input.occupancy);
  pushRange(where, '"densityScore"', input.densityScore);
  pushRange(where, '"vacancyScore"', input.vacancyScore);
  pushRange(where, '"motivationScore"', input.motivationScore);
  pushRange(where, '"valueAddWeightedAvg"', input.valueAddWeightedAvg);
  pushRange(where, '"codeViolationsOpenCount"', input.codeViolationsOpenCount);
  pushRange(where, '"housingNetUnitChange5y"', input.housingNetUnitChange5y);

  if (input.hasSizeDiscrepancy != null) {
    where.push(Prisma.sql`"hasSizeDiscrepancy" = ${input.hasSizeDiscrepancy}`);
  }

  if (input.rentControlCovered != null) {
    where.push(Prisma.sql`"rentControlCovered" = ${input.rentControlCovered}`);
  }

  if (input.postDate?.min) {
    where.push(Prisma.sql`"postDate" >= ${new Date(input.postDate.min)}`);
  }
  if (input.postDate?.max) {
    where.push(Prisma.sql`"postDate" <= ${new Date(input.postDate.max)}`);
  }

  if (input.radius) {
    where.push(
      Prisma.sql`ST_DWithin("geom", ST_SetSRID(ST_MakePoint(${input.radius.lng}, ${input.radius.lat}), 4326)::geography, ${input.radius.meters})`,
    );
  }

  if (input.polygon) {
    const wkt = `POLYGON((${input.polygon.points
      .concat(input.polygon.points[0] ? [input.polygon.points[0]] : [])
      .map((p) => `${p.lng} ${p.lat}`)
      .join(", ")}))`;
    where.push(
      Prisma.sql`ST_Contains(ST_GeographyFromText(${"SRID=4326;" + wkt})::geometry, "geom"::geometry)`,
    );
  }

  if (opts.includeCursor && input.cursor) {
    const sortBy = input.sortBy ?? FILTER_DEFAULTS.sortBy;
    const sortDir = input.sortDir ?? FILTER_DEFAULTS.sortDir;
    const sortExpr = opts.sortExpr ?? Prisma.raw(SORT_COLUMN[sortBy]);
    const cmp = Prisma.raw(sortDir === "asc" ? ">" : "<");

    if (input.cursor.sortValue == null) {
      where.push(Prisma.sql`("mlsId" ${cmp} ${input.cursor.mlsId})`);
    } else {
      where.push(
        Prisma.sql`(${sortExpr} ${cmp} ${input.cursor.sortValue} OR (${sortExpr} = ${input.cursor.sortValue} AND "mlsId" ${cmp} ${input.cursor.mlsId}))`,
      );
    }
  }

  return {
    sql: where.length ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty,
  };
}

export async function searchListings(input: FilterInput): Promise<SearchResult> {
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
export async function countListings(input: FilterInput): Promise<number> {
  const { sql: whereSql } = buildWhere(input, { includeCursor: false });
  const rows = await db.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`SELECT COUNT(*)::bigint AS count FROM "mv_listing_search" ${whereSql}`,
  );
  return Number(rows[0]?.count ?? 0n);
}

function pushRange(
  out: Prisma.Sql[],
  col: string,
  range?: { min?: number; max?: number },
) {
  if (!range) return;
  const c = Prisma.raw(col);
  if (range.min != null) out.push(Prisma.sql`${c} >= ${range.min}`);
  if (range.max != null) out.push(Prisma.sql`${c} <= ${range.max}`);
}

function extractSortValue(row: ListingRow, key: SortKey): number | null {
  switch (key) {
    case "valueAdd":
      return row.valueAddWeightedAvg;
    case "price":
      return row.price;
    case "pricePerSqft":
      return row.pricePerSqft;
    case "pricePerUnit":
      return row.pricePerUnit;
    case "daysOnMls":
      return row.daysOnMls;
    case "postDate":
      return row.postDate.getTime();
    case "yearBuilt":
      return row.yearBuilt;
    case "density":
      return row.densityScore;
    case "vacancy":
      return row.vacancyScore;
    case "motivation":
      return row.motivationScore;
  }
}
