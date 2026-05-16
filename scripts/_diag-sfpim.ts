import { db } from "../src/lib/db";

(async () => {
  const overall = await db.$queryRawUnsafe<any[]>(`
    SELECT
      COUNT(*) FILTER (WHERE "assessorFetchedAt" IS NOT NULL) AS fetched,
      COUNT(*) FILTER (WHERE "assessorFetchedAt" IS NOT NULL AND "blockLot" IS NOT NULL) AS matched,
      COUNT(*) FILTER (WHERE "assessorFetchedAt" IS NOT NULL AND "blockLot" IS NULL) AS unmatched,
      COUNT(*) AS total_sf
    FROM "Listing"
    WHERE "city" = 'San Francisco'
  `);
  console.log("OVERALL:", overall[0]);

  const buckets = await db.$queryRawUnsafe<any[]>(`
    SELECT
      COUNT(*) FILTER (WHERE "assessorBuildingSqft" > 3 * "sqft") AS assessor_3x_larger,
      COUNT(*) FILTER (WHERE "assessorBuildingSqft" < "sqft" / 3 AND "assessorBuildingSqft" > 0) AS assessor_3x_smaller,
      COUNT(*) FILTER (WHERE "assessorUnits" IS NOT NULL AND "units" IS NOT NULL AND ABS("assessorUnits" - "units") >= 3) AS units_diverge_3plus,
      COUNT(*) FILTER (WHERE "assessorBuildingSqft" > 2 * "sqft") AS assessor_2x_larger,
      COUNT(*) FILTER (WHERE "assessorBuildingSqft" < "sqft" / 2 AND "assessorBuildingSqft" > 0) AS assessor_2x_smaller,
      COUNT(*) AS denom
    FROM "Listing"
    WHERE "city" = 'San Francisco' AND "blockLot" IS NOT NULL AND "sqft" IS NOT NULL AND "sqft" > 0
  `);
  console.log("DIVERGENCE BUCKETS (denom = matched rows with sqft):", buckets[0]);

  // Street-number anchoring sniff test: does the street number from
  // Listing.address appear as a properly anchored token in the matched
  // assessor.property_location?
  const sniff = await db.$queryRawUnsafe<any[]>(`
    SELECT
      COUNT(*) AS matched_with_addr,
      COUNT(*) FILTER (
        WHERE substring("address" from '^\\s*(\\d+)') IS NOT NULL
        AND raw->'assessor'->>'property_location' IS NOT NULL
        AND raw->'assessor'->>'property_location' !~* (
          '(^|\\s)' || substring("address" from '^\\s*(\\d+)') || '(\\s|$)'
        )
      ) AS street_num_not_in_assessor_loc
    FROM "Listing"
    WHERE "city" = 'San Francisco' AND "blockLot" IS NOT NULL
  `);
  console.log("STREET-NUMBER SNIFF:", sniff[0]);

  await db.$disconnect();
})();
