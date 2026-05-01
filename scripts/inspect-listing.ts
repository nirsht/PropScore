import { db } from "@/lib/db";

async function main() {
  const mlsId = process.argv[2];
  if (!mlsId) {
    console.error("usage: tsx scripts/inspect-listing.ts <mlsId>");
    process.exit(1);
  }

  const l = await db.listing.findUnique({
    where: { mlsId },
    select: {
      mlsId: true,
      address: true,
      city: true,
      price: true,
      propertyType: true,
      status: true,
      extractedUnitMix: true,
      extractedRentRoll: true,
      extractedTotalMonthlyRent: true,
      aiRentEstimate: true,
      postRenovationRentEstimate: true,
    },
  });
  if (!l) {
    console.error(`No listing for mlsId=${mlsId}`);
    process.exit(2);
  }

  console.log(JSON.stringify(l, null, 2));
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
