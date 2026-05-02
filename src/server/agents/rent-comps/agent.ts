import { db } from "@/lib/db";
import { searchAll, odataDateTime } from "@/server/etl/bridge-client";
import {
  RentCompsInput,
  type RentComp,
  type RentCompBucket,
  type RentCompsOutput,
} from "./schema";

const DEFAULT_RADIUS_MILES = 1;
const DEFAULT_MONTHS_BACK = 24;
const MAX_COMPS_KEPT = 50;

const COMP_SELECT = [
  "ListingKey",
  "ListingId",
  "BedroomsTotal",
  "BathroomsTotalInteger",
  "BathroomsTotalDecimal",
  "LivingArea",
  "BuildingAreaTotal",
  "ListPrice",
  "ClosePrice",
  "CloseDate",
  "Latitude",
  "Longitude",
  "PropertyType",
  "StandardStatus",
];

/**
 * 1° latitude ≈ 69 mi. Longitude varies by latitude — at SF (~37.77°N),
 * 1° longitude ≈ 54.6 mi. We use the cosine of the listing's latitude so
 * the bounding box stays correct elsewhere.
 */
function bbox(lat: number, lng: number, radiusMiles: number) {
  const dLat = radiusMiles / 69;
  const dLng = radiusMiles / (69 * Math.cos((lat * Math.PI) / 180));
  return {
    latMin: lat - dLat,
    latMax: lat + dLat,
    lngMin: lng - dLng,
    lngMax: lng + dLng,
  };
}

function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function bucketize(comps: RentComp[]): RentCompBucket[] {
  const groups = new Map<string, RentComp[]>();
  for (const c of comps) {
    const key = `${c.beds ?? "?"}|${c.baths ?? "?"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  return Array.from(groups.entries()).map(([_, list]) => {
    const rents = list.map((c) => c.monthlyRent);
    const ppsf = list
      .map((c) => c.pricePerSqft)
      .filter((v): v is number => v != null && Number.isFinite(v));
    const sqfts = list
      .map((c) => c.sqft)
      .filter((v): v is number => v != null && v > 0);
    return {
      beds: list[0]!.beds,
      baths: list[0]!.baths,
      count: list.length,
      medianRent: median(rents),
      medianPricePerSqft: median(ppsf),
      medianSqft: median(sqfts),
    };
  });
}

/**
 * Fetch SFAR closed-lease comps within a radius/recency window of the
 * listing, bucket them by (beds, baths), and persist the aggregate to
 * AIEnrichment so the drawer can render comp-grounded estimates.
 *
 * Deterministic — no LLM call. Cheap to re-run.
 */
export async function runRentComps(
  mlsId: string,
  _userId: string | null,
  options: { radiusMiles?: number; monthsBack?: number } = {},
): Promise<RentCompsOutput> {
  const parsed = RentCompsInput.parse({ mlsId, ...options });
  const radiusMiles = parsed.radiusMiles ?? DEFAULT_RADIUS_MILES;
  const monthsBack = parsed.monthsBack ?? DEFAULT_MONTHS_BACK;

  const listing = await db.listing.findUnique({
    where: { mlsId },
    select: { mlsId: true, lat: true, lng: true },
  });
  if (!listing) throw new Error(`Listing not found: ${mlsId}`);
  if (listing.lat == null || listing.lng == null) {
    throw new Error(
      `Listing ${mlsId} has no lat/lng — cannot fetch rental comps.`,
    );
  }

  const since = new Date();
  since.setMonth(since.getMonth() - monthsBack);

  const box = bbox(listing.lat, listing.lng, radiusMiles);
  const filter = [
    "PropertyType eq 'Residential Lease'",
    "StandardStatus eq 'Closed'",
    `Latitude ge ${box.latMin}`,
    `Latitude le ${box.latMax}`,
    `Longitude ge ${box.lngMin}`,
    `Longitude le ${box.lngMax}`,
    `CloseDate ge ${odataDateTime(since)}`,
  ].join(" and ");

  // Cap the pull — radius is small, but a hot neighborhood + 24mo can
  // still return hundreds of rows. 500 is plenty for a median.
  const { records } = await searchAll({
    filter,
    select: COMP_SELECT,
    orderby: "CloseDate desc",
    maxRows: 500,
  });

  const comps: RentComp[] = [];
  for (const r of records) {
    const rent = (r.ClosePrice as number | undefined) ?? r.ListPrice;
    if (typeof rent !== "number" || rent <= 0) continue;
    const lat = r.Latitude as number | undefined;
    const lng = r.Longitude as number | undefined;
    if (lat == null || lng == null) continue;
    const distanceMiles = haversineMiles(listing.lat, listing.lng, lat, lng);
    if (distanceMiles > radiusMiles) continue;
    const sqft =
      (r.LivingArea as number | undefined) ??
      (r.BuildingAreaTotal as number | undefined) ??
      null;
    comps.push({
      listingKey: String(r.ListingKey ?? r.ListingId ?? ""),
      beds: (r.BedroomsTotal as number | undefined) ?? null,
      baths:
        (r.BathroomsTotalInteger as number | undefined) ??
        (r.BathroomsTotalDecimal as number | undefined) ??
        null,
      sqft: sqft && sqft > 0 ? Math.round(sqft) : null,
      monthlyRent: Math.round(rent),
      closeDate: (r.CloseDate as string | undefined) ?? null,
      lat,
      lng,
      distanceMiles: Math.round(distanceMiles * 100) / 100,
      pricePerSqft: sqft && sqft > 0 ? rent / sqft : null,
    });
  }

  const buckets = bucketize(comps);
  // Keep the closest N comps for the trace/tooltip — sorted by distance
  // for predictability.
  const trimmed = [...comps]
    .sort((a, b) => (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0))
    .slice(0, MAX_COMPS_KEPT);

  const output: RentCompsOutput = {
    origin: { lat: listing.lat, lng: listing.lng },
    radiusMiles,
    monthsBack,
    totalComps: comps.length,
    buckets,
    comps: trimmed,
    summary:
      comps.length === 0
        ? `No SFAR closed leases within ${radiusMiles}mi in the last ${monthsBack}mo.`
        : `${comps.length} SFAR closed leases within ${radiusMiles}mi · last ${monthsBack}mo · ${buckets.length} (beds, baths) bucket${buckets.length === 1 ? "" : "s"}.`,
  };

  await db.aIEnrichment.create({
    data: {
      listingMlsId: mlsId,
      agentName: "rent-comps",
      output: output as unknown as object,
    },
  });

  return output;
}
