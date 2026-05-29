import { compEstimateFor, matchEstimate } from "./rentRollEstimators";
import type {
  RentCompsOutputUI,
  RentEstimateEntryUI,
  RentRollEntryUI,
  UnitMixEntryUI,
} from "./types";

const round50 = (n: number) => Math.round(n / 50) * 50;
// Minimum uplift a moderate cosmetic remodel should add over market rent.
// Used as a floor when we can't derive the LLM's per-unit uplift ratio
// (e.g. no aiRentEstimate match, or the model emitted postReno <= aiRent).
const MIN_RENO_UPLIFT = 1.05;

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
    const matchKey = {
      beds: row.beds,
      baths: row.baths,
      sqft: row.sqft,
      unitLabel: row.unitLabel,
      index: row.sourceIndex,
    };
    const ai = matchEstimate(aiRentEstimate, matchKey);
    let market: EnrichedRow["market"] = null;
    if (compsOutput) {
      const c = compEstimateFor(compsOutput.buckets, row);
      if (c) market = { ...c, source: "comps" };
    }
    if (!market && ai) {
      market = {
        rent: ai.estimatedRent,
        rationale: ai.rationale,
        source: ai.source ?? "gpt",
      };
    }
    const reno = matchEstimate(postRenoEstimate, matchKey);

    // Anchor post-remodel rent to the actually-displayed market rent.
    // The LLM keeps postReno > aiRentEstimate, but when comps replace
    // the market column with a higher number, the raw postReno can fall
    // below it. Preserve the LLM's per-unit uplift ratio when available,
    // otherwise apply a flat MIN_RENO_UPLIFT floor.
    let postReno: EnrichedRow["postReno"] = reno
      ? { rent: reno.estimatedRent, rationale: reno.rationale }
      : null;
    if (market && postReno) {
      const upliftRatio =
        ai && reno && ai.estimatedRent > 0 && reno.estimatedRent > ai.estimatedRent
          ? reno.estimatedRent / ai.estimatedRent
          : MIN_RENO_UPLIFT;
      const floor = round50(market.rent * upliftRatio);
      if (floor > postReno.rent) {
        const bumpPct = Math.round((upliftRatio - 1) * 100);
        postReno = {
          rent: floor,
          rationale: `${reno!.rationale} · lifted +${bumpPct}% over ${market.source === "comps" ? "comps" : "market"}`,
        };
      }
    }

    return { ...row, market, postReno };
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
