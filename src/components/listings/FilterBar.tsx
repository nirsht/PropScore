"use client";

import * as React from "react";
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import { trpc } from "@/lib/trpc/client";
import { useFilter } from "./filterStore";

type Range = { min?: number; max?: number };

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
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

function Field({
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

type DateRangeValue = { from?: string; to?: string };

function DateRange({
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
  const [from, setFrom] = React.useState(value?.from ?? "");
  const [to, setTo] = React.useState(value?.to ?? "");

  React.useEffect(() => {
    setFrom(value?.from ?? "");
    setTo(value?.to ?? "");
  }, [value?.from, value?.to]);

  function commit(nextFrom: string, nextTo: string) {
    if (!nextFrom && !nextTo) {
      onChange(undefined);
      return;
    }
    onChange({
      ...(nextFrom ? { from: nextFrom } : {}),
      ...(nextTo ? { to: nextTo } : {}),
    });
  }

  return (
    <Field label={label} hint={hint}>
      <Stack direction="row" spacing={1}>
        <TextField
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            commit(e.target.value, to);
          }}
          fullWidth
        />
        <TextField
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            commit(from, e.target.value);
          }}
          fullWidth
        />
      </Stack>
    </Field>
  );
}

function NumberRange({
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

export function FilterBar() {
  const { state, set, reset } = useFilter();
  const facets = trpc.listings.facets.useQuery(undefined, { staleTime: 5 * 60_000 });
  const [expanded, setExpanded] = React.useState(true);

  const propertyTypeOptions = facets.data?.propertyTypes.map((p) => p.value) ?? [];
  const activeCount = countActive(state);

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
      {/* Header row: collapse toggle, label, active-count, quick chips, reset */}
      <Stack
        direction={{ xs: "column", md: "row" }}
        alignItems={{ xs: "stretch", md: "center" }}
        spacing={1.5}
        sx={{ mb: expanded ? 2.5 : 0 }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <IconButton
            size="small"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse filters" : "Expand filters"}
          >
            <ExpandMoreRoundedIcon
              sx={{
                transition: "transform 200ms",
                transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
              }}
            />
          </IconButton>
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>Filters</Typography>
          {activeCount > 0 && (
            <Chip size="small" color="primary" label={`${activeCount} active`} />
          )}
        </Stack>

        <Box sx={{ flex: 1 }} />

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <QuickChips />
          <Tooltip title="Reset all filters">
            <span>
              <Button
                size="small"
                variant="text"
                startIcon={<RefreshOutlinedIcon fontSize="small" />}
                onClick={reset}
                disabled={activeCount === 0}
              >
                Reset
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      <Collapse in={expanded} unmountOnExit>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(2, 1fr)",
              md: "repeat(3, 1fr)",
              lg: "repeat(4, 1fr)",
            },
            columnGap: 2,
            rowGap: 2.25,
          }}
        >
          {/* Address spans 2 columns when there's space */}
          <Box sx={{ gridColumn: { xs: "auto", sm: "span 2" } }}>
            <Field label="Address / city">
              <TextField
                placeholder="Mission, 24th St…"
                value={state.q ?? ""}
                onChange={(e) => set({ q: e.target.value || undefined })}
                fullWidth
              />
            </Field>
          </Box>

          <Box sx={{ gridColumn: { xs: "auto", sm: "span 2" } }}>
            <Field label="Property type">
              <Autocomplete
                multiple
                size="small"
                options={propertyTypeOptions}
                value={state.propertyTypes ?? []}
                onChange={(_, value) => set({ propertyTypes: value.length ? value : undefined })}
                renderInput={(params) => (
                  <TextField {...params} placeholder="Any type" />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => {
                    const { key, ...tagProps } = getTagProps({ index });
                    return <Chip key={key} size="small" label={option} {...tagProps} />;
                  })
                }
              />
            </Field>
          </Box>

          <NumberRange
            label="Price ($)"
            hint="ListPrice from MLS"
            value={state.price}
            onChange={(price) => set({ price })}
            step={1000}
          />
          <NumberRange
            label="$/Sqft"
            hint="price ÷ sqft (indexed)"
            value={state.pricePerSqft}
            onChange={(pricePerSqft) => set({ pricePerSqft })}
          />
          <NumberRange
            label="$/Unit"
            hint="price ÷ units (indexed)"
            value={state.pricePerUnit}
            onChange={(pricePerUnit) => set({ pricePerUnit })}
          />
          <NumberRange label="Units" value={state.units} onChange={(units) => set({ units })} />

          <NumberRange label="Beds" value={state.beds} onChange={(beds) => set({ beds })} />
          <NumberRange
            label="Year built"
            value={state.yearBuilt}
            onChange={(yearBuilt) => set({ yearBuilt })}
          />
          <NumberRange
            label="DOM"
            hint="Days on market"
            value={state.daysOnMls}
            onChange={(daysOnMls) => set({ daysOnMls })}
          />
          <NumberRange
            label="Value-Add ≥"
            hint="0–100 weighted opportunity score"
            value={state.valueAddWeightedAvg}
            onChange={(valueAddWeightedAvg) => set({ valueAddWeightedAvg })}
          />
          <DateRange
            label="Posted"
            hint="Listing post-date range (inclusive)"
            value={state.postDate}
            onChange={(postDate) => set({ postDate })}
          />
        </Box>
      </Collapse>
    </Paper>
  );
}

function QuickChips() {
  const { state, set } = useFilter();
  const chips = [
    {
      key: "ppsf-600",
      label: "$/Sqft < $600",
      active: state.pricePerSqft?.max === 600,
      apply: () =>
        set({
          pricePerSqft: state.pricePerSqft?.max === 600 ? undefined : { max: 600 },
        }),
    },
    {
      key: "ppu-500k",
      label: "Price/Unit < $500k",
      active: state.pricePerUnit?.max === 500_000,
      apply: () =>
        set({
          pricePerUnit: state.pricePerUnit?.max === 500_000 ? undefined : { max: 500_000 },
        }),
    },
    {
      key: "value-add-70",
      label: "Value-Add ≥ 70",
      active: state.valueAddWeightedAvg?.min === 70,
      apply: () =>
        set({
          valueAddWeightedAvg:
            state.valueAddWeightedAvg?.min === 70 ? undefined : { min: 70 },
        }),
    },
  ];

  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      {chips.map((c) => (
        <Chip
          key={c.key}
          size="small"
          label={c.label}
          color={c.active ? "primary" : "default"}
          variant={c.active ? "filled" : "outlined"}
          onClick={c.apply}
        />
      ))}
    </Stack>
  );
}

function countActive(s: ReturnType<typeof useFilter>["state"]): number {
  let n = 0;
  if (s.q) n++;
  if (s.propertyTypes?.length) n++;
  for (const k of [
    "price",
    "pricePerSqft",
    "pricePerUnit",
    "sqft",
    "units",
    "beds",
    "baths",
    "yearBuilt",
    "daysOnMls",
    "occupancy",
    "densityScore",
    "vacancyScore",
    "motivationScore",
    "valueAddWeightedAvg",
  ] as const) {
    const v = s[k];
    if (v && (v.min != null || v.max != null)) n++;
  }
  if (s.postDate && (s.postDate.from || s.postDate.to)) n++;
  if (s.radius) n++;
  if (s.polygon) n++;
  return n;
}
