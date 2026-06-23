"use client";

import { Tooltip, Typography } from "@mui/material";
import { formatAgo } from "@/lib/formatAgo";

/**
 * Small "Updated 3 days ago" caption rendered alongside each enrichment
 * card in the listing drawer. Renders nothing when the timestamp is
 * missing — the caller doesn't need to gate it.
 */
export function DataFreshness({
  updatedAt,
  label = "Updated",
}: {
  updatedAt: Date | string | null | undefined;
  label?: string;
}) {
  const ago = formatAgo(updatedAt);
  if (!ago) return null;

  // Absolute timestamp on hover so the user can disambiguate a vague
  // "3 days ago" without having to dig into the raw JSON tab.
  const iso =
    typeof updatedAt === "string"
      ? updatedAt
      : updatedAt instanceof Date
        ? updatedAt.toISOString()
        : "";
  const tooltip = iso ? new Date(iso).toLocaleString() : ago;

  return (
    <Tooltip title={tooltip} placement="top" arrow>
      <Typography
        variant="caption"
        component="span"
        sx={{ color: "text.secondary", whiteSpace: "nowrap" }}
      >
        {label} {ago}
      </Typography>
    </Tooltip>
  );
}
