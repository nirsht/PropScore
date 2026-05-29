"use client";

import * as React from "react";
import {
  Box,
  Button,
  Chip,
  Divider,
  Popover,
  Slider,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import { WEIGHT_KEYS, type WeightKey } from "@/server/etl/scoring/valueAdd";
import {
  DEFAULT_WEIGHTS,
  useScoringWeights,
  type ScoringWeights,
} from "./filterStore";

const LABELS: Record<WeightKey, { name: string; hint: string }> = {
  vacancy: {
    name: "Vacancy",
    hint: "Higher vacancy = bigger reposition upside on rents.",
  },
  location: {
    name: "Location",
    hint: "Walk Score (30%) + neighborhood safety percentile (70%).",
  },
  density: {
    name: "Density",
    hint: "Units per parcel — more units, more cash flow.",
  },
  rehab: {
    name: "Rehab potential",
    hint: "Vision-agent renovation level + condition signals (open violations, unpermitted space). Worse condition = more upside.",
  },
  adu: {
    name: "ADU potential",
    hint: "AI-extracted feasibility for a backyard ADU.",
  },
  motivation: {
    name: "Seller motivation",
    hint: "Days on MLS + price changes — proxy for negotiability.",
  },
};

function pct(n: number): number {
  return Math.round(n * 100);
}

/**
 * Normalize the 5 weights so they sum to 1 (rounded to 2 decimals so the
 * displayed percentages don't drift from what the server applies).
 */
function normalize(w: ScoringWeights): ScoringWeights {
  const sum = WEIGHT_KEYS.reduce((s, k) => s + Math.max(0, w[k]), 0);
  if (sum <= 0) return { ...DEFAULT_WEIGHTS };
  const out = {} as ScoringWeights;
  for (const k of WEIGHT_KEYS) out[k] = Math.max(0, w[k]) / sum;
  return out;
}

export function ScoringWeightsButton() {
  const { weights, setWeights, resetWeights, isDefault } = useScoringWeights();
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  // Local draft so mid-drag re-renders don't re-sort the grid every frame.
  // We commit to the global store on slider commit (mouseup / blur).
  const [draft, setDraft] = React.useState<ScoringWeights>(weights);

  React.useEffect(() => {
    if (!anchorEl) setDraft(weights);
  }, [weights, anchorEl]);

  const open = Boolean(anchorEl);
  const draftPct = WEIGHT_KEYS.map((k) => pct(normalize(draft)[k]));
  const draftSum = draftPct.reduce((s, n) => s + n, 0);

  function handleChange(key: WeightKey, raw: number) {
    setDraft((prev) => ({ ...prev, [key]: raw / 100 }));
  }

  function handleCommit() {
    setWeights(normalize(draft));
  }

  return (
    <>
      <Tooltip title="Adjust scoring weights">
        <Button
          size="small"
          variant={isDefault ? "outlined" : "contained"}
          color={isDefault ? "inherit" : "primary"}
          startIcon={<TuneRoundedIcon fontSize="small" />}
          onClick={(e) => setAnchorEl(e.currentTarget)}
        >
          Weights
          {!isDefault && (
            <Chip
              size="small"
              label="custom"
              color="primary"
              sx={{ ml: 1, height: 18, fontSize: 10 }}
            />
          )}
        </Button>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { p: 2.5, width: 360 } } }}
      >
        <Stack spacing={1.5}>
          <Stack direction="row" alignItems="baseline" justifyContent="space-between">
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
              Scoring weights
            </Typography>
            <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
              normalized to 100%
            </Typography>
          </Stack>
          <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
            Re-rank listings by your own blend. Saved to this browser.
          </Typography>
          <Divider />
          <Stack spacing={1.25}>
            {WEIGHT_KEYS.map((k, i) => (
              <Box key={k}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Tooltip title={LABELS[k].hint} arrow placement="top">
                    <Typography
                      sx={{
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: "help",
                        userSelect: "none",
                      }}
                    >
                      {LABELS[k].name}
                    </Typography>
                  </Tooltip>
                  <Typography
                    sx={{
                      fontSize: 12,
                      fontVariantNumeric: "tabular-nums",
                      color: "text.secondary",
                      minWidth: 32,
                      textAlign: "right",
                    }}
                  >
                    {draftPct[i]}%
                  </Typography>
                </Stack>
                <Slider
                  size="small"
                  value={Math.round(draft[k] * 100)}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(_, v) => handleChange(k, Array.isArray(v) ? v[0]! : v)}
                  onChangeCommitted={handleCommit}
                />
              </Box>
            ))}
          </Stack>
          <Divider />
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
              raw sum: {draftSum}% (auto-normalized)
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                onClick={() => {
                  resetWeights();
                  setDraft(DEFAULT_WEIGHTS);
                }}
                disabled={isDefault}
              >
                Reset
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={() => {
                  handleCommit();
                  setAnchorEl(null);
                }}
              >
                Done
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </Popover>
    </>
  );
}
