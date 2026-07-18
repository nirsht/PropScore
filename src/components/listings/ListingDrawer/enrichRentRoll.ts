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
  moveInDate: string | null;
  sourceIndex: number;
  isGrouped: boolean;
  // Retail/office/market space. We render it as a "Commercial" row and skip
  // residential market/reno estimates for it (no residential comp applies).
  isCommercial: boolean;
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
        moveInDate: r.moveInDate ?? null,
        sourceIndex: i,
        isGrouped: false,
        isCommercial: r.kind === "commercial",
      }))
    : (unitMix ?? []).map((u, i) => ({
        weight: u.count,
        actualRent: null,
        beds: u.beds,
        baths: u.baths,
        sqft: null,
        unitLabel: null,
        moveInDate: null,
        sourceIndex: i,
        isGrouped: true,
        isCommercial: u.kind === "commercial",
      }));

  const enriched: EnrichedRow[] = rows.map((row) => {
    // Commercial space has no residential comp — leave market/reno blank.
    if (row.isCommercial) {
      return { ...row, market: null, postReno: null };
    }
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

  // Current rent is gross — it includes any commercial row's actual rent, since
  // that's real in-place income. Market/reno upside, however, is residential-
  // only (we don't estimate commercial rent), so the market/reno totals and the
  // upside baseline both exclude commercial rows. With no commercial row present
  // `residential === enriched`, so this is a no-op for the common case.
  const currentTotal = (() => {
    if (rentRoll?.length) {
      const sum = enriched.reduce((s, r) => s + (r.actualRent ?? 0), 0);
      return sum > 0 ? sum : null;
    }
    return extractedTotalMonthlyRent ?? null;
  })();
  const residential = enriched.filter((r) => !r.isCommercial);
  const marketTotal =
    residential.length > 0 && residential.every((r) => r.market != null)
      ? residential.reduce((s, r) => s + r.market!.rent * r.weight, 0)
      : null;
  const renoTotal =
    residential.length > 0 && residential.every((r) => r.postReno != null)
      ? residential.reduce((s, r) => s + r.postReno!.rent * r.weight, 0)
      : null;

  // Upside baseline = residential in-place rent only (matches marketTotal's
  // residential scope). Falls back to gross currentTotal when no per-unit
  // residential rents are itemized.
  const residentialCurrentTotal = rentRoll?.length
    ? residential.reduce((s, r) => s + (r.actualRent ?? 0), 0)
    : (currentTotal ?? 0);
  const monthlyUpside =
    marketTotal != null && residentialCurrentTotal > 0
      ? Math.round(marketTotal - residentialCurrentTotal)
      : null;
  const upsidePercent =
    monthlyUpside != null && residentialCurrentTotal > 0
      ? Math.round((monthlyUpside / residentialCurrentTotal) * 100)
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
