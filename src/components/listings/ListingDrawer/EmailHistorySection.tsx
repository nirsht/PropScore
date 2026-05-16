"use client";

import * as React from "react";
import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Link as MuiLink,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import ExpandLessRoundedIcon from "@mui/icons-material/ExpandLessRounded";
import SyncRoundedIcon from "@mui/icons-material/SyncRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import { trpc } from "@/lib/trpc/client";

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

export function EmailHistorySection({ listingMlsId }: { listingMlsId: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const utils = trpc.useUtils();
  const thread = trpc.emails.forListing.useQuery({ listingMlsId });
  const sync = trpc.emails.syncNow.useMutation({
    onSuccess: () => {
      void utils.emails.forListing.invalidate({ listingMlsId });
      void utils.listings.getById.invalidate({ mlsId: listingMlsId });
    },
  });

  if (!thread.data) return null;
  const t = thread.data;
  const status = t.status;
  const messages = t.messages;
  const lastMsg = messages[messages.length - 1];
  const draftUrl = t.gmailDraftId
    ? `https://mail.google.com/mail/u/0/#drafts?compose=${t.gmailDraftId}`
    : null;
  const threadUrl = t.gmailThreadId
    ? `https://mail.google.com/mail/u/0/#all/${t.gmailThreadId}`
    : null;
  const gmailUrl = draftUrl ?? threadUrl;

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ cursor: "pointer" }}
        onClick={() => setExpanded((v) => !v)}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: "uppercase",
          }}
        >
          Rent-roll outreach
        </Typography>
        <Chip
          size="small"
          color={STATUS_COLOR[status] ?? "default"}
          label={status.toLowerCase()}
          sx={{ height: 20 }}
        />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ flex: 1, minWidth: 0 }}
          noWrap
        >
          {lastMsg
            ? `${lastMsg.direction === "INBOUND" ? "↓" : "↑"} ${lastMsg.snippet ?? lastMsg.subject ?? ""}`
            : "Draft created — send from Gmail to start the thread"}
        </Typography>
        <Tooltip title="Sync replies now">
          <span>
            <IconButton
              size="small"
              disabled={sync.isPending}
              onClick={(e) => {
                e.stopPropagation();
                sync.mutate({ threadId: t.id });
              }}
            >
              <SyncRoundedIcon
                fontSize="small"
                sx={
                  sync.isPending
                    ? {
                        animation: "spin 1s linear infinite",
                        "@keyframes spin": {
                          from: { transform: "rotate(0deg)" },
                          to: { transform: "rotate(360deg)" },
                        },
                      }
                    : undefined
                }
              />
            </IconButton>
          </span>
        </Tooltip>
        <IconButton size="small">
          {expanded ? (
            <ExpandLessRoundedIcon fontSize="small" />
          ) : (
            <ExpandMoreRoundedIcon fontSize="small" />
          )}
        </IconButton>
      </Stack>

      <Collapse in={expanded}>
        <Box sx={{ mt: 1.5 }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <Typography variant="caption" color="text.secondary">
              To: {t.toEmail}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              · Trigger: {t.trigger}
            </Typography>
            {t.parseError && (
              <Typography variant="caption" color="error.main">
                · Parse error: {t.parseError}
              </Typography>
            )}
          </Stack>

          <Stack spacing={1} sx={{ mb: 1.5 }}>
            {messages.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                No messages yet — open the draft in Gmail and send it.
              </Typography>
            )}
            {messages.map((m) => (
              <Box
                key={m.id}
                sx={{
                  borderLeft: 2,
                  borderColor:
                    m.direction === "INBOUND" ? "warning.main" : "info.main",
                  pl: 1,
                  py: 0.5,
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  {m.direction === "INBOUND" ? "Reply" : "Sent"} ·{" "}
                  {new Date(m.receivedAt).toLocaleString()}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {m.subject}
                </Typography>
                {m.snippet && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block" }}
                  >
                    {m.snippet}
                  </Typography>
                )}
              </Box>
            ))}
          </Stack>

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
        </Box>
      </Collapse>
    </Paper>
  );
}
