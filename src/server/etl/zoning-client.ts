/**
 * SF Planning Zoning Districts — Socrata GeoJSON client.
 *
 * Dataset: DataSF "Zoning Map - Zoning Districts" (resource id `3i4a-hu95`).
 * Polygon features keyed by `zoning` (district code, e.g. "RH-2", "RM-1",
 * "NCT-3"). Verify the resource ID against https://data.sfgov.org if a fetch
 * starts failing — Socrata occasionally re-publishes datasets under new IDs
 * (this dataset previously lived at `8br2-hhp3`, which now 404s).
 *
 * The dataset is parcel-level (~10.6k features citywide) but still small
 * enough to download the whole FeatureCollection in one request and bulk-load
 * it into the `zoning_polygon` PostGIS table. Re-fetch quarterly; districts
 * change rarely.
 *
 * Anonymous access (no X-App-Token), ~1 req/sec to stay polite within
 * Socrata's anonymous-access guidance.
 */

const ZONING_URL = "https://data.sfgov.org/resource/3i4a-hu95.geojson";
const THROTTLE_MS = 1100;

let lastRequestAt = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + THROTTLE_MS - now);
  lastRequestAt = now + wait;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export type ZoningFeature = {
  type: "Feature";
  properties: {
    // Common Socrata-published columns; not all are guaranteed. The current
    // `3i4a-hu95` export ships `zoning` + `zoning_sim` + `districtna`; older
    // exports used `zoning_district` / `districtname`.
    zoning?: string;
    zoning_sim?: string;
    zoning_district?: string;
    districtname?: string;
    districtna?: string;
    [k: string]: unknown;
  };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: unknown;
  };
};

export type ZoningFeatureCollection = {
  type: "FeatureCollection";
  features: ZoningFeature[];
};

/**
 * Pull the canonical zoning code from a feature's properties. Different
 * Socrata exports of this dataset have shipped the column under slightly
 * different names; we try the most common ones in priority order.
 */
export function readDistrict(f: ZoningFeature): string | null {
  const raw =
    (f.properties.zoning as string | undefined) ??
    (f.properties.zoning_sim as string | undefined) ??
    (f.properties.zoning_district as string | undefined) ??
    (f.properties.districtname as string | undefined) ??
    (f.properties.districtna as string | undefined) ??
    null;
  if (!raw) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function fetchZoningDistricts(): Promise<ZoningFeatureCollection> {
  await throttle();
  // The dataset has ~10.6k features; $limit=50000 (Socrata's anonymous cap)
  // keeps the whole FeatureCollection in one request without silently
  // truncating. If features ever exceed the cap this must switch to paging.
  const url = `${ZONING_URL}?$limit=50000`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Zoning ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as ZoningFeatureCollection;
}
