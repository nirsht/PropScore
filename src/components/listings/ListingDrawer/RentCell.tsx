import { Tooltip, Typography } from "@mui/material";

export function RentCell({
  value,
  rationale,
  italic,
  placeholder,
}: {
  value: number | null;
  rationale?: string;
  italic: boolean;
  /** Shown italic+muted when value is null. Defaults to "—". Used to render
   *  "Vacant" in the Current column so a null rent reads as intentional
   *  rather than missing data. */
  placeholder?: string;
}) {
  const text =
    value != null ? `$${Math.round(value).toLocaleString()}` : (placeholder ?? "—");
  const isPlaceholder = value == null && placeholder != null;
  const el = (
    <Typography
      variant="body2"
      sx={{
        fontWeight: 600,
        textAlign: "right",
        fontStyle: italic || isPlaceholder ? "italic" : "normal",
        color: italic || isPlaceholder ? "text.secondary" : "text.primary",
        cursor: rationale ? "help" : "default",
      }}
    >
      {text}
    </Typography>
  );
  return rationale ? (
    <Tooltip arrow placement="top" title={rationale}>
      {el}
    </Tooltip>
  ) : (
    el
  );
}
