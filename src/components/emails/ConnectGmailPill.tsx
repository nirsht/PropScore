"use client";

import * as React from "react";
import {
  Alert,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import LinkOffRoundedIcon from "@mui/icons-material/LinkOffRounded";
import GoogleIcon from "@mui/icons-material/Google";
import { trpc } from "@/lib/trpc/client";

export function ConnectGmailPill() {
  const utils = trpc.useUtils();
  const status = trpc.emails.connectionStatus.useQuery();
  const disconnect = trpc.emails.disconnect.useMutation({
    onSuccess: () => {
      void utils.emails.connectionStatus.invalidate();
    },
  });

  if (status.isLoading) {
    return <CircularProgress size={18} />;
  }

  if (status.error) {
    return (
      <Alert severity="error" sx={{ py: 0.5 }}>
        Failed to load Gmail status: {status.error.message}
      </Alert>
    );
  }

  if (!status.data?.configured) {
    return (
      <Alert severity="info" sx={{ py: 0.5 }}>
        Gmail integration not configured — set GOOGLE_CLIENT_ID and
        GOOGLE_CLIENT_SECRET in .env.
      </Alert>
    );
  }

  if (!status.data.connected) {
    return (
      <Button
        size="small"
        variant="contained"
        startIcon={<GoogleIcon />}
        onClick={() => {
          // Standalone mailbox-connect flow — NOT a NextAuth sign-in. Keeps the
          // app login identity untouched and just attaches Gmail tokens to it.
          window.location.assign("/api/gmail/connect");
        }}
      >
        Connect Gmail
      </Button>
    );
  }

  return (
    <Stack direction="row" alignItems="center" spacing={0.75}>
      <CheckCircleRoundedIcon color="success" fontSize="small" />
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {status.data.email}
      </Typography>
      <Tooltip title="Disconnect Gmail">
        <span>
          <IconButton
            size="small"
            disabled={disconnect.isPending}
            onClick={() => {
              if (
                window.confirm(
                  "Disconnect Gmail? Existing threads stay in PropScore but no new replies will sync until you reconnect.",
                )
              ) {
                disconnect.mutate();
              }
            }}
          >
            <LinkOffRoundedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );
}
