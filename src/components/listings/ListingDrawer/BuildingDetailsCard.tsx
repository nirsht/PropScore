import * as React from "react";
import { Alert, Box, Paper, Stack, Typography } from "@mui/material";
import { isDiverging, rowDiverges } from "@/lib/diff";
import { AIEvidenceTrail } from "./AIEvidenceTrail";
import { deriveRatio, fmtMoney, fmtNum } from "./formatters";
import type { ListingForDetails } from "./types";

// ============================================================================
// Building Details — replaces the old headline metrics + source-comparison.
// 3-column grid: MLS / Assessor / AI, with diverging rows highlighted.
// Rooms calc: MLS column = beds + units*2 (assessor counts kitchen+living per
// unit, so this is the MLS-equivalent room count); Assessor column = raw.
// ============================================================================
export function BuildingDetailsCard({ listing }: { listing: ListingForDetails }) {
  const fmt = (n: number | null | undefined) => fmtNum(n);
  const fmtFloat = (n: number | null | undefined) =>
    n == null ? "—" : (Math.round(n * 10) / 10).toString();
  const fmtMoneyCell = (n: number | null | undefined) => fmtMoney(n);

  // Sum unit-mix counts when present.
  const aiUnits = (() => {
    const um = listing.extractedUnitMix as Array<{ count?: number }> | null | undefined;
    if (!Array.isArray(um) || um.length === 0) return null;
    const total = um.reduce((s, e) => s + (e.count ?? 0), 0);
    return total > 0 ? total : null;
  })();

  // Rooms: MLS-equivalent computed from MLS beds + units (assessor counts
  // kitchen+living as 2 extra rooms per unit, so to compare we add units*2 to
  // MLS beds and compare against raw assessorRooms).
  const mlsRoomsComputed =
    listing.beds != null && listing.units != null
      ? listing.beds + listing.units * 2
      : null;

  type Row = {
    label: string;
    mls: number | null;
    assessor: number | null;
    ai: number | null;
    fmt?: (n: number | null | undefined) => string;
  };

  const pricePerSqftMls = deriveRatio(listing.price, listing.sqft);
  const pricePerSqftAssessor = deriveRatio(listing.price, listing.assessorBuildingSqft);

  const rows: Row[] = [
    { label: "Sqft", mls: listing.sqft, assessor: listing.assessorBuildingSqft, ai: null, fmt },
    { label: "Lot Sqft", mls: listing.lotSizeSqft, assessor: listing.assessorLotSqft, ai: null, fmt },
    {
      label: "Units",
      mls: listing.units,
      assessor: listing.assessorUnits,
      ai: aiUnits,
      fmt,
    },
    { label: "Beds", mls: listing.beds, assessor: listing.assessorBedrooms, ai: null, fmt },
    {
      label: "Baths",
      mls: listing.baths,
      assessor: listing.assessorBathrooms,
      ai: null,
      fmt: fmtFloat,
    },
    {
      label: "Rooms",
      mls: mlsRoomsComputed,
      assessor: listing.assessorRooms,
      ai: null,
      fmt,
    },
    {
      label: "Year built",
      mls: listing.yearBuilt,
      assessor: listing.assessorYearBuilt,
      ai: null,
      fmt: (n) => (n == null ? "—" : String(n)),
    },
    {
      label: "Stories",
      mls: listing.stories,
      assessor: listing.assessorStories,
      ai: listing.aiStories,
      fmt,
    },
    {
      label: "Lot value",
      mls: null,
      assessor: listing.assessorLandValue,
      ai: null,
      fmt: fmtMoneyCell,
    },
    {
      label: "Building value",
      mls: null,
      assessor: listing.assessorBuildingValue,
      ai: null,
      fmt: fmtMoneyCell,
    },
    {
      label: "$/Sqft",
      mls: pricePerSqftMls,
      assessor: pricePerSqftAssessor,
      ai: null,
      fmt: fmtMoneyCell,
    },
  ];

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2">Building details</Typography>
        <Typography variant="caption" color="text.secondary">
          MLS · Assessor · AI — diffs &gt; 5% highlighted
        </Typography>
      </Stack>
      {!listing.assessorFetchedAt && (
        <Alert severity="info" sx={{ mb: 1.5, py: 0.5 }}>
          SF Assessor record not yet fetched. Run{" "}
          <code>pnpm enrich:sfpim</code> to populate.
        </Alert>
      )}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "1.1fr 1fr 1fr 1fr",
          rowGap: 0.5,
          columnGap: 1,
          alignItems: "center",
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          Field
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          MLS
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          Assessor
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          AI
        </Typography>
        {rows.map((r) => {
          const formatter = r.fmt ?? ((n: number | null | undefined) => fmtNum(n));
          // Row is highlighted when any *populated* pair diverges.
          const diverge = rowDiverges([r.mls, r.assessor, r.ai]);
          // Per-cell tone for sqft/units/lot (the "bigger is better" signals).
          const isUpsideRow =
            r.label === "Sqft" ||
            r.label === "Lot Sqft" ||
            r.label === "Units" ||
            r.label === "Stories";
          const assessorBeatsMls =
            isUpsideRow &&
            isDiverging(r.mls, r.assessor) &&
            (r.assessor as number) > (r.mls as number);
          const assessorTrailsMls =
            isUpsideRow &&
            isDiverging(r.mls, r.assessor) &&
            (r.assessor as number) < (r.mls as number);
          return (
            <React.Fragment key={r.label}>
              <Typography variant="body2" color="text.secondary">
                {r.label}
              </Typography>
              <CompareCell value={r.mls} fmt={formatter} highlight={diverge} />
              <CompareCell
                value={r.assessor}
                fmt={formatter}
                highlight={diverge}
                tone={
                  assessorBeatsMls
                    ? "positive"
                    : assessorTrailsMls
                      ? "negative"
                      : undefined
                }
              />
              <CompareCell value={r.ai} fmt={formatter} highlight={diverge} />
            </React.Fragment>
          );
        })}
      </Box>
      <AIEvidenceTrail enrichments={listing.enrichments} />
    </Paper>
  );
}

function CompareCell({
  value,
  fmt,
  highlight,
  tone,
}: {
  value: number | null;
  fmt: (n: number | null | undefined) => string;
  highlight: boolean;
  tone?: "positive" | "negative";
}) {
  const sx: Record<string, unknown> = {
    fontWeight: highlight ? 600 : 500,
    px: highlight ? 0.75 : 0,
    py: highlight ? 0.25 : 0,
    borderRadius: 0.5,
    display: "inline-block",
  };
  if (tone === "positive") {
    sx.bgcolor = "success.light";
    sx.color = "success.contrastText";
  } else if (tone === "negative") {
    sx.bgcolor = "error.light";
    sx.color = "error.contrastText";
  } else if (highlight) {
    sx.bgcolor = "warning.light";
    sx.color = "warning.contrastText";
  } else {
    sx.bgcolor = "transparent";
    sx.color = "text.primary";
  }
  return (
    <Typography variant="body2" sx={sx}>
      {value == null ? "—" : fmt(value)}
    </Typography>
  );
}
