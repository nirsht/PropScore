/**
 * DataSF Socrata client — crime incidents (wg3w-h783) + analysis
 * neighborhoods polygons (p5b7-5n3h). Anonymous access, ~1 req/sec.
 *
 * The crime dataset has ~500K incidents/year — far too many to download
 * row-by-row. We let Socrata do the aggregation server-side via a single
 * SoQL `$group` query, returning ~120 rows (41 neighborhoods × 3 categories
 * we care about, minus empty buckets).
 */

import { bucketIncidentCategory, type CrimeCategory } from "./scoring/location";

const INCIDENTS_URL = "https://data.sfgov.org/resource/wg3w-h783.json";
const NEIGHBORHOODS_URL = "https://data.sfgov.org/resource/p5b7-5n3h.geojson";

const THROTTLE_MS = 1100;

let lastRequestAt = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + THROTTLE_MS - now);
  lastRequestAt = now + wait;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function getJson<T>(url: string): Promise<T> {
  await throttle();
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`DataSF ${res.status} ${res.statusText} on ${url}\n${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

/**
 * Aggregate crime incidents per (analysis_neighborhood, incident_category)
 * since `windowStart` via Socrata's `$group`. Returns rows already bucketed
 * into our coarse categories (violent/property/qol); rows that fall outside
 * those buckets (Non-Criminal, Lost Property, etc.) are dropped.
 *
 * SoQL caps unauthenticated queries at 50,000 rows; the grouped result has
 * far fewer (~hundreds of distinct incident_categories × 41 neighborhoods),
 * so a single request is sufficient.
 */
export async function fetchCrimeAggregates(
  windowStart: Date,
): Promise<Array<{ neighborhood: string; category: CrimeCategory; count: number }>> {
  const since = windowStart.toISOString().split(".")[0]; // SoQL doesn't like ms
  const select = "analysis_neighborhood,incident_category,count(*) AS count";
  const where = `incident_datetime > '${since}' AND analysis_neighborhood IS NOT NULL AND incident_category IS NOT NULL`;
  const group = "analysis_neighborhood,incident_category";

  const url =
    `${INCIDENTS_URL}?` +
    new URLSearchParams({
      $select: select,
      $where: where,
      $group: group,
      $limit: "50000",
    }).toString();

  type Row = {
    analysis_neighborhood: string;
    incident_category: string;
    count: string;
  };

  const rows = await getJson<Row[]>(url);

  // Re-aggregate by (neighborhood, our coarse category) since multiple
  // incident_categories collapse into a single bucket. Use a tab delimiter
  // since neighborhood names contain spaces ("Bayview Hunters Point").
  const SEP = "\t";
  const agg = new Map<string, number>();
  for (const r of rows) {
    const cat = bucketIncidentCategory(r.incident_category);
    if (!cat) continue;
    const key = `${r.analysis_neighborhood}${SEP}${cat}`;
    const n = Number(r.count);
    if (!Number.isFinite(n)) continue;
    agg.set(key, (agg.get(key) ?? 0) + n);
  }

  return [...agg.entries()].map(([key, count]) => {
    const [neighborhood, category] = key.split(SEP) as [string, CrimeCategory];
    return { neighborhood, category, count };
  });
}

/**
 * Download the DataSF "Analysis Neighborhoods" GeoJSON FeatureCollection.
 * 41 polygons covering the city. Each feature's `properties.nhood` is the
 * canonical neighborhood name we use as a primary key.
 */
export type NeighborhoodFeature = {
  type: "Feature";
  properties: { nhood: string; [k: string]: unknown };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: unknown;
  };
};

export type NeighborhoodFeatureCollection = {
  type: "FeatureCollection";
  features: NeighborhoodFeature[];
};

export async function fetchAnalysisNeighborhoods(): Promise<NeighborhoodFeatureCollection> {
  return getJson<NeighborhoodFeatureCollection>(NEIGHBORHOODS_URL);
}
