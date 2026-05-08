import { Box, Typography } from "@mui/material";

export function MlsRemarksFooter({
  privateRemarks,
}: {
  privateRemarks: string | null;
}) {
  if (!privateRemarks) return null;
  return (
    <Box
      sx={{
        mt: 1.25,
        pt: 1,
        borderTop: 1,
        borderColor: "divider",
      }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          fontWeight: 600,
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        From MLS · original source
      </Typography>
      <Box sx={{ mt: 0.75 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontWeight: 600 }}
        >
          Private remarks
        </Typography>
        <Typography
          component="pre"
          variant="body2"
          sx={{
            whiteSpace: "pre-wrap",
            fontFamily: "inherit",
            m: 0,
            mt: 0.25,
          }}
        >
          {privateRemarks}
        </Typography>
      </Box>
    </Box>
  );
}
