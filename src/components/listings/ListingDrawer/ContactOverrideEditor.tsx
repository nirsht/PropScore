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
 * Shared state/mutations for the manual contact-override editor. Split into a
 * hook so the trigger buttons can render in the broker card's top-right corner
 * while the collapsible edit form renders lower in the card body — both driven
 * by a single source of truth (see ContactOverrideButtons / ContactOverrideForm).
 *
 * Overrides win over Bridge in the display (see useListingContact); clearing a
 * field reverts to the Bridge/enrichment value.
 */
export function useContactOverride({
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

  return {
    mlsId,
    resolved,
    open,
    setOpen,
    toast,
    setToast,
    fields: { agentName, agentEmail, agentPhone, officeName },
    setters: { setAgentName, setAgentEmail, setAgentPhone, setOfficeName },
    save,
    repull,
  };
}

export type ContactOverrideCtl = ReturnType<typeof useContactOverride>;

/**
 * The edit (pencil) + re-pull (refresh) icon buttons, plus the shared toast.
 * Designed to sit in the broker card header row (top-right).
 */
export function ContactOverrideButtons({ ctl }: { ctl: ContactOverrideCtl }) {
  const { open, setOpen, repull, toast, setToast } = ctl;
  return (
    <>
      <Stack direction="row" spacing={0.5} alignItems="center">
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
              onClick={() => repull.mutate({ mlsId: ctl.mlsId })}
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
    </>
  );
}

/**
 * The collapsible contact-override edit form (Agent name/email/phone +
 * Brokerage). Renders in the broker card body; visibility is driven by the
 * shared `open` state so the header pencil button toggles it.
 */
export function ContactOverrideForm({ ctl }: { ctl: ContactOverrideCtl }) {
  const { open, setOpen, save, resolved, fields, setters, mlsId } = ctl;
  const { agentName, agentEmail, agentPhone, officeName } = fields;
  const { setAgentName, setAgentEmail, setAgentPhone, setOfficeName } = setters;

  return (
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
  );
}
