import { type GridColDef } from "@mui/x-data-grid";
import type { ListingRow } from "@/server/api/listings-search";
import {
  addressColumn,
  daysOnMlsColumn,
  listingUpdatedAtColumn,
  mlsIdColumn,
  occupancyColumn,
  postDateColumn,
  priceColumn,
  propertyTypeColumn,
  starredColumn,
  yearBuiltColumn,
} from "./columns/coreColumns";
import {
  aiDensityColumn,
  aiMotivationColumn,
  aiValueAddColumn,
  aiVacancyColumn,
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
  valueAddColumn,
  aiValueAddColumn,
  mlsIdColumn,
  addressColumn,
  priceColumn,
  daysOnMlsColumn,
  postDateColumn,
  listingUpdatedAtColumn,
  densityColumn,
  vacancyColumn,
  motivationColumn,
  aiDensityColumn,
  aiVacancyColumn,
  aiMotivationColumn,
  propertyTypeColumn,
  renovationLevelColumn,
  effectiveSqftColumn,
  pricePerSqftColumn,
  effectiveUnitsColumn,
  sqftPerUnitColumn,
  pricePerUnitColumn,
  bedsColumn,
  bathsColumn,
  occupancyColumn,
  yearBuiltColumn,
  effectiveStoriesColumn,
];
