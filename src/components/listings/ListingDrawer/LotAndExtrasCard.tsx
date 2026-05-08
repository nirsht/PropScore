import { Box, Chip, Paper, Stack, Typography } from "@mui/material";
import { arrField, numField, strField } from "./fieldGuards";
import { Metric } from "./Metric";

export function LotAndExtrasCard({ raw }: { raw: Record<string, unknown> }) {
  const lotFeatures = arrField(raw.LotFeatures);
  const view = arrField(raw.View);
  const parking = numField(raw.ParkingTotal);
  const hoa = numField(raw.AssociationFee);
  const hoaFreq = strField(raw.AssociationFeeFrequency);
  const tax = numField(raw.TaxAnnualAmount);
  const taxYear = numField(raw.TaxYear);

  const hasAny =
    lotFeatures.length || view.length || parking != null || hoa != null || tax != null;
  if (!hasAny) return null;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
        Lot &amp; details
      </Typography>
      <Stack
        direction="row"
        spacing={3}
        flexWrap="wrap"
        useFlexGap
        sx={{ mb: lotFeatures.length || view.length ? 1.5 : 0 }}
      >
        {parking != null && <Metric label="Parking spaces" value={String(parking)} />}
        {hoa != null && (
          <Metric
            label="HOA"
            value={`$${Math.round(hoa).toLocaleString()}${hoaFreq ? ` / ${hoaFreq.toLowerCase()}` : ""}`}
          />
        )}
        {tax != null && (
          <Metric
            label="Property tax (annual)"
            value={`$${Math.round(tax).toLocaleString()}${taxYear ? ` (${taxYear})` : ""}`}
          />
        )}
      </Stack>
      {lotFeatures.length > 0 && (
        <Box sx={{ mb: view.length ? 1 : 0 }}>
          <Typography variant="caption" color="text.secondary">
            Lot features
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
            {lotFeatures.map((f, i) => (
              <Chip key={i} size="small" variant="outlined" label={f} />
            ))}
          </Stack>
        </Box>
      )}
      {view.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary">
            View
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
            {view.map((v, i) => (
              <Chip key={i} size="small" variant="outlined" label={v} />
            ))}
          </Stack>
        </Box>
      )}
    </Paper>
  );
}
