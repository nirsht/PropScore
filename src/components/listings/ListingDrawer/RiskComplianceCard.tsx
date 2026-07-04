import * as React from "react";
import { Box, Button, Chip, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { DataFreshness } from "./DataFreshness";
import { RiskComplianceDetailDialog } from "./RiskComplianceDetailDialog";

export type RiskComplianceCardListing = {
  mlsId: string;
  // DBI Notice of Violations (Socrata nife-svxp)
  codeViolationsOpenCount: number | null;
  codeViolationsRecentCount: number | null;
  codeViolationsLatest: unknown;
  codeViolationsFetchedAt: Date | string | null;
  // DBI Inspection Complaints (Socrata 9c7e-yn3d) — superset of NOVs
  dbiComplaintsOpenCount: number | null;
  dbiComplaintsRecentCount: number | null;
  dbiComplaintsLatest: unknown;
  dbiComplaintsFetchedAt: Date | string | null;
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

type LatestComplaint = {
  complaintNumber?: string | null;
  dateOpened?: string | null;
  status?: string | null;
  description?: string | null;
  address?: string | null;
};

function asLatest(v: unknown): LatestNov | null {
  if (v == null || typeof v !== "object") return null;
  return v as LatestNov;
}

function asLatestComplaint(v: unknown): LatestComplaint | null {
  if (v == null || typeof v !== "object") return null;
  return v as LatestComplaint;
}

function newestDate(
  dates: Array<Date | string | null | undefined>,
): Date | null {
  let best: number | null = null;
  for (const d of dates) {
    if (d == null) continue;
    const t = (d instanceof Date ? d : new Date(d)).getTime();
    if (!Number.isFinite(t)) continue;
    if (best == null || t > best) best = t;
  }
  return best == null ? null : new Date(best);
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
  const [detailKind, setDetailKind] = React.useState<"nov" | "complaint" | null>(null);

  const hasViolations = listing.codeViolationsFetchedAt != null;
  const hasComplaints = listing.dbiComplaintsFetchedAt != null;
  const hasHousing = listing.housingInventoryFetchedAt != null;
  const hasRentControl = listing.rentControlComputedAt != null;
  const softStoryRedFlag =
    listing.softStoryFetchedAt != null && listing.softStoryRedFlag === true;
  const hasAnything =
    hasViolations || hasComplaints || hasHousing || hasRentControl || softStoryRedFlag;

  if (!hasAnything) return null;

  const open = listing.codeViolationsOpenCount ?? 0;
  const recent = listing.codeViolationsRecentCount ?? 0;
  const latest = asLatest(listing.codeViolationsLatest);
  const dualUse = open >= OPEN_NOV_DUAL_USE_THRESHOLD;

  const complaintsOpen = listing.dbiComplaintsOpenCount ?? 0;
  const complaintsRecent = listing.dbiComplaintsRecentCount ?? 0;
  const complaintLatest = asLatestComplaint(listing.dbiComplaintsLatest);

  const netChange = listing.housingNetUnitChange5y ?? 0;
  const lostUnits = netChange < 0;
  const gainedUnits = netChange > 0;

  const rentCtrl = listing.rentControlCovered;

  // Most-recently-fetched timestamp across the four sub-pipelines that feed
  // this card — gives the user a single "Updated …" anchor without one
  // pipeline lagging the others making everything look stale.
  const newest = newestDate([
    listing.codeViolationsFetchedAt,
    listing.dbiComplaintsFetchedAt,
    listing.housingInventoryFetchedAt,
    listing.rentControlComputedAt,
    listing.softStoryFetchedAt,
  ]);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2">Risk &amp; compliance</Typography>
        <Box sx={{ flex: 1 }} />
        <DataFreshness updatedAt={newest} />
      </Stack>

      {/* Row 1 — Code enforcement (dual-use framing) */}
      {hasViolations && (
        <Box sx={{ mb: 1.5 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="caption" color="text.secondary">
              Code enforcement (NOVs)
            </Typography>
            {(open > 0 || recent > 0) && (
              <Button
                size="small"
                sx={{ minWidth: 0, py: 0, lineHeight: 1.2 }}
                onClick={() => setDetailKind("nov")}
              >
                View details
              </Button>
            )}
          </Stack>
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

      {/* Row 1b — DBI inspection complaints (superset of NOVs) */}
      {hasComplaints && (
        <Box sx={{ mb: 1.5 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="caption" color="text.secondary">
              Complaints (DBI)
            </Typography>
            {(complaintsOpen > 0 || complaintsRecent > 0) && (
              <Button
                size="small"
                sx={{ minWidth: 0, py: 0, lineHeight: 1.2 }}
                onClick={() => setDetailKind("complaint")}
              >
                View details
              </Button>
            )}
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mt: 0.5 }}
            flexWrap="wrap"
            useFlexGap
          >
            {complaintsOpen === 0 && complaintsRecent === 0 ? (
              <Chip
                size="small"
                variant="outlined"
                label="No complaints on record"
              />
            ) : (
              <>
                <Tooltip
                  arrow
                  placement="top"
                  title={
                    complaintsOpen === 0
                      ? "No open DBI complaints on this parcel today."
                      : `${complaintsOpen} open DBI complaint${complaintsOpen === 1 ? "" : "s"} on this parcel — habitability/work-without-permit reports the seller may not be disclosing. Cross-reference with NOVs above.`
                  }
                >
                  <Chip
                    size="small"
                    color={complaintsOpen > 0 ? "warning" : "default"}
                    variant={complaintsOpen > 0 ? "filled" : "outlined"}
                    label={`Open complaints: ${complaintsOpen}`}
                  />
                </Tooltip>
                {complaintsRecent > 0 && (
                  <Tooltip
                    arrow
                    placement="top"
                    title={`${complaintsRecent} complaint${complaintsRecent === 1 ? "" : "s"} on this parcel in the last 5 years (any status).`}
                  >
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`5y history: ${complaintsRecent}`}
                    />
                  </Tooltip>
                )}
                {complaintLatest && complaintLatest.dateOpened && (
                  <Tooltip
                    arrow
                    placement="top"
                    title={
                      [
                        complaintLatest.status
                          ? `Status: ${complaintLatest.status}`
                          : null,
                        complaintLatest.description
                          ? complaintLatest.description.length > 200
                            ? `${complaintLatest.description.slice(0, 200)}…`
                            : complaintLatest.description
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" — ") || "Most recent DBI complaint on this parcel."
                    }
                  >
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`Latest: ${fmtDate(complaintLatest.dateOpened)}`}
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

      <RiskComplianceDetailDialog
        open={detailKind != null}
        kind={detailKind ?? "nov"}
        mlsId={listing.mlsId}
        onClose={() => setDetailKind(null)}
      />
    </Paper>
  );
}
