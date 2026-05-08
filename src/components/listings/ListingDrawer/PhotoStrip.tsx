import { Box, Skeleton, Stack, Typography } from "@mui/material";

export function PhotoStrip({
  loading,
  items,
  onOpen,
}: {
  loading: boolean;
  items: Array<{ MediaURL?: string; ShortDescription?: string }>;
  onOpen: (index: number) => void;
}) {
  if (loading && items.length === 0) {
    return (
      <Stack direction="row" spacing={1.5} sx={{ overflowX: "auto" }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} variant="rectangular" width={220} height={140} />
        ))}
      </Stack>
    );
  }
  if (!items.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        No photos available from this MLS feed.
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={1.5} sx={{ overflowX: "auto", pb: 1 }}>
      {items.map((it, i) =>
        !it.MediaURL ? null : (
          <Box
            key={i}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(i)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(i);
              }
            }}
            sx={{
              position: "relative",
              flexShrink: 0,
              width: 220,
              height: 140,
              borderRadius: 1.5,
              overflow: "hidden",
              border: 1,
              borderColor: "divider",
              display: "block",
              cursor: "zoom-in",
              transition: "transform 150ms",
              "&:hover": { transform: "translateY(-2px)" },
            }}
          >
            <Box
              component="img"
              src={it.MediaURL}
              alt={it.ShortDescription ?? `Photo ${i + 1}`}
              loading="lazy"
              sx={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </Box>
        ),
      )}
    </Stack>
  );
}
