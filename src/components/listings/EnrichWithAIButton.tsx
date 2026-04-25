"use client";

import * as React from "react";
import { Button, CircularProgress, Tooltip } from "@mui/material";
import AutoFixHighOutlinedIcon from "@mui/icons-material/AutoFixHighOutlined";
import { trpc } from "@/lib/trpc/client";

export function EnrichWithAIButton({ mlsId }: { mlsId: string }) {
  const utils = trpc.useUtils();
  const aiScore = trpc.agents.aiScore.useMutation({
    onSuccess: () => {
      void utils.listings.search.invalidate();
      void utils.listings.getById.invalidate({ mlsId });
    },
  });

  return (
    <Tooltip title="Re-score with AI">
      <span>
        <Button
          size="small"
          variant="outlined"
          startIcon={
            aiScore.isPending ? (
              <CircularProgress size={14} />
            ) : (
              <AutoFixHighOutlinedIcon fontSize="small" />
            )
          }
          disabled={aiScore.isPending}
          onClick={() => aiScore.mutate({ mlsId })}
        >
          AI score
        </Button>
      </span>
    </Tooltip>
  );
}
