"use client";

import * as React from "react";
import { Button, CircularProgress, Tooltip } from "@mui/material";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import { trpc } from "@/lib/trpc/client";

export function EnrichWithVisionButton({ mlsId }: { mlsId: string }) {
  const utils = trpc.useUtils();
  const buildingVision = trpc.agents.buildingVision.useMutation({
    onSuccess: () => {
      void utils.listings.search.invalidate();
      void utils.listings.getById.invalidate({ mlsId });
    },
  });

  return (
    <Tooltip title="Pick the best exterior photo and analyze the building (stories, basement, renovation level)">
      <span>
        <Button
          size="small"
          variant="outlined"
          color="secondary"
          startIcon={
            buildingVision.isPending ? (
              <CircularProgress size={14} />
            ) : (
              <VisibilityRoundedIcon fontSize="small" />
            )
          }
          disabled={buildingVision.isPending}
          onClick={() => buildingVision.mutate({ mlsId })}
        >
          Analyze building
        </Button>
      </span>
    </Tooltip>
  );
}
