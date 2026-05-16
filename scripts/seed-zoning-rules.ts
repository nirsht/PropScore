/**
 * One-off (re-runnable, idempotent): seed the curated `ZoningRule` table.
 *
 * Maps SF Planning base zoning districts to the max-allowed dwelling units.
 * RH-* districts have a fixed cap (RH-1=1, RH-2=2, RH-3=3); RM-* and RTO
 * districts use density-by-lot-area (e.g. RM-1 = 1 unit per 800 sqft).
 * Commercial / NCT / C-3 districts have density decontrol — no static cap —
 * and are seeded with both columns null and a `notes` string so the
 * enrichment script can flag "no static cap" without re-querying.
 *
 * State-law overlays (SB-9, AB-2011, density bonuses) are explicitly NOT
 * modeled here — v1 reflects base zoning only. The UI surfaces this caveat.
 *
 * Source: SF Planning Code Article 2 (Residential) and Article 7
 * (Neighborhood Commercial). Verify against current code before relying on
 * any specific district for an underwriting decision.
 *
 * Usage: pnpm tsx scripts/seed-zoning-rules.ts
 */
import { db } from "@/lib/db";

type Rule = {
  district: string;
  maxUnitsFixed: number | null;
  maxUnitsPerLotSqft: number | null;
  notes: string | null;
};

// `maxUnitsPerLotSqft` is the lot-area divisor: max units = floor(lotSqft / divisor).
const RULES: Rule[] = [
  // ---------- RH (Residential, House) ----------
  { district: "RH-1",     maxUnitsFixed: 1, maxUnitsPerLotSqft: null, notes: "Single-family." },
  { district: "RH-1(D)",  maxUnitsFixed: 1, maxUnitsPerLotSqft: null, notes: "Detached single-family." },
  { district: "RH-1(S)",  maxUnitsFixed: 1, maxUnitsPerLotSqft: null, notes: "Semi-detached single-family." },
  { district: "RH-2",     maxUnitsFixed: 2, maxUnitsPerLotSqft: null, notes: null },
  { district: "RH-3",     maxUnitsFixed: 3, maxUnitsPerLotSqft: null, notes: null },

  // ---------- RM (Residential, Mixed) — density-by-lot-area ----------
  { district: "RM-1", maxUnitsFixed: null, maxUnitsPerLotSqft: 800, notes: "1 unit / 800 sqft lot." },
  { district: "RM-2", maxUnitsFixed: null, maxUnitsPerLotSqft: 600, notes: "1 unit / 600 sqft lot." },
  { district: "RM-3", maxUnitsFixed: null, maxUnitsPerLotSqft: 400, notes: "1 unit / 400 sqft lot." },
  { district: "RM-4", maxUnitsFixed: null, maxUnitsPerLotSqft: 200, notes: "1 unit / 200 sqft lot." },

  // ---------- RTO (Residential Transit Oriented) ----------
  { district: "RTO",   maxUnitsFixed: null, maxUnitsPerLotSqft: 600, notes: "1 unit / 600 sqft lot." },
  { district: "RTO-M", maxUnitsFixed: null, maxUnitsPerLotSqft: 400, notes: "1 unit / 400 sqft lot (Mission)." },

  // ---------- RC (Residential-Commercial) ----------
  { district: "RC-1", maxUnitsFixed: null, maxUnitsPerLotSqft: 800, notes: "Treated as RM-1-equivalent." },
  { district: "RC-2", maxUnitsFixed: null, maxUnitsPerLotSqft: 600, notes: "Treated as RM-2-equivalent." },
  { district: "RC-3", maxUnitsFixed: null, maxUnitsPerLotSqft: 400, notes: "Treated as RM-3-equivalent." },
  { district: "RC-4", maxUnitsFixed: null, maxUnitsPerLotSqft: 200, notes: "Treated as RM-4-equivalent." },

  // ---------- Districts with no static cap ----------
  { district: "NCT-3", maxUnitsFixed: null, maxUnitsPerLotSqft: null, notes: "Density decontrol on commercial corridor — no static cap." },
  { district: "NCT-4", maxUnitsFixed: null, maxUnitsPerLotSqft: null, notes: "Density decontrol on commercial corridor — no static cap." },
  { district: "C-3-O", maxUnitsFixed: null, maxUnitsPerLotSqft: null, notes: "Downtown — no static residential cap." },
  { district: "C-3-R", maxUnitsFixed: null, maxUnitsPerLotSqft: null, notes: "Downtown — no static residential cap." },
  { district: "C-3-G", maxUnitsFixed: null, maxUnitsPerLotSqft: null, notes: "Downtown — no static residential cap." },
  { district: "C-3-S", maxUnitsFixed: null, maxUnitsPerLotSqft: null, notes: "Downtown — no static residential cap." },
  { district: "UMU",   maxUnitsFixed: null, maxUnitsPerLotSqft: null, notes: "Urban Mixed Use — no static residential cap." },
  { district: "MUR",   maxUnitsFixed: null, maxUnitsPerLotSqft: null, notes: "Mixed Use Residential — no static residential cap." },
  { district: "MUG",   maxUnitsFixed: null, maxUnitsPerLotSqft: null, notes: "Mixed Use General — no static residential cap." },
  { district: "MUO",   maxUnitsFixed: null, maxUnitsPerLotSqft: null, notes: "Mixed Use Office — no static residential cap." },
];

async function main() {
  console.log(`[seed-zoning-rules] upserting ${RULES.length} districts…`);
  let upserted = 0;
  for (const r of RULES) {
    await db.zoningRule.upsert({
      where: { district: r.district },
      create: r,
      update: r,
    });
    upserted += 1;
  }
  const total = await db.zoningRule.count();
  console.log(`[seed-zoning-rules] done — upserted=${upserted}, totalRows=${total}`);
}

main()
  .catch((err) => {
    console.error("[seed-zoning-rules] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
