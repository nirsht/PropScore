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
import StreetviewRoundedIcon from "@mui/icons-material/StreetviewRounded";
import PublicRoundedIcon from "@mui/icons-material/PublicRounded";
import LayersRoundedIcon from "@mui/icons-material/LayersRounded";
import WaterDamageRoundedIcon from "@mui/icons-material/WaterDamageRounded";
import HomeWorkRoundedIcon from "@mui/icons-material/HomeWorkRounded";
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
import { RentGrowthCard } from "./RentGrowthCard";
import { PhotoLightbox } from "./PhotoLightbox";

const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;
const fmtDecimal = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : Number(n).toFixed(digits);
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

          {/* Headline metrics */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
              <Metric label="Price" value={fmtMoney(listing.price)} emphasis />
              <Metric label="$/Sqft" value={fmtMoney(deriveRatio(listing.price, listing.sqft))} />
              <Metric
                label="$/Unit"
                value={fmtMoney(deriveRatio(listing.price, listing.units))}
              />
              <Metric label="Sqft" value={listing.sqft?.toLocaleString() ?? "—"} />
              <Metric label="Units" value={listing.units?.toString() ?? "—"} />
              <Metric label="Beds / Baths" value={`${listing.beds ?? "—"} / ${listing.baths ?? "—"}`} />
              <Metric label="Year built" value={listing.yearBuilt?.toString() ?? "—"} />
              <Metric label="DOM" value={listing.daysOnMls.toString()} />
              <Metric label="Stories" value={listing.stories?.toString() ?? "—"} />
            </Stack>
          </Paper>

          {/* Score breakdown */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <Typography variant="subtitle2">Opportunity scores</Typography>
              {score?.computedBy === "AI" && <Chip size="small" color="primary" label="AI" />}
              <Box sx={{ flex: 1 }} />
              <EnrichWithAIButton mlsId={listing.mlsId} />
            </Stack>
            <ScoreBars score={score} />
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
                href={`https://www.redfin.com/zipcode/${listing.postalCode ?? ""}`}
                icon={<HomeWorkRoundedIcon fontSize="small" />}
                label="Redfin"
              />
              <ToolLink
                href={`https://propertymap.sfplanning.org/?search=${encodeURIComponent(address)}`}
                icon={<LayersRoundedIcon fontSize="small" />}
                label="SF Planning PIM"
              />
              <ToolLink
                href="https://sfassessor.org/property-information"
                icon={<LayersRoundedIcon fontSize="small" />}
                label="SF Assessor"
              />
              <ToolLink
                href={`https://msc.fema.gov/portal/search?AddressQuery=${encodeURIComponent(fullAddress)}`}
                icon={<WaterDamageRoundedIcon fontSize="small" />}
                label="FEMA Flood"
              />
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
    </Drawer>
  );
}

function Metric({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant={emphasis ? "h6" : "body1"}
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

function ScoreBars({
  score,
}: {
  score:
    | {
        densityScore: number;
        vacancyScore: number;
        motivationScore: number;
        valueAddWeightedAvg: number;
      }
    | null
    | undefined;
}) {
  if (!score) {
    return (
      <Typography variant="body2" color="text.secondary">
        No score yet.
      </Typography>
    );
  }
  const data = [
    { name: "Density", value: score.densityScore, color: "#7c5cff" },
    { name: "Vacancy", value: score.vacancyScore, color: "#23d29a" },
    { name: "Motivation", value: score.motivationScore, color: "#ffb86b" },
    { name: "Value-Add", value: score.valueAddWeightedAvg, color: "#ff6b8a" },
  ];
  return (
    <ResponsiveContainer width="100%" height={150}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: "var(--mui-palette-text-secondary)" }}
          axisLine={false}
          tickLine={false}
        />
        <RechartsTooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
          itemStyle={CHART_TOOLTIP_ITEM_STYLE}
        />
        <Bar dataKey="value" radius={[6, 6, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const CHART_TOOLTIP_CONTENT_STYLE: React.CSSProperties = {
  background: "var(--mui-palette-background-paper)",
  border: "1px solid var(--mui-palette-divider)",
  borderRadius: 8,
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
  color: "var(--mui-palette-text-primary)",
};
const CHART_TOOLTIP_LABEL_STYLE: React.CSSProperties = {
  color: "var(--mui-palette-text-primary)",
  fontWeight: 600,
};
const CHART_TOOLTIP_ITEM_STYLE: React.CSSProperties = {
  color: "var(--mui-palette-text-secondary)",
};

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
