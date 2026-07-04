"use client";

import * as React from "react";
import {
  Alert,
  Box,
  Chip,
  Dialog,
  IconButton,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import GavelRoundedIcon from "@mui/icons-material/GavelRounded";
import { trpc } from "@/lib/trpc/client";

type DetailRecord = {
  complaintNumber?: string | null;
  dateFiled?: string | null;
  dateOpened?: string | null;
  status?: string | null;
  description?: string | null;
  address?: string | null;
};

const KIND_COPY = {
  nov: { title: "Open NOVs & history", noun: "NOV" },
  complaint: { title: "DBI complaints & history", noun: "complaint" },
} as const;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function RiskComplianceDetailDialog({
  open,
  onClose,
  kind,
  mlsId,
}: {
  open: boolean;
  onClose: () => void;
  kind: "nov" | "complaint";
  mlsId: string;
}) {
  const novQuery = trpc.listings.getCodeEnforcementDetail.useQuery(
    { mlsId },
    { enabled: open && kind === "nov", staleTime: 5 * 60_000 },
  );
  const complaintQuery = trpc.listings.getComplaintsDetail.useQuery(
    { mlsId },
    { enabled: open && kind === "complaint", staleTime: 5 * 60_000 },
  );
  const query = kind === "nov" ? novQuery : complaintQuery;
  const records: DetailRecord[] = query.data?.records ?? [];
  const copy = KIND_COPY[kind];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: "divider" }}
      >
        <GavelRoundedIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {copy.title}
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseRoundedIcon />
        </IconButton>
      </Stack>

      <Box sx={{ p: 2, maxHeight: "70vh", overflowY: "auto" }}>
        {query.isLoading && (
          <Stack spacing={1.5}>
            <Skeleton variant="rectangular" height={72} />
            <Skeleton variant="rectangular" height={72} />
          </Stack>
        )}

        {!query.isLoading && query.data?.error && (
          <Alert severity="warning">
            Couldn&apos;t load {copy.noun} details right now — try again in a moment.
          </Alert>
        )}

        {!query.isLoading && !query.data?.error && records.length === 0 && (
          <Alert severity="info">No {copy.noun} records found on this parcel.</Alert>
        )}

        {!query.isLoading && records.length > 0 && (
          <Stack spacing={1.5}>
            {records.map((r, i) => {
              const date = kind === "nov" ? r.dateFiled : r.dateOpened;
              return (
                <Box
                  key={r.complaintNumber ?? i}
                  sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }}
                >
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    flexWrap="wrap"
                    useFlexGap
                    sx={{ mb: 0.5 }}
                  >
                    {r.status && (
                      <Chip
                        size="small"
                        label={r.status}
                        color={r.status.toLowerCase() === "active" ? "warning" : "default"}
                        variant={r.status.toLowerCase() === "active" ? "filled" : "outlined"}
                      />
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {fmtDate(date)}
                    </Typography>
                    {r.complaintNumber && (
                      <Typography variant="caption" color="text.secondary">
                        · #{r.complaintNumber}
                      </Typography>
                    )}
                  </Stack>
                  <Typography variant="body2">
                    {r.description || "No description on file."}
                  </Typography>
                  {r.address && (
                    <Typography variant="caption" color="text.secondary">
                      {r.address}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>
    </Dialog>
  );
}
