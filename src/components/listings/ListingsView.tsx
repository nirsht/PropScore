"use client";

import { Stack, Typography } from "@mui/material";
import { FilterProvider } from "./filterStore";
import { FilterBar } from "./FilterBar";
import { NLQueryBox } from "./NLQueryBox";
import { ListingsGrid } from "./ListingsGrid";
import { ListingDrawer } from "./ListingDrawer";
import { useSelectedListing } from "./useSelectedListing";

export function ListingsView() {
  const [selectedMlsId, setSelectedMlsId] = useSelectedListing();

  return (
    <FilterProvider>
      <Stack spacing={2}>
        <Stack direction="row" alignItems="baseline" spacing={2}>
          <Typography variant="h5">Opportunities</Typography>
          <Typography variant="body2" color="text.secondary">
            Sorted by Value-Add Weighted Avg — click any row for details
          </Typography>
        </Stack>
        <NLQueryBox />
        <FilterBar />
        <ListingsGrid onSelectListing={setSelectedMlsId} />
      </Stack>
      <ListingDrawer mlsId={selectedMlsId} onClose={() => setSelectedMlsId(null)} />
    </FilterProvider>
  );
}
