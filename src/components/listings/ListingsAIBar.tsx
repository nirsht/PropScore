"use client";

import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Collapse,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import PsychologyOutlinedIcon from "@mui/icons-material/PsychologyOutlined";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import { trpc } from "@/lib/trpc/client";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useFilter } from "./filterStore";
import { useSelectedListing } from "./useSelectedListing";

/**
 * Top-of-page AI bar on the listings view. Replaces the old single-shot
 * NLQueryBox. Two paths:
 *  - "Apply as filter" — translates the prompt to a FilterInput and applies
 *    it (existing behavior).
 *  - "Ask" — opens an inline multi-turn chat grounded in the current filter
 *    snapshot. The chat lives in a collapsible thread below the bar.
 */
export function ListingsAIBar() {
  const { state, replace } = useFilter();
  const [, setSelected] = useSelectedListing();
  const [q, setQ] = React.useState("");
  const [chatOpen, setChatOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const facets = trpc.listings.facets.useQuery(undefined, { staleTime: 5 * 60_000 });
  const nlFilter = trpc.agents.nlFilter.useMutation();

  // Snapshot the filter at the moment the chat is first opened so the
  // conversation has a stable grounding even if the user changes filters.
  // We refresh it whenever the user opens a fresh thread (toggling the
  // panel off and back on).
  const [chatSnapshot, setChatSnapshot] = React.useState<typeof state | null>(null);

  async function applyAsFilter() {
    if (!q.trim()) return;
    setError(null);
    try {
      const result = await nlFilter.mutateAsync({
        q,
        knownPropertyTypes: facets.data?.propertyTypes.map((p) => p.value) ?? [],
      });
      replace({ ...result.filter });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent failed.");
    }
  }

  function openChat() {
    setError(null);
    setChatSnapshot(state);
    setChatOpen(true);
  }

  function closeChat() {
    setChatOpen(false);
  }

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, mb: 2, borderColor: "divider", bgcolor: "background.paper" }}
    >
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "primary.main" }}>
          <AutoAwesomeIcon fontSize="small" />
          <Typography variant="body2" fontWeight={600}>
            Ask in plain English
          </Typography>
        </Box>

        <TextField
          placeholder='e.g. "4-unit buildings under $500k/unit built before 1980"'
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void applyAsFilter();
            }
          }}
          sx={{ flex: 1 }}
        />

        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            disabled={nlFilter.isPending || !q.trim()}
            onClick={applyAsFilter}
          >
            {nlFilter.isPending ? "Translating…" : "Apply as filter"}
          </Button>
          <Tooltip title="Open a chat about the current result set">
            <Button
              variant="outlined"
              startIcon={<PsychologyOutlinedIcon />}
              onClick={openChat}
            >
              Ask
            </Button>
          </Tooltip>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Collapse in={chatOpen} unmountOnExit>
        <Box sx={{ mt: 2, position: "relative" }}>
          <IconButton
            size="small"
            onClick={closeChat}
            sx={{ position: "absolute", top: 4, right: 4, zIndex: 1 }}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
          <ChatPanel
            scope="GLOBAL"
            filterSnapshot={chatSnapshot ?? undefined}
            mode="inline"
            showThreadSwitcher={false}
            onCitationClick={(mlsId) => setSelected(mlsId)}
            emptyHint="Ask anything about the listings on screen — comparisons, outliers, rent strategies, value-add picks."
          />
        </Box>
      </Collapse>
    </Paper>
  );
}
