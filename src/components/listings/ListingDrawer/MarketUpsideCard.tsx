"use client";

import * as React from "react";
import {
  Box,
  Chip,
  Divider,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
import { DataFreshness } from "./DataFreshness";
import { fmtMoney } from "./formatters";

const MIN_SAMPLE = 5;

type NeighborhoodComps = {
  name?: string | null;
  medianAssessedPerSqft: number | null;
  medianAssessedPerUnit: number | null;
  compSampleSize: number | null;
} | null;

type Props = {
  marketUpsideScore: number | null;
  // Assessment delta inputs
  assessorBuildingValue: number | null;
  assessorLandValue: number | null;
  assessorBuildingSqft: number | null;
  sqft: number | null;
  assessorUnits: number | null;
  units: number | null;
  neighborhood: string | null;
  comps: NeighborhoodComps;
  compsUpdatedAt: Date | string | null;
  // Zoning inputs
  zoningDistrict: string | null;
  zoningMaxUnits: number | null;
  // Rental upside inputs — disclosed in-place vs market gross rent (monthly).
  inPlaceMonthlyRent: number | null;
  marketMonthlyRent: number | null;
};

function tierColor(score: number): "error" | "warning" | "success" {
  if (score < 40) return "error";
  if (score < 70) return "warning";
  return "success";
}

export function MarketUpsideCard(props: Props) {
  const {
    marketUpsideScore,
    assessorBuildingValue,
    assessorLandValue,
    assessorBuildingSqft,
    sqft,
    assessorUnits,
    units,
    neighborhood,
    comps,
    compsUpdatedAt,
    zoningDistrict,
    zoningMaxUnits,
    inPlaceMonthlyRent,
    marketMonthlyRent,
  } = props;

  const rentGapPct =
    inPlaceMonthlyRent != null &&
    inPlaceMonthlyRent > 0 &&
    marketMonthlyRent != null &&
    marketMonthlyRent > inPlaceMonthlyRent
      ? Math.round(
          ((marketMonthlyRent - inPlaceMonthlyRent) / inPlaceMonthlyRent) * 100,
        )
      : null;

  const assessedTotal =
    (assessorBuildingValue ?? 0) + (assessorLandValue ?? 0) || null;
  const sampleSize = comps?.compSampleSize ?? 0;
  const haveSample = sampleSize >= MIN_SAMPLE;

  // Pick the same basis the scoring module would have picked (sqft preferred).
  const sqftBasis = assessorBuildingSqft ?? sqft ?? null;
  const unitBasis = assessorUnits ?? units ?? null;

  const expectedFromSqft =
    haveSample &&
    sqftBasis != null &&
    sqftBasis > 0 &&
    comps?.medianAssessedPerSqft != null &&
    comps.medianAssessedPerSqft > 0
      ? comps.medianAssessedPerSqft * sqftBasis
      : null;
  const expectedFromUnit =
    haveSample &&
    unitBasis != null &&
    unitBasis > 0 &&
    comps?.medianAssessedPerUnit != null &&
    comps.medianAssessedPerUnit > 0
      ? comps.medianAssessedPerUnit * unitBasis
      : null;
  const expected = expectedFromSqft ?? expectedFromUnit;
  const basis: "sqft" | "unit" | null = expectedFromSqft
    ? "sqft"
    : expectedFromUnit
      ? "unit"
      : null;

  const deltaPct =
    assessedTotal != null && expected != null && expected > 0
      ? Math.round(((expected - assessedTotal) / expected) * 100)
      : null;

  const currentUnits = unitBasis;
  const zoningSlack =
    zoningMaxUnits != null && zoningMaxUnits > 0 && currentUnits != null
      ? `${currentUnits} / ${zoningMaxUnits}`
      : null;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <TrendingUpRoundedIcon fontSize="small" sx={{ opacity: 0.7 }} />
        <Typography variant="subtitle2">Market upside</Typography>
        <Tooltip
          arrow
          placement="top"
          title="Combined signal: how far the parcel's assessed value sits below neighborhood comps, how many more units the lot's base zoning would allow, and the listing's disclosed in-place→market rent spread. Computed but not yet folded into the value-add weighted average — surfacing only."
        >
          <HelpOutlineRoundedIcon
            sx={{ fontSize: 16, opacity: 0.55, cursor: "help" }}
          />
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <DataFreshness updatedAt={compsUpdatedAt} label="Comps" />
        <ScoreChip score={marketUpsideScore} />
      </Stack>

      <Stack spacing={1.5} divider={<Divider flexItem />}>
        <Row
          label="Assessment vs. neighborhood"
          empty={
            !haveSample
              ? `Need ${MIN_SAMPLE}+ comparable listings${neighborhood ? ` in ${neighborhood}` : ""} (have ${sampleSize}).`
              : assessedTotal == null
                ? "Assessor record not yet matched."
                : expected == null
                  ? "Insufficient basis (sqft / units)."
                  : null
          }
        >
          {assessedTotal != null && expected != null && (
            <>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  Assessed total
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {fmtMoney(assessedTotal)}
                </Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  Neighborhood expected ({basis === "sqft" ? "$/sqft" : "$/unit"})
                </Typography>
                <Typography variant="body2">{fmtMoney(expected)}</Typography>
              </Stack>
              {deltaPct != null && (
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">
                    Delta
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 700,
                      color:
                        deltaPct > 0
                          ? "success.main"
                          : deltaPct < 0
                            ? "error.main"
                            : "text.primary",
                    }}
                  >
                    {deltaPct > 0 ? `${deltaPct}% below` : `${Math.abs(deltaPct)}% above`}
                  </Typography>
                </Stack>
              )}
            </>
          )}
        </Row>

        <Row
          label="Zoning slack"
          empty={
            zoningDistrict == null
              ? "No zoning match — listing outside SF or polygon refresh pending."
              : zoningMaxUnits == null
                ? `District ${zoningDistrict} — no static unit cap.`
                : currentUnits == null
                  ? "Current unit count unknown."
                  : null
          }
        >
          {zoningDistrict && zoningMaxUnits != null && currentUnits != null && (
            <>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2" color="text.secondary">
                  Current / max units
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {zoningSlack}
                  </Typography>
                  <Chip size="small" label={zoningDistrict} variant="outlined" />
                </Stack>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Base zoning only — state-law overlays (SB-9, AB-2011, density
                bonuses) not applied.
              </Typography>
            </>
          )}
        </Row>

        <Row
          label="Rental upside"
          empty={
            inPlaceMonthlyRent == null || marketMonthlyRent == null
              ? "Listing doesn't disclose both in-place and market rent."
              : rentGapPct == null
                ? "Disclosed market rent doesn't exceed in-place rent."
                : null
          }
        >
          {rentGapPct != null && (
            <>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  In-place → market (mo)
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {fmtMoney(inPlaceMonthlyRent!)} → {fmtMoney(marketMonthlyRent!)}
                </Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  Disclosed upside
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 700, color: "success.main" }}
                >
                  +{rentGapPct}%
                </Typography>
              </Stack>
            </>
          )}
        </Row>
      </Stack>
    </Paper>
  );
}

function ScoreChip({ score }: { score: number | null }) {
  if (score == null) {
    return (
      <Chip size="small" label="—" variant="outlined" sx={{ fontWeight: 600 }} />
    );
  }
  const tier = tierColor(score);
  const palette = {
    error: { bg: "rgba(211, 47, 47, 0.12)", fg: "#d32f2f" },
    warning: { bg: "rgba(237, 108, 2, 0.12)", fg: "#ed6c02" },
    success: { bg: "rgba(46, 125, 50, 0.12)", fg: "#2e7d32" },
  }[tier];
  return (
    <Box
      sx={{
        px: 1.25,
        py: 0.25,
        borderRadius: 1,
        bgcolor: palette.bg,
        color: palette.fg,
        fontWeight: 700,
        fontSize: 13,
      }}
    >
      {Math.round(score)}
    </Box>
  );
}

function Row({
  label,
  empty,
  children,
}: {
  label: string;
  empty: string | null;
  children: React.ReactNode;
}) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="overline" sx={{ lineHeight: 1.2, opacity: 0.7 }}>
        {label}
      </Typography>
      {empty ? (
        <Typography variant="body2" color="text.secondary">
          {empty}
        </Typography>
      ) : (
        children
      )}
    </Stack>
  );
}
