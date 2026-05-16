import { Box, Tooltip } from "@mui/material";
import { type GridColDef } from "@mui/x-data-grid";
import type { ListingRow } from "@/server/api/listings-search";
import { fmtDecimal, fmtMoney, sumUnitMix } from "../gridFormatters";
import { DiscrepancyCell, FallbackCell, HeaderTooltip } from "../gridCells";

export const effectiveSqftColumn: GridColDef<ListingRow> = {
  field: "effectiveSqft",
  headerName: "Sqft",
  width: 110,
  type: "number",
  renderHeader: () => (
    <HeaderTooltip
      label="Sqft"
      hint="Resolved building sqft: SF Assessor first, then Bridge MLS. When building sqft is missing, lot sqft is shown instead (italic, prefixed “Lot”). Cell color shows MLS↔Assessor disagreement (>5%): green = assessor larger (upside), red = assessor smaller."
    />
  ),
  renderCell: ({ row }) => {
    if (row.effectiveSqft == null && row.effectiveLotSizeSqft != null) {
      return (
        <Tooltip
          arrow
          placement="top"
          title="No building sqft on file — showing lot size as a fallback."
        >
          <Box
            component="span"
            sx={{
              color: "text.secondary",
              fontStyle: "italic",
              fontWeight: 500,
            }}
          >
            Lot {Math.round(row.effectiveLotSizeSqft).toLocaleString()}
          </Box>
        </Tooltip>
      );
    }
    return (
      <DiscrepancyCell
        preferred={row.effectiveSqft}
        mls={row.sqft}
        assessor={row.assessorBuildingSqft}
        fmt={(n) => Math.round(n).toLocaleString()}
      />
    );
  },
};

export const pricePerSqftColumn: GridColDef<ListingRow> = {
  field: "pricePerSqft",
  width: 100,
  renderHeader: () => (
    <HeaderTooltip
      label="$/Sqft"
      hint="Generated column: price ÷ sqft. When building sqft is missing, falls back to price ÷ lot sqft (italic, prefixed “Lot”). Indexed for fast filtering."
    />
  ),
  renderCell: ({ row }) => {
    if (row.pricePerSqft != null) return <span>{fmtMoney(row.pricePerSqft)}</span>;
    if (row.effectiveLotSizeSqft && row.effectiveLotSizeSqft > 0) {
      const lotPpsf = row.price / row.effectiveLotSizeSqft;
      return (
        <Tooltip
          arrow
          placement="top"
          title="No building sqft on file — showing price ÷ lot sqft as a fallback."
        >
          <Box
            component="span"
            sx={{
              color: "text.secondary",
              fontStyle: "italic",
              fontWeight: 500,
            }}
          >
            Lot {fmtMoney(lotPpsf)}
          </Box>
        </Tooltip>
      );
    }
    return <span>—</span>;
  },
};

export const effectiveUnitsColumn: GridColDef<ListingRow> = {
  field: "effectiveUnits",
  headerName: "Units",
  width: 90,
  type: "number",
  renderHeader: () => (
    <HeaderTooltip
      label="Units"
      hint="Resolved unit count: SF Assessor first, then Bridge MLS. Color = MLS↔Assessor disagreement (green = assessor larger)."
    />
  ),
  renderCell: ({ row }) => {
    if (row.effectiveUnits == null) {
      const aiUnits = sumUnitMix(row.extractedUnitMix);
      if (aiUnits != null) {
        return (
          <FallbackCell
            value={aiUnits.toString()}
            prefix="AI"
            tooltip="Inferred from the MLS unit-mix description (AI). No MLS or assessor unit count on file."
          />
        );
      }
    }
    return (
      <DiscrepancyCell
        preferred={row.effectiveUnits}
        mls={row.units}
        assessor={row.assessorUnits}
        fmt={(n) => n.toString()}
      />
    );
  },
};

export const sqftPerUnitColumn: GridColDef<ListingRow> = {
  field: "sqftPerUnit",
  width: 100,
  renderHeader: () => (
    <HeaderTooltip label="Sqft/Unit" hint="Generated column: sqft ÷ units." />
  ),
  valueFormatter: (v) => fmtDecimal(v as number | null, 0),
};

export const pricePerUnitColumn: GridColDef<ListingRow> = {
  field: "pricePerUnit",
  width: 130,
  renderHeader: () => (
    <HeaderTooltip
      label="Price/Unit"
      hint="Generated column: price ÷ units. Indexed for fast filtering."
    />
  ),
  valueFormatter: (v) => fmtMoney(v as number | null),
};

export const bedsColumn: GridColDef<ListingRow> = {
  field: "beds",
  headerName: "Beds",
  width: 70,
  type: "number",
  renderCell: ({ row }) => {
    if (row.beds != null) return <span>{row.beds}</span>;
    if (row.assessorBedrooms != null) {
      return (
        <FallbackCell
          value={row.assessorBedrooms.toString()}
          tooltip="From SF Assessor — no MLS bedrooms on file"
        />
      );
    }
    return <span>—</span>;
  },
};

export const bathsColumn: GridColDef<ListingRow> = {
  field: "baths",
  headerName: "Baths",
  width: 70,
  type: "number",
  renderCell: ({ row }) => {
    if (row.baths != null) return <span>{row.baths}</span>;
    if (row.assessorBathrooms != null) {
      return (
        <FallbackCell
          value={fmtDecimal(row.assessorBathrooms, 1)}
          tooltip="From SF Assessor — no MLS bathrooms on file"
        />
      );
    }
    return <span>—</span>;
  },
};

export const effectiveStoriesColumn: GridColDef<ListingRow> = {
  field: "effectiveStories",
  headerName: "Stories",
  width: 95,
  type: "number",
  renderHeader: () => (
    <HeaderTooltip
      label="Stories"
      hint="Resolved story count: SF Assessor → Bridge MLS → AI vision. Color = MLS↔Assessor disagreement (green = assessor larger)."
    />
  ),
  renderCell: ({ row }) => (
    <DiscrepancyCell
      preferred={row.effectiveStories}
      mls={row.stories}
      assessor={row.assessorStories}
      fmt={(n) => n.toString()}
    />
  ),
};
