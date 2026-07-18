"use client";

import * as React from "react";
import {
  Box,
  Button,
  Chip,
  Divider,
  Link as MuiLink,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import SyncRoundedIcon from "@mui/icons-material/SyncRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import { trpc } from "@/lib/trpc/client";

type RentRollEntryUI = {
  // null when the unit is vacant — the parser keeps the row and nulls the rent.
  rent: number | null;
  beds: number | null;
  baths: number | null;
  sqft?: number | null;
  unitLabel?: string | null;
};

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

export function ThreadDetail({ threadId }: { threadId: string }) {
  const utils = trpc.useUtils();
  const thread = trpc.emails.getThread.useQuery({ threadId });
  const sync = trpc.emails.syncNow.useMutation({
    onSuccess: () => {
      void utils.emails.getThread.invalidate({ threadId });
      void utils.emails.listThreads.invalidate();
    },
  });
  const parse = trpc.emails.parseMessage.useMutation({
    onSuccess: () => {
      void utils.emails.getThread.invalidate({ threadId });
      void utils.emails.listThreads.invalidate();
    },
  });

  if (!thread.data) return null;
  const t = thread.data;
  const draftUrl = t.gmailDraftId
    ? `https://mail.google.com/mail/u/0/#drafts?compose=${t.gmailDraftId}`
    : null;
  const threadUrl = t.gmailThreadId
    ? `https://mail.google.com/mail/u/0/#all/${t.gmailThreadId}`
    : null;
  const gmailUrl = draftUrl ?? threadUrl;

  // The most recent inbound message with a parsed rent roll is what's
  // ground-truth for the listing. We surface it as a table.
  const inboundWithRoll = [...t.messages]
    .reverse()
    .find(
      (m) =>
        m.direction === "INBOUND" &&
        Array.isArray(m.parsedRentRoll) &&
        (m.parsedRentRoll as unknown[]).length > 0,
    );
  const parsedRoll =
    (inboundWithRoll?.parsedRentRoll as RentRollEntryUI[] | undefined) ?? null;

  const lastInbound = [...t.messages]
    .reverse()
    .find((m) => m.direction === "INBOUND");

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Chip
          size="small"
          color={STATUS_COLOR[t.status] ?? "default"}
          label={t.status.toLowerCase()}
        />
        <Typography variant="h6" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {t.listing.address}
        </Typography>
        <MuiLink
          href={`/listings?focus=${encodeURIComponent(t.listing.mlsId)}`}
          variant="caption"
        >
          Open listing
        </MuiLink>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <Typography variant="caption" color="text.secondary">
          To: {t.toEmail}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          · Trigger: {t.trigger}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          · Created: {new Date(t.createdAt).toLocaleString()}
        </Typography>
        {t.sentAt && (
          <Typography variant="caption" color="text.secondary">
            · Sent: {new Date(t.sentAt).toLocaleString()}
          </Typography>
        )}
        {t.lastSyncedAt && (
          <Typography variant="caption" color="text.secondary">
            · Last synced: {new Date(t.lastSyncedAt).toLocaleString()}
          </Typography>
        )}
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        {gmailUrl && (
          <Button
            size="small"
            variant="outlined"
            component={MuiLink}
            href={gmailUrl}
            target="_blank"
            rel="noopener"
            endIcon={<OpenInNewRoundedIcon fontSize="small" />}
          >
            Open in Gmail
          </Button>
        )}
        <Button
          size="small"
          variant="outlined"
          startIcon={<SyncRoundedIcon />}
          disabled={sync.isPending}
          onClick={() => sync.mutate({ threadId })}
        >
          {sync.isPending ? "Syncing…" : "Sync"}
        </Button>
        {lastInbound && (
          <Tooltip title="Re-run the GPT-5 rent-roll parser on the latest reply">
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ReplayRoundedIcon />}
                disabled={parse.isPending}
                onClick={() =>
                  parse.mutate({ messageId: lastInbound.id })
                }
              >
                {parse.isPending ? "Parsing…" : "Re-parse"}
              </Button>
            </span>
          </Tooltip>
        )}
      </Stack>

      {t.parseError && (
        <Box
          sx={{
            p: 1.5,
            mb: 2,
            bgcolor: "error.50",
            border: 1,
            borderColor: "error.200",
            borderRadius: 1,
          }}
        >
          <Typography variant="caption" color="error.main">
            Parse error: {t.parseError}
          </Typography>
        </Box>
      )}

      {parsedRoll && parsedRoll.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              fontWeight: 600,
              letterSpacing: 0.4,
              textTransform: "uppercase",
            }}
          >
            Parsed rent roll · {parsedRoll.length} units · $
            {parsedRoll
              .reduce((s, r) => s + (r.rent ?? 0), 0)
              .toLocaleString()}{" "}
            / mo
          </Typography>
          <Box sx={{ mt: 0.75, overflowX: "auto" }}>
            <Box
              component="table"
              sx={{
                width: "100%",
                fontSize: 13,
                borderCollapse: "collapse",
                "& th, & td": {
                  textAlign: "left",
                  py: 0.5,
                  px: 1,
                  borderBottom: 1,
                  borderColor: "divider",
                },
                "& th": { color: "text.secondary", fontWeight: 600 },
              }}
            >
              <Box component="thead">
                <Box component="tr">
                  <Box component="th">Unit</Box>
                  <Box component="th">Beds</Box>
                  <Box component="th">Baths</Box>
                  <Box component="th">Sqft</Box>
                  <Box component="th" sx={{ textAlign: "right !important" }}>
                    Rent
                  </Box>
                </Box>
              </Box>
              <Box component="tbody">
                {parsedRoll.map((r, i) => (
                  <Box component="tr" key={i}>
                    <Box component="td">{r.unitLabel ?? `#${i + 1}`}</Box>
                    <Box component="td">{r.beds ?? "—"}</Box>
                    <Box component="td">{r.baths ?? "—"}</Box>
                    <Box component="td">{r.sqft ?? "—"}</Box>
                    <Box component="td" sx={{ textAlign: "right !important" }}>
                      {r.rent != null ? `$${r.rent.toLocaleString()}` : "Vacant"}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      <Divider sx={{ my: 2 }} />

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          fontWeight: 600,
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        Messages
      </Typography>
      <Stack spacing={1.5} sx={{ mt: 1 }}>
        {t.messages.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No messages yet. Open the draft in Gmail and send it to start the
            thread.
          </Typography>
        )}
        {t.messages.map((m) => (
          <Box
            key={m.id}
            sx={{
              borderLeft: 3,
              borderColor:
                m.direction === "INBOUND" ? "warning.main" : "info.main",
              pl: 1.5,
              py: 0.5,
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip
                size="small"
                variant="outlined"
                label={m.direction.toLowerCase()}
                sx={{ height: 18 }}
              />
              <Typography variant="caption" color="text.secondary">
                {new Date(m.receivedAt).toLocaleString()} · {m.fromEmail}
              </Typography>
            </Stack>
            <Typography variant="body2" sx={{ fontWeight: 500, mt: 0.25 }}>
              {m.subject}
            </Typography>
            {m.bodyText && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}
              >
                {m.bodyText.slice(0, 800)}
                {m.bodyText.length > 800 ? "…" : ""}
              </Typography>
            )}
            {Array.isArray(m.attachments) && m.attachments.length > 0 && (
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                {(m.attachments as Array<{ filename: string }>).map((a, i) => (
                  <Chip
                    key={i}
                    size="small"
                    variant="outlined"
                    label={a.filename}
                    sx={{ height: 18 }}
                  />
                ))}
              </Stack>
            )}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
