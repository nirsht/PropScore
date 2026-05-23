import { Box, Stack, Typography } from "@mui/material";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
} from "recharts";
import type { ScoreLike } from "./types";

const METRIC_COLORS: Record<string, string> = {
  Density: "#7c5cff",
  Vacancy: "#23d29a",
  Motivation: "#ffb86b",
  Upside: "#5cd0ff",
  "Value-Add": "#ff6b8a",
};

export function ScoreBars({
  score,
  heuristic,
}: {
  score: ScoreLike | null | undefined;
  heuristic: ScoreLike | null | undefined;
}) {
  if (!score) {
    return (
      <Typography variant="body2" color="text.secondary">
        No score yet.
      </Typography>
    );
  }

  const hasAI =
    score.aiDensityScore != null ||
    score.aiVacancyScore != null ||
    score.aiMotivationScore != null ||
    score.aiValueAddWeightedAvg != null;

  const data = [
    {
      name: "Density",
      ai: score.aiDensityScore ?? null,
      heuristic: heuristic?.densityScore ?? score.densityScore,
    },
    {
      name: "Vacancy",
      ai: score.aiVacancyScore ?? null,
      heuristic: heuristic?.vacancyScore ?? score.vacancyScore,
    },
    {
      name: "Motivation",
      ai: score.aiMotivationScore ?? null,
      heuristic: heuristic?.motivationScore ?? score.motivationScore,
    },
    {
      name: "Upside",
      ai: null,
      heuristic: heuristic?.marketUpsideScore ?? score.marketUpsideScore ?? null,
    },
    {
      name: "Value-Add",
      ai: score.aiValueAddWeightedAvg ?? null,
      heuristic: heuristic?.valueAddWeightedAvg ?? score.valueAddWeightedAvg,
    },
  ];

  return (
    <ResponsiveContainer width="100%" height={130}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
        barCategoryGap="22%"
      >
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: "var(--mui-palette-text-secondary)" }}
          axisLine={false}
          tickLine={false}
        />
        <RechartsTooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          content={<ScoreTooltip hasAI={hasAI} />}
        />
        {hasAI && (
          <Bar dataKey="ai" name="AI" radius={[6, 6, 0, 0]}>
            {data.map((d) => (
              <Cell key={`ai-${d.name}`} fill={METRIC_COLORS[d.name]} />
            ))}
          </Bar>
        )}
        <Bar dataKey="heuristic" name="Heuristic" radius={[6, 6, 0, 0]}>
          {data.map((d) => (
            <Cell
              key={`heur-${d.name}`}
              fill={METRIC_COLORS[d.name]}
              fillOpacity={hasAI ? 0.28 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ScoreTooltip({
  active,
  payload,
  label,
  hasAI,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number }>;
  label?: string;
  hasAI: boolean;
}) {
  if (!active || !payload?.length) return null;
  const ai = payload.find((p) => p.dataKey === "ai")?.value;
  const heur = payload.find((p) => p.dataKey === "heuristic")?.value;
  const diff =
    typeof ai === "number" && typeof heur === "number"
      ? Math.round((ai - heur) * 10) / 10
      : null;

  return (
    <Box
      sx={{
        background: "var(--mui-palette-background-paper)",
        border: 1,
        borderColor: "divider",
        borderRadius: 1.5,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        px: 1.5,
        py: 1,
        minWidth: 160,
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 600, display: "block", mb: 0.5 }}>
        {label}
      </Typography>
      <Stack spacing={0.25}>
        {hasAI && typeof ai === "number" && (
          <Stack direction="row" justifyContent="space-between" spacing={2}>
            <Typography variant="caption" color="text.secondary">
              AI
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {ai.toFixed(1)}
            </Typography>
          </Stack>
        )}
        {typeof heur === "number" && (
          <Stack direction="row" justifyContent="space-between" spacing={2}>
            <Typography variant="caption" color="text.secondary">
              {hasAI ? "Heuristic" : "Score"}
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: hasAI ? 400 : 600 }}>
              {heur.toFixed(1)}
            </Typography>
          </Stack>
        )}
        {diff !== null && (
          <Stack
            direction="row"
            justifyContent="space-between"
            spacing={2}
            sx={{ mt: 0.5, pt: 0.5, borderTop: 1, borderColor: "divider" }}
          >
            <Typography variant="caption" color="text.secondary">
              Δ
            </Typography>
            <Typography
              variant="caption"
              sx={{
                fontWeight: 700,
                color:
                  diff > 0 ? "success.main" : diff < 0 ? "error.main" : "text.secondary",
              }}
            >
              {diff > 0 ? "+" : ""}
              {diff.toFixed(1)}
            </Typography>
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
