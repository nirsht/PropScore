import { Prisma } from "@prisma/client";
import { FILTER_DEFAULTS, type FilterInput } from "./schemas/filter";
import { SORT_COLUMN } from "./listing-sorting";

/**
 * Build the WHERE clause used by both `searchListings` (with keyset cursor)
 * and `countListings` (no cursor — we want the total of the filtered set,
 * not the remainder after the current cursor).
 */
export function buildWhere(
  input: FilterInput,
  opts: { includeCursor: boolean; sortExpr?: Prisma.Sql; userId?: string },
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

  if (input.softStoryRedFlag != null) {
    where.push(Prisma.sql`"softStoryRedFlag" = ${input.softStoryRedFlag}`);
  }

  if (input.starredOnly) {
    if (opts.userId) {
      where.push(
        Prisma.sql`"mlsId" IN (SELECT "listingMlsId" FROM "StarredListing" WHERE "userId" = ${opts.userId})`,
      );
    } else {
      where.push(Prisma.sql`FALSE`);
    }
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
