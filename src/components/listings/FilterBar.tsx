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
import { ScoringWeightsButton } from "./ScoringWeightsPopover";
import { DateRange, Field, NumberRange } from "./FilterBar/fields";
import { QuickChips } from "./FilterBar/QuickChips";
import { RENO_OPTIONS, countActive } from "./FilterBar/filterConstants";

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
          <ScoringWeightsButton />
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
            <Field label="Address / city / MLS ID">
              <TextField
                placeholder="Mission, 24th St, 424012345…"
                value={state.q ?? ""}
                onChange={(e) => set({ q: e.target.value || undefined })}
                fullWidth
              />
            </Field>
          </Box>

          <Box sx={{ gridColumn: { xs: "auto", sm: "span 1" } }}>
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

          <Box sx={{ gridColumn: { xs: "auto", sm: "span 1" } }}>
            <Field
              label="Renovation"
              hint="MLS-vision classification of renovation level. Multi-select (any match)."
            >
              <Autocomplete
                multiple
                size="small"
                options={RENO_OPTIONS}
                getOptionLabel={(opt) => opt.label}
                isOptionEqualToValue={(a, b) => a.value === b.value}
                value={RENO_OPTIONS.filter((o) =>
                  (state.renovationLevel ?? []).includes(o.value),
                )}
                onChange={(_, value) =>
                  set({
                    renovationLevel: value.length
                      ? value.map((v) => v.value)
                      : undefined,
                  })
                }
                renderInput={(params) => (
                  <TextField {...params} placeholder="Any condition" />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((opt, index) => {
                    const { key, ...tagProps } = getTagProps({ index });
                    return (
                      <Chip
                        key={key}
                        size="small"
                        label={opt.label}
                        color={opt.color}
                        {...tagProps}
                      />
                    );
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
          <NumberRange
            label="Sqft"
            hint="Building sqft (assessor-first). Falls back to lot sqft when building sqft is missing."
            value={state.sqft}
            onChange={(sqft) => set({ sqft })}
            step={50}
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
          <NumberRange
            label="Open NOVs"
            hint="DBI Notice of Violations open today on the parcel. Set max=0 to filter out parcels with active code-enforcement risk; set min≥3 to surface distressed-asset levers."
            value={state.codeViolationsOpenCount}
            onChange={(codeViolationsOpenCount) => set({ codeViolationsOpenCount })}
          />
          <NumberRange
            label="Net unit Δ (5y)"
            hint="Sum of net unit changes attributed to the parcel over the last 5 years. Negative = net loss (rental upside cap), positive = net gain."
            value={state.housingNetUnitChange5y}
            onChange={(housingNetUnitChange5y) => set({ housingNetUnitChange5y })}
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
