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
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SyncRoundedIcon from "@mui/icons-material/SyncRounded";
import MailOutlineRoundedIcon from "@mui/icons-material/MailOutlineRounded";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import { trpc } from "@/lib/trpc/client";
import { ConnectGmailPill } from "./ConnectGmailPill";
import { ThreadDetail } from "./ThreadDetail";
import { EmailStatsHeader } from "./EmailStatsHeader";
import {
  MultiSelectFilter,
  type ChipColor,
} from "@/components/common/MultiSelectFilter";

type ThreadStatus = "DRAFT" | "SENT" | "REPLIED" | "PARSED" | "FAILED";
type TriggerKind = "manual" | "auto_under_450";

const STATUS_OPTIONS: Array<{ value: ThreadStatus; label: string; color: ChipColor }> = [
  { value: "DRAFT", label: "Draft", color: "default" },
  { value: "SENT", label: "Sent", color: "info" },
  { value: "REPLIED", label: "Replied", color: "warning" },
  { value: "PARSED", label: "Parsed", color: "success" },
  { value: "FAILED", label: "Failed", color: "error" },
];

const TRIGGER_OPTIONS: Array<{ value: TriggerKind; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "auto_under_450", label: "Auto < $450/sqft" },
];

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

export function EmailsView() {
  const [statusFilter, setStatusFilter] = React.useState<ThreadStatus[]>([]);
  const [triggerFilter, setTriggerFilter] = React.useState<TriggerKind[]>([]);
  // Single sender control: "all" (default) shows the whole team and drafts as
  // me; a userId filters the list + stats to that person AND drafts into their
  // mailbox.
  const [sender, setSender] = React.useState<string>("all");
  const [search, setSearch] = React.useState<string>("");
  const [selectedThreadId, setSelectedThreadId] = React.useState<string | null>(
    null,
  );

  const utils = trpc.useUtils();
  const connection = trpc.emails.connectionStatus.useQuery();
  const mailboxes = trpc.emails.connectedMailboxes.useQuery();
  const myUserId = connection.data?.userId ?? null;
  const myName = connection.data?.name ?? null;

  // "All" + one entry per connected mailbox ("Me (name)" for the caller).
  const senderChoices = [
    { value: "all", label: "All senders" },
    ...(mailboxes.data ?? []).map((m) => ({
      value: m.id,
      label:
        m.id === myUserId
          ? `Me${myName ? ` (${myName})` : ""}`
          : m.name || m.email,
    })),
  ];
  const senderUserId = sender === "all" ? undefined : [sender];

  const threads = trpc.emails.listThreads.useQuery({
    status: statusFilter.length ? statusFilter : undefined,
    trigger: triggerFilter.length ? triggerFilter : undefined,
    senderUserId,
  });
  const syncAll = trpc.emails.syncNow.useMutation({
    onSuccess: () => {
      void utils.emails.listThreads.invalidate();
      void utils.emails.teamStats.invalidate();
      if (selectedThreadId)
        void utils.emails.getThread.invalidate({ threadId: selectedThreadId });
    },
  });
  const [bulkResult, setBulkResult] = React.useState<string | null>(null);
  const bulkDraft = trpc.emails.bulkDraftUnderThreshold.useMutation({
    onSuccess: (res) => {
      void utils.emails.listThreads.invalidate();
      void utils.emails.teamStats.invalidate();
      setBulkResult(
        res.total === 0
          ? `No new listings under $${res.threshold}/sqft to draft.`
          : `Drafted ${res.drafted} · skipped ${res.skipped} · ${res.total} candidate${res.total === 1 ? "" : "s"}.`,
      );
    },
    onError: (err) => setBulkResult(err.message),
  });

  const allRows = threads.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = q
    ? allRows.filter(
        (t) =>
          t.listing.address.toLowerCase().includes(q) ||
          t.toEmail.toLowerCase().includes(q),
      )
    : allRows;

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
            Team rent-roll outreach — one thread per listing, drafts only, sent
            from each person&apos;s Gmail.
          </Typography>
        </Box>
        <ConnectGmailPill />
      </Stack>

      {/* Sender filter — sits above the stats so picking a teammate recomputes
          the tiles below, filters the list, and drafts into their mailbox. */}
      {senderChoices.length > 1 && (
        <Box sx={{ mb: 2 }}>
          <TextField
            select
            size="small"
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            InputProps={{
              startAdornment: (
                <PersonOutlineRoundedIcon
                  fontSize="small"
                  sx={{ mr: 0.5, color: "text.secondary" }}
                />
              ),
            }}
            sx={{ minWidth: 200 }}
          >
            {senderChoices.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      )}

      <EmailStatsHeader senderUserId={senderUserId} />

      <Stack
        direction="row"
        spacing={1.5}
        sx={{ mb: 2 }}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
      >
        <Box sx={{ minWidth: 220 }}>
          <MultiSelectFilter
            options={STATUS_OPTIONS}
            value={STATUS_OPTIONS.filter((o) => statusFilter.includes(o.value))}
            onChange={(next) => setStatusFilter(next.map((o) => o.value))}
            getOptionLabel={(o) => o.label}
            getOptionKey={(o) => o.value}
            getOptionColor={(o) => o.color}
            placeholder="All statuses"
            allLabel="All statuses"
          />
        </Box>
        <Box sx={{ minWidth: 220 }}>
          <MultiSelectFilter
            options={TRIGGER_OPTIONS}
            value={TRIGGER_OPTIONS.filter((o) => triggerFilter.includes(o.value))}
            onChange={(next) => setTriggerFilter(next.map((o) => o.value))}
            getOptionLabel={(o) => o.label}
            getOptionKey={(o) => o.value}
            placeholder="All triggers"
            allLabel="All triggers"
          />
        </Box>
        <TextField
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search address…"
          InputProps={{
            startAdornment: (
              <SearchRoundedIcon
                fontSize="small"
                sx={{ mr: 0.5, color: "text.secondary" }}
              />
            ),
          }}
          sx={{ minWidth: 220, flex: { xs: "1 1 100%", sm: "0 1 280px" } }}
        />
        <Box sx={{ flex: 1 }} />
        {bulkResult && (
          <Typography variant="caption" color="text.secondary">
            {bulkResult}
          </Typography>
        )}
        <Tooltip
          title={
            sender === "all"
              ? "Draft (into your mailbox) rent-roll requests for every Active listing under the price/sqft threshold whose agent nobody on the team has emailed yet"
              : `Draft into ${senderChoices.find((o) => o.value === sender)?.label ?? "the selected"}'s mailbox for every under-threshold listing whose agent nobody has emailed yet`
          }
        >
          <span>
            <Button
              size="small"
              variant="outlined"
              startIcon={<MailOutlineRoundedIcon />}
              disabled={bulkDraft.isPending}
              onClick={() => {
                setBulkResult(null);
                bulkDraft.mutate(
                  sender !== "all" ? { senderUserId: sender } : undefined,
                );
              }}
            >
              {bulkDraft.isPending ? "Drafting…" : "Draft rent-roll requests"}
            </Button>
          </span>
        </Tooltip>
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

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        alignItems="flex-start"
      >
        <Paper
          variant="outlined"
          sx={{
            flex: 1,
            minWidth: 0,
            p: 0,
            maxHeight: "calc(100vh - 200px)",
            overflowY: "auto",
          }}
        >
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
                  {search.trim()
                    ? `No threads match “${search.trim()}”.`
                    : "No threads yet. Open a listing and click the rent-roll button on the listing agent row to start."}
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
                  <Tooltip title={`Sent by ${t.user?.name || t.user?.email || "—"}`}>
                    <Chip
                      size="small"
                      variant="outlined"
                      icon={<PersonOutlineRoundedIcon sx={{ fontSize: 12 }} />}
                      label={t.user?.name || t.user?.email || "—"}
                      sx={{ height: 20, maxWidth: 140, fontSize: 11 }}
                    />
                  </Tooltip>
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

        <Paper
          variant="outlined"
          sx={{
            flex: 1.5,
            minWidth: 0,
            p: 2,
            position: { md: "sticky" },
            top: { md: 16 },
            maxHeight: { md: "calc(100vh - 200px)" },
            overflowY: { md: "auto" },
          }}
        >
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
