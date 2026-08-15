"use client";

import * as React from "react";
import {
  Box,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { trpc } from "@/lib/trpc/client";

function StatTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  // Optional status color, painted as a left rail so each tile reads as its
  // status at a glance.
  accent?: string;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        px: 2,
        py: 1.25,
        flex: 1,
        minWidth: 120,
        borderLeft: accent ? 4 : undefined,
        borderLeftColor: accent,
      }}
    >
      <Typography variant="caption" color="text.secondary" noWrap>
        {label}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary" noWrap>
          {hint}
        </Typography>
      )}
    </Paper>
  );
}

type StatusKey = "DRAFT" | "SENT" | "REPLIED" | "PARSED" | "FAILED";

const STATUS_META: Array<{ key: StatusKey; label: string; color: string }> = [
  { key: "DRAFT", label: "Draft", color: "grey.500" },
  { key: "SENT", label: "Sent", color: "info.main" },
  { key: "REPLIED", label: "Replied", color: "warning.main" },
  { key: "PARSED", label: "Parsed", color: "success.main" },
  { key: "FAILED", label: "Failed", color: "error.main" },
];

export function EmailStatsHeader({
  senderUserId,
}: {
  senderUserId?: string[];
}) {
  const stats = trpc.emails.teamStats.useQuery(
    senderUserId ? { senderUserId } : undefined,
  );
  const d = stats.data;
  if (!d) return null;

  const maxUser = Math.max(1, ...d.perUser.map((u) => u.total));

  return (
    <Stack spacing={1.5} sx={{ mb: 2 }}>
      {/* One tile per status — the raw counts, matching the funnel below. */}
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
        {STATUS_META.map((s) => (
          <StatTile
            key={s.key}
            label={s.label}
            value={String(d.statusCounts[s.key] ?? 0)}
            accent={s.color}
          />
        ))}
        <StatTile
          label="Un-contacted"
          value={String(d.uncontacted)}
          hint={`under $${d.threshold}/sqft`}
        />
      </Stack>

      {/* Status funnel — a single stacked bar of the thread statuses. */}
      {d.total > 0 && (
        <Box
          sx={{
            display: "flex",
            height: 10,
            borderRadius: 1,
            overflow: "hidden",
            border: 1,
            borderColor: "divider",
          }}
        >
          {STATUS_META.map((s) => {
            const n = d.statusCounts[s.key] ?? 0;
            if (n === 0) return null;
            return (
              <Tooltip key={s.key} title={`${s.label}: ${n}`}>
                <Box
                  sx={{
                    width: `${(n / d.total) * 100}%`,
                    bgcolor: s.color,
                  }}
                />
              </Tooltip>
            );
          })}
        </Box>
      )}

      {/* Per-user breakdown — who's driving the outreach. */}
      {d.perUser.length > 0 && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            By teammate
          </Typography>
          <Stack spacing={1} sx={{ mt: 1 }}>
            {d.perUser.map((u) => (
              <Stack key={u.userId} direction="row" spacing={1.5} alignItems="center">
                <Box sx={{ width: 160, minWidth: 160 }}>
                  <Typography variant="body2" noWrap>
                    {u.name || u.email}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <LinearProgress
                    variant="determinate"
                    value={(u.total / maxUser) * 100}
                    sx={{ height: 8, borderRadius: 1 }}
                  />
                </Box>
                <Stack direction="row" spacing={0.5}>
                  <Chip size="small" variant="outlined" label={`${u.total} total`} />
                  <Chip
                    size="small"
                    color="warning"
                    variant="outlined"
                    label={`${u.replied + u.parsed} replied`}
                  />
                </Stack>
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
