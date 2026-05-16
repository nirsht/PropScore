import { Box, Paper } from "@mui/material";

export function RawPayloadCollapsible({ raw }: { raw: Record<string, unknown> }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <details>
        <summary style={{ cursor: "pointer", fontSize: 13, opacity: 0.8 }}>
          Raw MLS payload
        </summary>
        <Box
          component="pre"
          sx={{
            mt: 1.5,
            p: 1.5,
            fontSize: 11,
            overflowX: "auto",
            bgcolor: "background.paper",
            borderRadius: 1,
          }}
        >
          {JSON.stringify(raw, null, 2)}
        </Box>
      </details>
    </Paper>
  );
}
