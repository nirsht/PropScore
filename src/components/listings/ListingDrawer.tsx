"use client";

import * as React from "react";
import {
  Alert,
  Box,
  Divider,
  Drawer,
  Paper,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import ChatBubbleOutlineRoundedIcon from "@mui/icons-material/ChatBubbleOutlineRounded";
import HomeWorkOutlinedIcon from "@mui/icons-material/HomeWorkOutlined";
import { trpc } from "@/lib/trpc/client";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { LocationRatingCard } from "./LocationRatingCard";
import { PhotoLightbox } from "./PhotoLightbox";
import { MeasureLotModal } from "./MeasureLotModal";
import { AIInsightsCard } from "./ListingDrawer/AIInsightsCard";
import { BuildingDetailsCard } from "./ListingDrawer/BuildingDetailsCard";
import { FeasibilityCard } from "./ListingDrawer/FeasibilityCard";
import { GisToolsSection } from "./ListingDrawer/GisToolsSection";
import { HeaderAndContacts } from "./ListingDrawer/HeaderAndContacts";
import { LotAndExtrasCard } from "./ListingDrawer/LotAndExtrasCard";
import { MarketUpsideCard } from "./ListingDrawer/MarketUpsideCard";
import { OpportunityScoresCard } from "./ListingDrawer/OpportunityScoresCard";
import { PhotosCard } from "./ListingDrawer/PhotosCard";
import { RawPayloadCollapsible } from "./ListingDrawer/RawPayloadCollapsible";
import { RiskComplianceCard } from "./ListingDrawer/RiskComplianceCard";
import { useListingContact } from "./ListingDrawer/useListingContact";

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

  const contact = useListingContact(listing?.contact, raw);

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
          <HeaderAndContacts
            listing={listing}
            address={address}
            contact={contact}
            onClose={onClose}
          />

          {/* Building Details — 3-column MLS / Assessor / AI grid. */}
          <BuildingDetailsCard listing={listing} />

          {/* AI insights — merges photo-vision (renovation, stories) with the new
              listing-extract output (rent roll, capex, ADU). */}
          <AIInsightsCard
            listing={{
              ...listing,
              privateRemarks: (raw.PrivateRemarks as string | undefined) ?? null,
            }}
          />

          {/* ADU & reconfiguration feasibility — SF Open Data signals. */}
          <FeasibilityCard listing={listing} />

          {/* Risk & compliance — code enforcement (NOVs), unit-change history,
              rent-control exposure. Filter+display only — does NOT enter the
              value-add weighted average. */}
          <RiskComplianceCard listing={listing} />

          <OpportunityScoresCard
            score={score}
            heuristic={listing.heuristicSnapshot ?? null}
          />

          {/* Location rating — Walk Score (30%) + neighborhood safety from
              DataSF crime incidents (70%). Independent of the value-add
              opportunity scoring above. */}
          <LocationRatingCard
            walkScore={listing.walkScore ?? null}
            neighborhood={listing.neighborhood ?? null}
            neighborhoodScore={listing.neighborhoodRel?.crimeScore ?? null}
            total={listing.locationScore ?? null}
          />

          {/* Market upside — assessment delta vs. neighborhood comps and
              zoning under-utilization. Surfaced but not yet folded into the
              value-add weighted average. */}
          <MarketUpsideCard
            marketUpsideScore={
              listing.score?.marketUpsideScore ??
              listing.heuristicSnapshot?.marketUpsideScore ??
              null
            }
            assessorBuildingValue={listing.assessorBuildingValue ?? null}
            assessorLandValue={listing.assessorLandValue ?? null}
            assessorBuildingSqft={listing.assessorBuildingSqft ?? null}
            sqft={listing.sqft ?? null}
            assessorUnits={listing.assessorUnits ?? null}
            units={listing.units ?? null}
            neighborhood={listing.neighborhood ?? null}
            comps={
              listing.neighborhoodRel
                ? {
                    name: listing.neighborhoodRel.name,
                    medianAssessedPerSqft:
                      listing.neighborhoodRel.medianAssessedPerSqft ?? null,
                    medianAssessedPerUnit:
                      listing.neighborhoodRel.medianAssessedPerUnit ?? null,
                    compSampleSize:
                      listing.neighborhoodRel.compSampleSize ?? null,
                  }
                : null
            }
            zoningDistrict={listing.zoningDistrict ?? null}
            zoningMaxUnits={listing.zoningMaxUnits ?? null}
          />

          <GisToolsSection
            fullAddress={fullAddress}
            address={listing?.address}
            city={listing?.city}
            state={listing?.state}
            lat={lat}
            lng={lng}
            onMeasureClick={() => setMeasureOpen(true)}
          />

          {/* Lot & extras (parking, HOA, tax, lot features, view) */}
          <LotAndExtrasCard raw={raw} />

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

          <PhotosCard
            loading={photosQuery.isLoading}
            data={photosQuery.data}
            onOpenPhoto={openPhoto}
            onRefresh={refreshPhotos}
          />

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

          <RawPayloadCollapsible raw={raw} />

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
