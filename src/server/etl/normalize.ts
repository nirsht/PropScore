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
