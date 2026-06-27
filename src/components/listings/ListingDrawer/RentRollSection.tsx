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
import { DataFreshness } from "./DataFreshness";
import { fmtMoney, unitTypeLabel } from "./formatters";
import { Metric } from "./Metric";
import { MlsRemarksFooter } from "./MlsRemarksFooter";
import { RentCell } from "./RentCell";
import { bedsBathsLabel } from "./rentRollEstimators";
import { enrichRentRoll } from "./enrichRentRoll";
import type {
  ListingForAI,
  RentCompsOutputUI,
  RentEstimateEntryUI,
  RentRollEntryUI,
  UnitMixEntryUI,
} from "./types";

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

  const {
    enriched,
    currentTotal,
    marketTotal,
    renoTotal,
    monthlyUpside,
    upsidePercent,
    compsBased,
    totalUnitCount,
  } = enrichRentRoll({
    rentRoll,
    unitMix,
    aiRentEstimate,
    postRenoEstimate,
    compsOutput,
    extractedTotalMonthlyRent: listing.extractedTotalMonthlyRent,
  });

  const hasLatLng = listing.lat != null && listing.lng != null;

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
        {listing.extractedRentRollSource === "email_reply" && (
          <Tooltip
            arrow
            placement="top"
            title={
              listing.extractFetchedAt
                ? `Parsed from listing agent's email reply on ${new Date(listing.extractFetchedAt).toLocaleDateString()}`
                : "Parsed from listing agent's email reply"
            }
          >
            <Chip
              size="small"
              color="success"
              variant="outlined"
              label="From agent email"
              sx={{ height: 20, cursor: "help" }}
            />
          </Tooltip>
        )}
        {listing.extractedRentRollSource === "manual_upload" && (
          <Tooltip
            arrow
            placement="top"
            title={
              listing.extractFetchedAt
                ? `Parsed from a file you uploaded on ${new Date(listing.extractFetchedAt).toLocaleDateString()}`
                : "Parsed from a file you uploaded"
            }
          >
            <Chip
              size="small"
              color="success"
              variant="outlined"
              label="From upload"
              sx={{ height: 20, cursor: "help" }}
            />
          </Tooltip>
        )}
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
        <Box sx={{ flex: 1 }} />
        <DataFreshness updatedAt={listing.extractFetchedAt} label="Extract" />
        <DataFreshness updatedAt={compsCachedAt} label="Comps" />
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
            <Box sx={{ display: "flex", flexDirection: "column" }}>
              <Typography variant="body2">
                {row.isGrouped
                  ? unitTypeLabel(row.weight, row.beds, row.baths)
                  : `${row.unitLabel ? row.unitLabel + " · " : ""}${bedsBathsLabel(row.beds, row.baths)}`}
              </Typography>
              {row.moveInDate && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ lineHeight: 1.1, fontSize: 11 }}
                >
                  Tenant since {row.moveInDate}
                </Typography>
              )}
            </Box>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ textAlign: "right" }}
            >
              {row.sqft ? `${row.sqft.toLocaleString()} sf` : "—"}
            </Typography>
            <RentCell
              value={row.actualRent}
              italic={false}
              placeholder={row.actualRent == null ? "Vacant" : undefined}
            />
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
