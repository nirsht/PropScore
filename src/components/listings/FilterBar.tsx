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
} from "@mui/material";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import { trpc } from "@/lib/trpc/client";
import { useFilter } from "./filterStore";

type Range = { min?: number; max?: number };

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
    <Stack direction="column" spacing={0.5} sx={{ minWidth: 180 }}>
      <Tooltip title={hint ?? ""} arrow placement="top" disableHoverListener={!hint}>
        <Box sx={{ fontSize: 12, color: "text.secondary", cursor: hint ? "help" : "default" }}>
          {label}
        </Box>
      </Tooltip>
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
        />
      </Stack>
    </Stack>
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
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: expanded ? 2 : 0 }}>
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
        <Box sx={{ fontSize: 13, fontWeight: 600 }}>Filters</Box>
        {activeCount > 0 && (
          <Chip size="small" color="primary" label={`${activeCount} active`} />
        )}

        <Box sx={{ flex: 1 }} />

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

      <Collapse in={expanded} unmountOnExit>
        <Stack
          direction={{ xs: "column", lg: "row" }}
          spacing={2}
          alignItems={{ xs: "stretch", lg: "flex-end" }}
          flexWrap="wrap"
        >
          <TextField
            label="Address / city"
            placeholder="Mission, 24th St…"
            value={state.q ?? ""}
            onChange={(e) => set({ q: e.target.value || undefined })}
            sx={{ minWidth: 220 }}
          />

          <Autocomplete
            multiple
            size="small"
            sx={{ minWidth: 240 }}
            options={propertyTypeOptions}
            value={state.propertyTypes ?? []}
            onChange={(_, value) => set({ propertyTypes: value.length ? value : undefined })}
            renderInput={(params) => <TextField {...params} label="Property type" />}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => {
                const { key, ...tagProps } = getTagProps({ index });
                return <Chip key={key} size="small" label={option} {...tagProps} />;
              })
            }
          />

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
        </Stack>
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
    <Stack direction="row" spacing={1}>
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
  if (s.radius) n++;
  if (s.polygon) n++;
  return n;
}
