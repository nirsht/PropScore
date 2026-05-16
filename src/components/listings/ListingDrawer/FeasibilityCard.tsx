import { Box, Chip, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { Metric } from "./Metric";

export type FeasibilityCardListing = {
  // Land Use 2023 (DataSF fdfd-xptc)
  landUseCategory: string | null;
  landUseResUnits: number | null;
  landUseResSqft: number | null;
  landUseCommSqft: number | null;
  landUseFetchedAt: Date | string | null;
  // Assessor (already populated)
  assessorConstructionType: string | null;
  assessorYearBuilt: number | null;
  // Permits (DataSF i98e-djp9)
  permitsOwnParcelCount: number | null;
  permitsOwnParcelAduCount: number | null;
  permitsBlockAduRecentCount: number | null;
  permitsRadiusAduRecentCount: number | null;
  latestAduPermitOnBlock: unknown;
  permitsFetchedAt: Date | string | null;
};

const LAND_USE_INFO: Record<
  string,
  { color: "success" | "warning" | "info" | "default"; blurb: string }
> = {
  MIXRES: {
    color: "success",
    blurb:
      "Mixed-use with residential — ground-floor commercial-to-residential conversion is typically allowed.",
  },
  MIXED: {
    color: "info",
    blurb: "Mixed-use without residential — residential additions may need a use change.",
  },
  RESIDENT: {
    color: "default",
    blurb: "Pure residential — straightforward for ADU/reconfiguration within unit count limits.",
  },
  RETAIL: {
    color: "warning",
    blurb: "Retail/entertainment — residential conversion may need a use change.",
  },
  "RETAIL/ENT": {
    color: "warning",
    blurb: "Retail/entertainment — residential conversion may need a use change.",
  },
  PDR: {
    color: "warning",
    blurb: "Production/distribution/repair — residential conversion is constrained.",
  },
  CIE: { color: "default", blurb: "Cultural/institutional/educational." },
  MED: { color: "default", blurb: "Medical." },
  MIPS: { color: "default", blurb: "Office (management/info/professional)." },
  VISITOR: { color: "default", blurb: "Hotel/visitor." },
  VACANT: { color: "info", blurb: "Vacant — fewer constraints, full ground-up potential." },
};

function isWoodFrame(t: string | null): boolean {
  return t != null && /\b(wood\s*frame|type\s*v|^frame$)\b/i.test(t);
}

function fmtPermitDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

type LatestPermit = {
  permitNumber?: string;
  filedDate?: string | null;
  description?: string | null;
  address?: string | null;
};

function asLatest(v: unknown): LatestPermit | null {
  if (v == null || typeof v !== "object") return null;
  return v as LatestPermit;
}

export function FeasibilityCard({ listing }: { listing: FeasibilityCardListing }) {
  const hasLandUse = listing.landUseFetchedAt != null;
  const hasPermits = listing.permitsFetchedAt != null;
  const hasAnything =
    hasLandUse ||
    hasPermits ||
    listing.assessorConstructionType != null ||
    listing.assessorYearBuilt != null;

  if (!hasAnything) return null;

  const cat = listing.landUseCategory?.toUpperCase() ?? null;
  const landUseMeta = cat ? LAND_USE_INFO[cat] : null;

  const wood = isWoodFrame(listing.assessorConstructionType);
  const preSoftStory =
    wood &&
    listing.assessorYearBuilt != null &&
    listing.assessorYearBuilt < 1979;

  const latest = asLatest(listing.latestAduPermitOnBlock);
  const ownParcelAdu = listing.permitsOwnParcelAduCount ?? 0;
  const blockAdu = listing.permitsBlockAduRecentCount ?? 0;
  const radiusAdu = listing.permitsRadiusAduRecentCount ?? 0;
  const noPrecedent = hasPermits && ownParcelAdu === 0 && blockAdu === 0 && radiusAdu === 0;

  const showConstruction =
    listing.assessorConstructionType != null || listing.assessorYearBuilt != null;

  const sectionDivider = { borderTop: 1, borderColor: "divider", pt: 1.5, mt: 1.5 };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
        ADU & reconfiguration feasibility
      </Typography>

      {/* Row 1 — Land Use */}
      {hasLandUse && (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75 }}>
            Land use
          </Typography>
          <Stack direction="row" spacing={2.5} alignItems="flex-end" flexWrap="wrap" useFlexGap>
            {cat ? (
              <Tooltip title={landUseMeta?.blurb ?? cat} arrow placement="top">
                <Chip
                  size="small"
                  color={landUseMeta?.color ?? "default"}
                  label={cat}
                />
              </Tooltip>
            ) : (
              <Chip size="small" variant="outlined" label="Not classified" />
            )}
            {listing.landUseResUnits != null && (
              <Metric label="Res units" value={listing.landUseResUnits.toString()} small />
            )}
            {listing.landUseResSqft != null && listing.landUseResSqft > 0 && (
              <Metric
                label="Res sqft"
                value={listing.landUseResSqft.toLocaleString()}
                small
              />
            )}
            {listing.landUseCommSqft != null && listing.landUseCommSqft > 0 && (
              <Metric
                label="Comm sqft"
                value={listing.landUseCommSqft.toLocaleString()}
                small
              />
            )}
          </Stack>
        </Box>
      )}

      {/* Row 2 — Construction & age */}
      {showConstruction && (
        <Box sx={hasLandUse ? sectionDivider : undefined}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75 }}>
            Construction
          </Typography>
          <Stack direction="row" spacing={2.5} alignItems="flex-end" flexWrap="wrap" useFlexGap>
            {listing.assessorConstructionType && (
              <Tooltip
                arrow
                placement="top"
                title={
                  wood
                    ? "Wood-frame construction is generally easier to reconfigure (non-load-bearing partition walls, simpler permit path)."
                    : "Non-wood (concrete/masonry) construction can constrain interior reconfiguration."
                }
              >
                <Chip
                  size="small"
                  color={wood ? "success" : "default"}
                  variant={wood ? "filled" : "outlined"}
                  label={listing.assessorConstructionType}
                />
              </Tooltip>
            )}
            {listing.assessorYearBuilt != null && (
              <Metric
                label="Year built"
                value={listing.assessorYearBuilt.toString()}
                small
              />
            )}
            {preSoftStory && (
              <Tooltip
                arrow
                placement="top"
                title="Pre-1979 wood-frame buildings may have soft-story risk — check SF's mandatory soft-story retrofit list before a major reconfiguration."
              >
                <Chip size="small" color="warning" variant="outlined" label="Soft-story era" />
              </Tooltip>
            )}
          </Stack>
        </Box>
      )}

      {/* Row 3 — Permit precedent */}
      {hasPermits && (
        <Box sx={hasLandUse || showConstruction ? sectionDivider : undefined}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75 }}>
            ADU / unit-add permit precedent
          </Typography>
          {noPrecedent ? (
            <Typography variant="body2" color="text.secondary">
              No nearby ADU/unit-legalization precedent in the last 5 years.
            </Typography>
          ) : (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Tooltip
                arrow
                placement="top"
                title={`This parcel has ${listing.permitsOwnParcelCount ?? 0} permits on file overall, ${ownParcelAdu} of them ADU/unit-legalization.`}
              >
                <Chip
                  size="small"
                  color={ownParcelAdu > 0 ? "success" : "default"}
                  variant={ownParcelAdu > 0 ? "filled" : "outlined"}
                  label={`This parcel: ${ownParcelAdu} ADU permit${ownParcelAdu === 1 ? "" : "s"}`}
                />
              </Tooltip>

              <Tooltip
                arrow
                placement="top"
                title={
                  latest && blockAdu > 0
                    ? `Most recent: ${latest.address ?? "—"} (${fmtPermitDate(latest.filedDate ?? null)})${latest.description ? ` — ${latest.description.slice(0, 200)}${latest.description.length > 200 ? "…" : ""}` : ""}`
                    : "ADU/unit-legalization permits filed on the same Assessor block in the last 5 years."
                }
              >
                <Chip
                  size="small"
                  color={blockAdu > 0 ? "success" : "default"}
                  variant={blockAdu > 0 ? "filled" : "outlined"}
                  label={`Block (5y): ${blockAdu}`}
                />
              </Tooltip>

              <Tooltip
                arrow
                placement="top"
                title="ADU/unit-legalization permits filed within ~500ft in the last 5 years."
              >
                <Chip
                  size="small"
                  color={radiusAdu > 0 ? "success" : "default"}
                  variant={radiusAdu > 0 ? "filled" : "outlined"}
                  label={`Within 500ft (5y): ${radiusAdu}`}
                />
              </Tooltip>
            </Stack>
          )}
        </Box>
      )}
    </Paper>
  );
}
