"use client";

import * as React from "react";
import {
  Alert,
  CircularProgress,
  IconButton,
  Link as MuiLink,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import EmailRoundedIcon from "@mui/icons-material/EmailRounded";
import { trpc } from "@/lib/trpc/client";

export function ContactCard({
  role,
  name,
  phone,
  email,
  listingMlsId,
}: {
  role: string;
  name: string | null;
  phone?: string | null;
  email?: string | null;
  /** When set, renders the "Request rent roll" draft button for this row. */
  listingMlsId?: string;
}) {
  const telHref = phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null;

  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      sx={{ minWidth: 0, minHeight: 24 }}
    >
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          textTransform: "uppercase",
          letterSpacing: 0.4,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {role}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontWeight: 500, flex: 1, minWidth: 0 }}
        noWrap
      >
        {name ?? "—"}
      </Typography>
      {telHref && (
        <Tooltip title={`Call ${phone}`}>
          <IconButton
            size="small"
            component={MuiLink}
            href={telHref}
            sx={{ p: 0.25, color: "text.secondary" }}
          >
            <PhoneRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
      {phone && <CopyPhoneButton phone={phone} />}
      {listingMlsId && email && (
        <RequestRentRollButton listingMlsId={listingMlsId} agentEmail={email} />
      )}
    </Stack>
  );
}

function CopyPhoneButton({ phone }: { phone: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in non-secure contexts; silently ignore.
    }
  };

  return (
    <Tooltip title={copied ? "Copied!" : `Copy ${phone}`}>
      <IconButton
        size="small"
        onClick={handleCopy}
        sx={{ p: 0.25, color: copied ? "success.main" : "text.secondary" }}
      >
        {copied ? (
          <CheckRoundedIcon sx={{ fontSize: 16 }} />
        ) : (
          <ContentCopyRoundedIcon sx={{ fontSize: 16 }} />
        )}
      </IconButton>
    </Tooltip>
  );
}

function RequestRentRollButton({
  listingMlsId,
  agentEmail,
}: {
  listingMlsId: string;
  agentEmail: string;
}) {
  const connection = trpc.emails.connectionStatus.useQuery(undefined, {
    staleTime: 60 * 1000,
  });
  const existing = trpc.emails.forListing.useQuery({ listingMlsId });
  const utils = trpc.useUtils();
  // Hold a tab opened synchronously on click so the post-mutation navigation
  // counts as a user gesture and isn't blocked by popup blockers.
  const pendingTab = React.useRef<Window | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const request = trpc.emails.requestRentRoll.useMutation({
    onSuccess: (result) => {
      void utils.emails.forListing.invalidate({ listingMlsId });
      void utils.emails.listThreads.invalidate();
      const tab = pendingTab.current;
      pendingTab.current = null;
      if (result.draftUrl) {
        if (tab && !tab.closed) tab.location.href = result.draftUrl;
        else window.open(result.draftUrl, "_blank", "noopener");
      } else if (tab && !tab.closed) {
        tab.close();
      }
    },
    onError: (err) => {
      const tab = pendingTab.current;
      pendingTab.current = null;
      if (tab && !tab.closed) tab.close();
      setErrorMessage(err.message || "Couldn't create the Gmail draft.");
    },
  });

  const isConfigured = connection.data?.configured ?? false;
  const isConnected = connection.data?.connected ?? false;
  const hasDraft = Boolean(existing.data);

  if (!isConfigured) {
    return null;
  }

  if (!isConnected) {
    return (
      <Tooltip title="Connect Gmail on the Emails page to request rent rolls">
        <span>
          <IconButton
            size="small"
            disabled
            sx={{ p: 0.25, color: "text.disabled" }}
          >
            <EmailRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </span>
      </Tooltip>
    );
  }

  if (hasDraft) {
    const draftId = existing.data?.gmailDraftId;
    const threadId = existing.data?.gmailThreadId;
    const href = draftId
      ? `https://mail.google.com/mail/u/0/#drafts?compose=${draftId}`
      : threadId
        ? `https://mail.google.com/mail/u/0/#all/${threadId}`
        : undefined;
    return (
      <Tooltip
        title={`Rent-roll outreach already exists (${existing.data?.status?.toLowerCase()}) — open in Gmail`}
      >
        <IconButton
          size="small"
          component={href ? MuiLink : "button"}
          href={href}
          target={href ? "_blank" : undefined}
          rel={href ? "noopener" : undefined}
          sx={{ p: 0.25, color: "success.main" }}
        >
          <EmailRoundedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <>
      <Tooltip title={`Create Gmail draft to ${agentEmail} requesting the rent roll`}>
        <span>
          <IconButton
            size="small"
            disabled={request.isPending}
            onClick={() => {
              pendingTab.current = window.open("about:blank", "_blank", "noopener");
              request.mutate({ listingMlsId });
            }}
            sx={{ p: 0.25, color: "primary.main" }}
          >
            {request.isPending ? (
              <CircularProgress size={14} />
            ) : (
              <EmailRoundedIcon sx={{ fontSize: 16 }} />
            )}
          </IconButton>
        </span>
      </Tooltip>
      <Snackbar
        open={errorMessage !== null}
        autoHideDuration={5000}
        onClose={() => setErrorMessage(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity="error"
          variant="filled"
          onClose={() => setErrorMessage(null)}
          sx={{ width: "100%" }}
        >
          {errorMessage}
        </Alert>
      </Snackbar>
    </>
  );
}
