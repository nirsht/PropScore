"use client";

import * as React from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
  IconButton,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
} from "@mui/material";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import { trpc } from "@/lib/trpc/client";

type Review = {
  agentName: string | null;
  agentEmail: string | null;
  agentPhone: string | null;
  officeName: string | null;
} | null;

/** Resolved (post-override) contact values — used as field placeholders so the
 *  user sees what's currently shown and can tell an override from a fallback. */
type Resolved = {
  agentName: string | null;
  agentEmail: string | null;
  agentPhone: string | null;
  officeName: string | null;
};

/**
 * Inline editor for the manual contact corrections stored on the listing's
 * ListingReview row, plus a "Re-pull from Bridge" button that force-refreshes
 * the enrichment chain. Overrides win over Bridge in the display (see
 * useListingContact); clearing a field reverts to the Bridge/enrichment value.
 */
export function ContactOverrideEditor({
  mlsId,
  review,
  resolved,
}: {
  mlsId: string;
  review: Review;
  resolved: Resolved;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{
    severity: "success" | "error" | "info";
    msg: string;
  } | null>(null);

  // Field buffers hold only the *override* values (empty = fall back to Bridge).
  const [agentName, setAgentName] = React.useState(review?.agentName ?? "");
  const [agentEmail, setAgentEmail] = React.useState(review?.agentEmail ?? "");
  const [agentPhone, setAgentPhone] = React.useState(review?.agentPhone ?? "");
  const [officeName, setOfficeName] = React.useState(review?.officeName ?? "");

  // Re-seed when switching listings or when server overrides change.
  React.useEffect(() => {
    setAgentName(review?.agentName ?? "");
    setAgentEmail(review?.agentEmail ?? "");
    setAgentPhone(review?.agentPhone ?? "");
    setOfficeName(review?.officeName ?? "");
  }, [mlsId, review?.agentName, review?.agentEmail, review?.agentPhone, review?.officeName]);

  const invalidateContact = () => {
    utils.listingReviews.get.invalidate({ mlsId });
    utils.listings.getById.invalidate({ mlsId });
  };

  const save = trpc.listingReviews.setContactOverride.useMutation({
    onSuccess: () => {
      invalidateContact();
      setOpen(false);
      setToast({ severity: "success", msg: "Contact updated" });
    },
    onError: (e) => setToast({ severity: "error", msg: e.message }),
  });

  const repull = trpc.listingReviews.repullContact.useMutation({
    onSuccess: (res) => {
      invalidateContact();
      setToast({
        severity: res.status === "hit" ? "success" : "info",
        msg:
          res.status === "hit"
            ? "Re-pulled from Bridge — contact refreshed"
            : "Re-pulled from Bridge — no new phone/email found",
      });
    },
    onError: (e) => setToast({ severity: "error", msg: e.message }),
  });

  return (
    <Box>
      <Stack
        direction="row"
        spacing={0.5}
        justifyContent="flex-end"
        alignItems="center"
        sx={{ mt: 0.25 }}
      >
        <Tooltip title={open ? "Close editor" : "Edit contact"}>
          <IconButton
            size="small"
            onClick={() => setOpen((v) => !v)}
            sx={{ p: 0.5, color: open ? "primary.main" : "text.secondary" }}
          >
            <EditRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Re-pull agent/brokerage from Bridge + the enrichment chain (bypasses the 30-day cache).">
          <span>
            <IconButton
              size="small"
              disabled={repull.isPending}
              onClick={() => repull.mutate({ mlsId })}
              sx={{ p: 0.5, color: "text.secondary" }}
            >
              {repull.isPending ? (
                <CircularProgress size={16} />
              ) : (
                <RefreshRoundedIcon sx={{ fontSize: 18 }} />
              )}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Collapse in={open} unmountOnExit>
        <Stack spacing={1.25} sx={{ mt: 1 }}>
          <TextField
            label="Agent name"
            size="small"
            value={agentName}
            placeholder={resolved.agentName ?? "—"}
            onChange={(e) => setAgentName(e.target.value)}
            fullWidth
          />
          <TextField
            label="Agent email"
            size="small"
            value={agentEmail}
            placeholder={resolved.agentEmail ?? "—"}
            onChange={(e) => setAgentEmail(e.target.value)}
            fullWidth
          />
          <TextField
            label="Agent phone"
            size="small"
            value={agentPhone}
            placeholder={resolved.agentPhone ?? "—"}
            onChange={(e) => setAgentPhone(e.target.value)}
            fullWidth
          />
          <TextField
            label="Brokerage"
            size="small"
            value={officeName}
            placeholder={resolved.officeName ?? "—"}
            onChange={(e) => setOfficeName(e.target.value)}
            fullWidth
          />
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button size="small" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={save.isPending}
              onClick={() =>
                save.mutate({
                  mlsId,
                  agentName,
                  agentEmail,
                  agentPhone,
                  officeName,
                })
              }
            >
              Save
            </Button>
          </Stack>
          <Box sx={{ color: "text.secondary", fontSize: 12 }}>
            Leave a field blank to fall back to the Bridge/enrichment value.
          </Box>
        </Stack>
      </Collapse>

      <Snackbar
        open={!!toast}
        autoHideDuration={3500}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)} variant="filled">
            {toast.msg}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
