import { Box, Typography } from "@mui/material";

export function Metric({
  label,
  value,
  emphasis,
  small,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  small?: boolean;
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant={emphasis ? "h6" : small ? "body2" : "body1"}
        sx={{ fontWeight: emphasis ? 700 : 500, lineHeight: 1.2 }}
      >
        {value}
      </Typography>
    </Box>
  );
}
