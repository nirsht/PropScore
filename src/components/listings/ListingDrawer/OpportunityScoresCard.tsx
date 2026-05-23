import { Box, Paper, Stack, Tooltip, Typography } from "@mui/material";
import AutoFixHighOutlinedIcon from "@mui/icons-material/AutoFixHighOutlined";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import { Rationale } from "./Rationale";
import { ScoreBars } from "./ScoreBars";

type ScoreLike = {
  aiBreakdown?: unknown;
} | null | undefined;

export function OpportunityScoresCard({
  score,
  heuristic,
}: {
  score: ScoreLike;
  heuristic: Parameters<typeof ScoreBars>[0]["heuristic"];
}) {
  const aiBreakdown = score?.aiBreakdown ?? null;
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle2">Opportunity scores</Typography>
        <Tooltip
          arrow
          placement="top"
          title="Bars compare GPT's AI score against the deterministic heuristic baseline (recomputed from the listing data on every read). Hover any bar pair to see the values and the Δ."
        >
          <HelpOutlineRoundedIcon
            sx={{ fontSize: 16, opacity: 0.55, cursor: "help" }}
          />
        </Tooltip>
        {aiBreakdown != null && (
          <Tooltip
            arrow
            placement="top"
            title={
              <Box sx={{ p: 0.5, maxWidth: 360 }}>
                <Rationale breakdown={aiBreakdown as Record<string, unknown>} />
              </Box>
            }
          >
            <AutoFixHighOutlinedIcon
              sx={{ fontSize: 16, color: "primary.main", cursor: "help" }}
            />
          </Tooltip>
        )}
        <Box sx={{ flex: 1 }} />
      </Stack>
      <ScoreBars
        score={score as Parameters<typeof ScoreBars>[0]["score"]}
        heuristic={heuristic}
      />
    </Paper>
  );
}
