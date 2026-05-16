import { Box, Chip, Paper, Stack, Tooltip, Typography } from "@mui/material";

export type RiskComplianceCardListing = {
  // DBI Notice of Violations (Socrata nife-svxp)
  codeViolationsOpenCount: number | null;
  codeViolationsRecentCount: number | null;
  codeViolationsLatest: unknown;
  codeViolationsFetchedAt: Date | string | null;
  // Housing Inventory (Socrata 6v9b-p59r)
  housingNetUnitChange5y: number | null;
  housingInventoryFetchedAt: Date | string | null;
  // Derived (no fetch)
  rentControlCovered: boolean | null;
  rentControlComputedAt: Date | string | null;
  // SF mandatory soft-story retrofit program (Socrata jwdp-cqyc).
  // `softStoryRedFlag === true` only when on the list AND not yet retrofitted.
  softStoryRedFlag: boolean | null;
  softStoryTier: number | null;
  softStoryStatus: string | null;
  softStoryFetchedAt: Date | string | null;
};

type LatestNov = {
  complaintNumber?: string | null;
  dateFiled?: string | null;
  status?: string | null;
  description?: string | null;
  address?: string | null;
};

function asLatest(v: unknown): LatestNov | null {
  if (v == null || typeof v !== "object") return null;
  return v as LatestNov;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

// Threshold above which a parcel reads as "lots of open NOVs" — used to
// flip the dual-use chip pair from neutral to warning + opportunity.
const OPEN_NOV_DUAL_USE_THRESHOLD = 3;

export function RiskComplianceCard({
  listing,
}: {
  listing: RiskComplianceCardListing;
}) {
  const hasViolations = listing.codeViolationsFetchedAt != null;
  const hasHousing = listing.housingInventoryFetchedAt != null;
  const hasRentControl = listing.rentControlComputedAt != null;
  const softStoryRedFlag =
    listing.softStoryFetchedAt != null && listing.softStoryRedFlag === true;
  const hasAnything =
    hasViolations || hasHousing || hasRentControl || softStoryRedFlag;

  if (!hasAnything) return null;

  const open = listing.codeViolationsOpenCount ?? 0;
  const recent = listing.codeViolationsRecentCount ?? 0;
  const latest = asLatest(listing.codeViolationsLatest);
  const dualUse = open >= OPEN_NOV_DUAL_USE_THRESHOLD;

  const netChange = listing.housingNetUnitChange5y ?? 0;
  const lostUnits = netChange < 0;
  const gainedUnits = netChange > 0;

  const rentCtrl = listing.rentControlCovered;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2">Risk &amp; compliance</Typography>
      </Stack>

      {/* Row 1 — Code enforcement (dual-use framing) */}
      {hasViolations && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            Code enforcement (NOVs)
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mt: 0.5 }}
            flexWrap="wrap"
            useFlexGap
          >
            {open === 0 && recent === 0 ? (
              <Chip size="small" variant="outlined" label="No NOVs on record" />
            ) : (
              <>
                <Tooltip
                  arrow
                  placement="top"
                  title={
                    open === 0
                      ? "No open Notice of Violations on this parcel today."
                      : `${open} open NOV${open === 1 ? "" : "s"} on this parcel — operational/headache risk to factor into the rehab budget.`
                  }
                >
                  <Chip
                    size="small"
                    color={open > 0 ? "warning" : "default"}
                    variant={open > 0 ? "filled" : "outlined"}
                    label={`Open NOVs: ${open}`}
                  />
                </Tooltip>
                {dualUse && (
                  <Tooltip
                    arrow
                    placement="top"
                    title="Lots of open violations can also be a distressed-asset signal — leverage in price negotiation if the seller is motivated."
                  >
                    <Chip
                      size="small"
                      color="success"
                      variant="outlined"
                      label="Distressed lever"
                    />
                  </Tooltip>
                )}
                {recent > 0 && (
                  <Tooltip
                    arrow
                    placement="top"
                    title={`${recent} NOV${recent === 1 ? "" : "s"} filed on this parcel in the last 5 years (any status).`}
                  >
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`5y history: ${recent}`}
                    />
                  </Tooltip>
                )}
                {latest && latest.dateFiled && (
                  <Tooltip
                    arrow
                    placement="top"
                    title={
                      [
                        latest.status ? `Status: ${latest.status}` : null,
                        latest.description
                          ? latest.description.length > 200
                            ? `${latest.description.slice(0, 200)}…`
                            : latest.description
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" — ") || "Most recent NOV on this parcel."
                    }
                  >
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`Latest: ${fmtDate(latest.dateFiled)}`}
                    />
                  </Tooltip>
                )}
              </>
            )}
          </Stack>
        </Box>
      )}

      {/* Row 2 — Housing inventory (net unit change) */}
      {hasHousing && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            Unit history (5y net change)
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mt: 0.5 }}
            flexWrap="wrap"
            useFlexGap
          >
            {netChange === 0 ? (
              <Chip size="small" variant="outlined" label="No reported changes" />
            ) : (
              <Tooltip
                arrow
                placement="top"
                title={
                  lostUnits
                    ? "Net unit loss on this parcel in the last 5 years — can cap rental upside and may trigger replacement-unit rules under the SF Housing Element."
                    : "Net unit gain on this parcel in the last 5 years — confirmed precedent for adding units here."
                }
              >
                <Chip
                  size="small"
                  color={lostUnits ? "warning" : gainedUnits ? "success" : "default"}
                  variant={netChange !== 0 ? "filled" : "outlined"}
                  label={`${netChange > 0 ? "+" : ""}${netChange} unit${Math.abs(netChange) === 1 ? "" : "s"}`}
                />
              </Tooltip>
            )}
          </Stack>
        </Box>
      )}

      {/* Row 3 — Rent control coverage (derived) */}
      {hasRentControl && rentCtrl != null && (
        <Box>
          <Typography variant="caption" color="text.secondary">
            Rent control exposure
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mt: 0.5 }}
            flexWrap="wrap"
            useFlexGap
          >
            <Tooltip
              arrow
              placement="top"
              title={
                rentCtrl
                  ? "Multi-unit residential built before 1979-06-13 — likely covered by SF rent ordinance (Ch. 37). Existing rents may be below market and capped on annual increases. Verify directly with SF Rent Board before underwriting rent growth."
                  : "Likely exempt from SF rent ordinance — single-family, post-1979, or not classified residential. Costa-Hawkins decontrol may still apply on vacancy; confirm before underwriting."
              }
            >
              <Chip
                size="small"
                color={rentCtrl ? "info" : "default"}
                variant={rentCtrl ? "filled" : "outlined"}
                label={rentCtrl ? "Likely rent-controlled" : "Likely exempt"}
              />
            </Tooltip>
          </Stack>
        </Box>
      )}

      {/* Row 4 — Soft-story seismic risk (red flag only) */}
      {softStoryRedFlag && (
        <Box sx={{ mt: hasRentControl ? 1.5 : 0 }}>
          <Typography variant="caption" color="text.secondary">
            Seismic risk (soft story)
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mt: 0.5 }}
            flexWrap="wrap"
            useFlexGap
          >
            <Tooltip
              arrow
              placement="top"
              title={
                `Listed on SF's mandatory soft-story retrofit program${
                  listing.softStoryStatus ? ` — status: ${listing.softStoryStatus}` : ""
                }. Soft-story buildings have a weak first story and are at elevated risk of damage in a quake. Verify outstanding retrofit obligation and budget before underwriting.`
              }
            >
              <Chip
                size="small"
                color="warning"
                variant="filled"
                label={
                  listing.softStoryTier != null
                    ? `Soft story (Tier ${listing.softStoryTier})`
                    : "Soft story"
                }
              />
            </Tooltip>
          </Stack>
        </Box>
      )}
    </Paper>
  );
}
