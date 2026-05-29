import { Box, Chip, Stack, Typography } from "@mui/material";
import {
  type GridColDef,
  type GridRenderCellParams,
} from "@mui/x-data-grid";
import type { RenovationLevel } from "@prisma/client";
import type { ListingRow } from "@/server/api/listings-search";
import { RENO_COLOR, RENO_LABEL, fmtDecimal } from "../gridFormatters";
import { HeaderTooltip } from "../gridCells";

const renderHeuristicWithAi = (
  aiValue: number | null,
  heuristicValue: number | null,
) => {
  if (aiValue == null && heuristicValue == null) {
    return <Typography variant="caption" color="text.secondary">—</Typography>;
  }
  if (aiValue == null) {
    return <span>{fmtDecimal(heuristicValue, 0)}</span>;
  }
  return (
    <Stack direction="row" spacing={0.5} alignItems="baseline">
      <Box sx={{ fontWeight: 600 }}>{fmtDecimal(aiValue, 0)}</Box>
      {heuristicValue != null && (
        <Typography variant="caption" color="text.secondary">
          ({fmtDecimal(heuristicValue, 0)})
        </Typography>
      )}
    </Stack>
  );
};

export const valueAddColumn: GridColDef<ListingRow> = {
  field: "valueAddWeightedAvg",
  width: 110,
  renderHeader: () => (
    <HeaderTooltip
      label="Value-Add"
      hint="Heuristic weighted average: Vacancy 30%, Location 20%, Density 15%, Rehab 15%, ADU 15%, Motivation 5%. 0–100. Always populated, refreshed every nightly."
    />
  ),
  valueFormatter: (v) => fmtDecimal(v as number | null, 1),
  renderCell: ({ value }: GridRenderCellParams<ListingRow>) => (
    <Box sx={{ fontWeight: 600 }}>{fmtDecimal(value as number | null, 1)}</Box>
  ),
};

export const aiValueAddColumn: GridColDef<ListingRow> = {
  field: "aiValueAddWeightedAvg",
  width: 130,
  renderHeader: () => (
    <HeaderTooltip
      label="AI Value-Add"
      hint="GPT-5-mini's holistic 0–100 value-add score. Reasons over the same payload the heuristic uses plus the public remarks. Null until the listing has been AI-scored at least once (delta-only nightly)."
    />
  ),
  valueFormatter: (v) => fmtDecimal(v as number | null, 1),
  renderCell: ({ value }: GridRenderCellParams<ListingRow>) => {
    const v = value as number | null;
    if (v == null) {
      return <Typography variant="caption" color="text.secondary">—</Typography>;
    }
    return <Box sx={{ fontWeight: 600 }}>{fmtDecimal(v, 1)}</Box>;
  },
};

export const densityColumn: GridColDef<ListingRow> = {
  field: "densityScore",
  width: 110,
  renderHeader: () => (
    <HeaderTooltip
      label="Density"
      hint="0–100. AI score (bold) when available, heuristic in parens. Heuristic combines propertyType (multifamily +20), unit count, stories, beds; AI reasons over the same payload plus public remarks."
    />
  ),
  valueFormatter: (v) => fmtDecimal(v as number | null, 0),
  renderCell: ({ row }: GridRenderCellParams<ListingRow>) =>
    renderHeuristicWithAi(row.aiDensityScore, row.densityScore),
};

export const vacancyColumn: GridColDef<ListingRow> = {
  field: "vacancyScore",
  width: 110,
  renderHeader: () => (
    <HeaderTooltip
      label="Vacancy"
      hint="0–100, higher = likely vacant / under-occupied. AI score (bold) when available, heuristic in parens. Heuristic uses explicit occupancy if present, otherwise remark keywords (vacant, fully leased, etc.) and DOM."
    />
  ),
  valueFormatter: (v) => fmtDecimal(v as number | null, 0),
  renderCell: ({ row }: GridRenderCellParams<ListingRow>) =>
    renderHeuristicWithAi(row.aiVacancyScore, row.vacancyScore),
};

export const motivationColumn: GridColDef<ListingRow> = {
  field: "motivationScore",
  width: 120,
  renderHeader: () => (
    <HeaderTooltip
      label="Motivation"
      hint="0–100, higher = more motivated seller. AI score (bold) when available, heuristic in parens. Heuristic uses DOM bands, price drops, and remark phrases like 'must sell', 'as-is', 'estate sale', short sale / REO."
    />
  ),
  valueFormatter: (v) => fmtDecimal(v as number | null, 0),
  renderCell: ({ row }: GridRenderCellParams<ListingRow>) =>
    renderHeuristicWithAi(row.aiMotivationScore, row.motivationScore),
};

export const renovationLevelColumn: GridColDef<ListingRow> = {
  field: "renovationLevel",
  width: 110,
  renderHeader: () => (
    <HeaderTooltip
      label="Reno"
      hint="Renovation level from AI vision (interior photos: kitchen + bath finishes, fixtures, appliances; falls back to exterior signal). Distressed → Original → Updated → Renovated. Anchors the Rehab Potential driver (15%) in the value-add weighted average."
    />
  ),
  renderCell: ({ value }: GridRenderCellParams<ListingRow>) => {
    const v = value as RenovationLevel | null;
    if (!v) return <Typography variant="caption" color="text.secondary">—</Typography>;
    return <Chip size="small" color={RENO_COLOR[v]} label={RENO_LABEL[v]} />;
  },
};
