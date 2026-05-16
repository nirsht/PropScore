"use client";

import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { trpc } from "@/lib/trpc/client";
import { useFilter } from "./filterStore";

export function ListingsAIBar() {
  const { replace } = useFilter();
  const [q, setQ] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const facets = trpc.listings.facets.useQuery(undefined, { staleTime: 5 * 60_000 });
  const nlFilter = trpc.agents.nlFilter.useMutation();

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

        <Button
          variant="contained"
          disabled={nlFilter.isPending || !q.trim()}
          onClick={applyAsFilter}
        >
          {nlFilter.isPending ? "Translating…" : "Apply as filter"}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
    </Paper>
  );
}
