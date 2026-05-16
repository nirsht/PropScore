"use client";

import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import UndoRoundedIcon from "@mui/icons-material/UndoRounded";

const fmt = (n: number) => `${Math.round(n).toLocaleString()} sqft`;

function Stat({
  label,
  value,
  emphasis,
  tone,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: "ok" | "warn";
}) {
  const color =
    tone === "warn" ? "warning.main" : emphasis ? "primary.main" : "text.primary";
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant={emphasis ? "h6" : "body1"}
        sx={{ fontWeight: emphasis ? 700 : 500, color, lineHeight: 1.2 }}
      >
        {value}
      </Typography>
    </Box>
  );
}

export function MeasureResults({
  measured,
  apiLotSizeSqft,
  delta,
  ratio,
  driftPct,
  pointCount,
  onUndo,
  onReset,
  onDone,
}: {
  measured: number | null;
  apiLotSizeSqft: number | null;
  delta: number | null;
  ratio: number | null;
  driftPct: number | null;
  pointCount: number;
  onUndo: () => void;
  onReset: () => void;
  onDone: () => void;
}) {
  return (
    <Stack
      direction={{ xs: "column", md: "row" }}
      spacing={2}
      alignItems={{ md: "center" }}
      sx={{
        px: 2,
        py: 1.5,
        borderTop: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ flex: 1 }}>
        <Stat
          label="Measured"
          value={measured != null ? fmt(measured) : "—"}
          emphasis
        />
        <Stat
          label="API"
          value={apiLotSizeSqft != null ? fmt(apiLotSizeSqft) : "—"}
        />
        {delta != null && (
          <Stat
            label="Δ vs API"
            value={`${delta > 0 ? "+" : ""}${Math.round(delta).toLocaleString()} sqft`}
            tone={driftPct != null && driftPct > 0.2 ? "warn" : "ok"}
          />
        )}
        {ratio != null && (
          <Stat label="Ratio" value={`${Math.round(ratio * 100)}%`} />
        )}
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center">
        {pointCount > 0 && (
          <Chip
            size="small"
            variant="outlined"
            label={`${pointCount} corner${pointCount === 1 ? "" : "s"}`}
          />
        )}
        <Button
          size="small"
          startIcon={<UndoRoundedIcon fontSize="small" />}
          onClick={onUndo}
          disabled={!pointCount}
        >
          Undo
        </Button>
        <Button
          size="small"
          startIcon={<RefreshRoundedIcon fontSize="small" />}
          onClick={onReset}
          disabled={!pointCount}
        >
          Reset
        </Button>
        <Button variant="contained" size="small" onClick={onDone}>
          Done
        </Button>
      </Stack>
    </Stack>
  );
}
