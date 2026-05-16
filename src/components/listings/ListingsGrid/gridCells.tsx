import { Box, Stack, Tooltip, Typography } from "@mui/material";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import { getDiscrepancyTone } from "@/lib/diff";

export function HeaderTooltip({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip title={hint} arrow placement="top">
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ cursor: "help" }}>
        <Typography variant="inherit" component="span">
          {label}
        </Typography>
        <HelpOutlineRoundedIcon sx={{ fontSize: 13, opacity: 0.55 }} />
      </Stack>
    </Tooltip>
  );
}

/**
 * Italic-muted cell used when the primary source is null and we're showing
 * an alternative (assessor / AI / lot). Always wrapped in a tooltip that
 * explains where the number came from.
 */
export function FallbackCell({
  value,
  prefix,
  tooltip,
}: {
  value: string;
  prefix?: string;
  tooltip: string;
}) {
  return (
    <Tooltip arrow placement="top" title={tooltip}>
      <Box
        component="span"
        sx={{ color: "text.secondary", fontStyle: "italic", fontWeight: 500 }}
      >
        {prefix ? `${prefix} ${value}` : value}
      </Box>
    </Tooltip>
  );
}

/**
 * Cell renderer that shows the resolved value (Assessor-first) and
 * highlights it green when assessor > MLS (upside) or red when assessor <
 * MLS (overstatement). Tooltip shows both numbers + tone.
 */
export function DiscrepancyCell({
  preferred,
  mls,
  assessor,
  fmt,
}: {
  preferred: number | null | undefined;
  mls: number | null | undefined;
  assessor: number | null | undefined;
  fmt: (n: number) => string;
}) {
  const tone = getDiscrepancyTone(mls, assessor);
  const sx: Record<string, unknown> = {
    px: 1.25,
    py: 0.25,
    borderRadius: 999,
    fontWeight: tone === "neutral" ? 500 : 600,
    display: "inline-block",
    lineHeight: 1.6,
  };
  if (tone === "positive") {
    sx.bgcolor = "success.light";
    sx.color = "success.contrastText";
  } else if (tone === "negative") {
    sx.bgcolor = "error.light";
    sx.color = "error.contrastText";
  }
  const node = (
    <Box component="span" sx={sx}>
      {preferred == null ? "—" : fmt(preferred)}
    </Box>
  );
  if (tone === "neutral") return node;
  const tip =
    `MLS: ${mls != null ? fmt(mls) : "—"} · Assessor: ${assessor != null ? fmt(assessor) : "—"} ` +
    `(${tone === "positive" ? "Assessor larger — upside" : "Assessor smaller — MLS overstates"})`;
  return (
    <Tooltip title={tip} arrow placement="top">
      {node}
    </Tooltip>
  );
}
