"use client";

import * as React from "react";
import { Box, Stack, TextField, Tooltip, Typography } from "@mui/material";

export type Range = { min?: number; max?: number };

export function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <Tooltip title={hint ?? ""} arrow placement="top" disableHoverListener={!hint}>
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          fontWeight: 500,
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          mb: 0.75,
          display: "block",
          cursor: hint ? "help" : "default",
          userSelect: "none",
        }}
      >
        {children}
      </Typography>
    </Tooltip>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      {children}
    </Box>
  );
}

type DateRangeValue = { min?: string; max?: string };

export function DateRange({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: DateRangeValue | undefined;
  onChange: (v: DateRangeValue | undefined) => void;
  hint?: string;
}) {
  const [min, setMin] = React.useState(value?.min ?? "");
  const [max, setMax] = React.useState(value?.max ?? "");

  React.useEffect(() => {
    setMin(value?.min ?? "");
    setMax(value?.max ?? "");
  }, [value?.min, value?.max]);

  function commit(nextMin: string, nextMax: string) {
    if (!nextMin && !nextMax) {
      onChange(undefined);
      return;
    }
    onChange({
      ...(nextMin ? { min: nextMin } : {}),
      ...(nextMax ? { max: nextMax } : {}),
    });
  }

  return (
    <Field label={label} hint={hint}>
      <Stack direction="row" spacing={1}>
        <TextField
          type="date"
          label="min"
          value={min}
          onChange={(e) => {
            setMin(e.target.value);
            commit(e.target.value, max);
          }}
          slotProps={{ inputLabel: { shrink: true } }}
          fullWidth
        />
        <TextField
          type="date"
          label="max"
          value={max}
          onChange={(e) => {
            setMax(e.target.value);
            commit(min, e.target.value);
          }}
          slotProps={{ inputLabel: { shrink: true } }}
          fullWidth
        />
      </Stack>
    </Field>
  );
}

export function NumberRange({
  label,
  value,
  onChange,
  hint,
  step = 1,
}: {
  label: string;
  value: Range | undefined;
  onChange: (v: Range | undefined) => void;
  hint?: string;
  step?: number;
}) {
  const [min, setMin] = React.useState(value?.min?.toString() ?? "");
  const [max, setMax] = React.useState(value?.max?.toString() ?? "");

  React.useEffect(() => {
    setMin(value?.min?.toString() ?? "");
    setMax(value?.max?.toString() ?? "");
  }, [value?.min, value?.max]);

  function commit(nextMin: string, nextMax: string) {
    const parsedMin = nextMin === "" ? undefined : Number(nextMin);
    const parsedMax = nextMax === "" ? undefined : Number(nextMax);
    if (
      (parsedMin == null || Number.isFinite(parsedMin)) &&
      (parsedMax == null || Number.isFinite(parsedMax))
    ) {
      const next: Range | undefined =
        parsedMin == null && parsedMax == null ? undefined : { min: parsedMin, max: parsedMax };
      onChange(next);
    }
  }

  return (
    <Field label={label} hint={hint}>
      <Stack direction="row" spacing={1}>
        <TextField
          placeholder="min"
          type="number"
          value={min}
          onChange={(e) => setMin(e.target.value)}
          onBlur={() => commit(min, max)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(min, max);
          }}
          inputProps={{ inputMode: "numeric", step }}
          fullWidth
        />
        <TextField
          placeholder="max"
          type="number"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          onBlur={() => commit(min, max)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(min, max);
          }}
          inputProps={{ inputMode: "numeric", step }}
          fullWidth
        />
      </Stack>
    </Field>
  );
}
