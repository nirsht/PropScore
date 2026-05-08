import * as React from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import AutoFixHighOutlinedIcon from "@mui/icons-material/AutoFixHighOutlined";
import { trpc } from "@/lib/trpc/client";
import { fmtMoney, unitTypeLabel } from "./formatters";
import { Metric } from "./Metric";
import { MlsRemarksFooter } from "./MlsRemarksFooter";
import type {
  ListingForAI,
  RentCompBucketUI,
  RentCompsOutputUI,
  RentEstimateEntryUI,
  RentRollEntryUI,
  UnitMixEntryUI,
} from "./types";

function bedsBathsLabel(beds: number | null, baths: number | null): string {
  if (beds == null && baths == null) return "—";
  if (beds === 0) return baths != null ? `Studio · ${baths}BA` : "Studio";
  const b = beds != null ? `${beds}BR` : "?BR";
  const ba = baths != null ? `${baths}BA` : "?BA";
  return `${b} · ${ba}`;
}

function compEstimateFor(
  buckets: RentCompBucketUI[],
  target: { beds: number | null; baths: number | null; sqft?: number | null },
): { rent: number; rationale: string } | null {
  const match = buckets.find(
    (b) => b.beds === target.beds && b.baths === target.baths,
  );
  if (!match || match.count === 0) return null;
  if (target.sqft && match.medianPricePerSqft != null) {
    const rent = Math.round((match.medianPricePerSqft * target.sqft) / 50) * 50;
    const ppsf = match.medianPricePerSqft.toFixed(2);
    return {
      rent,
      rationale: `${match.count} closed SFAR lease${match.count === 1 ? "" : "s"} · median $${ppsf}/sf × ${target.sqft.toLocaleString()} sf`,
    };
  }
  if (match.medianRent != null) {
    return {
      rent: Math.round(match.medianRent / 50) * 50,
      rationale: `${match.count} closed SFAR lease${match.count === 1 ? "" : "s"} · median $${Math.round(match.medianRent).toLocaleString()}/mo`,
    };
  }
  return null;
}

function matchEstimate<
  T extends {
    beds: number | null;
    baths: number | null;
    sqft?: number | null;
    unitLabel?: string | null;
  },
>(
  estimates: T[] | null | undefined,
  target: {
    beds: number | null;
    baths: number | null;
    sqft?: number | null;
    unitLabel?: string | null;
    index: number;
  },
): T | null {
  if (!estimates?.length) return null;
  // 1. Same unit label (most specific)
  if (target.unitLabel) {
    const m = estimates.find(
      (e) => !!e.unitLabel && e.unitLabel === target.unitLabel,
    );
    if (m) return m;
  }
  // 2. Same index (when the agent emitted estimates in lockstep with rent roll)
  const indexed = estimates[target.index];
  if (indexed && indexed.beds === target.beds && indexed.baths === target.baths) {
    return indexed;
  }
  // 3. Same (beds, baths) and sqft within ±15%
  if (target.sqft) {
    const m = estimates.find(
      (e) =>
        e.beds === target.beds &&
        e.baths === target.baths &&
        !!e.sqft &&
        Math.abs(e.sqft - target.sqft!) / target.sqft! < 0.15,
    );
    if (m) return m;
  }
  // 4. First (beds, baths) match
  return (
    estimates.find((e) => e.beds === target.beds && e.baths === target.baths) ??
    null
  );
}

export function RentRollSection({ listing }: { listing: ListingForAI }) {
  const utils = trpc.useUtils();
  const compsQuery = trpc.agents.latestRentComps.useQuery({
    mlsId: listing.mlsId,
  });
  const compsMutation = trpc.agents.rentComps.useMutation({
    onSuccess: () => {
      void utils.agents.latestRentComps.invalidate({ mlsId: listing.mlsId });
    },
  });

  const rentRoll = listing.extractedRentRoll as
    | RentRollEntryUI[]
    | null
    | undefined;
  const unitMix = listing.extractedUnitMix as
    | UnitMixEntryUI[]
    | null
    | undefined;
  const aiRentEstimate = listing.aiRentEstimate as
    | RentEstimateEntryUI[]
    | null
    | undefined;
  const postRenoEstimate = listing.postRenovationRentEstimate as
    | RentEstimateEntryUI[]
    | null
    | undefined;

  const compsOutput =
    (compsQuery.data?.output as RentCompsOutputUI | undefined) ?? null;
  const compsCachedAt = compsQuery.data?.createdAt ?? null;

  const hasUnits = !!rentRoll?.length || !!unitMix?.length;

  // No unit-level data — fall back to a one-line gross/occupancy summary.
  if (!hasUnits) {
    if (
      listing.extractedTotalMonthlyRent == null &&
      listing.extractedOccupancy == null
    ) {
      return null;
    }
    return (
      <Stack direction="row" spacing={3} sx={{ mb: 1.5 }}>
        {listing.extractedTotalMonthlyRent != null && (
          <Metric
            label="Gross monthly rent"
            value={fmtMoney(listing.extractedTotalMonthlyRent)}
          />
        )}
        {listing.extractedOccupancy != null && (
          <Metric
            label="Occupancy"
            value={`${Math.round(listing.extractedOccupancy * 100)}%`}
          />
        )}
      </Stack>
    );
  }

  // Per-apartment rows when rent roll exists; grouped by unit type otherwise.
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

  const enriched = rows.map((row) => {
    let market:
      | { rent: number; rationale: string; source: "gpt" | "comps" }
      | null = null;
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
    return listing.extractedTotalMonthlyRent ?? null;
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
  const hasLatLng = listing.lat != null && listing.lng != null;

  const RentCell = ({
    value,
    rationale,
    italic,
  }: {
    value: number | null;
    rationale?: string;
    italic: boolean;
  }) => {
    const text = value != null ? `$${Math.round(value).toLocaleString()}` : "—";
    const el = (
      <Typography
        variant="body2"
        sx={{
          fontWeight: 600,
          textAlign: "right",
          fontStyle: italic ? "italic" : "normal",
          color: italic ? "text.secondary" : "text.primary",
          cursor: rationale ? "help" : "default",
        }}
      >
        {text}
      </Typography>
    );
    return rationale ? (
      <Tooltip arrow placement="top" title={rationale}>
        {el}
      </Tooltip>
    ) : (
      el
    );
  };

  return (
    <Box sx={{ mb: 1.5 }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ mb: 0.75 }}
        flexWrap="wrap"
        useFlexGap
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: "uppercase",
          }}
        >
          Rent roll · {totalUnitCount}{" "}
          {totalUnitCount === 1 ? "unit" : "units"}
        </Typography>
        {monthlyUpside != null && monthlyUpside > 0 && (
          <Tooltip
            arrow
            placement="top"
            title="Monthly upside = market rent total − current rent total. Source: SFAR closed-lease comps when available, AI estimate as fallback."
          >
            <Chip
              size="small"
              color="success"
              label={`+$${monthlyUpside.toLocaleString()}/mo${
                upsidePercent != null ? ` · +${upsidePercent}%` : ""
              }`}
              sx={{ height: 20, cursor: "help" }}
            />
          </Tooltip>
        )}
      </Stack>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "1fr auto auto auto auto",
          rowGap: 0.5,
          columnGap: 2,
          alignItems: "baseline",
          fontSize: 13,
        }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontWeight: 600 }}
        >
          Unit
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontWeight: 600, textAlign: "right" }}
        >
          Size
        </Typography>
        <Tooltip
          arrow
          placement="top"
          title="Rent disclosed in the listing remarks. Blank when remarks don't list it."
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontWeight: 600, textAlign: "right", cursor: "help" }}
          >
            Current
          </Typography>
        </Tooltip>
        <Tooltip
          arrow
          placement="top"
          title={
            compsBased
              ? "Estimated market rent grounded in SFAR closed-lease comps near this property. Hover any number for the comp count and median $/sf."
              : "AI estimate of market rent at the unit's current condition. Run rent comps below to ground it in real SFAR lease data."
          }
        >
          <Typography
            variant="caption"
            color={compsBased ? "success.main" : "text.secondary"}
            sx={{ fontWeight: 600, textAlign: "right", cursor: "help" }}
          >
            Market{compsBased ? " (comps)" : " (AI)"}
          </Typography>
        </Tooltip>
        <Tooltip
          arrow
          placement="top"
          title="AI estimate of market rent after a moderate cosmetic remodel: kitchens/baths refreshed, paint, modern fixtures."
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontWeight: 600, textAlign: "right", cursor: "help" }}
          >
            Post-remodel
          </Typography>
        </Tooltip>

        {enriched.map((row, key) => (
          <React.Fragment key={key}>
            <Typography variant="body2">
              {row.isGrouped
                ? unitTypeLabel(row.weight, row.beds, row.baths)
                : `${row.unitLabel ? row.unitLabel + " · " : ""}${bedsBathsLabel(row.beds, row.baths)}`}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ textAlign: "right" }}
            >
              {row.sqft ? `${row.sqft.toLocaleString()} sf` : "—"}
            </Typography>
            <RentCell value={row.actualRent} italic={false} />
            <RentCell
              value={row.market?.rent ?? null}
              rationale={row.market?.rationale}
              italic
            />
            <RentCell
              value={row.postReno?.rent ?? null}
              rationale={row.postReno?.rationale}
              italic
            />
          </React.Fragment>
        ))}

        {(currentTotal != null ||
          marketTotal != null ||
          renoTotal != null) && (
          <>
            <Typography variant="body2" sx={{ fontWeight: 700, mt: 0.75 }}>
              Total /mo
            </Typography>
            <Box />
            <Typography
              variant="body2"
              sx={{ fontWeight: 700, mt: 0.75, textAlign: "right" }}
            >
              {currentTotal != null
                ? `$${currentTotal.toLocaleString()}`
                : "—"}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 700,
                mt: 0.75,
                textAlign: "right",
                fontStyle: "italic",
                color: "text.secondary",
              }}
            >
              {marketTotal != null
                ? `$${Math.round(marketTotal).toLocaleString()}`
                : "—"}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 700,
                mt: 0.75,
                textAlign: "right",
                fontStyle: "italic",
                color: "text.secondary",
              }}
            >
              {renoTotal != null
                ? `$${Math.round(renoTotal).toLocaleString()}`
                : "—"}
            </Typography>
          </>
        )}
      </Box>

      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          mt: 1.25,
          pt: 1,
          borderTop: 1,
          borderColor: "divider",
        }}
        flexWrap="wrap"
        useFlexGap
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ flex: 1, minWidth: 200 }}
        >
          {compsOutput
            ? compsOutput.totalComps > 0
              ? `${compsOutput.summary}${compsCachedAt ? ` · cached ${new Date(compsCachedAt).toLocaleDateString()}` : ""}`
              : `${compsOutput.summary}${compsCachedAt ? ` · checked ${new Date(compsCachedAt).toLocaleDateString()}` : ""} — Market column is an AI estimate.`
            : hasLatLng
              ? "Market column is an AI estimate from listing remarks. Run rent comps to ground it in SFAR closed-lease data within 1 mi (last 24 mo)."
              : "Market column is an AI estimate. Rent-comp grounding needs lat/lng on this listing."}
        </Typography>
        {compsMutation.error && (
          <Typography variant="caption" color="error.main">
            {compsMutation.error.message}
          </Typography>
        )}
        <Tooltip
          arrow
          placement="top"
          title={
            hasLatLng
              ? "Pulls SFAR closed leases within 1 mi over the last 24 months and re-medians per (beds, baths) bucket."
              : "Listing has no lat/lng — cannot fetch comps."
          }
        >
          <span>
            <Button
              size="small"
              variant={compsOutput ? "outlined" : "contained"}
              startIcon={
                compsMutation.isPending ? (
                  <CircularProgress size={12} />
                ) : (
                  <AutoFixHighOutlinedIcon fontSize="small" />
                )
              }
              disabled={compsMutation.isPending || !hasLatLng}
              onClick={() => compsMutation.mutate({ mlsId: listing.mlsId })}
            >
              {compsMutation.isPending
                ? "Fetching…"
                : compsOutput
                  ? "Re-estimate"
                  : "Run rent comps"}
            </Button>
          </span>
        </Tooltip>
      </Stack>

      <MlsRemarksFooter privateRemarks={listing.privateRemarks} />
    </Box>
  );
}
