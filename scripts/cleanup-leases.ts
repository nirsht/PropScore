import { db } from "@/lib/db";

async function main() {
  const before = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "Listing" WHERE raw->>'PropertyType' ILIKE '%Lease%'`,
  );
  console.log(`Lease rows before: ${before[0]?.count}`);

  const ids = await db.$queryRawUnsafe<Array<{ mlsId: string }>>(
    `SELECT "mlsId" FROM "Listing" WHERE raw->>'PropertyType' ILIKE '%Lease%'`,
  );
  console.log(`Deleting ${ids.length} listings (Score + AIEnrichment cascade)...`);

  const result = await db.listing.deleteMany({
    where: { mlsId: { in: ids.map((r) => r.mlsId) } },
  });
  console.log(`Deleted ${result.count} listings.`);

  const after = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "Listing" WHERE raw->>'PropertyType' ILIKE '%Lease%'`,
  );
  console.log(`Lease rows after: ${after[0]?.count}`);

  // Refresh the materialized view so the grid stops showing the deleted rows
  // immediately (it's not auto-refreshed on row changes).
  console.log("Refreshing mv_listing_search...");
  await db.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW "mv_listing_search"`);
  console.log("Done.");

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
