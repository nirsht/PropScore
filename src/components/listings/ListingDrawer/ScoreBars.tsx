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

  const showCompare = score.computedBy === "AI" && !!heuristic;

  const data = [
    {
      name: "Density",
      current: score.densityScore,
      heuristic: heuristic?.densityScore ?? null,
    },
    {
      name: "Vacancy",
      current: score.vacancyScore,
      heuristic: heuristic?.vacancyScore ?? null,
    },
    {
      name: "Motivation",
      current: score.motivationScore,
      heuristic: heuristic?.motivationScore ?? null,
    },
    {
      name: "Value-Add",
      current: score.valueAddWeightedAvg,
      heuristic: heuristic?.valueAddWeightedAvg ?? null,
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
          content={<ScoreTooltip showCompare={showCompare} />}
        />
        <Bar dataKey="current" name="Current" radius={[6, 6, 0, 0]}>
          {data.map((d) => (
            <Cell key={`current-${d.name}`} fill={METRIC_COLORS[d.name]} />
          ))}
        </Bar>
        {showCompare && (
          <Bar dataKey="heuristic" name="Heuristic" radius={[6, 6, 0, 0]}>
            {data.map((d) => (
              <Cell
                key={`heur-${d.name}`}
                fill={METRIC_COLORS[d.name]}
                fillOpacity={0.28}
              />
            ))}
          </Bar>
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

function ScoreTooltip({
  active,
  payload,
  label,
  showCompare,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number }>;
  label?: string;
  showCompare: boolean;
}) {
  if (!active || !payload?.length) return null;
  const current = payload.find((p) => p.dataKey === "current")?.value;
  const heur = payload.find((p) => p.dataKey === "heuristic")?.value;
  const diff =
    typeof current === "number" && typeof heur === "number"
      ? Math.round((current - heur) * 10) / 10
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
        {typeof current === "number" && (
          <Stack direction="row" justifyContent="space-between" spacing={2}>
            <Typography variant="caption" color="text.secondary">
              {showCompare ? "AI" : "Score"}
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {current.toFixed(1)}
            </Typography>
          </Stack>
        )}
        {showCompare && typeof heur === "number" && (
          <Stack direction="row" justifyContent="space-between" spacing={2}>
            <Typography variant="caption" color="text.secondary">
              Heuristic
            </Typography>
            <Typography variant="caption">{heur.toFixed(1)}</Typography>
          </Stack>
        )}
        {showCompare && diff !== null && (
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
