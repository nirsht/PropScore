"use client";

import * as React from "react";
import {
  Chip,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { DealStatus } from "@prisma/client";
import { trpc } from "@/lib/trpc/client";
import {
  STATUS_OPTIONS,
  STATUS_OPTION_BY_VALUE,
} from "../FilterBar/filterConstants";

/**
 * Deal-workspace card in the listing drawer: the pipeline-status selector plus
 * a free-text review-notes field. Status shares the same `listingReviews.list`
 * cache the grid's inline dropdown uses, so both stay in sync. Notes autosave
 * on blur (and are seeded from `listingReviews.get`).
 */
export function DealWorkspaceCard({ mlsId }: { mlsId: string }) {
  const utils = trpc.useUtils();
  const reviewsQuery = trpc.listingReviews.list.useQuery(undefined, {
    staleTime: 60_000,
  });
  const reviewQuery = trpc.listingReviews.get.useQuery({ mlsId });

  const status: DealStatus = reviewsQuery.data?.[mlsId] ?? "NEW";

  const setStatus = trpc.listingReviews.setStatus.useMutation({
    onMutate: async ({ status: next }) => {
      await utils.listingReviews.list.cancel();
      const prev = utils.listingReviews.list.getData();
      utils.listingReviews.list.setData(undefined, {
        ...(prev ?? {}),
        [mlsId]: next,
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) utils.listingReviews.list.setData(undefined, ctx.prev);
    },
    onSettled: () => {
      utils.listingReviews.list.invalidate();
      utils.listingReviews.get.invalidate({ mlsId });
      utils.listings.search.invalidate();
      utils.listings.count.invalidate();
    },
  });

  const setNote = trpc.listingReviews.setNote.useMutation({
    onSettled: () => utils.listingReviews.get.invalidate({ mlsId }),
  });

  // Local notes buffer so typing is smooth; commit on blur.
  const savedNote = reviewQuery.data?.note ?? "";
  const [note, setNote_] = React.useState(savedNote);
  // Re-seed when switching listings or when the server value first arrives.
  React.useEffect(() => {
    setNote_(savedNote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mlsId, reviewQuery.data?.note]);

  const commitNote = () => {
    if (note === savedNote) return;
    setNote.mutate({ mlsId, note });
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack spacing={1.25}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.5}
          justifyContent="space-between"
        >
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              textTransform: "uppercase",
              letterSpacing: 0.4,
              fontWeight: 600,
            }}
          >
            Deal status
          </Typography>
          <Select
            size="small"
            value={status}
            onChange={(e) =>
              setStatus.mutate({ mlsId, status: e.target.value as DealStatus })
            }
            renderValue={(v) => {
              const opt = STATUS_OPTION_BY_VALUE[v as DealStatus];
              return (
                <Chip
                  size="small"
                  label={opt.label}
                  color={opt.color !== "default" ? opt.color : undefined}
                  variant={opt.color !== "default" ? "filled" : "outlined"}
                  sx={{ pointerEvents: "none" }}
                />
              );
            }}
            sx={{ minWidth: 150, "& .MuiSelect-select": { py: 0.5 } }}
          >
            {STATUS_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                <Chip
                  size="small"
                  label={o.label}
                  color={o.color !== "default" ? o.color : undefined}
                  variant={o.color !== "default" ? "filled" : "outlined"}
                  sx={{ pointerEvents: "none" }}
                />
              </MenuItem>
            ))}
          </Select>
        </Stack>

        <TextField
          label="Review notes"
          placeholder="Toured the property, condition, concerns, next steps…"
          value={note}
          onChange={(e) => setNote_(e.target.value)}
          onBlur={commitNote}
          multiline
          minRows={2}
          maxRows={12}
          fullWidth
          size="small"
        />
      </Stack>
    </Paper>
  );
}
