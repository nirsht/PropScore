/**
 * One-off probe: does Bridge `sfar` expose rental listings?
 *
 *   1. Dump EntitySets from $metadata
 *   2. Dump distinct PropertyType / PropertySubType values currently in the dataset
 *   3. Try a handful of likely lease filters and count results
 *
 * Read-only. Safe to run.
 */
import { fetchMetadata } from "@/server/etl/bridge-client";
import { env } from "@/lib/env";

const BASE = `${env.BRIDGE_BASE_URL}/${env.BRIDGE_DATASET}`;

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE}${path}${sep}access_token=${env.BRIDGE_SERVER_TOKEN}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  console.log(`dataset=${env.BRIDGE_DATASET} base=${env.BRIDGE_BASE_URL}\n`);

  // 1. EntitySets — metadata fetch is best-effort; skip on timeout.
  try {
    const xml = await Promise.race<string>([
      fetchMetadata(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("metadata timeout")), 15_000)),
    ]);
    const sets = Array.from(xml.matchAll(/<EntitySet\s+Name="([^"]+)"/g)).map((m) => m[1]);
    console.log(`EntitySets (${sets.length}):`, sets.join(", "), "\n");
  } catch (err) {
    console.log(`(skipped EntitySet listing: ${(err as Error).message})\n`);
  }

  // 2. Distinct PropertyType / PropertySubType values
  for (const field of ["PropertyType", "PropertySubType"]) {
    const { status, body } = await get(
      `/Property?$apply=groupby((${field}),aggregate($count as Count))&$top=50`,
    );
    type Row = { Count?: number } & Record<string, unknown>;
    const values = (body as { value?: Row[] }).value ?? [];
    console.log(`${field} distinct values (status ${status}):`);
    for (const v of values) {
      console.log(`  ${String(v[field] ?? "(null)").padEnd(40)} count=${v.Count ?? "?"}`);
    }
    console.log();
  }

  // 3. Try common lease filters
  const filters = [
    "PropertyType eq 'Residential Lease'",
    "PropertyType eq 'ResidentialLease'",
    "PropertyType eq 'Lease'",
    "PropertySubType eq 'Residential Lease'",
    "MlsStatus eq 'Leased'",
    "StandardStatus eq 'Active' and contains(tolower(PropertyType),'lease')",
  ];
  for (const f of filters) {
    const { status, body } = await get(
      `/Property?$filter=${encodeURIComponent(f)}&$top=1&$count=true&$select=ListingId,PropertyType,PropertySubType,ListPrice`,
    );
    const odataCount = (body as { "@odata.count"?: number })["@odata.count"];
    const sample = ((body as { value?: unknown[] }).value ?? [])[0];
    console.log(`filter:  ${f}`);
    console.log(`  status=${status} count=${odataCount ?? "?"} sample=${JSON.stringify(sample) ?? "—"}`);
  }
}

main().catch((err) => {
  console.error("probe failed:", err);
  process.exit(1);
});
