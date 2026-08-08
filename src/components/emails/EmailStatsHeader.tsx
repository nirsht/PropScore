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
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        px: 2,
        py: 1.25,
        flex: 1,
        minWidth: 120,
        bgcolor: emphasis ? "action.hover" : "background.paper",
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

export function EmailStatsHeader() {
  const stats = trpc.emails.teamStats.useQuery();
  const d = stats.data;
  if (!d) return null;

  const replyPct = Math.round(d.replyRate * 100);
  const maxUser = Math.max(1, ...d.perUser.map((u) => u.total));

  return (
    <Stack spacing={1.5} sx={{ mb: 2 }}>
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
        <StatTile label="Total outreach" value={String(d.total)} />
        <StatTile
          label="Sent"
          value={String(
            d.statusCounts.SENT + d.statusCounts.REPLIED + d.statusCounts.PARSED,
          )}
          hint={`${d.statusCounts.DRAFT} still draft`}
        />
        <StatTile
          label="Replies"
          value={String(d.statusCounts.REPLIED + d.statusCounts.PARSED)}
          hint={`${replyPct}% reply rate`}
          emphasis
        />
        <StatTile
          label="Rent rolls parsed"
          value={String(d.statusCounts.PARSED)}
        />
        <StatTile
          label="Un-contacted"
          value={String(d.uncontacted)}
          hint={`under $${d.threshold}/sqft`}
        />
      </Stack>

      {/* Status funnel — a single stacked bar of the thread statuses. */}
      {d.total > 0 && (
        <Box>
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
          <Stack direction="row" spacing={1} sx={{ mt: 0.75 }} flexWrap="wrap" useFlexGap>
            {STATUS_META.map((s) => (
              <Stack key={s.key} direction="row" spacing={0.5} alignItems="center">
                <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: s.color }} />
                <Typography variant="caption" color="text.secondary">
                  {s.label} {d.statusCounts[s.key] ?? 0}
                </Typography>
              </Stack>
            ))}
          </Stack>
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
