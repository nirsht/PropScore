import { Box, Paper, Stack, Tooltip, Typography } from "@mui/material";
import AutoFixHighOutlinedIcon from "@mui/icons-material/AutoFixHighOutlined";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import { DataFreshness } from "./DataFreshness";
import { Rationale } from "./Rationale";
import { ScoreBars } from "./ScoreBars";

type ScoreLike = {
  aiBreakdown?: unknown;
  aiComputedAt?: Date | string | null;
  computedAt?: Date | string | null;
} | null | undefined;

export function OpportunityScoresCard({
  score,
  heuristic,
}: {
  score: ScoreLike;
  heuristic: Parameters<typeof ScoreBars>[0]["heuristic"];
}) {
  const aiBreakdown = score?.aiBreakdown ?? null;
  const scoreUpdatedAt = score?.aiComputedAt ?? score?.computedAt ?? null;
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle2">Opportunity scores</Typography>
        {/* Single merged info icon: the how-it-works explanation and, when
            present, the AI rationale breakdown, in one tooltip. When an AI
            breakdown exists we use the sparkle icon to signal AI is available;
            otherwise the plain help icon. */}
        <Tooltip
          arrow
          placement="top"
          title={
            <Box sx={{ p: 0.5, maxWidth: 360 }}>
              <Typography variant="caption" component="p" sx={{ mb: aiBreakdown != null ? 1 : 0 }}>
                Bars compare GPT&apos;s AI score against the deterministic
                heuristic baseline (recomputed from the listing data on every
                read). Hover any bar pair to see the values and the Δ.
              </Typography>
              {aiBreakdown != null && (
                <Rationale breakdown={aiBreakdown as Record<string, unknown>} />
              )}
            </Box>
          }
        >
          {aiBreakdown != null ? (
            <AutoFixHighOutlinedIcon
              sx={{ fontSize: 16, color: "primary.main", cursor: "help" }}
            />
          ) : (
            <HelpOutlineRoundedIcon
              sx={{ fontSize: 16, opacity: 0.55, cursor: "help" }}
            />
          )}
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <DataFreshness
          updatedAt={scoreUpdatedAt}
          label={score?.aiComputedAt ? "AI" : "Scored"}
        />
      </Stack>
      <ScoreBars
        score={score as Parameters<typeof ScoreBars>[0]["score"]}
        heuristic={heuristic}
      />
    </Paper>
  );
}
