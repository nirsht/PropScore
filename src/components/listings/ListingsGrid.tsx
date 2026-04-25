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
import { trpc } from "@/lib/trpc/client";
import { useFilter } from "./filterStore";
import type { SortKey } from "@/server/api/schemas/filter";
import type { ListingRow } from "@/server/api/listings-search";
import { EnrichWithAIButton } from "./EnrichWithAIButton";

const PAGE_SIZE = 50;

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
  { field: "sqft", headerName: "Sqft", width: 90, type: "number" },
  {
    field: "pricePerSqft",
    width: 100,
    renderHeader: () => (
      <HeaderTooltip
        label="$/Sqft"
        hint="Generated column: price ÷ sqft. Indexed for fast filtering."
      />
    ),
    valueFormatter: (v) => fmtMoney(v as number | null),
  },
  { field: "units", headerName: "Units", width: 80, type: "number" },
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
  { field: "beds", headerName: "Beds", width: 70, type: "number" },
  { field: "baths", headerName: "Baths", width: 70, type: "number" },
  {
    field: "occupancy",
    headerName: "Occupancy",
    width: 100,
    valueFormatter: (v) =>
      v == null ? "—" : `${(Number(v) * 100).toFixed(0)}%`,
  },
  { field: "yearBuilt", headerName: "Year Built", width: 100, type: "number" },
  { field: "stories", headerName: "Stori", width: 80, type: "number" },
  {
    field: "_actions",
    headerName: "",
    width: 130,
    sortable: false,
    filterable: false,
    renderCell: ({ row }) => <EnrichWithAIButton mlsId={row.mlsId} />,
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

export function ListingsGrid({ onSelectListing }: Props) {
  const { state, set } = useFilter();
  const [page, setPage] = React.useState(0);
  const [cursors, setCursors] = React.useState<Array<typeof state.cursor | null>>([null]);

  React.useEffect(() => {
    setPage(0);
    setCursors([null]);
  }, [
    state.q,
    state.propertyTypes,
    state.price,
    state.pricePerSqft,
    state.pricePerUnit,
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

  const handleSort = React.useCallback(
    (model: GridSortModel) => {
      const item = model[0];
      if (!item) {
        if (sortBy !== "valueAdd" || sortDir !== "desc") {
          set({ sortBy: "valueAdd", sortDir: "desc" });
        }
        return;
      }
      const key = FIELD_TO_SORT_KEY[item.field];
      if (!key) return;
      const nextDir = item.sort === "asc" ? "asc" : "desc";
      // Bail out if nothing changed — DataGrid fires this during initial
      // render with the model we already passed in.
      if (key === sortBy && nextDir === sortDir) return;
      set({ sortBy: key, sortDir: nextDir });
    },
    [sortBy, sortDir, set],
  );

  const rows = query.data?.rows ?? [];
  const nextCursor = query.data?.nextCursor;
  const handlePagination = React.useCallback(
    (model: { page: number; pageSize: number }) => {
      const next = model.page;
      if (next === page) return;
      if (next > page) {
        setCursors((prev) => {
          if (prev[next] !== undefined) return prev;
          const copy = [...prev];
          copy[next] = nextCursor ?? null;
          return copy;
        });
      }
      setPage(next);
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
