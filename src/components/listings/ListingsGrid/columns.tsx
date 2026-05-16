import { Box, Chip, Stack, Tooltip, Typography } from "@mui/material";
import {
  type GridColDef,
  type GridRenderCellParams,
} from "@mui/x-data-grid";
import type { RenovationLevel } from "@prisma/client";
import type { ListingRow } from "@/server/api/listings-search";
import type { SortKey } from "@/server/api/schemas/filter";
import {
  RENO_COLOR,
  RENO_LABEL,
  fmtDecimal,
  fmtMoney,
  sumUnitMix,
} from "./gridFormatters";
import { DiscrepancyCell, FallbackCell, HeaderTooltip, StarCell } from "./gridCells";

export const columns: GridColDef<ListingRow>[] = [
  {
    field: "__starred",
    headerName: "",
    width: 48,
    sortable: false,
    filterable: false,
    disableColumnMenu: true,
    renderCell: ({ row }: GridRenderCellParams<ListingRow>) => (
      <StarCell mlsId={row.mlsId} />
    ),
  },
  {
    field: "valueAddWeightedAvg",
    width: 110,
    renderHeader: () => (
      <HeaderTooltip
        label="Value-Add"
        hint="Heuristic weighted average: Vacancy 35%, Location 25%, Density 20%, ADU 15%, Motivation 5%. 0–100. Always populated, refreshed every nightly."
      />
    ),
    valueFormatter: (v) => fmtDecimal(v as number | null, 1),
    renderCell: ({ value }: GridRenderCellParams<ListingRow>) => (
      <Box sx={{ fontWeight: 600 }}>{fmtDecimal(value as number | null, 1)}</Box>
    ),
  },
  {
    field: "aiValueAddWeightedAvg",
    width: 130,
    renderHeader: () => (
      <HeaderTooltip
        label="AI Value-Add"
        hint="GPT-5-mini's holistic 0–100 value-add score. Reasons over the same payload the heuristic uses plus the public remarks. Null until the listing has been AI-scored at least once (delta-only nightly)."
      />
    ),
    valueFormatter: (v) => fmtDecimal(v as number | null, 1),
    renderCell: ({ value, row }: GridRenderCellParams<ListingRow>) => {
      const v = value as number | null;
      if (v == null) {
        return (
          <Typography variant="caption" color="text.secondary">—</Typography>
        );
      }
      return (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Box sx={{ fontWeight: 600 }}>{fmtDecimal(v, 1)}</Box>
          {row.aiComputedAt && <Chip size="small" color="primary" label="AI" />}
        </Stack>
      );
    },
  },
  {
    field: "mlsId",
    headerName: "MLS ID",
    width: 130,
  },
  { field: "address", headerName: "Address", flex: 1.4, minWidth: 220 },
  {
    field: "price",
    width: 130,
    renderHeader: () => (
      <HeaderTooltip label="Price" hint="ListPrice from MLS in USD." />
    ),
    valueFormatter: (v) => fmtMoney(v as number | null),
  },
  {
    field: "daysOnMls",
    width: 80,
    type: "number",
    renderHeader: () => (
      <HeaderTooltip
        label="DOM"
        hint="DaysOnMarket from MLS, or computed from postDate if missing."
      />
    ),
  },
  {
    field: "postDate",
    headerName: "Posted",
    width: 110,
    valueFormatter: (v) =>
      v ? new Date(v as string | Date).toLocaleDateString() : "—",
  },
  {
    field: "listingUpdatedAt",
    headerName: "Updated",
    width: 110,
    valueFormatter: (v) =>
      v ? new Date(v as string | Date).toLocaleDateString() : "—",
  },
  {
    field: "densityScore",
    width: 90,
    renderHeader: () => (
      <HeaderTooltip
        label="Density"
        hint="0–100. Heuristic combining propertyType (multifamily +20), unit count, stories, beds. AI scoring overrides this with reasoned 0–100."
      />
    ),
    valueFormatter: (v) => fmtDecimal(v as number | null, 0),
  },
  {
    field: "vacancyScore",
    width: 90,
    renderHeader: () => (
      <HeaderTooltip
        label="Vacancy"
        hint="0–100, higher = likely vacant / under-occupied. Uses explicit occupancy if present, otherwise remark keywords (vacant, fully leased, etc.) and DOM."
      />
    ),
    valueFormatter: (v) => fmtDecimal(v as number | null, 0),
  },
  {
    field: "motivationScore",
    width: 100,
    renderHeader: () => (
      <HeaderTooltip
        label="Motivation"
        hint="0–100, higher = more motivated seller. Uses DOM bands, price drops (PreviousListPrice), and remark phrases like 'must sell', 'as-is', 'estate sale', short sale / REO."
      />
    ),
    valueFormatter: (v) => fmtDecimal(v as number | null, 0),
  },
  {
    field: "aiDensityScore",
    width: 95,
    renderHeader: () => (
      <HeaderTooltip
        label="AI Density"
        hint="GPT-5-mini's 0–100 density read. Null until AI-scored."
      />
    ),
    valueFormatter: (v) => fmtDecimal(v as number | null, 0),
    renderCell: ({ value }: GridRenderCellParams<ListingRow>) => {
      const v = value as number | null;
      if (v == null) return <Typography variant="caption" color="text.secondary">—</Typography>;
      return <span>{fmtDecimal(v, 0)}</span>;
    },
  },
  {
    field: "aiVacancyScore",
    width: 95,
    renderHeader: () => (
      <HeaderTooltip
        label="AI Vacancy"
        hint="GPT-5-mini's 0–100 vacancy read. Null until AI-scored."
      />
    ),
    valueFormatter: (v) => fmtDecimal(v as number | null, 0),
    renderCell: ({ value }: GridRenderCellParams<ListingRow>) => {
      const v = value as number | null;
      if (v == null) return <Typography variant="caption" color="text.secondary">—</Typography>;
      return <span>{fmtDecimal(v, 0)}</span>;
    },
  },
  {
    field: "aiMotivationScore",
    width: 110,
    renderHeader: () => (
      <HeaderTooltip
        label="AI Motivation"
        hint="GPT-5-mini's 0–100 seller-motivation read. Null until AI-scored."
      />
    ),
    valueFormatter: (v) => fmtDecimal(v as number | null, 0),
    renderCell: ({ value }: GridRenderCellParams<ListingRow>) => {
      const v = value as number | null;
      if (v == null) return <Typography variant="caption" color="text.secondary">—</Typography>;
      return <span>{fmtDecimal(v, 0)}</span>;
    },
  },
  { field: "propertyType", headerName: "Type", width: 130 },
  {
    field: "renovationLevel",
    width: 110,
    renderHeader: () => (
      <HeaderTooltip
        label="Reno"
        hint="Renovation level from AI vision: Distressed → Original → Updated → Renovated. A 4th input to the value-add weighted average."
      />
    ),
    renderCell: ({ value }: GridRenderCellParams<ListingRow>) => {
      const v = value as RenovationLevel | null;
      if (!v) return <Typography variant="caption" color="text.secondary">—</Typography>;
      return <Chip size="small" color={RENO_COLOR[v]} label={RENO_LABEL[v]} />;
    },
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
    field: "sqftPerUnit",
    width: 100,
    renderHeader: () => (
      <HeaderTooltip label="Sqft/Unit" hint="Generated column: sqft ÷ units." />
    ),
    valueFormatter: (v) => fmtDecimal(v as number | null, 0),
  },
  {
    field: "pricePerUnit",
    width: 130,
    renderHeader: () => (
      <HeaderTooltip
        label="Price/Unit"
        hint="Generated column: price ÷ units. Indexed for fast filtering."
      />
    ),
    valueFormatter: (v) => fmtMoney(v as number | null),
  },
  {
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
  },
  {
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
  },
  {
    field: "occupancy",
    headerName: "Occupancy",
    width: 100,
    valueFormatter: (v) =>
      v == null ? "—" : `${(Number(v) * 100).toFixed(0)}%`,
  },
  {
    field: "yearBuilt",
    headerName: "Year Built",
    width: 100,
    type: "number",
    renderCell: ({ row }) => {
      if (row.yearBuilt != null) return <span>{row.yearBuilt}</span>;
      if (row.assessorYearBuilt != null) {
        return (
          <FallbackCell
            value={row.assessorYearBuilt.toString()}
            tooltip="From SF Assessor — no MLS year built on file"
          />
        );
      }
      return <span>—</span>;
    },
  },
  {
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
  },
];

export const SORT_KEY_TO_FIELD: Record<SortKey, string> = {
  valueAdd: "valueAddWeightedAvg",
  price: "price",
  pricePerSqft: "pricePerSqft",
  pricePerUnit: "pricePerUnit",
  daysOnMls: "daysOnMls",
  postDate: "postDate",
  yearBuilt: "yearBuilt",
  density: "densityScore",
  vacancy: "vacancyScore",
  motivation: "motivationScore",
  valueAddAi: "aiValueAddWeightedAvg",
  densityAi: "aiDensityScore",
  vacancyAi: "aiVacancyScore",
  motivationAi: "aiMotivationScore",
};

export const FIELD_TO_SORT_KEY: Record<string, SortKey> = Object.entries(SORT_KEY_TO_FIELD).reduce(
  (acc, [k, v]) => ({ ...acc, [v]: k as SortKey }),
  {} as Record<string, SortKey>,
);
