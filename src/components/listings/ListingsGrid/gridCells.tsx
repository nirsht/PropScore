"use client";

import * as React from "react";
import {
  Box,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowDropDownRoundedIcon from "@mui/icons-material/ArrowDropDownRounded";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import StarRounded from "@mui/icons-material/StarRounded";
import StarBorderRounded from "@mui/icons-material/StarBorderRounded";
import type { DealStatus } from "@prisma/client";
import { trpc } from "@/lib/trpc/client";
import { getDiscrepancyTone } from "@/lib/diff";
import {
  STATUS_OPTIONS,
  STATUS_OPTION_BY_VALUE,
} from "../FilterBar/filterConstants";

export function HeaderTooltip({ label, hint }: { label: string; hint: string }) {
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

/**
 * Italic-muted cell used when the primary source is null and we're showing
 * an alternative (assessor / AI / lot). Always wrapped in a tooltip that
 * explains where the number came from.
 */
export function FallbackCell({
  value,
  prefix,
  tooltip,
}: {
  value: string;
  prefix?: string;
  tooltip: string;
}) {
  return (
    <Tooltip arrow placement="top" title={tooltip}>
      <Box
        component="span"
        sx={{ color: "text.secondary", fontStyle: "italic", fontWeight: 500 }}
      >
        {prefix ? `${prefix} ${value}` : value}
      </Box>
    </Tooltip>
  );
}

/**
 * Cell renderer that shows the resolved value (Assessor-first) and
 * highlights it green when assessor > MLS (upside) or red when assessor <
 * MLS (overstatement). Tooltip shows both numbers + tone.
 */
export function DiscrepancyCell({
  preferred,
  mls,
  assessor,
  fmt,
}: {
  preferred: number | null | undefined;
  mls: number | null | undefined;
  assessor: number | null | undefined;
  fmt: (n: number) => string;
}) {
  const tone = getDiscrepancyTone(mls, assessor);
  const sx: Record<string, unknown> = {
    px: 1.25,
    py: 0.25,
    borderRadius: 999,
    fontWeight: tone === "neutral" ? 500 : 600,
    display: "inline-block",
    lineHeight: 1.6,
  };
  if (tone === "positive") {
    sx.bgcolor = "success.light";
    sx.color = "success.contrastText";
  } else if (tone === "negative") {
    sx.bgcolor = "error.light";
    sx.color = "error.contrastText";
  }
  const node = (
    <Box component="span" sx={sx}>
      {preferred == null ? "—" : fmt(preferred)}
    </Box>
  );
  if (tone === "neutral") return node;
  const tip =
    `MLS: ${mls != null ? fmt(mls) : "—"} · Assessor: ${assessor != null ? fmt(assessor) : "—"} ` +
    `(${tone === "positive" ? "Assessor larger — upside" : "Assessor smaller — MLS overstates"})`;
  return (
    <Tooltip title={tip} arrow placement="top">
      {node}
    </Tooltip>
  );
}

/**
 * Star icon for marking a listing as a favorite. Reads the user's starred
 * mlsIds from a single cached query and toggles via optimistic mutation.
 * Stops click propagation so the surrounding row-click handler doesn't
 * also open the drawer.
 */
export function StarCell({ mlsId }: { mlsId: string }) {
  const utils = trpc.useUtils();
  const starredQuery = trpc.starredListings.list.useQuery(undefined, {
    staleTime: 60_000,
  });
  const starred = starredQuery.data ?? [];
  const isStarred = starred.includes(mlsId);
  const toggle = trpc.starredListings.toggle.useMutation({
    onMutate: async () => {
      await utils.starredListings.list.cancel();
      const prev = utils.starredListings.list.getData() ?? [];
      utils.starredListings.list.setData(
        undefined,
        isStarred ? prev.filter((id) => id !== mlsId) : [mlsId, ...prev],
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx) utils.starredListings.list.setData(undefined, ctx.prev);
    },
    onSettled: () => {
      utils.starredListings.list.invalidate();
      utils.listings.search.invalidate();
      utils.listings.count.invalidate();
    },
  });
  return (
    <Tooltip title={isStarred ? "Unstar" : "Star"} arrow placement="top">
      <IconButton
        size="small"
        aria-label={isStarred ? "Unstar listing" : "Star listing"}
        onClick={(e) => {
          e.stopPropagation();
          toggle.mutate({ mlsId });
        }}
        sx={{ color: isStarred ? "warning.main" : "text.disabled" }}
      >
        {isStarred ? (
          <StarRounded fontSize="small" />
        ) : (
          <StarBorderRounded fontSize="small" />
        )}
      </IconButton>
    </Tooltip>
  );
}

/**
 * Inline deal-status dropdown. Reads the shared review map from a single
 * cached query (listings absent from the map are NEW) and writes via an
 * optimistic mutation, invalidating the listing search so an active status
 * filter re-runs. Rendered as a compact colored chip that opens a menu;
 * stops click propagation so changing status doesn't also open the drawer.
 */
export function StatusCell({ mlsId }: { mlsId: string }) {
  const utils = trpc.useUtils();
  const reviewsQuery = trpc.listingReviews.list.useQuery(undefined, {
    staleTime: 60_000,
  });
  const status: DealStatus = reviewsQuery.data?.[mlsId] ?? "NEW";
  const opt = STATUS_OPTION_BY_VALUE[status];
  const [anchor, setAnchor] = React.useState<null | HTMLElement>(null);

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

  return (
    <>
      <Chip
        size="small"
        label={opt.label}
        color={opt.color !== "default" ? opt.color : undefined}
        variant={opt.color !== "default" ? "filled" : "outlined"}
        deleteIcon={<ArrowDropDownRoundedIcon />}
        onDelete={(e) => {
          e.stopPropagation();
          setAnchor(e.currentTarget.parentElement as HTMLElement);
        }}
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(e.currentTarget);
        }}
        sx={{ cursor: "pointer", fontWeight: 500, maxWidth: "100%" }}
      />
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        onClick={(e) => e.stopPropagation()}
      >
        {STATUS_OPTIONS.map((o) => (
          <MenuItem
            key={o.value}
            selected={o.value === status}
            onClick={(e) => {
              e.stopPropagation();
              setAnchor(null);
              if (o.value !== status) setStatus.mutate({ mlsId, status: o.value });
            }}
          >
            <Chip
              size="small"
              label={o.label}
              color={o.color !== "default" ? o.color : undefined}
              variant={o.color !== "default" ? "filled" : "outlined"}
              sx={{ pointerEvents: "none" }}
            />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
