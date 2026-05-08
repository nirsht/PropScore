"use client";

import * as React from "react";
import { Box, LinearProgress, Paper } from "@mui/material";
import {
  DataGrid,
  type GridSortModel,
} from "@mui/x-data-grid";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc/client";
import { useFilter } from "./filterStore";
import type { ListingRow } from "@/server/api/listings-search";
import { columns, FIELD_TO_SORT_KEY, SORT_KEY_TO_FIELD } from "./ListingsGrid/columns";
import { EMPTY_ROWS, PAGE_SIZE } from "./ListingsGrid/gridConstants";

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

  const sortModel = React.useMemo<GridSortModel>(
    () => [{ field: sortField, sort: sortDir }],
    [sortField, sortDir],
  );
  const paginationModel = React.useMemo(
    () => ({ page, pageSize: PAGE_SIZE }),
    [page],
  );

  // DataGrid v7 + React 19: DataGrid schedules state updates during its
  // first commit (controlled paginationModel/sortModel reconciliation),
  // which fires before ListingsGrid finishes mounting and trips React 19's
  // "state update on a component that hasn't mounted yet" warning. Defer
  // mounting DataGrid by one tick so its callbacks land on a mounted parent.
  const [postMount, setPostMount] = React.useState(false);
  React.useEffect(() => {
    setPostMount(true);
  }, []);

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
      if (key === sortBy && nextDir === sortDir) return;
      set({ sortBy: key, sortDir: nextDir });
    },
    [sortBy, sortDir, set],
  );

  const rows = query.data?.rows ?? EMPTY_ROWS;
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
        {postMount && (
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
        )}
      </Box>
    </Paper>
  );
}
