import { compEstimateFor, matchEstimate } from "./rentRollEstimators";
import type {
  RentCompsOutputUI,
  RentEstimateEntryUI,
  RentRollEntryUI,
  UnitMixEntryUI,
} from "./types";

type Row = {
  weight: number;
  actualRent: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  unitLabel: string | null;
  sourceIndex: number;
  isGrouped: boolean;
};

export type EnrichedRow = Row & {
  market: { rent: number; rationale: string; source: "gpt" | "comps" } | null;
  postReno: { rent: number; rationale: string } | null;
};

export type EnrichedRentRoll = {
  rows: Row[];
  enriched: EnrichedRow[];
  currentTotal: number | null;
  marketTotal: number | null;
  renoTotal: number | null;
  monthlyUpside: number | null;
  upsidePercent: number | null;
  compsBased: boolean;
  totalUnitCount: number;
};

export function enrichRentRoll(args: {
  rentRoll: RentRollEntryUI[] | null | undefined;
  unitMix: UnitMixEntryUI[] | null | undefined;
  aiRentEstimate: RentEstimateEntryUI[] | null | undefined;
  postRenoEstimate: RentEstimateEntryUI[] | null | undefined;
  compsOutput: RentCompsOutputUI | null;
  extractedTotalMonthlyRent: number | null;
}): EnrichedRentRoll {
  const {
    rentRoll,
    unitMix,
    aiRentEstimate,
    postRenoEstimate,
    compsOutput,
    extractedTotalMonthlyRent,
  } = args;

  const rows: Row[] = rentRoll?.length
    ? rentRoll.map((r, i) => ({
        weight: 1,
        actualRent: r.rent,
        beds: r.beds,
        baths: r.baths,
        sqft: r.sqft ?? null,
        unitLabel: r.unitLabel ?? null,
        sourceIndex: i,
        isGrouped: false,
      }))
    : (unitMix ?? []).map((u, i) => ({
        weight: u.count,
        actualRent: null,
        beds: u.beds,
        baths: u.baths,
        sqft: null,
        unitLabel: null,
        sourceIndex: i,
        isGrouped: true,
      }));

  const enriched: EnrichedRow[] = rows.map((row) => {
    let market: EnrichedRow["market"] = null;
    if (compsOutput) {
      const c = compEstimateFor(compsOutput.buckets, row);
      if (c) market = { ...c, source: "comps" };
    }
    if (!market) {
      const ai = matchEstimate(aiRentEstimate, {
        beds: row.beds,
        baths: row.baths,
        sqft: row.sqft,
        unitLabel: row.unitLabel,
        index: row.sourceIndex,
      });
      if (ai) {
        market = {
          rent: ai.estimatedRent,
          rationale: ai.rationale,
          source: ai.source ?? "gpt",
        };
      }
    }
    const reno = matchEstimate(postRenoEstimate, {
      beds: row.beds,
      baths: row.baths,
      sqft: row.sqft,
      unitLabel: row.unitLabel,
      index: row.sourceIndex,
    });
    return {
      ...row,
      market,
      postReno: reno
        ? { rent: reno.estimatedRent, rationale: reno.rationale }
        : null,
    };
  });

  const currentTotal = (() => {
    if (rentRoll?.length) {
      const sum = enriched.reduce((s, r) => s + (r.actualRent ?? 0), 0);
      return sum > 0 ? sum : null;
    }
    return extractedTotalMonthlyRent ?? null;
  })();
  const marketTotal =
    enriched.length > 0 && enriched.every((r) => r.market != null)
      ? enriched.reduce((s, r) => s + r.market!.rent * r.weight, 0)
      : null;
  const renoTotal =
    enriched.length > 0 && enriched.every((r) => r.postReno != null)
      ? enriched.reduce((s, r) => s + r.postReno!.rent * r.weight, 0)
      : null;

  const monthlyUpside =
    currentTotal != null && marketTotal != null
      ? Math.round(marketTotal - currentTotal)
      : null;
  const upsidePercent =
    monthlyUpside != null && currentTotal != null && currentTotal > 0
      ? Math.round((monthlyUpside / currentTotal) * 100)
      : null;
  const compsBased = enriched.some((r) => r.market?.source === "comps");
  const totalUnitCount = rows.reduce((s, r) => s + r.weight, 0);

  return {
    rows,
    enriched,
    currentTotal,
    marketTotal,
    renoTotal,
    monthlyUpside,
    upsidePercent,
    compsBased,
    totalUnitCount,
  };
}
