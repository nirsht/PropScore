"use client";

import * as React from "react";
import { Box, Chip, LinearProgress, Paper, Stack, Tooltip, Typography } from "@mui/material";
import {
  DataGrid,
  type GridColDef,
  type GridRenderCellParams,
  type GridSortModel,
} from "@mui/x-data-grid";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import { keepPreviousData } from "@tanstack/react-query";
import type { RenovationLevel } from "@prisma/client";
import { trpc } from "@/lib/trpc/client";
import { useFilter } from "./filterStore";
import type { SortKey } from "@/server/api/schemas/filter";
import type { ListingRow } from "@/server/api/listings-search";
import { getDiscrepancyTone } from "@/lib/diff";

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

const PAGE_SIZE = 50;
const EMPTY_ROWS: ListingRow[] = [];

const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;
const fmtDecimal = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : Number(n).toFixed(digits);

function HeaderTooltip({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip title={hint} arrow placement="top">
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ cursor: "help" }}>
        <Typography variant="inherit" component="span">
          {label}
        </Typography>
        <HelpOutlineRoundedIcon sx={{ fontSize: 13, opacity: 0.55 }} />
      </Stack>
    </Tooltip>
  );
}

/**
 * Italic-muted cell used when the primary source is null and we're showing
 * an alternative (assessor / AI / lot). Always wrapped in a tooltip that
 * explains where the number came from.
 */
function FallbackCell({
  value,
  prefix,
  tooltip,
}: {
  value: string;
  prefix?: string;
  tooltip: string;
}) {
  return (
    <Tooltip arrow placement="top" title={tooltip}>
      <Box
        component="span"
        sx={{ color: "text.secondary", fontStyle: "italic", fontWeight: 500 }}
      >
        {prefix ? `${prefix} ${value}` : value}
      </Box>
    </Tooltip>
  );
}

function sumUnitMix(mix: unknown): number | null {
  if (!Array.isArray(mix) || mix.length === 0) return null;
  let total = 0;
  for (const entry of mix) {
    if (entry && typeof entry === "object" && "count" in entry) {
      const c = (entry as { count?: unknown }).count;
      if (typeof c === "number" && Number.isFinite(c)) total += c;
    }
  }
  return total > 0 ? total : null;
}

/**
 * Cell renderer that shows the resolved value (Assessor-first) and
 * highlights it green when assessor > MLS (upside) or red when assessor <
 * MLS (overstatement). Tooltip shows both numbers + tone.
 */
function DiscrepancyCell({
  preferred,
  mls,
  assessor,
  fmt,
}: {
  preferred: number | null | undefined;
  mls: number | null | undefined;
  assessor: number | null | undefined;
  fmt: (n: number) => string;
}) {
  const tone = getDiscrepancyTone(mls, assessor);
  const sx: Record<string, unknown> = {
    px: 1.25,
    py: 0.25,
    borderRadius: 999,
    fontWeight: tone === "neutral" ? 500 : 600,
    display: "inline-block",
    lineHeight: 1.6,
  };
  if (tone === "positive") {
    sx.bgcolor = "success.light";
    sx.color = "success.contrastText";
  } else if (tone === "negative") {
    sx.bgcolor = "error.light";
    sx.color = "error.contrastText";
  }
  const node = (
    <Box component="span" sx={sx}>
      {preferred == null ? "—" : fmt(preferred)}
    </Box>
  );
  if (tone === "neutral") return node;
  const tip =
    `MLS: ${mls != null ? fmt(mls) : "—"} · Assessor: ${assessor != null ? fmt(assessor) : "—"} ` +
    `(${tone === "positive" ? "Assessor larger — upside" : "Assessor smaller — MLS overstates"})`;
  return (
    <Tooltip title={tip} arrow placement="top">
      {node}
    </Tooltip>
  );
}

const columns: GridColDef<ListingRow>[] = [
  {
    field: "valueAddWeightedAvg",
    width: 110,
    renderHeader: () => (
      <HeaderTooltip
        label="Value-Add"
        hint="Weighted average of Density (25%), Vacancy (35%), Motivation (40%). 0–100. Default sort key. AI badge means the score came from the GPT scorer."
      />
    ),
    valueFormatter: (v) => fmtDecimal(v as number | null, 1),
    renderCell: ({ value, row }: GridRenderCellParams<ListingRow>) => (
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Box sx={{ fontWeight: 600 }}>{fmtDecimal(value as number | null, 1)}</Box>
        {row.scoreComputedBy === "AI" && <Chip size="small" color="primary" label="AI" />}
      </Stack>
    ),
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

const SORT_KEY_TO_FIELD: Record<SortKey, string> = {
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
};

const FIELD_TO_SORT_KEY: Record<string, SortKey> = Object.entries(SORT_KEY_TO_FIELD).reduce(
  (acc, [k, v]) => ({ ...acc, [v]: k as SortKey }),
  {} as Record<string, SortKey>,
);

type Props = {
  onSelectListing?: (mlsId: string) => void;
};

type Cursor = { sortValue: number | null; mlsId: string } | null;

export function ListingsGrid({ onSelectListing }: Props) {
  const { state, set } = useFilter();
  const [page, setPage] = React.useState(0);
  const [cursors, setCursors] = React.useState<Cursor[]>([null]);

  React.useEffect(() => {
    setPage(0);
    setCursors([null]);
  }, [
    state.q,
    state.city,
    state.propertyTypes,
    state.renovationLevel,
    state.price,
    state.pricePerSqft,
    state.pricePerUnit,
    state.sqft,
    state.units,
    state.beds,
    state.baths,
    state.yearBuilt,
    state.daysOnMls,
    state.occupancy,
    state.densityScore,
    state.vacancyScore,
    state.motivationScore,
    state.valueAddWeightedAvg,
    state.hasSizeDiscrepancy,
    state.radius,
    state.polygon,
    state.sortBy,
    state.sortDir,
  ]);

  const query = trpc.listings.search.useQuery(
    {
      ...state,
      cursor: cursors[page] ?? null,
      limit: PAGE_SIZE,
    },
    { placeholderData: keepPreviousData },
  );

  // Real total of the filtered set, independent of the cursor / page.
  const countQuery = trpc.listings.count.useQuery(
    { ...state, cursor: null, limit: PAGE_SIZE },
    { placeholderData: keepPreviousData, staleTime: 30_000 },
  );

  const sortBy = state.sortBy ?? "valueAdd";
  const sortDir = state.sortDir ?? "desc";
  const sortField = SORT_KEY_TO_FIELD[sortBy] ?? "valueAddWeightedAvg";

  // Stable refs so DataGrid doesn't re-fire onSortModelChange /
  // onPaginationModelChange during the parent render commit (which was
  // producing "state update on a component that hasn't mounted yet").
  const sortModel = React.useMemo<GridSortModel>(
    () => [{ field: sortField, sort: sortDir }],
    [sortField, sortDir],
  );
  const paginationModel = React.useMemo(
    () => ({ page, pageSize: PAGE_SIZE }),
    [page],
  );

  // DataGrid fires its change callbacks synchronously inside a layout
  // effect during its own mount, which lands inside ListingsGrid's render
  // commit and trips React 19's "state update on a component that hasn't
  // mounted yet" warning. Defer the parent/local state updates to a
  // microtask so they run after the current commit.
  const handleSort = React.useCallback(
    (model: GridSortModel) => {
      const item = model[0];
      if (!item) {
        if (sortBy !== "valueAdd" || sortDir !== "desc") {
          queueMicrotask(() => set({ sortBy: "valueAdd", sortDir: "desc" }));
        }
        return;
      }
      const key = FIELD_TO_SORT_KEY[item.field];
      if (!key) return;
      const nextDir = item.sort === "asc" ? "asc" : "desc";
      if (key === sortBy && nextDir === sortDir) return;
      queueMicrotask(() => set({ sortBy: key, sortDir: nextDir }));
    },
    [sortBy, sortDir, set],
  );

  const rows = query.data?.rows ?? EMPTY_ROWS;
  const nextCursor = query.data?.nextCursor;
  const handlePagination = React.useCallback(
    (model: { page: number; pageSize: number }) => {
      const next = model.page;
      if (next === page) return;
      queueMicrotask(() => {
        if (next > page) {
          setCursors((prev) => {
            if (prev[next] !== undefined) return prev;
            const copy = [...prev];
            copy[next] = nextCursor ?? null;
            return copy;
          });
        }
        setPage(next);
      });
    },
    [page, nextCursor],
  );

  const handleRowClick = React.useCallback(
    (params: { row: ListingRow }) => onSelectListing?.(params.row.mlsId),
    [onSelectListing],
  );

  const getRowId = React.useCallback((row: ListingRow) => row.mlsId, []);

  // Real count from the server; falls back to a synthetic value while the
  // count query is in flight so DataGrid can still paginate.
  const totalCount =
    countQuery.data ??
    page * PAGE_SIZE + rows.length + (nextCursor ? 1 : 0);

  return (
    <Paper variant="outlined" sx={{ borderColor: "divider" }}>
      {query.isFetching && <LinearProgress />}
      <Box sx={{ height: "calc(100vh - 360px)", minHeight: 400 }}>
        <DataGrid<ListingRow>
          rows={rows}
          columns={columns}
          getRowId={getRowId}
          density="compact"
          disableRowSelectionOnClick
          disableColumnMenu
          loading={query.isLoading}
          sortingMode="server"
          sortModel={sortModel}
          onSortModelChange={handleSort}
          paginationMode="server"
          rowCount={totalCount}
          paginationModel={paginationModel}
          pageSizeOptions={[PAGE_SIZE]}
          onPaginationModelChange={handlePagination}
          onRowClick={handleRowClick}
          sx={{
            border: 0,
            cursor: "pointer",
            "& .MuiDataGrid-columnHeaders": {
              backgroundColor: "background.default",
            },
            "& .MuiDataGrid-row:hover": {
              backgroundColor: "action.hover",
            },
          }}
        />
      </Box>
    </Paper>
  );
}
