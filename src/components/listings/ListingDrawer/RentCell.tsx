import { Tooltip, Typography } from "@mui/material";

export function RentCell({
  value,
  rationale,
  italic,
}: {
  value: number | null;
  rationale?: string;
  italic: boolean;
}) {
  const text = value != null ? `$${Math.round(value).toLocaleString()}` : "—";
  const el = (
    <Typography
      variant="body2"
      sx={{
        fontWeight: 600,
        textAlign: "right",
        fontStyle: italic ? "italic" : "normal",
        color: italic ? "text.secondary" : "text.primary",
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
