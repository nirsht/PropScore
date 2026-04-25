"use client";

import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
import AutoFixHighOutlinedIcon from "@mui/icons-material/AutoFixHighOutlined";
import { trpc } from "@/lib/trpc/client";
import type { RentGrowthOutput } from "@/server/agents/rent-growth/schema";

const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;

const fmtPct = (n: number | null | undefined) =>
  n == null ? "—" : `${Math.round(n)}%`;

export function RentGrowthCard({ mlsId }: { mlsId: string }) {
  const utils = trpc.useUtils();
  const cached = trpc.agents.latestRentGrowth.useQuery({ mlsId });

  const compute = trpc.agents.rentGrowth.useMutation({
    onSuccess: () => {
      void utils.agents.latestRentGrowth.invalidate({ mlsId });
    },
  });

  const result: RentGrowthOutput | null =
    (compute.data as RentGrowthOutput | undefined) ??
    (cached.data?.output as RentGrowthOutput | undefined) ??
    null;

  const isStale =
    !!cached.data && !compute.data
      ? Date.now() - new Date(cached.data.createdAt).getTime() > 1000 * 60 * 60 * 24 * 30
      : false;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <TrendingUpRoundedIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2">Rent-growth potential</Typography>
        {result && <ConfidenceChip confidence={result.confidence} />}
        <Box sx={{ flex: 1 }} />
        <Tooltip title="GPT analyses the listing description and field data to estimate rent upside.">
          <span>
            <Button
              size="small"
              variant={result ? "outlined" : "contained"}
              startIcon={
                compute.isPending ? (
                  <CircularProgress size={14} />
                ) : (
                  <AutoFixHighOutlinedIcon fontSize="small" />
                )
              }
              disabled={compute.isPending}
              onClick={() => compute.mutate({ mlsId })}
            >
              {compute.isPending
                ? "Analyzing…"
                : result
                ? "Re-run"
                : "Estimate rent upside"}
            </Button>
          </span>
        </Tooltip>
      </Stack>

      {compute.error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {compute.error.message}
        </Alert>
      )}

      {!result && !compute.isPending && (
        <Typography variant="body2" color="text.secondary">
          Click <em>Estimate rent upside</em> to have GPT extract current vs.
          market rent signals from the description.
        </Typography>
      )}

      {result && (
        <Stack spacing={1.75}>
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
            <Metric
              label="Estimated rent (mo)"
              primary={fmtMoney(result.marketRent?.totalMonthly ?? null)}
              secondary={
                result.marketRent
                  ? `${fmtMoney(result.marketRent.perUnitMonthly)}/unit`
                  : "—"
              }
              hint={result.marketRent?.methodology ?? undefined}
              emphasis
            />
            <Metric
              label="Current rent (mo)"
              primary={fmtMoney(result.currentRent?.totalMonthly ?? null)}
              secondary={
                result.currentRent
                  ? result.currentRent.source === "unknown"
                    ? "not in description"
                    : `${fmtMoney(result.currentRent.perUnitMonthly)}/unit · ${result.currentRent.source}`
                  : "—"
              }
            />
            <Metric
              label="Monthly upside"
              primary={
                result.monthlyUpside != null
                  ? fmtMoney(result.monthlyUpside)
                  : "—"
              }
            />
            <Metric
              label="Annual upside"
              primary={
                result.annualUpside != null
                  ? fmtMoney(result.annualUpside)
                  : "—"
              }
            />
            <Metric label="Upside %" primary={fmtPct(result.upsidePercent)} />
          </Stack>

          {result.currentRent?.source === "unknown" && result.marketRent?.totalMonthly != null && (
            <Alert severity="info" variant="outlined" sx={{ py: 0.5 }}>
              The description doesn&apos;t disclose current rents, so the upside fields
              are blank. The estimated rent above is a data-driven projection
              using units, beds, sqft, year built, and city.
            </Alert>
          )}

          {result.rationale && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                Rationale
              </Typography>
              <Typography variant="body2">{result.rationale}</Typography>
            </Box>
          )}

          {result.signals.length > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                Signals from description
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                {result.signals.map((s, i) => (
                  <Chip key={i} size="small" variant="outlined" label={s} />
                ))}
              </Stack>
            </Box>
          )}

          {cached.data && !compute.data && (
            <Typography variant="caption" color="text.secondary">
              Cached estimate from {new Date(cached.data.createdAt).toLocaleString()}
              {isStale ? " · stale (>30d)" : ""}
            </Typography>
          )}
        </Stack>
      )}
    </Paper>
  );
}

function ConfidenceChip({ confidence }: { confidence: "low" | "medium" | "high" }) {
  const color = confidence === "high" ? "success" : confidence === "medium" ? "warning" : "default";
  return <Chip size="small" color={color} label={`${confidence} confidence`} />;
}

function Metric({
  label,
  primary,
  secondary,
  emphasis,
  hint,
}: {
  label: string;
  primary: string;
  secondary?: string;
  emphasis?: boolean;
  hint?: string;
}) {
  return (
    <Box>
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        {hint && (
          <Tooltip title={hint} arrow placement="top">
            <HelpOutlineRoundedIcon
              sx={{ fontSize: 12, opacity: 0.55, cursor: "help" }}
            />
          </Tooltip>
        )}
      </Stack>
      <Typography
        variant={emphasis ? "h6" : "body1"}
        sx={{
          fontWeight: emphasis ? 700 : 500,
          color: emphasis ? "primary.main" : "text.primary",
          lineHeight: 1.2,
        }}
      >
        {primary}
      </Typography>
      {secondary && (
        <Typography variant="caption" color="text.secondary">
          {secondary}
        </Typography>
      )}
    </Box>
  );
}
