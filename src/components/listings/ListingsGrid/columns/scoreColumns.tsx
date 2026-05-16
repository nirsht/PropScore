import { Box, Chip, Stack, Typography } from "@mui/material";
import {
  type GridColDef,
  type GridRenderCellParams,
} from "@mui/x-data-grid";
import type { RenovationLevel } from "@prisma/client";
import type { ListingRow } from "@/server/api/listings-search";
import { RENO_COLOR, RENO_LABEL, fmtDecimal } from "../gridFormatters";
import { HeaderTooltip } from "../gridCells";

const aiScoreRenderCell = ({ value }: GridRenderCellParams<ListingRow>) => {
  const v = value as number | null;
  if (v == null)
    return <Typography variant="caption" color="text.secondary">—</Typography>;
  return <span>{fmtDecimal(v, 0)}</span>;
};

export const valueAddColumn: GridColDef<ListingRow> = {
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
  renderCell: ({ value, row }: GridRenderCellParams<ListingRow>) => {
    const v = value as number | null;
    if (v == null) {
      return <Typography variant="caption" color="text.secondary">—</Typography>;
    }
    return (
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Box sx={{ fontWeight: 600 }}>{fmtDecimal(v, 1)}</Box>
        {row.aiComputedAt && <Chip size="small" color="primary" label="AI" />}
      </Stack>
    );
  },
};

export const densityColumn: GridColDef<ListingRow> = {
  field: "densityScore",
  width: 90,
  renderHeader: () => (
    <HeaderTooltip
      label="Density"
      hint="0–100. Heuristic combining propertyType (multifamily +20), unit count, stories, beds. AI scoring overrides this with reasoned 0–100."
    />
  ),
  valueFormatter: (v) => fmtDecimal(v as number | null, 0),
};

export const vacancyColumn: GridColDef<ListingRow> = {
  field: "vacancyScore",
  width: 90,
  renderHeader: () => (
    <HeaderTooltip
      label="Vacancy"
      hint="0–100, higher = likely vacant / under-occupied. Uses explicit occupancy if present, otherwise remark keywords (vacant, fully leased, etc.) and DOM."
    />
  ),
  valueFormatter: (v) => fmtDecimal(v as number | null, 0),
};

export const motivationColumn: GridColDef<ListingRow> = {
  field: "motivationScore",
  width: 100,
  renderHeader: () => (
    <HeaderTooltip
      label="Motivation"
      hint="0–100, higher = more motivated seller. Uses DOM bands, price drops (PreviousListPrice), and remark phrases like 'must sell', 'as-is', 'estate sale', short sale / REO."
    />
  ),
  valueFormatter: (v) => fmtDecimal(v as number | null, 0),
};

export const aiDensityColumn: GridColDef<ListingRow> = {
  field: "aiDensityScore",
  width: 95,
  renderHeader: () => (
    <HeaderTooltip
      label="AI Density"
      hint="GPT-5-mini's 0–100 density read. Null until AI-scored."
    />
  ),
  valueFormatter: (v) => fmtDecimal(v as number | null, 0),
  renderCell: aiScoreRenderCell,
};

export const aiVacancyColumn: GridColDef<ListingRow> = {
  field: "aiVacancyScore",
  width: 95,
  renderHeader: () => (
    <HeaderTooltip
      label="AI Vacancy"
      hint="GPT-5-mini's 0–100 vacancy read. Null until AI-scored."
    />
  ),
  valueFormatter: (v) => fmtDecimal(v as number | null, 0),
  renderCell: aiScoreRenderCell,
};

export const aiMotivationColumn: GridColDef<ListingRow> = {
  field: "aiMotivationScore",
  width: 110,
  renderHeader: () => (
    <HeaderTooltip
      label="AI Motivation"
      hint="GPT-5-mini's 0–100 seller-motivation read. Null until AI-scored."
    />
  ),
  valueFormatter: (v) => fmtDecimal(v as number | null, 0),
  renderCell: aiScoreRenderCell,
};

export const renovationLevelColumn: GridColDef<ListingRow> = {
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
};
