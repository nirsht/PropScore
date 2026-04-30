"use client";

import * as React from "react";
import {
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
import { EnrichWithVisionButton } from "./EnrichWithVisionButton";
import { RentGrowthCard } from "./RentGrowthCard";
import { PhotoLightbox } from "./PhotoLightbox";
import { MeasureLotModal } from "./MeasureLotModal";
import type { RenovationLevel } from "@prisma/client";

const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;
const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString() : "—";

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
                <Typography variant="caption" color="text.secondary">
                  MLS {listing.mlsId}
                </Typography>
              </Stack>
              <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
                {address}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {[listing.city, listing.state, listing.postalCode].filter(Boolean).join(", ")}
              </Typography>
            </Box>
            <IconButton onClick={onClose} size="small">
              <CloseRoundedIcon />
            </IconButton>
          </Stack>

          {/* Headline metrics — uses resolved effective fields with provenance */}
          {(() => {
            const sqft = resolveValue(
              listing.sqft,
              listing.assessorBuildingSqft,
              null,
            );
            const lotSqft = resolveValue(
              listing.lotSizeSqft,
              listing.assessorLotSqft,
              null,
            );
            const units = resolveValue(listing.units, listing.assessorUnits, null);
            const stories = resolveValue(
              listing.stories,
              listing.assessorStories,
              listing.aiStories,
            );
            const yearBuilt = resolveValue(
              listing.yearBuilt,
              listing.assessorYearBuilt,
              null,
            );
            return (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
                  <Metric label="Price" value={fmtMoney(listing.price)} emphasis />
                  <Metric
                    label="$/Sqft"
                    value={fmtMoney(deriveRatio(listing.price, sqft.value))}
                    provenance={sqft.source}
                  />
                  <Metric
                    label="$/Unit"
                    value={fmtMoney(deriveRatio(listing.price, units.value))}
                    provenance={units.source}
                  />
                  <Metric
                    label="Sqft (building)"
                    value={sqft.value?.toLocaleString() ?? "—"}
                    provenance={sqft.source}
                  />
                  <Metric
                    label="Lot (sqft)"
                    value={lotSqft.value?.toLocaleString() ?? "—"}
                    provenance={lotSqft.source}
                  />
                  <Metric
                    label="Units"
                    value={units.value?.toString() ?? "—"}
                    provenance={units.source}
                  />
                  <Metric
                    label="Beds / Baths"
                    value={`${listing.beds ?? "—"} / ${listing.baths ?? "—"}`}
                  />
                  <Metric
                    label="Year built"
                    value={yearBuilt.value?.toString() ?? "—"}
                    provenance={yearBuilt.source}
                  />
                  <Metric label="DOM" value={listing.daysOnMls.toString()} />
                  <Metric
                    label="Stories"
                    value={stories.value?.toString() ?? "—"}
                    provenance={stories.source}
                  />
                </Stack>
              </Paper>
            );
          })()}

          {/* Source comparison — Bridge MLS vs SF Assessor side-by-side */}
          <SourceComparisonCard listing={listing} />

          {/* Lot & extras pulled directly from raw — no extra DB columns. */}
          <LotAndExtrasCard raw={raw} />

          {/* AI vision — building analysis */}
          <BuildingVisionCard listing={listing} />

          {/* Score breakdown */}
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
          </Paper>

          {/* Rent-growth potential */}
          <RentGrowthCard mlsId={listing.mlsId} />

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
              <ToolLink
                href={`https://www.redfin.com/stingray/do/location-autocomplete?location=${encodeURIComponent(fullAddress)}&v=2`}
                icon={<HomeWorkRoundedIcon fontSize="small" />}
                label="Redfin"
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

          {/* Map preview */}
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

          {/* Public remarks */}
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

          {/* Score rationale (if AI) */}
          {score?.computedBy === "AI" && score?.breakdown && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                AI rationale
              </Typography>
              <Rationale breakdown={score.breakdown as Record<string, unknown>} />
            </Paper>
          )}

          {/* Dates */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
              <Metric label="Posted" value={fmtDate(listing.postDate)} />
              <Metric label="Updated" value={fmtDate(listing.listingUpdatedAt)} />
              <Metric
                label="Bridge mod"
                value={fmtDate(listing.bridgeModificationTimestamp)}
              />
            </Stack>
          </Paper>

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

type Provenance = "MLS" | "Assessor" | "AI" | null;

function Metric({
  label,
  value,
  emphasis,
  provenance,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  provenance?: Provenance;
}) {
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        {provenance && (
          <Chip
            size="small"
            label={provenance}
            sx={{ height: 14, fontSize: 9, "& .MuiChip-label": { px: 0.5 } }}
            color={
              provenance === "MLS"
                ? "default"
                : provenance === "Assessor"
                  ? "info"
                  : "secondary"
            }
            variant="outlined"
          />
        )}
      </Stack>
      <Typography
        variant={emphasis ? "h6" : "body1"}
        sx={{ fontWeight: emphasis ? 700 : 500, lineHeight: 1.2 }}
      >
        {value}
      </Typography>
    </Box>
  );
}

/**
 * Resolve a value from primary → secondary → tertiary sources, returning the
 * winning value and its source label. `null` source = no value at all.
 */
function resolveValue<T extends number | string | null | undefined>(
  mls: T,
  assessor: T,
  ai: T,
): { value: NonNullable<T> | null; source: Provenance } {
  if (mls != null && mls !== 0) return { value: mls as NonNullable<T>, source: "MLS" };
  if (assessor != null && assessor !== 0)
    return { value: assessor as NonNullable<T>, source: "Assessor" };
  if (ai != null && ai !== 0) return { value: ai as NonNullable<T>, source: "AI" };
  return { value: null, source: null };
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
          <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ mt: 0.5, pt: 0.5, borderTop: 1, borderColor: "divider" }}>
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
      <Box
        component="pre"
        sx={{ fontSize: 12, whiteSpace: "pre-wrap" }}
      >
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
      <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ mb: lotFeatures.length || view.length ? 1.5 : 0 }}>
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

type ListingForCompare = {
  sqft: number | null;
  lotSizeSqft: number | null;
  units: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  stories: number | null;
  assessorBuildingSqft: number | null;
  assessorLotSqft: number | null;
  assessorUnits: number | null;
  assessorBedrooms: number | null;
  assessorBathrooms: number | null;
  assessorYearBuilt: number | null;
  assessorStories: number | null;
  assessorRooms: number | null;
  assessorFetchedAt: Date | string | null;
};

function SourceComparisonCard({ listing }: { listing: ListingForCompare }) {
  if (!listing.assessorFetchedAt) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
          <Typography variant="subtitle2">Source comparison</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          SF Assessor record not yet fetched for this listing. Run{" "}
          <code>pnpm tsx scripts/enrich-sfpim.ts</code> to populate.
        </Typography>
      </Paper>
    );
  }

  const rows: Array<{
    label: string;
    mls: number | null;
    assessor: number | null;
    fmt?: (n: number) => string;
  }> = [
    { label: "Sqft", mls: listing.sqft, assessor: listing.assessorBuildingSqft, fmt: (n) => n.toLocaleString() },
    { label: "Lot Sqft", mls: listing.lotSizeSqft, assessor: listing.assessorLotSqft, fmt: (n) => n.toLocaleString() },
    { label: "Stories", mls: listing.stories, assessor: listing.assessorStories },
    { label: "Units", mls: listing.units, assessor: listing.assessorUnits },
    { label: "Year built", mls: listing.yearBuilt, assessor: listing.assessorYearBuilt },
    { label: "Beds", mls: listing.beds, assessor: listing.assessorBedrooms },
    { label: "Baths", mls: listing.baths, assessor: listing.assessorBathrooms },
    { label: "Rooms", mls: null, assessor: listing.assessorRooms },
  ];

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2">Source comparison</Typography>
        <Typography variant="caption" color="text.secondary">
          Bridge MLS vs SF Assessor — diffs &gt; 5% highlighted
        </Typography>
      </Stack>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr 1fr",
          rowGap: 0.5,
          columnGap: 1,
          alignItems: "center",
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          Field
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          Bridge MLS
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          SF Assessor
        </Typography>
        {rows.map((r) => {
          const diverge = isDiverging(r.mls, r.assessor);
          const fmt = r.fmt ?? ((n: number) => n.toString());
          return (
            <React.Fragment key={r.label}>
              <Typography variant="body2" color="text.secondary">
                {r.label}
              </Typography>
              <CompareCell value={r.mls} fmt={fmt} highlight={diverge} />
              <CompareCell value={r.assessor} fmt={fmt} highlight={diverge} />
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
}: {
  value: number | null;
  fmt: (n: number) => string;
  highlight: boolean;
}) {
  return (
    <Typography
      variant="body2"
      sx={{
        fontWeight: highlight ? 600 : 500,
        bgcolor: highlight ? "warning.light" : "transparent",
        color: highlight ? "warning.contrastText" : "text.primary",
        px: highlight ? 0.75 : 0,
        py: highlight ? 0.25 : 0,
        borderRadius: 0.5,
        display: "inline-block",
      }}
    >
      {value == null ? "—" : fmt(value)}
    </Typography>
  );
}

function isDiverging(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return false;
  if (a === 0 && b === 0) return false;
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return false;
  return Math.abs(a - b) / max > 0.05;
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

type ListingForVision = {
  mlsId: string;
  aiStories: number | null;
  aiHasBasement: boolean | null;
  aiHasPenthouse: boolean | null;
  aiBestPhotoUrl: string | null;
  renovationLevel: RenovationLevel | null;
  renovationConfidence: number | null;
  visionFetchedAt: Date | string | null;
};

function BuildingVisionCard({ listing }: { listing: ListingForVision }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2">Building analysis (AI vision)</Typography>
        {listing.renovationLevel && (
          <Chip
            size="small"
            color={RENO_COLOR[listing.renovationLevel]}
            label={RENO_LABEL[listing.renovationLevel]}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <EnrichWithVisionButton mlsId={listing.mlsId} />
      </Stack>
      {!listing.visionFetchedAt ? (
        <Typography variant="body2" color="text.secondary">
          Click &ldquo;Analyze building&rdquo; to pick the best exterior photo and
          extract stories, basement / penthouse presence, and renovation level.
        </Typography>
      ) : (
        <Stack direction="row" spacing={2} alignItems="flex-start">
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
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
            <Metric
              label="Stories (AI)"
              value={listing.aiStories?.toString() ?? "—"}
            />
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
        </Stack>
      )}
    </Paper>
  );
}
