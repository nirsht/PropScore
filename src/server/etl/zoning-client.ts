/**
 * SF Planning Zoning Districts — Socrata GeoJSON client.
 *
 * Dataset: SF Planning "Zoning Districts" (resource id `8br2-hhp3`). Polygon
 * features keyed by `zoning` (district code, e.g. "RH-2", "RM-1", "NCT-3").
 * Verify the resource ID against https://data.sfgov.org if a fetch starts
 * failing — Socrata occasionally re-publishes datasets under new IDs.
 *
 * The polygon set is small (~hundreds of features citywide) so we download
 * the whole FeatureCollection in one request and bulk-load it into the
 * `zoning_polygon` PostGIS table. Re-fetch quarterly; districts change rarely.
 *
 * Anonymous access (no X-App-Token), ~1 req/sec to stay polite within
 * Socrata's anonymous-access guidance.
 */

const ZONING_URL = "https://data.sfgov.org/resource/8br2-hhp3.geojson";
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
    // Common Socrata-published columns; not all are guaranteed.
    zoning?: string;
    zoning_district?: string;
    districtname?: string;
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
    (f.properties.zoning_district as string | undefined) ??
    (f.properties.districtname as string | undefined) ??
    null;
  if (!raw) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function fetchZoningDistricts(): Promise<ZoningFeatureCollection> {
  await throttle();
  // $limit=10000 is well above the actual feature count; Socrata caps
  // anonymous queries at 50000 but the dataset is much smaller.
  const url = `${ZONING_URL}?$limit=10000`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Zoning ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as ZoningFeatureCollection;
}
