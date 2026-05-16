import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { PhotoStrip } from "./PhotoStrip";

type PhotosQueryData = {
  items: unknown[];
  via?: string;
  attempts: unknown[];
} | undefined;

export function PhotosCard({
  loading,
  data,
  onOpenPhoto,
  onRefresh,
}: {
  loading: boolean;
  data: PhotosQueryData;
  onOpenPhoto: (idx: number) => void;
  onRefresh: () => void;
}) {
  const items = (data?.items ?? []) as Parameters<typeof PhotoStrip>[0]["items"];
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle2">Photos</Typography>
        {loading && <CircularProgress size={14} />}
        {data?.via && data.via !== "none" && (
          <Chip
            size="small"
            variant="outlined"
            label={data.via}
            sx={{ fontSize: 10 }}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          {data?.items.length ?? 0} photos
        </Typography>
        <Button size="small" variant="text" onClick={onRefresh}>
          Refresh
        </Button>
      </Stack>
      <PhotoStrip loading={loading} items={items} onOpen={onOpenPhoto} />
      {data &&
        !data.items.length &&
        data.via === "none" &&
        data.attempts.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              Tried {data.attempts.length} Bridge endpoints — none returned media.
              Run <code>pnpm bootstrap:bridge</code> to inspect what `sfar` exposes.
            </Typography>
          </Box>
        )}
    </Paper>
  );
}
