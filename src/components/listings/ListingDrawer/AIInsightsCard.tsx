import { Box, Chip, Paper, Stack, Tooltip, Typography } from "@mui/material";
import type { RenovationLevel } from "@prisma/client";
import { Metric } from "./Metric";
import { RentRollSection } from "./RentRollSection";
import { EmailHistorySection } from "./EmailHistorySection";
import type { ListingForAI } from "./types";

export const RENO_COLOR: Record<RenovationLevel, "error" | "warning" | "info" | "success"> = {
  DISTRESSED: "error",
  ORIGINAL: "warning",
  UPDATED: "info",
  RENOVATED: "success",
};

export const RENO_LABEL: Record<RenovationLevel, string> = {
  DISTRESSED: "Distressed",
  ORIGINAL: "Original",
  UPDATED: "Updated",
  RENOVATED: "Renovated",
};

// Two parallel 0–100 ADU reads emitted by the listing-extract agent — see
// `valueAdd.ts`. Bucketed into High/Medium/Low (≥70 / 40–69 / <40) for the
// chip label; the rationale shows on hover.
type AduLevel = { label: "High" | "Medium" | "Low"; color: "success" | "warning" | "default" };

function aduLevel(score: number): AduLevel {
  if (score >= 70) return { label: "High", color: "success" };
  if (score >= 40) return { label: "Medium", color: "warning" };
  return { label: "Low", color: "default" };
}

// ============================================================================
// AI Insights — merges photo-vision facts (renovation, stories, basement,
// penthouse) with text-extracted facts (unit mix, rent roll, capex, ADU).
// Replaces the old "Building analysis (AI vision)" card.
// ============================================================================
export function AIInsightsCard({ listing }: { listing: ListingForAI }) {
  const unitMix = listing.extractedUnitMix as
    | Array<{ count: number; beds: number | null; baths: number | null }>
    | null
    | undefined;
  const rentRoll = listing.extractedRentRoll as
    | Array<{ rent: number; beds: number | null; baths: number | null }>
    | null
    | undefined;
  const capex = listing.recentCapex as string[] | null | undefined;
  const detachedScore = listing.detachedAduScore;
  const convertedScore = listing.convertedAduScore;
  const hasAdu = detachedScore != null || convertedScore != null;

  const hasAnyExtract =
    !!unitMix?.length ||
    !!rentRoll?.length ||
    listing.extractedTotalMonthlyRent != null ||
    listing.extractedOccupancy != null ||
    !!capex?.length ||
    hasAdu;
  const hasVision = !!listing.visionFetchedAt;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
        <Typography variant="subtitle2">AI insights</Typography>
        {listing.renovationLevel && (
          <Chip
            size="small"
            color={RENO_COLOR[listing.renovationLevel]}
            label={RENO_LABEL[listing.renovationLevel]}
          />
        )}
      </Stack>

      {!hasVision && !hasAnyExtract && (
        <Typography variant="body2" color="text.secondary">
          No AI analysis available for this listing yet.
        </Typography>
      )}

      <Stack direction="row" spacing={2} alignItems="flex-start" sx={{ mb: hasAnyExtract ? 1.5 : 0 }}>
        {listing.aiBestPhotoUrl && (
          <Box
            component="img"
            src={listing.aiBestPhotoUrl}
            alt="Best exterior photo"
            loading="lazy"
            sx={{
              width: 180,
              height: 120,
              objectFit: "cover",
              borderRadius: 1,
              border: 1,
              borderColor: "divider",
              flexShrink: 0,
            }}
          />
        )}
        {hasVision && (
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
            <Metric label="Stories (AI)" value={listing.aiStories?.toString() ?? "—"} />
            <Metric
              label="Basement"
              value={
                listing.aiHasBasement == null
                  ? "—"
                  : listing.aiHasBasement
                    ? "Yes"
                    : "No"
              }
            />
            <Metric
              label="Penthouse"
              value={
                listing.aiHasPenthouse == null
                  ? "—"
                  : listing.aiHasPenthouse
                    ? "Yes"
                    : "No"
              }
            />
            <Metric
              label="Reno confidence"
              value={
                listing.renovationConfidence == null
                  ? "—"
                  : `${Math.round(listing.renovationConfidence * 100)}%`
              }
            />
          </Stack>
        )}
      </Stack>

      <Box sx={{ mb: 1.5 }}>
        <Typography variant="caption" color="text.secondary">
          ADU potential
        </Typography>
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
          {detachedScore == null && convertedScore == null ? (
            <Typography variant="body2" color="text.secondary">
              Not yet analyzed — click Enrich to populate.
            </Typography>
          ) : (
            <>
              {detachedScore != null && (
                <Tooltip
                  title={listing.detachedAduRationale ?? ""}
                  arrow
                  placement="top"
                  disableHoverListener={!listing.detachedAduRationale}
                >
                  <Chip
                    size="small"
                    color={aduLevel(detachedScore).color}
                    label={`Detached ADU · ${aduLevel(detachedScore).label}`}
                  />
                </Tooltip>
              )}
              {convertedScore != null && (
                <Tooltip
                  title={listing.convertedAduRationale ?? ""}
                  arrow
                  placement="top"
                  disableHoverListener={!listing.convertedAduRationale}
                >
                  <Chip
                    size="small"
                    color={aduLevel(convertedScore).color}
                    label={`Converted ADU · ${aduLevel(convertedScore).label}${
                      listing.convertedAduSource ? ` · ${listing.convertedAduSource}` : ""
                    }`}
                  />
                </Tooltip>
              )}
            </>
          )}
        </Stack>
      </Box>

      <RentRollSection listing={listing} />

      <Box sx={{ mb: 1.5 }}>
        <EmailHistorySection listingMlsId={listing.mlsId} />
      </Box>

      {!!capex?.length && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            Recent capex
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
            {capex.map((c, i) => (
              <Chip key={i} size="small" variant="outlined" label={c} />
            ))}
          </Stack>
        </Box>
      )}

    </Paper>
  );
}
