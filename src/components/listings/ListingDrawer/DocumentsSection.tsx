"use client";

import * as React from "react";
import {
  Box,
  Chip,
  IconButton,
  Link as MuiLink,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import { trpc } from "@/lib/trpc/client";

type StoredAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  gmailAttachmentId: string;
};

type AttachmentRow = StoredAttachment & {
  messageId: string;
  receivedAt: Date;
  parsed: boolean;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(mimeType: string) {
  const mt = (mimeType || "").toLowerCase();
  if (mt.includes("pdf")) return <PictureAsPdfOutlinedIcon fontSize="small" />;
  if (
    mt.includes("spreadsheet") ||
    mt.includes("excel") ||
    mt.includes("csv") ||
    mt.endsWith("/tab-separated-values")
  ) {
    return <TableChartOutlinedIcon fontSize="small" />;
  }
  if (mt.startsWith("image/")) return <ImageOutlinedIcon fontSize="small" />;
  return <InsertDriveFileOutlinedIcon fontSize="small" />;
}

function isAttachmentArray(value: unknown): value is StoredAttachment[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) =>
        v &&
        typeof v === "object" &&
        typeof (v as StoredAttachment).filename === "string" &&
        typeof (v as StoredAttachment).gmailAttachmentId === "string",
    )
  );
}

export function DocumentsSection({ listingMlsId }: { listingMlsId: string }) {
  const thread = trpc.emails.forListing.useQuery({ listingMlsId });

  if (thread.isLoading) {
    return (
      <Stack spacing={1.5} sx={{ p: 3 }}>
        <Skeleton variant="rectangular" height={56} />
        <Skeleton variant="rectangular" height={56} />
        <Skeleton variant="rectangular" height={56} />
      </Stack>
    );
  }

  if (!thread.data) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="body2" color="text.secondary">
          Request an OM or rent roll from the agent to start collecting documents here.
        </Typography>
      </Box>
    );
  }

  const rows: AttachmentRow[] = [];
  for (const m of thread.data.messages) {
    if (m.direction !== "INBOUND") continue;
    const atts = isAttachmentArray(m.attachments) ? m.attachments : [];
    for (const a of atts) {
      rows.push({
        ...a,
        messageId: m.id,
        receivedAt: new Date(m.receivedAt),
        parsed: m.parsedRentRoll != null,
      });
    }
  }

  if (rows.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="body2" color="text.secondary">
          Waiting on the agent&apos;s reply. Attachments will appear here automatically once
          they arrive.
        </Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={1.5} sx={{ p: 3 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase" }}
      >
        Documents from agent
      </Typography>

      {rows.map((row) => {
        const href = `/api/emails/attachment?messageId=${encodeURIComponent(
          row.messageId,
        )}&attachmentId=${encodeURIComponent(row.gmailAttachmentId)}`;
        return (
          <Paper
            key={`${row.messageId}:${row.gmailAttachmentId}`}
            variant="outlined"
            sx={{ p: 1.5 }}
          >
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Box sx={{ color: "text.secondary", display: "flex" }}>
                {iconFor(row.mimeType)}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                  {row.filename}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatBytes(row.size)} · {row.receivedAt.toLocaleString()}
                </Typography>
              </Box>
              {row.parsed && (
                <Chip
                  size="small"
                  color="success"
                  label="parsed"
                  sx={{ height: 20 }}
                />
              )}
              <Tooltip title="Download">
                <IconButton
                  size="small"
                  component={MuiLink}
                  href={href}
                  target="_blank"
                  rel="noopener"
                >
                  <DownloadRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}
