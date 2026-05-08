import { Box, Chip, Stack, Typography } from "@mui/material";

export function Rationale({ breakdown }: { breakdown: Record<string, unknown> }) {
  const r = breakdown.rationale as
    | { density?: string; vacancy?: string; motivation?: string; valueAdd?: string }
    | undefined;
  const signals = breakdown.signals as string[] | undefined;
  if (!r && !signals) {
    return (
      <Box component="pre" sx={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
        {JSON.stringify(breakdown, null, 2)}
      </Box>
    );
  }
  return (
    <Stack spacing={1}>
      {r?.density && <Line label="Density" value={r.density} />}
      {r?.vacancy && <Line label="Vacancy" value={r.vacancy} />}
      {r?.motivation && <Line label="Motivation" value={r.motivation} />}
      {r?.valueAdd && <Line label="Value-Add" value={r.valueAdd} />}
      {signals && signals.length > 0 && (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {signals.map((s, i) => (
            <Chip key={i} size="small" variant="outlined" label={s} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  );
}
