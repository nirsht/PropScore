/**
 * One-off: backfill Listing.baths for rows where MLS bath count was dropped
 * before BathroomsTotalDecimal was added to the Bridge $select
 * (bridge-client.ts DEFAULT_SELECT). Re-fetches only the affected listings
 * by ListingKey and writes only the `baths` column.
 *
 * Flags:
 *   --dry   report counts without writing
 *   --limit=N  cap rows processed
 */
import { db } from "@/lib/db";
import { env } from "@/lib/env";

const CHUNK = 40; // OData `in (...)` filter — keep URL short
const BATH_SELECT = [
  "ListingKey",
  "ListingId",
  "BathroomsTotalInteger",
  "BathroomsTotalDecimal",
];

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

function positiveNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchBaths(keys: string[]): Promise<Map<string, number>> {
  const quoted = keys.map((k) => `'${k.replace(/'/g, "''")}'`).join(",");
  const filter = `ListingKey in (${quoted})`;
  const url =
    `${env.BRIDGE_BASE_URL}/${env.BRIDGE_DATASET}/Properties` +
    `?access_token=${env.BRIDGE_SERVER_TOKEN}` +
    `&$top=${keys.length}` +
    `&$select=${encodeURIComponent(BATH_SELECT.join(","))}` +
    `&$filter=${encodeURIComponent(filter)}`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Bridge ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as {
    value: Array<Record<string, unknown>>;
  };

  const out = new Map<string, number>();
  for (const row of body.value ?? []) {
    const key = String(row.ListingKey ?? row.ListingId ?? "").trim();
    if (!key) continue;
    const baths =
      positiveNum(row.BathroomsTotalDecimal) ??
      positiveNum(row.BathroomsTotalInteger);
    if (baths != null) out.set(key, baths);
  }
  return out;
}

async function main() {
  const gaps = await db.listing.findMany({
    where: { baths: null },
    select: { mlsId: true, status: true },
    ...(limit ? { take: limit } : {}),
  });

  const total = gaps.length;
  const active = gaps.filter((g) => g.status === "Active").length;
  console.log(
    `[backfill-baths] gaps in DB: total=${total}, active=${active}${
      limit ? ` (limited to ${limit})` : ""
    }`,
  );
  if (total === 0) return;

  let probed = 0;
  let filled = 0;
  let stillNull = 0;

  for (let i = 0; i < gaps.length; i += CHUNK) {
    const chunk = gaps.slice(i, i + CHUNK);
    const keys = chunk.map((g) => g.mlsId);
    const found = await fetchBaths(keys);
    probed += keys.length;

    for (const key of keys) {
      const baths = found.get(key);
      if (baths == null) {
        stillNull += 1;
        continue;
      }
      if (!dry) {
        await db.listing.update({
          where: { mlsId: key },
          data: { baths },
        });
      }
      filled += 1;
    }

    console.log(
      `[backfill-baths] progress: probed=${probed}/${total}, filled=${filled}, stillNull=${stillNull}`,
    );
  }

  console.log(
    `[backfill-baths] done${dry ? " (DRY)" : ""}: filled=${filled}, stillNull=${stillNull} (Bridge has no bath count either)`,
  );
}

main()
  .catch((err) => {
    console.error("[backfill-baths] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
