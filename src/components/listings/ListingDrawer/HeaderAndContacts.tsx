import {
  Box,
  Chip,
  Divider,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import { StarCell } from "../ListingsGrid/gridCells";
import { ContactCard } from "./ContactCard";
import { ContactOverrideEditor } from "./ContactOverrideEditor";
import { DataFreshness } from "./DataFreshness";
import { Metric } from "./Metric";
import { deriveRatio, fmtDate, fmtMoney } from "./formatters";
import type { ListingContactFields } from "./useListingContact";

type ListingLike = {
  mlsId: string;
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  status: string;
  propertyType: string;
  postDate: Date | string;
  listingUpdatedAt: Date | string;
  bridgeModificationTimestamp?: Date | string | null;
  price: number;
  daysOnMls: number | null;
  sqft: number | null;
  units: number | null;
  assessorBuildingSqft: number | null;
  assessorUnits: number | null;
  isAuction?: boolean | null;
  auctionDate?: Date | string | null;
};

export type ContactOverrideFields = {
  agentName: string | null;
  agentEmail: string | null;
  agentPhone: string | null;
  officeName: string | null;
} | null;

export function HeaderAndContacts({
  listing,
  address,
  contact,
  contactFetchedAt,
  review,
  onClose,
}: {
  listing: ListingLike;
  address: string;
  contact: ListingContactFields;
  contactFetchedAt: Date | string | null;
  /** Manual contact overrides from the ListingReview row (edit-form prefill). */
  review: ContactOverrideFields;
  onClose: () => void;
}) {
  const {
    agentName,
    agentPhone,
    agentEmail,
    coAgentName,
    coAgentPhone,
    coAgentEmail,
    officeName,
    officePhone,
    officeEmail,
  } = contact;

  const hasAnyContact =
    agentName ||
    agentPhone ||
    agentEmail ||
    coAgentName ||
    coAgentPhone ||
    coAgentEmail ||
    officeName ||
    officePhone ||
    officeEmail;

  return (
    <>
      <Stack direction="row" alignItems="flex-start" spacing={1}>
        <Box sx={{ flex: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Chip
              size="small"
              color={listing.status === "Active" ? "success" : "default"}
              label={listing.status}
            />
            {listing.isAuction && (
              <Chip size="small" color="warning" label="Auction" />
            )}
            <Chip size="small" variant="outlined" label={listing.propertyType} />
          </Stack>
          <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
            {address}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {[listing.city, listing.state, listing.postalCode].filter(Boolean).join(", ")}
          </Typography>
        </Box>
        <StarCell mlsId={listing.mlsId} />
        <IconButton onClick={onClose} size="small">
          <CloseRoundedIcon />
        </IconButton>
      </Stack>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack spacing={1.25}>
          {hasAnyContact && (
            <>
              <Stack spacing={0.25}>
                {contactFetchedAt && (
                  <Stack direction="row" alignItems="center" sx={{ mb: 0.25 }}>
                    <Box sx={{ flex: 1 }} />
                    <DataFreshness updatedAt={contactFetchedAt} label="Contact" />
                  </Stack>
                )}
                {(agentName || agentPhone || agentEmail) && (
                  <ContactCard
                    role="Listed by"
                    name={agentName}
                    phone={agentPhone}
                    email={agentEmail}
                    listingMlsId={listing.mlsId}
                  />
                )}
                {(coAgentName || coAgentPhone || coAgentEmail) && (
                  <ContactCard
                    role="Co-listed by"
                    name={coAgentName}
                    phone={coAgentPhone}
                    email={coAgentEmail}
                    listingMlsId={listing.mlsId}
                  />
                )}
                {(officeName || officePhone || officeEmail) && (
                  <ContactCard
                    role="Brokerage"
                    name={officeName}
                    phone={officePhone}
                    email={officeEmail}
                    listingMlsId={listing.mlsId}
                  />
                )}
              </Stack>
              <Divider />
            </>
          )}
          <ContactOverrideEditor
            mlsId={listing.mlsId}
            review={review}
            resolved={{
              agentName,
              agentEmail,
              agentPhone,
              officeName,
            }}
          />
          <Divider />
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
              value={fmtDate(listing.bridgeModificationTimestamp ?? null)}
              small
            />
            {listing.auctionDate && (
              <Metric
                label="Auction date"
                value={fmtDate(listing.auctionDate)}
                small
              />
            )}
          </Stack>
        </Stack>
      </Paper>

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
          <Metric
            label="DOM"
            value={listing.daysOnMls != null ? listing.daysOnMls.toString() : "—"}
          />
        </Stack>
      </Paper>
    </>
  );
}
