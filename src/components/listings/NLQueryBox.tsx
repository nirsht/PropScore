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
import { useFilter } from "./filterStore";

export function NLQueryBox() {
  const { state, replace } = useFilter();
  const [q, setQ] = React.useState("");
  const [reasoning, setReasoning] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const facets = trpc.listings.facets.useQuery(undefined, { staleTime: 5 * 60_000 });
  const nlFilter = trpc.agents.nlFilter.useMutation();
  const setReasoningMutation = trpc.agents.setReasoning.useMutation();

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

  async function explainSet() {
    if (!q.trim()) return;
    setError(null);
    setReasoning(null);
    try {
      const result = await setReasoningMutation.mutateAsync({
        question: q,
        filter: { ...state, limit: 50 },
      });
      setReasoning(result.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent failed.");
    }
  }

  const loading = nlFilter.isPending || setReasoningMutation.isPending;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        mb: 2,
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
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
            disabled={loading || !q.trim()}
            onClick={applyAsFilter}
          >
            {nlFilter.isPending ? "Translating…" : "Apply as filter"}
          </Button>
          <Tooltip title="Reason over the current result set">
            <span>
              <Button
                variant="outlined"
                disabled={loading || !q.trim()}
                startIcon={<PsychologyOutlinedIcon />}
                onClick={explainSet}
              >
                Explain
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      <Collapse in={!!reasoning}>
        <Paper
          variant="outlined"
          sx={{ mt: 2, p: 2, position: "relative", bgcolor: "background.default" }}
        >
          <IconButton
            size="small"
            onClick={() => setReasoning(null)}
            sx={{ position: "absolute", top: 4, right: 4 }}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
          <Typography component="pre" variant="body2" sx={{ whiteSpace: "pre-wrap", m: 0 }}>
            {reasoning}
          </Typography>
        </Paper>
      </Collapse>
    </Paper>
  );
}
