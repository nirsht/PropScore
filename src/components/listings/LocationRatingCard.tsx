"use client";

import * as React from "react";
import { Box, LinearProgress, Paper, Stack, Tooltip, Typography } from "@mui/material";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import LocationOnRoundedIcon from "@mui/icons-material/LocationOnRounded";
import DirectionsWalkRoundedIcon from "@mui/icons-material/DirectionsWalkRounded";
import ShieldRoundedIcon from "@mui/icons-material/ShieldRounded";
import { LOCATION_WEIGHTS, locationScore } from "@/server/etl/scoring/location";

type Props = {
  walkScore: number | null;
  neighborhood: string | null;
  neighborhoodScore: number | null;
  /** Pre-computed `Listing.locationScore` from the server. Recomputed
   *  client-side as a fallback if missing (e.g. between a fresh fetch and
   *  the next nightly recompute). */
  total: number | null;
};

/**
 * Tier color for a 0–100 score. Below 40 is red, 40–70 amber, 70+ green.
 * Single source of truth so the total badge and sub-bars feel consistent.
 */
function tierColor(score: number): "error" | "warning" | "success" {
  if (score < 40) return "error";
  if (score < 70) return "warning";
  return "success";
}

export function LocationRatingCard({
  walkScore,
  neighborhood,
  neighborhoodScore,
  total,
}: Props) {
  // If the server hasn't computed locationScore yet (no recompute since the
  // last refresh), do it client-side from the same inputs to avoid a stale
  // empty state on freshly-fetched data.
  const computed = total ?? locationScore({ walkScore, neighborhoodScore });

  const unavailable = computed == null;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <LocationOnRoundedIcon fontSize="small" sx={{ opacity: 0.7 }} />
        <Typography variant="subtitle2">Location rating</Typography>
        <Tooltip
          arrow
          placement="top"
          title={`Total = ${Math.round(LOCATION_WEIGHTS.walk * 100)}% Walk Score + ${Math.round(
            LOCATION_WEIGHTS.neighborhood * 100,
          )}% neighborhood safety. Safety is percentile-ranked across SF from DataSF crime incidents (last 12 months). When one input is missing, the other is used at 100%.`}
        >
          <HelpOutlineRoundedIcon sx={{ fontSize: 16, opacity: 0.55, cursor: "help" }} />
        </Tooltip>
      </Stack>

      {unavailable ? (
        <Typography variant="body2" color="text.secondary">
          Location data unavailable for this listing.
        </Typography>
      ) : (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="center">
          <ScoreBadge score={Math.round(computed!)} />
          <Stack spacing={1} sx={{ flex: 1, minWidth: 0, width: "100%" }}>
            <SubBar
              icon={<DirectionsWalkRoundedIcon fontSize="small" />}
              label="Walk Score"
              score={walkScore}
              weightLabel={`${Math.round(LOCATION_WEIGHTS.walk * 100)}%`}
              missingHint="Add WALKSCORE_API_KEY"
            />
            <SubBar
              icon={<ShieldRoundedIcon fontSize="small" />}
              label={
                neighborhood
                  ? `Neighborhood safety — ${neighborhood}`
                  : "Neighborhood safety"
              }
              score={neighborhoodScore}
              weightLabel={`${Math.round(LOCATION_WEIGHTS.neighborhood * 100)}%`}
              missingHint={neighborhood ? "Crime data not refreshed yet" : "Outside SF polygons"}
            />
          </Stack>
        </Stack>
      )}
    </Paper>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tier = tierColor(score);
  const palette = {
    error: { bg: "rgba(211, 47, 47, 0.12)", fg: "#d32f2f" },
    warning: { bg: "rgba(237, 108, 2, 0.12)", fg: "#ed6c02" },
    success: { bg: "rgba(46, 125, 50, 0.12)", fg: "#2e7d32" },
  }[tier];
  return (
    <Box
      sx={{
        width: 96,
        height: 96,
        borderRadius: 2,
        bgcolor: palette.bg,
        color: palette.fg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Typography variant="h3" sx={{ fontWeight: 700, lineHeight: 1 }}>
        {score}
      </Typography>
      <Typography variant="caption" sx={{ opacity: 0.85 }}>
        out of 100
      </Typography>
    </Box>
  );
}

function SubBar({
  icon,
  label,
  score,
  weightLabel,
  missingHint,
}: {
  icon: React.ReactNode;
  label: string;
  score: number | null | undefined;
  weightLabel: string;
  missingHint: string;
}) {
  const haveScore = typeof score === "number";
  const tier = haveScore ? tierColor(score!) : "warning";
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
        <Box sx={{ opacity: 0.7, display: "inline-flex" }}>{icon}</Box>
        <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {weightLabel}
        </Typography>
        <Typography variant="body2" sx={{ minWidth: 32, textAlign: "right", fontWeight: 600 }}>
          {haveScore ? Math.round(score!) : "—"}
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={haveScore ? Math.min(100, Math.max(0, score!)) : 0}
        color={tier}
        sx={{ height: 6, borderRadius: 1, opacity: haveScore ? 1 : 0.3 }}
      />
      {!haveScore && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
          {missingHint}
        </Typography>
      )}
    </Box>
  );
}
