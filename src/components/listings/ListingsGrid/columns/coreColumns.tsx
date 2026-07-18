import { Tooltip } from "@mui/material";
import { type GridColDef } from "@mui/x-data-grid";
import type { ListingRow } from "@/server/api/listings-search";
import { fmtMoney } from "../gridFormatters";
import { FallbackCell, HeaderTooltip, StarCell, StatusCell } from "../gridCells";

export const starredColumn: GridColDef<ListingRow> = {
  field: "__starred",
  headerName: "",
  width: 48,
  sortable: false,
  filterable: false,
  disableColumnMenu: true,
  renderCell: ({ row }) => <StarCell mlsId={row.mlsId} />,
};

export const dealStatusColumn: GridColDef<ListingRow> = {
  field: "__dealStatus",
  headerName: "Status",
  width: 130,
  sortable: false,
  filterable: false,
  disableColumnMenu: true,
  renderHeader: () => (
    <HeaderTooltip
      label="Status"
      hint="Your pipeline stage for this listing. Click to change. Untouched listings are 'New'."
    />
  ),
  renderCell: ({ row }) => <StatusCell mlsId={row.mlsId} />,
};

export const addressColumn: GridColDef<ListingRow> = {
  field: "address",
  headerName: "Address",
  flex: 1.4,
  minWidth: 220,
};

export const priceColumn: GridColDef<ListingRow> = {
  field: "price",
  width: 130,
  renderHeader: () => (
    <HeaderTooltip label="Price" hint="ListPrice from MLS in USD." />
  ),
  valueFormatter: (v) => fmtMoney(v as number | null),
};

export const daysOnMlsColumn: GridColDef<ListingRow> = {
  field: "daysOnMls",
  width: 80,
  type: "number",
  renderHeader: () => (
    <HeaderTooltip
      label="DOM"
      hint="Days since postDate (computed live at every search). Bridge's MLS DaysOnMarket field is a frozen snapshot and not used."
    />
  ),
  renderCell: ({ row }) => {
    if (row.daysOnMls == null) return <span>—</span>;
    const posted = row.postDate
      ? new Date(row.postDate).toLocaleDateString()
      : "unknown";
    return (
      <Tooltip arrow placement="top" title={`Posted ${posted}`}>
        <span>{row.daysOnMls}</span>
      </Tooltip>
    );
  },
};

export const postDateColumn: GridColDef<ListingRow> = {
  field: "postDate",
  headerName: "Posted",
  width: 110,
  valueFormatter: (v) =>
    v ? new Date(v as string | Date).toLocaleDateString() : "—",
};

export const listingUpdatedAtColumn: GridColDef<ListingRow> = {
  field: "listingUpdatedAt",
  headerName: "Updated",
  width: 110,
  valueFormatter: (v) =>
    v ? new Date(v as string | Date).toLocaleDateString() : "—",
};

export const propertyTypeColumn: GridColDef<ListingRow> = {
  field: "propertyType",
  headerName: "Type",
  width: 130,
};

export const yearBuiltColumn: GridColDef<ListingRow> = {
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
};
