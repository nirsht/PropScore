"use client";

import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Link as MuiLink,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
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
  const utils = trpc.useUtils();
  const thread = trpc.emails.forListing.useQuery({ listingMlsId });
  const documents = trpc.listingDocuments.forListing.useQuery({ listingMlsId });
  const deleteDoc = trpc.listingDocuments.delete.useMutation({
    onSuccess: () => {
      utils.listingDocuments.forListing.invalidate({ listingMlsId });
      // The parser writes onto Listing.extractedRentRoll; reset listing query
      // so RentRollSection re-reads after a delete that may have powered it.
      utils.listings.invalidate();
    },
  });

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);

  const onPickFile = () => fileInputRef.current?.click();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-uploading the same filename
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("listingMlsId", listingMlsId);
      form.append("file", file);
      const res = await fetch("/api/listing-documents", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Upload failed (${res.status})`);
      }
      await utils.listingDocuments.forListing.invalidate({ listingMlsId });
      // The parser may have populated extractedRentRoll on the Listing —
      // refresh listings so RentRollSection picks it up.
      await utils.listings.invalidate();
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const loading = thread.isLoading || documents.isLoading;

  if (loading) {
    return (
      <Stack spacing={1.5} sx={{ p: 3 }}>
        <Skeleton variant="rectangular" height={56} />
        <Skeleton variant="rectangular" height={56} />
        <Skeleton variant="rectangular" height={56} />
      </Stack>
    );
  }

  const emailRows: AttachmentRow[] = [];
  for (const m of thread.data?.messages ?? []) {
    if (m.direction !== "INBOUND") continue;
    const atts = isAttachmentArray(m.attachments) ? m.attachments : [];
    for (const a of atts) {
      emailRows.push({
        ...a,
        messageId: m.id,
        receivedAt: new Date(m.receivedAt),
        parsed: m.parsedRentRoll != null,
      });
    }
  }
  const manualRows = documents.data ?? [];
  const empty = emailRows.length === 0 && manualRows.length === 0;

  return (
    <Stack spacing={2} sx={{ p: 3 }}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        justifyContent="space-between"
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase" }}
        >
          Documents
        </Typography>
        <Button
          size="small"
          variant="outlined"
          startIcon={
            uploading ? (
              <CircularProgress size={14} />
            ) : (
              <UploadFileRoundedIcon fontSize="small" />
            )
          }
          onClick={onPickFile}
          disabled={uploading}
        >
          {uploading ? "Uploading…" : "Upload file"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          accept=".pdf,.csv,.xls,.xlsx,.txt,image/*,application/pdf"
          onChange={onFileChange}
        />
      </Stack>

      {uploadError && (
        <Alert severity="error" onClose={() => setUploadError(null)}>
          {uploadError}
        </Alert>
      )}

      {empty && (
        <Typography variant="body2" color="text.secondary">
          Drop in an OM or rent roll with <strong>Upload file</strong>, or wait for
          the agent&apos;s reply — attachments will appear here automatically.
        </Typography>
      )}

      {manualRows.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary">
            Uploaded by you
          </Typography>
          {manualRows.map((doc) => {
            const href = `/api/listing-documents/${encodeURIComponent(doc.id)}`;
            const parsed = doc.parsedAt != null && doc.parsedRentRoll != null;
            return (
              <Paper key={doc.id} variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" alignItems="center" spacing={1.5}>
                  <Box sx={{ color: "text.secondary", display: "flex" }}>
                    {iconFor(doc.mimeType)}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                      {doc.filename}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatBytes(doc.size)} ·{" "}
                      {new Date(doc.createdAt).toLocaleString()}
                      {doc.parseError ? ` · parse failed: ${doc.parseError}` : ""}
                    </Typography>
                  </Box>
                  {parsed && (
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
                  <Tooltip title="Delete">
                    <span>
                      <IconButton
                        size="small"
                        onClick={() => deleteDoc.mutate({ id: doc.id })}
                        disabled={deleteDoc.isPending}
                      >
                        <DeleteOutlineRoundedIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}

      {emailRows.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary">
            From agent
          </Typography>
          {emailRows.map((row) => {
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
      )}
    </Stack>
  );
}
