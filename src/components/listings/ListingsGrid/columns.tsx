import { type GridColDef } from "@mui/x-data-grid";
import type { ListingRow } from "@/server/api/listings-search";
import {
  addressColumn,
  daysOnMlsColumn,
  dealStatusColumn,
  listingUpdatedAtColumn,
  postDateColumn,
  priceColumn,
  propertyTypeColumn,
  starredColumn,
  yearBuiltColumn,
} from "./columns/coreColumns";
import {
  aiValueAddColumn,
  densityColumn,
  motivationColumn,
  renovationLevelColumn,
  vacancyColumn,
  valueAddColumn,
} from "./columns/scoreColumns";
import {
  bathsColumn,
  bedsColumn,
  effectiveSqftColumn,
  effectiveStoriesColumn,
  effectiveUnitsColumn,
  pricePerSqftColumn,
  pricePerUnitColumn,
  sqftPerUnitColumn,
} from "./columns/sizeColumns";

export { FIELD_TO_SORT_KEY, SORT_KEY_TO_FIELD } from "./columnSortMapping";

export const columns: GridColDef<ListingRow>[] = [
  starredColumn,
  dealStatusColumn,
  valueAddColumn,
  aiValueAddColumn,
  addressColumn,
  priceColumn,
  daysOnMlsColumn,
  densityColumn,
  vacancyColumn,
  motivationColumn,
  propertyTypeColumn,
  renovationLevelColumn,
  effectiveSqftColumn,
  pricePerSqftColumn,
  effectiveUnitsColumn,
  sqftPerUnitColumn,
  pricePerUnitColumn,
  bedsColumn,
  bathsColumn,
  yearBuiltColumn,
  effectiveStoriesColumn,
  postDateColumn,
  listingUpdatedAtColumn,
];
