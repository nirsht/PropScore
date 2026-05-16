import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import { EnrichWithAIButton } from "../EnrichWithAIButton";
import { Rationale } from "./Rationale";
import { ScoreBars } from "./ScoreBars";

type ScoreLike = {
  computedBy?: "AI" | "HEURISTIC" | null;
  breakdown?: unknown;
} | null | undefined;

export function OpportunityScoresCard({
  mlsId,
  score,
  heuristic,
}: {
  mlsId: string;
  score: ScoreLike;
  heuristic: Parameters<typeof ScoreBars>[0]["heuristic"];
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle2">Opportunity scores</Typography>
        {score?.computedBy === "AI" && <Chip size="small" color="primary" label="AI" />}
        <Tooltip
          arrow
          placement="top"
          title={
            score?.computedBy === "AI"
              ? "Bars compare GPT's reasoned score (current) against the deterministic heuristic baseline (recomputed from the listing data on every read). Hover any bar pair to see the values and the Δ."
              : "These are heuristic scores computed during ETL. Click 'AI score' to re-score with GPT — once you do, the chart will show both alongside each other so you can see the AI's delta."
          }
        >
          <HelpOutlineRoundedIcon
            sx={{ fontSize: 16, opacity: 0.55, cursor: "help" }}
          />
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <EnrichWithAIButton mlsId={mlsId} />
      </Stack>
      <ScoreBars
        score={score as Parameters<typeof ScoreBars>[0]["score"]}
        heuristic={heuristic}
      />
      {score?.computedBy === "AI" && score?.breakdown != null && (
        <Accordion
          disableGutters
          elevation={0}
          sx={{
            mt: 1.5,
            bgcolor: "transparent",
            "&:before": { display: "none" },
          }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreRoundedIcon />}
            sx={{ px: 0, minHeight: 32, "& .MuiAccordionSummary-content": { my: 0.5 } }}
          >
            <Typography variant="caption" color="text.secondary">
              Show AI rationale
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 0, pt: 0 }}>
            <Rationale breakdown={score.breakdown as Record<string, unknown>} />
          </AccordionDetails>
        </Accordion>
      )}
    </Paper>
  );
}
