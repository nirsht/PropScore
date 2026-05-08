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
  Paper,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import LocationOnRoundedIcon from "@mui/icons-material/LocationOnRounded";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import StreetviewRoundedIcon from "@mui/icons-material/StreetviewRounded";
import PublicRoundedIcon from "@mui/icons-material/PublicRounded";
import LayersRoundedIcon from "@mui/icons-material/LayersRounded";
import WaterDamageRoundedIcon from "@mui/icons-material/WaterDamageRounded";
import HomeWorkRoundedIcon from "@mui/icons-material/HomeWorkRounded";
import DirectionsWalkRoundedIcon from "@mui/icons-material/DirectionsWalkRounded";
import StraightenRoundedIcon from "@mui/icons-material/StraightenRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import ChatBubbleOutlineRoundedIcon from "@mui/icons-material/ChatBubbleOutlineRounded";
import HomeWorkOutlinedIcon from "@mui/icons-material/HomeWorkOutlined";
import { trpc } from "@/lib/trpc/client";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { EnrichWithAIButton } from "./EnrichWithAIButton";
import { LocationRatingCard } from "./LocationRatingCard";
import { PhotoLightbox } from "./PhotoLightbox";
import { MeasureLotModal } from "./MeasureLotModal";
import { AIInsightsCard } from "./ListingDrawer/AIInsightsCard";
import { BuildingDetailsCard } from "./ListingDrawer/BuildingDetailsCard";
import { ContactCard } from "./ListingDrawer/ContactCard";
import { strField } from "./ListingDrawer/fieldGuards";
import { deriveRatio, fmtDate, fmtMoney } from "./ListingDrawer/formatters";
import { LotAndExtrasCard } from "./ListingDrawer/LotAndExtrasCard";
import { Metric } from "./ListingDrawer/Metric";
import { PhotoStrip } from "./ListingDrawer/PhotoStrip";
import { Rationale } from "./ListingDrawer/Rationale";
import { ScoreBars } from "./ListingDrawer/ScoreBars";
import { CopyAndOpenLink, ToolLink } from "./ListingDrawer/ToolLinks";

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
  const [tab, setTab] = React.useState<"details" | "chat">("details");
  // Reset to Details when the user switches listings.
  React.useEffect(() => {
    setTab("details");
  }, [mlsId]);

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

  // Redfin requires an internal /home/<id> for property pages and blocks
  // server-side autocomplete via CloudFront, so we route through
  // DuckDuckGo's `!ducky` bang — DDG redirects to the top Google result
  // for `site:redfin.com <address>`, which is reliably the property page.
  const redfinUrl = fullAddress
    ? `https://duckduckgo.com/?q=${encodeURIComponent(`!ducky site:redfin.com ${fullAddress}`)}`
    : "https://www.redfin.com";

  // Zillow's `_rb` redirect expects dash-separated tokens, not URL-encoded
  // spaces/commas — encodeURIComponent produces 404s.
  const zillowSlug = fullAddress
    .replace(/,/g, "")
    .trim()
    .replace(/\s+/g, "-");
  const zillowUrl = zillowSlug
    ? `https://www.zillow.com/homes/${zillowSlug}_rb/`
    : "https://www.zillow.com";

  const agentName = strField(raw.ListAgentFullName);
  const agentPhone =
    strField(raw.ListAgentDirectPhone) ?? strField(raw.ListAgentOfficePhone);
  const agentEmail = strField(raw.ListAgentEmail);

  const coAgentName = strField(raw.CoListAgentFullName);
  const coAgentPhone = strField(raw.CoListAgentDirectPhone);
  const coAgentEmail = strField(raw.CoListAgentEmail);

  const officeName = strField(raw.ListOfficeName);
  const officePhone = strField(raw.ListOfficePhone);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: { xs: "100%", md: 720 },
            bgcolor: "background.default",
            display: "flex",
            flexDirection: "column",
          },
        },
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
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v as "details" | "chat")}
          sx={{
            px: 2,
            borderBottom: 1,
            borderColor: "divider",
            minHeight: 44,
            "& .MuiTab-root": { minHeight: 44, textTransform: "none" },
          }}
        >
          <Tab
            value="details"
            icon={<HomeWorkOutlinedIcon fontSize="small" />}
            iconPosition="start"
            label="Details"
          />
          <Tab
            value="chat"
            icon={<ChatBubbleOutlineRoundedIcon fontSize="small" />}
            iconPosition="start"
            label="Chat"
          />
        </Tabs>
      )}

      {listing && tab === "chat" && (
        <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <ChatPanel
            scope="ASSET"
            listingMlsId={listing.mlsId}
            mode="panel"
            emptyHint="Ask anything about this listing — rent comps, parcel info, value-add ideas, ADU potential, photos."
          />
        </Box>
      )}

      {listing && tab === "details" && (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
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
              {(agentName || agentPhone || agentEmail || coAgentName ||
                coAgentPhone || coAgentEmail || officeName || officePhone) && (
                <Stack spacing={1} sx={{ mt: 1.5 }}>
                  {(agentName || agentPhone || agentEmail) && (
                    <ContactCard
                      role="Listed by"
                      name={agentName}
                      phone={agentPhone}
                      email={agentEmail}
                      accent="primary"
                    />
                  )}
                  {(coAgentName || coAgentPhone || coAgentEmail) && (
                    <ContactCard
                      role="Co-listed by"
                      name={coAgentName}
                      phone={coAgentPhone}
                      email={coAgentEmail}
                      accent="secondary"
                    />
                  )}
                  {(officeName || officePhone) && (
                    <ContactCard
                      role="Brokerage"
                      name={officeName}
                      phone={officePhone}
                      accent="default"
                    />
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
          <AIInsightsCard
            listing={{
              ...listing,
              privateRemarks: (raw.PrivateRemarks as string | undefined) ?? null,
            }}
          />

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

          {/* Location rating — Walk Score (30%) + neighborhood safety from
              DataSF crime incidents (70%). Independent of the value-add
              opportunity scoring above. */}
          <LocationRatingCard
            walkScore={listing.walkScore ?? null}
            neighborhood={listing.neighborhood ?? null}
            neighborhoodScore={listing.neighborhoodRel?.crimeScore ?? null}
            total={listing.locationScore ?? null}
          />

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
                href={(() => {
                  const query =
                    lat != null && lng != null
                      ? `${lat},${lng}`
                      : [listing?.address, listing?.city, listing?.state]
                          .filter((p): p is string => Boolean(p))
                          .map((p) => encodeURIComponent(p))
                          .join(',+')
                          .replace(/%20/g, '+');
                  const coords = lat != null && lng != null ? `/@${lat},${lng},150a,500d,35y,0h,0t,0r` : '';
                  return `https://earth.google.com/web/search/${query}${coords}`;
                })()}
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
                href={zillowUrl}
                icon={<HomeWorkRoundedIcon fontSize="small" />}
                label="Zillow"
              />
              <CopyAndOpenLink
                href={redfinUrl}
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
        </Box>
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
