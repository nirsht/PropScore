import type { BridgeProperty } from "./bridge-client";

export type NormalizedListing = {
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
  lotSizeSqft: number | null;
  units: number | null;
  beds: number | null;
  baths: number | null;
  occupancy: number | null;
  yearBuilt: number | null;
  stories: number | null;
  bridgeModificationTimestamp: Date;
  raw: BridgeProperty;
};

const composeAddress = (p: BridgeProperty): string => {
  if (p.UnparsedAddress) return String(p.UnparsedAddress);
  const parts = [p.StreetNumber, p.StreetName].filter(Boolean).join(" ");
  return parts || "Unknown address";
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const int = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};

/**
 * Treat 0 as "missing" — MLS feeds frequently surface 0 for unknown
 * sqft / units / beds and that breaks every downstream ratio.
 */
const positiveInt = (v: unknown): number | null => {
  const n = int(v);
  return n != null && n > 0 ? n : null;
};

const positiveNum = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};

const date = (v: unknown): Date | null => {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
};

const SQFT_PER_ACRE = 43_560;

function computeLotSizeSqft(p: BridgeProperty): number | null {
  const direct = positiveNum(p.LotSizeSquareFeet);
  if (direct != null) return Math.round(direct);

  const acres = positiveNum(p.LotSizeAcres);
  if (acres != null) return Math.round(acres * SQFT_PER_ACRE);

  const area = positiveNum(p.LotSizeArea);
  if (area != null) {
    const u = String(p.LotSizeUnits ?? "").toLowerCase();
    if (u.includes("acre")) return Math.round(area * SQFT_PER_ACRE);
    if (u.includes("square") || u.includes("sqft") || u === "sf") return Math.round(area);
    // Unknown unit — assume sqft (most common in residential feeds).
    return Math.round(area);
  }
  return null;
}

/**
 * Map a raw Bridge property into the Listing row we persist. Returns null for
 * records that lack the bare-minimum identifiers / pricing.
 */
export function normalizeListing(p: BridgeProperty): NormalizedListing | null {
  const mlsId = String(p.ListingKey ?? p.ListingId ?? "").trim();
  if (!mlsId) return null;

  const price = int(p.ListPrice);
  if (price == null || price <= 0) return null;

  const postDate = date(p.ListingContractDate) ?? date(p.ModificationTimestamp);
  if (!postDate) return null;

  const listingUpdatedAt = date(p.ModificationTimestamp) ?? postDate;
  const bridgeModificationTimestamp =
    date(p.BridgeModificationTimestamp) ?? listingUpdatedAt;

  // Treat 0 as missing — many MLS rows report 0 sqft / 0 units when unknown,
  // and that produces nonsense $/Sqft and Sqft/Unit ratios downstream.
  const sqft = positiveInt(p.LivingArea ?? p.BuildingAreaTotal);

  // Lot size — MLS may report it in any of three ways:
  //   1. LotSizeSquareFeet directly
  //   2. LotSizeAcres (× 43_560 = sqft)
  //   3. LotSizeArea + LotSizeUnits (with units like "Square Feet" or "Acres")
  // We normalize everything to square feet.
  const lotSizeSqft = computeLotSizeSqft(p);

  const units = positiveInt(p.NumberOfUnitsTotal);
  const beds = positiveInt(p.BedroomsTotal);
  const baths =
    positiveNum(p.BathroomsTotalDecimal) ?? positiveNum(p.BathroomsTotalInteger);
  const yearBuilt = positiveInt(p.YearBuilt);
  const stories = positiveInt(p.StoriesTotal ?? p.Stories);

  const lat = num(p.Latitude);
  const lng = num(p.Longitude);

  const daysOnMlsRaw = int(p.DaysOnMarket);
  const daysOnMls =
    daysOnMlsRaw ??
    Math.max(
      0,
      Math.floor((Date.now() - postDate.getTime()) / (1000 * 60 * 60 * 24)),
    );

  return {
    mlsId,
    address: composeAddress(p),
    city: (p.City ? String(p.City) : null) ?? null,
    state: (p.StateOrProvince ? String(p.StateOrProvince) : null) ?? null,
    postalCode: (p.PostalCode ? String(p.PostalCode) : null) ?? null,
    lat,
    lng,
    price,
    daysOnMls,
    postDate,
    listingUpdatedAt,
    status: String(p.StandardStatus ?? "Unknown"),
    propertyType: String(p.PropertySubType ?? p.PropertyType ?? "Unknown"),
    sqft,
    lotSizeSqft,
    units,
    beds,
    baths,
    occupancy: null, // not in standard RESO; populated later if available
    yearBuilt,
    stories,
    bridgeModificationTimestamp,
    raw: p,
  };
}
