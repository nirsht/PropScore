import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { FILTER_DEFAULTS, type FilterInput, type SortKey } from "./schemas/filter";

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
  pricePerSqft: number | null;
  pricePerUnit: number | null;
  sqftPerUnit: number | null;
  densityScore: number | null;
  vacancyScore: number | null;
  motivationScore: number | null;
  valueAddWeightedAvg: number | null;
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
 * Build the WHERE clause used by both `searchListings` (with keyset cursor)
 * and `countListings` (no cursor — we want the total of the filtered set,
 * not the remainder after the current cursor).
 */
function buildWhere(
  input: FilterInput,
  opts: { includeCursor: boolean },
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

  if (input.propertyTypes?.length) {
    where.push(Prisma.sql`"propertyType" = ANY(${input.propertyTypes}::text[])`);
  }

  pushRange(where, '"price"', input.price);
  pushRange(where, '"pricePerSqft"', input.pricePerSqft);
  pushRange(where, '"pricePerUnit"', input.pricePerUnit);
  pushRange(where, '"sqft"', input.sqft);
  pushRange(where, '"units"', input.units);
  pushRange(where, '"beds"', input.beds);
  pushRange(where, '"baths"', input.baths);
  pushRange(where, '"yearBuilt"', input.yearBuilt);
  pushRange(where, '"daysOnMls"', input.daysOnMls);
  pushRange(where, '"occupancy"', input.occupancy);
  pushRange(where, '"densityScore"', input.densityScore);
  pushRange(where, '"vacancyScore"', input.vacancyScore);
  pushRange(where, '"motivationScore"', input.motivationScore);
  pushRange(where, '"valueAddWeightedAvg"', input.valueAddWeightedAvg);

  if (input.postDate?.from) {
    where.push(Prisma.sql`"postDate" >= ${new Date(input.postDate.from)}`);
  }
  if (input.postDate?.to) {
    where.push(Prisma.sql`"postDate" <= ${new Date(input.postDate.to)}`);
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
    const sortCol = Prisma.raw(SORT_COLUMN[sortBy]);
    const cmp = Prisma.raw(sortDir === "asc" ? ">" : "<");

    if (input.cursor.sortValue == null) {
      where.push(Prisma.sql`("mlsId" ${cmp} ${input.cursor.mlsId})`);
    } else {
      where.push(
        Prisma.sql`(${sortCol} ${cmp} ${input.cursor.sortValue} OR (${sortCol} = ${input.cursor.sortValue} AND "mlsId" ${cmp} ${input.cursor.mlsId}))`,
      );
    }
  }

  return {
    sql: where.length ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty,
  };
}

export async function searchListings(input: FilterInput): Promise<SearchResult> {
  const { sql: whereSql } = buildWhere(input, { includeCursor: true });
  const sortBy = input.sortBy ?? FILTER_DEFAULTS.sortBy;
  const sortDir = input.sortDir ?? FILTER_DEFAULTS.sortDir;
  const pageSize = input.limit ?? FILTER_DEFAULTS.limit;
  const sortCol = Prisma.raw(SORT_COLUMN[sortBy]);
  const dir = Prisma.raw(sortDir === "asc" ? "ASC" : "DESC");
  const limit = pageSize + 1;

  const rows = await db.$queryRaw<ListingRow[]>(
    Prisma.sql`
      SELECT
        "mlsId", "address", "city", "state", "postalCode",
        "lat", "lng",
        "price", "daysOnMls", "postDate", "listingUpdatedAt", "status", "propertyType",
        "sqft", "units", "beds", "baths", "occupancy", "yearBuilt", "stories",
        "pricePerSqft", "pricePerUnit", "sqftPerUnit",
        "densityScore", "vacancyScore", "motivationScore", "valueAddWeightedAvg",
        "scoreComputedBy"
      FROM "mv_listing_search"
      ${whereSql}
      ORDER BY ${sortCol} ${dir} NULLS LAST, "mlsId" ${dir}
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
