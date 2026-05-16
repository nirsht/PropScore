import { db } from "../src/lib/db";

(async () => {
  console.log("\n=== TOP 20: street number missing from matched assessor location ===");
  const numMissing = await db.$queryRawUnsafe<any[]>(`
    SELECT
      "mlsId",
      "address",
      "blockLot",
      "sqft" AS listing_sqft,
      "assessorBuildingSqft" AS asr_sqft,
      "units" AS listing_units,
      "assessorUnits" AS asr_units,
      raw->'assessor'->>'property_location' AS asr_loc,
      raw->'assessor'->>'parcel_number' AS asr_apn
    FROM "Listing"
    WHERE "city" = 'San Francisco' AND "blockLot" IS NOT NULL
      AND substring("address" from '^\\s*(\\d+)') IS NOT NULL
      AND raw->'assessor'->>'property_location' IS NOT NULL
      AND raw->'assessor'->>'property_location' !~* (
        '(^|\\s)' || substring("address" from '^\\s*(\\d+)') || '(\\s|$)'
      )
    ORDER BY "mlsId"
    LIMIT 20
  `);
  for (const r of numMissing) {
    console.log(`  ${r.mlsId}  "${r.address}"  → APN=${r.asr_apn}  loc="${r.asr_loc}"  sqft ${r.listing_sqft}↔${r.asr_sqft}  units ${r.listing_units}↔${r.asr_units}`);
  }

  console.log("\n=== TOP 20: assessor >3× listing sqft (suspected parent/wrong parcel) ===");
  const big = await db.$queryRawUnsafe<any[]>(`
    SELECT "mlsId", "address", "blockLot", "sqft", "assessorBuildingSqft",
           "units", "assessorUnits",
           raw->'assessor'->>'property_location' AS asr_loc
    FROM "Listing"
    WHERE "city" = 'San Francisco' AND "blockLot" IS NOT NULL
      AND "sqft" > 0 AND "assessorBuildingSqft" > 3 * "sqft"
    ORDER BY ("assessorBuildingSqft"::float / "sqft") DESC
    LIMIT 20
  `);
  for (const r of big) {
    console.log(`  ${r.mlsId}  "${r.address}"  ${r.sqft}↔${r.assessorBuildingSqft}sqft  units ${r.units}↔${r.assessorUnits}  loc="${r.asr_loc}"`);
  }

  console.log("\n=== TOP 20: assessor <1/3 listing sqft (suspected sub-unit) ===");
  const small = await db.$queryRawUnsafe<any[]>(`
    SELECT "mlsId", "address", "blockLot", "sqft", "assessorBuildingSqft",
           "units", "assessorUnits",
           raw->'assessor'->>'property_location' AS asr_loc,
           "propertyType"
    FROM "Listing"
    WHERE "city" = 'San Francisco' AND "blockLot" IS NOT NULL
      AND "sqft" > 0 AND "assessorBuildingSqft" > 0
      AND "assessorBuildingSqft" < "sqft" / 3
    ORDER BY ("sqft"::float / "assessorBuildingSqft") DESC
    LIMIT 20
  `);
  for (const r of small) {
    console.log(`  ${r.mlsId}  "${r.address}" [${r.propertyType}]  ${r.sqft}↔${r.assessorBuildingSqft}sqft  units ${r.units}↔${r.assessorUnits}  loc="${r.asr_loc}"`);
  }

  console.log("\n=== Confirm Haight case ===");
  const haight = await db.$queryRawUnsafe<any[]>(`
    SELECT "mlsId", "address", "blockLot", "assessorBuildingSqft", "assessorUnits",
           raw->'assessor'->>'property_location' AS asr_loc
    FROM "Listing"
    WHERE "mlsId" = 'be4faa0f8cd7bc8e3f336479a2424286'
  `);
  console.log(haight[0]);

  await db.$disconnect();
})();
