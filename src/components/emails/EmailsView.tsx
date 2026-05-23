"use client";

import * as React from "react";
import {
  Box,
  Button,
  Chip,
  Container,
  Divider,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import SyncRoundedIcon from "@mui/icons-material/SyncRounded";
import { trpc } from "@/lib/trpc/client";
import { ConnectGmailPill } from "./ConnectGmailPill";
import { ThreadDetail } from "./ThreadDetail";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "SENT", label: "Sent" },
  { value: "REPLIED", label: "Replied" },
  { value: "PARSED", label: "Parsed" },
  { value: "FAILED", label: "Failed" },
] as const;

const TRIGGER_OPTIONS = [
  { value: "all", label: "All triggers" },
  { value: "manual", label: "Manual" },
  { value: "auto_under_450", label: "Auto < $450/sqft" },
] as const;

const STATUS_COLOR: Record<
  string,
  "default" | "info" | "warning" | "success" | "error"
> = {
  DRAFT: "default",
  SENT: "info",
  REPLIED: "warning",
  PARSED: "success",
  FAILED: "error",
};

type StatusValue = (typeof STATUS_OPTIONS)[number]["value"];
type TriggerValue = (typeof TRIGGER_OPTIONS)[number]["value"];
type ThreadStatusFilter = Exclude<StatusValue, "all">;
type TriggerFilter = Exclude<TriggerValue, "all">;

export function EmailsView() {
  const [statusFilter, setStatusFilter] = React.useState<StatusValue>("all");
  const [triggerFilter, setTriggerFilter] = React.useState<TriggerValue>("all");
  const [selectedThreadId, setSelectedThreadId] = React.useState<string | null>(
    null,
  );

  const utils = trpc.useUtils();
  const threads = trpc.emails.listThreads.useQuery({
    status: statusFilter === "all" ? undefined : (statusFilter as ThreadStatusFilter),
    trigger: triggerFilter === "all" ? undefined : (triggerFilter as TriggerFilter),
  });
  const syncAll = trpc.emails.syncNow.useMutation({
    onSuccess: () => {
      void utils.emails.listThreads.invalidate();
      if (selectedThreadId)
        void utils.emails.getThread.invalidate({ threadId: selectedThreadId });
    },
  });

  const rows = threads.data ?? [];

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            Emails
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Rent-roll outreach to listing agents — drafts only, send from Gmail.
          </Typography>
        </Box>
        <ConnectGmailPill />
      </Stack>

      <Stack direction="row" spacing={1.5} sx={{ mb: 2 }} alignItems="center">
        <Select
          size="small"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusValue)}
        >
          {STATUS_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </Select>
        <Select
          size="small"
          value={triggerFilter}
          onChange={(e) => setTriggerFilter(e.target.value as TriggerValue)}
        >
          {TRIGGER_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </Select>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Poll Gmail for new replies on every thread">
          <span>
            <Button
              size="small"
              variant="outlined"
              startIcon={<SyncRoundedIcon />}
              disabled={syncAll.isPending}
              onClick={() => syncAll.mutate({})}
            >
              {syncAll.isPending ? "Syncing…" : "Sync all"}
            </Button>
          </span>
        </Tooltip>
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="stretch">
        <Paper variant="outlined" sx={{ flex: 1, minWidth: 0, p: 0 }}>
          <Stack divider={<Divider flexItem />}>
            {rows.length === 0 && (
              <Box
                sx={{
                  p: 3,
                  textAlign: "center",
                  minHeight: 320,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  No threads yet. Open a listing and click the rent-roll button
                  on the listing agent row to start.
                </Typography>
              </Box>
            )}
            {rows.map((t) => (
              <Box
                key={t.id}
                onClick={() => setSelectedThreadId(t.id)}
                sx={{
                  p: 1.5,
                  cursor: "pointer",
                  bgcolor:
                    selectedThreadId === t.id ? "action.selected" : "transparent",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Chip
                    size="small"
                    color={STATUS_COLOR[t.status] ?? "default"}
                    label={t.status.toLowerCase()}
                    sx={{ height: 20, minWidth: 60 }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                      {t.listing.address}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      noWrap
                      sx={{ display: "block" }}
                    >
                      {t.toEmail} · {new Date(t.createdAt).toLocaleDateString()}
                      {t.listing.sqft && t.listing.price
                        ? ` · $${Math.round(t.listing.price / t.listing.sqft)}/sqft`
                        : ""}
                    </Typography>
                  </Box>
                  {t.trigger === "auto_under_450" && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label="auto"
                      sx={{ height: 18, fontSize: 10 }}
                    />
                  )}
                </Stack>
              </Box>
            ))}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ flex: 1.5, minWidth: 0, p: 2 }}>
          {selectedThreadId ? (
            <ThreadDetail threadId={selectedThreadId} />
          ) : (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ textAlign: "center", py: 8 }}
            >
              Select a thread to view messages and parsed rent roll.
            </Typography>
          )}
        </Paper>
      </Stack>
    </Container>
  );
}
