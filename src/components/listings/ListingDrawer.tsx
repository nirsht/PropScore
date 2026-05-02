"use client";

import * as React from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Link as MuiLink,
  Paper,
  Skeleton,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import LocationOnRoundedIcon from "@mui/icons-material/LocationOnRounded";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import StreetviewRoundedIcon from "@mui/icons-material/StreetviewRounded";
import PublicRoundedIcon from "@mui/icons-material/PublicRounded";
import LayersRoundedIcon from "@mui/icons-material/LayersRounded";
import WaterDamageRoundedIcon from "@mui/icons-material/WaterDamageRounded";
import HomeWorkRoundedIcon from "@mui/icons-material/HomeWorkRounded";
import DirectionsWalkRoundedIcon from "@mui/icons-material/DirectionsWalkRounded";
import StraightenRoundedIcon from "@mui/icons-material/StraightenRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import EmailRoundedIcon from "@mui/icons-material/EmailRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import AutoFixHighOutlinedIcon from "@mui/icons-material/AutoFixHighOutlined";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
} from "recharts";
import { trpc } from "@/lib/trpc/client";
import { EnrichWithAIButton } from "./EnrichWithAIButton";
import { PhotoLightbox } from "./PhotoLightbox";
import { MeasureLotModal } from "./MeasureLotModal";
import { isDiverging, rowDiverges } from "@/lib/diff";
import type { RenovationLevel } from "@prisma/client";

const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;
const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString() : "—";
const fmtNum = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString();

/**
 * Spell out a unit-mix entry the way an investor reads it — no MLS
 * shorthand. "4 x 3 Bedroom + 2 Bathroom" rather than "4× 3BR/2BA".
 */
function unitTypeLabel(
  count: number,
  beds: number | null,
  baths: number | null,
): string {
  if (beds == null && baths == null) {
    return `${count} ${count === 1 ? "unit" : "units"}`;
  }
  const parts: string[] = [];
  if (beds === 0) {
    parts.push("Studio");
  } else if (beds != null) {
    parts.push(`${beds} Bedroom`);
  }
  if (baths != null) {
    parts.push(`${baths} Bathroom`);
  }
  return `${count} x ${parts.join(" + ")}`;
}

type Props = {
  mlsId: string | null;
  onClose: () => void;
};

export function ListingDrawer({ mlsId, onClose }: Props) {
  const open = !!mlsId;
  const listingQuery = trpc.listings.getById.useQuery(
    { mlsId: mlsId ?? "" },
    { enabled: open },
  );
  const photosQuery = trpc.listings.getPhotos.useQuery(
    { mlsId: mlsId ?? "" },
    { enabled: open, staleTime: 5 * 60_000 },
  );
  const utils = trpc.useUtils();
  const refreshPhotos = React.useCallback(() => {
    if (!mlsId) return;
    void utils.listings.getPhotos.fetch({ mlsId, refresh: true });
  }, [mlsId, utils]);

  const photoItems = photosQuery.data?.items ?? [];
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);
  const openPhoto = React.useCallback((idx: number) => setLightboxIndex(idx), []);
  const closeLightbox = React.useCallback(() => setLightboxIndex(null), []);

  const [measureOpen, setMeasureOpen] = React.useState(false);

  const listing = listingQuery.data;
  const score = listing?.score;
  const raw = (listing?.raw ?? {}) as Record<string, unknown>;

  const lat = listing?.lat ?? null;
  const lng = listing?.lng ?? null;
  const address = listing?.address ?? "";
  const fullAddress = [
    listing?.address,
    listing?.city,
    listing?.state,
    listing?.postalCode,
  ]
    .filter(Boolean)
    .join(", ");

  const agentName = strField(raw.ListAgentFullName);
  const agentPhone =
    strField(raw.ListAgentDirectPhone) ?? strField(raw.ListAgentOfficePhone);
  const agentEmail = strField(raw.ListAgentEmail);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: { sx: { width: { xs: "100%", md: 720 }, bgcolor: "background.default" } },
      }}
    >
      {!listing && listingQuery.isLoading && (
        <Box sx={{ p: 4 }}>
          <Skeleton variant="rectangular" height={40} sx={{ mb: 2 }} />
          <Skeleton variant="rectangular" height={240} sx={{ mb: 2 }} />
          <Skeleton variant="rectangular" height={120} sx={{ mb: 2 }} />
          <Skeleton variant="rectangular" height={300} />
        </Box>
      )}

      {listingQuery.isError && (
        <Box sx={{ p: 3 }}>
          <Alert severity="error">Failed to load listing.</Alert>
        </Box>
      )}

      {listing && (
        <Stack spacing={2.5} sx={{ p: 3 }}>
          {/* Header */}
          <Stack direction="row" alignItems="flex-start" spacing={1}>
            <Box sx={{ flex: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                <Chip
                  size="small"
                  color={listing.status === "Active" ? "success" : "default"}
                  label={listing.status}
                />
                <Chip size="small" variant="outlined" label={listing.propertyType} />
              </Stack>
              <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
                {address}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {[listing.city, listing.state, listing.postalCode].filter(Boolean).join(", ")}
              </Typography>
              {(agentName || agentPhone || agentEmail) && (
                <Stack
                  direction="row"
                  spacing={1.5}
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                  sx={{ mt: 1 }}
                >
                  <Typography variant="caption" color="text.secondary">
                    Listed by
                  </Typography>
                  {agentName && (
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {agentName}
                    </Typography>
                  )}
                  {agentPhone && (
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<PhoneRoundedIcon fontSize="small" />}
                      component={MuiLink}
                      href={`tel:${agentPhone.replace(/[^\d+]/g, "")}`}
                      sx={{ py: 0.25 }}
                    >
                      {agentPhone}
                    </Button>
                  )}
                  {agentEmail && (
                    <Button
                      size="small"
                      variant="text"
                      startIcon={<EmailRoundedIcon fontSize="small" />}
                      component={MuiLink}
                      href={`mailto:${agentEmail}`}
                      sx={{ py: 0.25 }}
                    >
                      Email
                    </Button>
                  )}
                </Stack>
              )}
            </Box>
            <IconButton onClick={onClose} size="small">
              <CloseRoundedIcon />
            </IconButton>
          </Stack>

          {/* Raw IDs & timestamps — moved up so the source of truth is at the top */}
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack
              direction="row"
              spacing={2.5}
              flexWrap="wrap"
              useFlexGap
              alignItems="center"
            >
              <Metric label="MLS ID" value={listing.mlsId} small />
              <Metric label="Posted" value={fmtDate(listing.postDate)} small />
              <Metric label="Updated" value={fmtDate(listing.listingUpdatedAt)} small />
              <Metric
                label="Bridge mod"
                value={fmtDate(listing.bridgeModificationTimestamp)}
                small
              />
            </Stack>
          </Paper>

          {/* Headline strip — price, $/sqft, $/unit, DOM (no comparison data) */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
              <Metric label="Price" value={fmtMoney(listing.price)} emphasis />
              <Metric
                label="$/Sqft"
                value={fmtMoney(
                  deriveRatio(
                    listing.price,
                    listing.assessorBuildingSqft ?? listing.sqft,
                  ),
                )}
              />
              <Metric
                label="$/Unit"
                value={fmtMoney(
                  deriveRatio(listing.price, listing.assessorUnits ?? listing.units),
                )}
              />
              <Metric label="DOM" value={listing.daysOnMls.toString()} />
            </Stack>
          </Paper>

          {/* Building Details — replaces the old headline metrics + source-comparison
              cards. 3-column MLS / Assessor / AI grid with row highlighting. */}
          <BuildingDetailsCard listing={listing} />

          {/* AI insights — merges photo-vision (renovation, stories) with the new
              listing-extract output (rent roll, capex, ADU). Sits directly under
              the building details so AI-derived facts read alongside the source
              data. */}
          <AIInsightsCard listing={listing} />

          {/* Lot & extras (parking, HOA, tax, lot features, view) */}
          <LotAndExtrasCard raw={raw} />

          {/* Public remarks — moved above map */}
          {(raw.PublicRemarks as string | undefined) && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Public remarks
              </Typography>
              <Typography
                component="pre"
                variant="body2"
                sx={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "inherit",
                  m: 0,
                  color: "text.primary",
                }}
              >
                {raw.PublicRemarks as string}
              </Typography>
            </Paper>
          )}

          {/* Photos */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <Typography variant="subtitle2">Photos</Typography>
              {photosQuery.isLoading && <CircularProgress size={14} />}
              {photosQuery.data?.via && photosQuery.data.via !== "none" && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={photosQuery.data.via}
                  sx={{ fontSize: 10 }}
                />
              )}
              <Box sx={{ flex: 1 }} />
              <Typography variant="caption" color="text.secondary">
                {photosQuery.data?.items.length ?? 0} photos
              </Typography>
              <Button size="small" variant="text" onClick={refreshPhotos}>
                Refresh
              </Button>
            </Stack>
            <PhotoStrip
              loading={photosQuery.isLoading}
              items={photoItems}
              onOpen={openPhoto}
            />
            {photosQuery.data &&
              !photosQuery.data.items.length &&
              photosQuery.data.via === "none" &&
              photosQuery.data.attempts.length > 0 && (
                <Box sx={{ mt: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    Tried {photosQuery.data.attempts.length} Bridge endpoints — none returned media.
                    Run <code>pnpm bootstrap:bridge</code> to inspect what `sfar` exposes.
                  </Typography>
                </Box>
              )}
          </Paper>

          {/* Opportunity scores — bar chart at top, AI rationale collapsed below */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <Typography variant="subtitle2">Opportunity scores</Typography>
              {score?.computedBy === "AI" && <Chip size="small" color="primary" label="AI" />}
              <Tooltip
                arrow
                placement="top"
                title={
                  score?.computedBy === "AI"
                    ? "Bars compare GPT's reasoned score (current) against the deterministic heuristic baseline (recomputed from the listing data on every read). Hover any bar pair to see the values and the Δ."
                    : "These are heuristic scores computed during ETL. Click 'AI score' to re-score with GPT — once you do, the chart will show both alongside each other so you can see the AI's delta."
                }
              >
                <HelpOutlineRoundedIcon
                  sx={{ fontSize: 16, opacity: 0.55, cursor: "help" }}
                />
              </Tooltip>
              <Box sx={{ flex: 1 }} />
              <EnrichWithAIButton mlsId={listing.mlsId} />
            </Stack>
            <ScoreBars score={score} heuristic={listing.heuristicSnapshot ?? null} />
            {score?.computedBy === "AI" && score?.breakdown && (
              <Accordion
                disableGutters
                elevation={0}
                sx={{
                  mt: 1.5,
                  bgcolor: "transparent",
                  "&:before": { display: "none" },
                }}
              >
                <AccordionSummary
                  expandIcon={<ExpandMoreRoundedIcon />}
                  sx={{ px: 0, minHeight: 32, "& .MuiAccordionSummary-content": { my: 0.5 } }}
                >
                  <Typography variant="caption" color="text.secondary">
                    Show AI rationale
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 0, pt: 0 }}>
                  <Rationale breakdown={score.breakdown as Record<string, unknown>} />
                </AccordionDetails>
              </Accordion>
            )}
          </Paper>

          {/* GIS tools row */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
              GIS &amp; external tools
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <ToolLink
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress || `${lat},${lng}`)}`}
                icon={<LocationOnRoundedIcon fontSize="small" />}
                label="Google Maps"
              />
              <ToolLink
                href={
                  lat != null && lng != null
                    ? `https://earth.google.com/web/@${lat},${lng},150a,500d,35y,0h,75t,0r`
                    : `https://earth.google.com/web/search/${encodeURIComponent(fullAddress)}`
                }
                icon={<PublicRoundedIcon fontSize="small" />}
                label="Google Earth (3D)"
              />
              <ToolLink
                href={
                  lat != null && lng != null
                    ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`
                    : `https://www.google.com/maps?q=${encodeURIComponent(fullAddress)}&layer=c`
                }
                icon={<StreetviewRoundedIcon fontSize="small" />}
                label="Street View"
              />
              <ToolLink
                href={`https://www.zillow.com/homes/${encodeURIComponent(fullAddress)}_rb/`}
                icon={<HomeWorkRoundedIcon fontSize="small" />}
                label="Zillow"
              />
              <CopyAndOpenLink
                href="https://www.redfin.com"
                icon={<HomeWorkRoundedIcon fontSize="small" />}
                label="Redfin"
                copyText={fullAddress}
              />
              <ToolLink
                href={`https://www.walkscore.com/score/${encodeURIComponent(fullAddress)}`}
                icon={<DirectionsWalkRoundedIcon fontSize="small" />}
                label="WalkScore"
              />
              <ToolLink
                href={`https://www.bing.com/maps?q=${encodeURIComponent(fullAddress)}&style=h`}
                icon={<LayersRoundedIcon fontSize="small" />}
                label="Bing Aerial"
              />
              <ToolLink
                href={`https://hazards-fema.maps.arcgis.com/apps/webappviewer/index.html?id=8b0adb51996444d4879338b5529aa9cd&find=${encodeURIComponent(fullAddress)}`}
                icon={<WaterDamageRoundedIcon fontSize="small" />}
                label="FEMA Flood"
              />
              <CopyAndOpenLink
                href="https://sfplanninggis.org/pim"
                icon={<LayersRoundedIcon fontSize="small" />}
                label="SF PIM"
                copyText={fullAddress}
              />
              <CopyAndOpenLink
                href="https://build.symbium.com"
                icon={<HomeWorkRoundedIcon fontSize="small" />}
                label="Symbium"
                copyText={fullAddress}
              />
              <Tooltip title="Trace the parcel on a satellite map and compare to the API's lot size" arrow>
                <Button
                  size="small"
                  variant="outlined"
                  color="primary"
                  startIcon={<StraightenRoundedIcon fontSize="small" />}
                  onClick={() => setMeasureOpen(true)}
                  disabled={lat == null || lng == null}
                >
                  Measure lot
                </Button>
              </Tooltip>
            </Stack>
          </Paper>

          {/* Map preview — kept at the bottom as a visual anchor under the
              data-heavy sections above. */}
          {lat != null && lng != null && (
            <Paper variant="outlined" sx={{ overflow: "hidden" }}>
              <Box
                component="iframe"
                title="Map preview"
                src={`https://www.google.com/maps?q=${lat},${lng}&z=18&output=embed`}
                sx={{
                  width: "100%",
                  height: 280,
                  border: 0,
                  display: "block",
                  filter: "saturate(0.95)",
                }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </Paper>
          )}

          {/* Raw payload, collapsed */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <details>
              <summary style={{ cursor: "pointer", fontSize: 13, opacity: 0.8 }}>
                Raw MLS payload
              </summary>
              <Box
                component="pre"
                sx={{
                  mt: 1.5,
                  p: 1.5,
                  fontSize: 11,
                  overflowX: "auto",
                  bgcolor: "background.paper",
                  borderRadius: 1,
                }}
              >
                {JSON.stringify(raw, null, 2)}
              </Box>
            </details>
          </Paper>

          <Divider sx={{ my: 1 }} />
        </Stack>
      )}

      <PhotoLightbox
        open={lightboxIndex !== null}
        items={photoItems}
        index={lightboxIndex ?? 0}
        onClose={closeLightbox}
        onIndexChange={setLightboxIndex}
      />

      <MeasureLotModal
        open={measureOpen}
        onClose={() => setMeasureOpen(false)}
        lat={lat}
        lng={lng}
        address={fullAddress || address}
        apiLotSizeSqft={listing?.lotSizeSqft ?? null}
      />
    </Drawer>
  );
}

function Metric({
  label,
  value,
  emphasis,
  small,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  small?: boolean;
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant={emphasis ? "h6" : small ? "body2" : "body1"}
        sx={{ fontWeight: emphasis ? 700 : 500, lineHeight: 1.2 }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function ToolLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip title="Opens in a new tab" arrow>
      <Button
        component={MuiLink}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        size="small"
        variant="outlined"
        startIcon={icon}
        endIcon={<OpenInNewRoundedIcon sx={{ fontSize: 14 }} />}
      >
        {label}
      </Button>
    </Tooltip>
  );
}

/**
 * For tools whose URLs don't accept an address search param (SF PIM,
 * Symbium, Redfin). Copies the full address to the clipboard, surfaces a
 * Snackbar telling the user to paste, then opens the tool in a new tab.
 */
function CopyAndOpenLink({
  href,
  label,
  icon,
  copyText,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  copyText: string;
}) {
  const [snackbarOpen, setSnackbarOpen] = React.useState(false);
  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setSnackbarOpen(true);
    } catch {
      // Clipboard API unavailable (older browsers, insecure context). Still
      // open the tool — the user can copy the address from the drawer header.
    }
    window.open(href, "_blank", "noopener,noreferrer");
  };
  return (
    <>
      <Tooltip
        title={`Copies the address, then opens ${label} so you can paste it (no search param available).`}
        arrow
      >
        <Button
          size="small"
          variant="outlined"
          startIcon={icon}
          endIcon={<OpenInNewRoundedIcon sx={{ fontSize: 14 }} />}
          onClick={handleClick}
        >
          {label}
        </Button>
      </Tooltip>
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity="success"
          variant="filled"
          onClose={() => setSnackbarOpen(false)}
          sx={{ width: "100%" }}
        >
          Address copied — paste it into {label}.
        </Alert>
      </Snackbar>
    </>
  );
}

type ScoreLike = {
  densityScore: number;
  vacancyScore: number;
  motivationScore: number;
  valueAddWeightedAvg: number;
  computedBy?: "HEURISTIC" | "AI";
};

const METRIC_COLORS: Record<string, string> = {
  Density: "#7c5cff",
  Vacancy: "#23d29a",
  Motivation: "#ffb86b",
  "Value-Add": "#ff6b8a",
};

function ScoreBars({
  score,
  heuristic,
}: {
  score: ScoreLike | null | undefined;
  heuristic: ScoreLike | null | undefined;
}) {
  if (!score) {
    return (
      <Typography variant="body2" color="text.secondary">
        No score yet.
      </Typography>
    );
  }

  const showCompare = score.computedBy === "AI" && !!heuristic;

  const data = [
    {
      name: "Density",
      current: score.densityScore,
      heuristic: heuristic?.densityScore ?? null,
    },
    {
      name: "Vacancy",
      current: score.vacancyScore,
      heuristic: heuristic?.vacancyScore ?? null,
    },
    {
      name: "Motivation",
      current: score.motivationScore,
      heuristic: heuristic?.motivationScore ?? null,
    },
    {
      name: "Value-Add",
      current: score.valueAddWeightedAvg,
      heuristic: heuristic?.valueAddWeightedAvg ?? null,
    },
  ];

  return (
    <ResponsiveContainer width="100%" height={170}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
        barCategoryGap="22%"
      >
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: "var(--mui-palette-text-secondary)" }}
          axisLine={false}
          tickLine={false}
        />
        <RechartsTooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          content={<ScoreTooltip showCompare={showCompare} />}
        />
        <Bar dataKey="current" name="Current" radius={[6, 6, 0, 0]}>
          {data.map((d) => (
            <Cell key={`current-${d.name}`} fill={METRIC_COLORS[d.name]} />
          ))}
        </Bar>
        {showCompare && (
          <Bar dataKey="heuristic" name="Heuristic" radius={[6, 6, 0, 0]}>
            {data.map((d) => (
              <Cell
                key={`heur-${d.name}`}
                fill={METRIC_COLORS[d.name]}
                fillOpacity={0.28}
              />
            ))}
          </Bar>
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

function ScoreTooltip({
  active,
  payload,
  label,
  showCompare,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number }>;
  label?: string;
  showCompare: boolean;
}) {
  if (!active || !payload?.length) return null;
  const current = payload.find((p) => p.dataKey === "current")?.value;
  const heur = payload.find((p) => p.dataKey === "heuristic")?.value;
  const diff =
    typeof current === "number" && typeof heur === "number"
      ? Math.round((current - heur) * 10) / 10
      : null;

  return (
    <Box
      sx={{
        background: "var(--mui-palette-background-paper)",
        border: 1,
        borderColor: "divider",
        borderRadius: 1.5,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        px: 1.5,
        py: 1,
        minWidth: 160,
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 600, display: "block", mb: 0.5 }}>
        {label}
      </Typography>
      <Stack spacing={0.25}>
        {typeof current === "number" && (
          <Stack direction="row" justifyContent="space-between" spacing={2}>
            <Typography variant="caption" color="text.secondary">
              {showCompare ? "AI" : "Score"}
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {current.toFixed(1)}
            </Typography>
          </Stack>
        )}
        {showCompare && typeof heur === "number" && (
          <Stack direction="row" justifyContent="space-between" spacing={2}>
            <Typography variant="caption" color="text.secondary">
              Heuristic
            </Typography>
            <Typography variant="caption">{heur.toFixed(1)}</Typography>
          </Stack>
        )}
        {showCompare && diff !== null && (
          <Stack
            direction="row"
            justifyContent="space-between"
            spacing={2}
            sx={{ mt: 0.5, pt: 0.5, borderTop: 1, borderColor: "divider" }}
          >
            <Typography variant="caption" color="text.secondary">
              Δ
            </Typography>
            <Typography
              variant="caption"
              sx={{
                fontWeight: 700,
                color:
                  diff > 0 ? "success.main" : diff < 0 ? "error.main" : "text.secondary",
              }}
            >
              {diff > 0 ? "+" : ""}
              {diff.toFixed(1)}
            </Typography>
          </Stack>
        )}
      </Stack>
    </Box>
  );
}

function PhotoStrip({
  loading,
  items,
  onOpen,
}: {
  loading: boolean;
  items: Array<{ MediaURL?: string; ShortDescription?: string }>;
  onOpen: (index: number) => void;
}) {
  if (loading && items.length === 0) {
    return (
      <Stack direction="row" spacing={1.5} sx={{ overflowX: "auto" }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} variant="rectangular" width={220} height={140} />
        ))}
      </Stack>
    );
  }
  if (!items.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        No photos available from this MLS feed.
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={1.5} sx={{ overflowX: "auto", pb: 1 }}>
      {items.map((it, i) =>
        !it.MediaURL ? null : (
          <Box
            key={i}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(i)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(i);
              }
            }}
            sx={{
              position: "relative",
              flexShrink: 0,
              width: 220,
              height: 140,
              borderRadius: 1.5,
              overflow: "hidden",
              border: 1,
              borderColor: "divider",
              display: "block",
              cursor: "zoom-in",
              transition: "transform 150ms",
              "&:hover": { transform: "translateY(-2px)" },
            }}
          >
            <Box
              component="img"
              src={it.MediaURL}
              alt={it.ShortDescription ?? `Photo ${i + 1}`}
              loading="lazy"
              sx={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </Box>
        ),
      )}
    </Stack>
  );
}

function Rationale({ breakdown }: { breakdown: Record<string, unknown> }) {
  const r = breakdown.rationale as
    | { density?: string; vacancy?: string; motivation?: string; valueAdd?: string }
    | undefined;
  const signals = breakdown.signals as string[] | undefined;
  if (!r && !signals) {
    return (
      <Box component="pre" sx={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
        {JSON.stringify(breakdown, null, 2)}
      </Box>
    );
  }
  return (
    <Stack spacing={1}>
      {r?.density && <Line label="Density" value={r.density} />}
      {r?.vacancy && <Line label="Vacancy" value={r.vacancy} />}
      {r?.motivation && <Line label="Motivation" value={r.motivation} />}
      {r?.valueAdd && <Line label="Value-Add" value={r.valueAdd} />}
      {signals && signals.length > 0 && (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {signals.map((s, i) => (
            <Chip key={i} size="small" variant="outlined" label={s} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  );
}

function deriveRatio(num: number | null | undefined, den: number | null | undefined) {
  if (num == null || den == null || den === 0) return null;
  return num / den;
}

function LotAndExtrasCard({ raw }: { raw: Record<string, unknown> }) {
  const lotFeatures = arrField(raw.LotFeatures);
  const view = arrField(raw.View);
  const parking = numField(raw.ParkingTotal);
  const hoa = numField(raw.AssociationFee);
  const hoaFreq = strField(raw.AssociationFeeFrequency);
  const tax = numField(raw.TaxAnnualAmount);
  const taxYear = numField(raw.TaxYear);

  const hasAny =
    lotFeatures.length || view.length || parking != null || hoa != null || tax != null;
  if (!hasAny) return null;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
        Lot &amp; details
      </Typography>
      <Stack
        direction="row"
        spacing={3}
        flexWrap="wrap"
        useFlexGap
        sx={{ mb: lotFeatures.length || view.length ? 1.5 : 0 }}
      >
        {parking != null && <Metric label="Parking spaces" value={String(parking)} />}
        {hoa != null && (
          <Metric
            label="HOA"
            value={`$${Math.round(hoa).toLocaleString()}${hoaFreq ? ` / ${hoaFreq.toLowerCase()}` : ""}`}
          />
        )}
        {tax != null && (
          <Metric
            label="Property tax (annual)"
            value={`$${Math.round(tax).toLocaleString()}${taxYear ? ` (${taxYear})` : ""}`}
          />
        )}
      </Stack>
      {lotFeatures.length > 0 && (
        <Box sx={{ mb: view.length ? 1 : 0 }}>
          <Typography variant="caption" color="text.secondary">
            Lot features
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
            {lotFeatures.map((f, i) => (
              <Chip key={i} size="small" variant="outlined" label={f} />
            ))}
          </Stack>
        </Box>
      )}
      {view.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary">
            View
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
            {view.map((v, i) => (
              <Chip key={i} size="small" variant="outlined" label={v} />
            ))}
          </Stack>
        </Box>
      )}
    </Paper>
  );
}

function arrField(v: unknown): string[] {
  return Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : [];
}
function numField(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function strField(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// ============================================================================
// Building Details — replaces the old headline metrics + source-comparison.
// 3-column grid: MLS / Assessor / AI, with diverging rows highlighted.
// Rooms calc: MLS column = beds + units*2 (assessor counts kitchen+living per
// unit, so this is the MLS-equivalent room count); Assessor column = raw.
// ============================================================================
type ListingForDetails = {
  // MLS-side
  sqft: number | null;
  lotSizeSqft: number | null;
  units: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  stories: number | null;
  price: number;
  // Assessor-side
  assessorBuildingSqft: number | null;
  assessorLotSqft: number | null;
  assessorUnits: number | null;
  assessorBedrooms: number | null;
  assessorBathrooms: number | null;
  assessorYearBuilt: number | null;
  assessorStories: number | null;
  assessorRooms: number | null;
  assessorBuildingValue: number | null;
  assessorLandValue: number | null;
  assessorFetchedAt: Date | string | null;
  // AI-side
  aiStories: number | null;
  extractedUnitMix: unknown;
};

function BuildingDetailsCard({ listing }: { listing: ListingForDetails }) {
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

const RENO_COLOR: Record<RenovationLevel, "error" | "warning" | "info" | "success"> = {
  DISTRESSED: "error",
  ORIGINAL: "warning",
  UPDATED: "info",
  RENOVATED: "success",
};

const RENO_LABEL: Record<RenovationLevel, string> = {
  DISTRESSED: "Distressed",
  ORIGINAL: "Original",
  UPDATED: "Updated",
  RENOVATED: "Renovated",
};

const ADU_COLOR: Record<"LOW" | "MEDIUM" | "HIGH", "default" | "warning" | "success"> = {
  LOW: "default",
  MEDIUM: "warning",
  HIGH: "success",
};

// ============================================================================
// AI Insights — merges photo-vision facts (renovation, stories, basement,
// penthouse) with text-extracted facts (unit mix, rent roll, capex, ADU).
// Replaces the old "Building analysis (AI vision)" card.
// ============================================================================
type ListingForAI = {
  mlsId: string;
  lat: number | null;
  lng: number | null;
  aiStories: number | null;
  aiHasBasement: boolean | null;
  aiHasPenthouse: boolean | null;
  aiBestPhotoUrl: string | null;
  renovationLevel: RenovationLevel | null;
  renovationConfidence: number | null;
  visionFetchedAt: Date | string | null;
  extractedUnitMix: unknown;
  extractedRentRoll: unknown;
  aiRentEstimate: unknown;
  postRenovationRentEstimate: unknown;
  extractedTotalMonthlyRent: number | null;
  extractedOccupancy: number | null;
  recentCapex: unknown;
  aduPotential: string | null;
  aduConfidence: number | null;
  aduRationale: string | null;
  extractFetchedAt: Date | string | null;
};

// ---------------------------------------------------------------------------
// Rent roll — single section that merges actual per-apartment rents,
// AI-or-comp-grounded market estimates, and post-remodel projections. The
// previous "Rent-growth Potential" card was redundant once this grid carries
// totals + upside, so it has been removed.
// ---------------------------------------------------------------------------

type RentRollEntryUI = {
  rent: number;
  beds: number | null;
  baths: number | null;
  sqft?: number | null;
  unitLabel?: string | null;
};

type UnitMixEntryUI = {
  count: number;
  beds: number | null;
  baths: number | null;
};

type RentEstimateEntryUI = {
  beds: number | null;
  baths: number | null;
  estimatedRent: number;
  rationale: string;
  sqft?: number | null;
  unitLabel?: string | null;
  source?: "gpt" | "comps";
};

type RentCompBucketUI = {
  beds: number | null;
  baths: number | null;
  count: number;
  medianRent: number | null;
  medianPricePerSqft: number | null;
  medianSqft: number | null;
};

type RentCompsOutputUI = {
  totalComps: number;
  radiusMiles: number;
  monthsBack: number;
  buckets: RentCompBucketUI[];
  summary: string;
};

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

function RentRollSection({ listing }: { listing: ListingForAI }) {
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
    </Box>
  );
}

function AIInsightsCard({ listing }: { listing: ListingForAI }) {
  const unitMix = listing.extractedUnitMix as
    | Array<{ count: number; beds: number | null; baths: number | null }>
    | null
    | undefined;
  const rentRoll = listing.extractedRentRoll as
    | Array<{ rent: number; beds: number | null; baths: number | null }>
    | null
    | undefined;
  const capex = listing.recentCapex as string[] | null | undefined;
  const adu = listing.aduPotential as "LOW" | "MEDIUM" | "HIGH" | null;

  const hasAnyExtract =
    !!unitMix?.length ||
    !!rentRoll?.length ||
    listing.extractedTotalMonthlyRent != null ||
    listing.extractedOccupancy != null ||
    !!capex?.length ||
    !!adu;
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
        {adu && (
          <Tooltip
            title={listing.aduRationale ?? ""}
            arrow
            placement="top"
            disableHoverListener={!listing.aduRationale}
          >
            <Chip
              size="small"
              color={ADU_COLOR[adu]}
              label={`ADU ${adu.toLowerCase()}${
                listing.aduConfidence != null
                  ? ` · ${Math.round(listing.aduConfidence * 100)}%`
                  : ""
              }`}
            />
          </Tooltip>
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

      <RentRollSection listing={listing} />

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

      {adu && (
        <Box>
          <Typography variant="caption" color="text.secondary">
            ADU feasibility
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.25 }}>
            {listing.aduRationale ?? "—"}
          </Typography>
        </Box>
      )}
    </Paper>
  );
}
