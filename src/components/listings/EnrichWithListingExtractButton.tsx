"use client";

import * as React from "react";
import { Button, CircularProgress, Tooltip } from "@mui/material";
import AutoFixHighRoundedIcon from "@mui/icons-material/AutoFixHighRounded";
import { trpc } from "@/lib/trpc/client";

export function EnrichWithListingExtractButton({ mlsId }: { mlsId: string }) {
  const utils = trpc.useUtils();
  const listingExtract = trpc.agents.listingExtract.useMutation({
    onSuccess: () => {
      void utils.listings.search.invalidate();
      void utils.listings.getById.invalidate({ mlsId });
      void utils.agents.latestListingExtract.invalidate({ mlsId });
    },
  });

  return (
    <Tooltip title="Parse public/private remarks for unit mix, rent roll, recent capex, and ADU potential.">
      <span>
        <Button
          size="small"
          variant="outlined"
          color="secondary"
          startIcon={
            listingExtract.isPending ? (
              <CircularProgress size={14} />
            ) : (
              <AutoFixHighRoundedIcon fontSize="small" />
            )
          }
          disabled={listingExtract.isPending}
          onClick={() => listingExtract.mutate({ mlsId })}
        >
          Extract details
        </Button>
      </span>
    </Tooltip>
  );
}
