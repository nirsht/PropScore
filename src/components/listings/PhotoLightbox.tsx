"use client";

import * as React from "react";
import {
  Box,
  Dialog,
  IconButton,
  Link as MuiLink,
  Stack,
  Typography,
} from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import ZoomInRoundedIcon from "@mui/icons-material/ZoomInRounded";
import ZoomOutRoundedIcon from "@mui/icons-material/ZoomOutRounded";

type PhotoItem = {
  MediaURL?: string;
  ShortDescription?: string;
  LongDescription?: string;
  ImageWidth?: number;
  ImageHeight?: number;
};

type Props = {
  open: boolean;
  items: PhotoItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (next: number) => void;
};

export function PhotoLightbox({ open, items, index, onClose, onIndexChange }: Props) {
  const [zoomed, setZoomed] = React.useState(false);
  const [origin, setOrigin] = React.useState<{ x: number; y: number }>({ x: 50, y: 50 });

  const total = items.length;
  const item = items[index];

  const goPrev = React.useCallback(() => {
    if (total === 0) return;
    onIndexChange((index - 1 + total) % total);
    setZoomed(false);
  }, [index, total, onIndexChange]);

  const goNext = React.useCallback(() => {
    if (total === 0) return;
    onIndexChange((index + 1) % total);
    setZoomed(false);
  }, [index, total, onIndexChange]);

  // Keyboard: ← → for nav, +/-/Z to zoom, Esc to close (Dialog handles Esc).
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "+" || e.key === "=" || e.key === "z") {
        setZoomed(true);
      } else if (e.key === "-" || e.key === "Z") {
        setZoomed(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, goPrev, goNext]);

  // Reset zoom when the index changes externally.
  React.useEffect(() => {
    setZoomed(false);
    setOrigin({ x: 50, y: 50 });
  }, [index]);

  if (!item?.MediaURL) {
    return (
      <Dialog open={open} onClose={onClose} fullScreen>
        <Box sx={{ p: 3, color: "common.white" }}>No photo.</Box>
      </Dialog>
    );
  }

  function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    const rect = (e.currentTarget as HTMLImageElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setOrigin({ x, y });
    setZoomed((v) => !v);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      slotProps={{
        paper: {
          sx: {
            bgcolor: "rgba(8, 8, 12, 0.96)",
            backgroundImage: "none",
            backdropFilter: "blur(2px)",
          },
        },
      }}
    >
      {/* Top bar */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          px: 2,
          py: 1.5,
          color: "common.white",
          zIndex: 2,
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0))",
        }}
      >
        <Typography variant="body2" sx={{ opacity: 0.85 }}>
          {index + 1} / {total}
        </Typography>
        {item.ShortDescription && (
          <Typography
            variant="body2"
            sx={{
              opacity: 0.7,
              ml: 1,
              maxWidth: { xs: 180, md: 600 },
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            · {item.ShortDescription}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <IconButton
          size="small"
          sx={{ color: "common.white" }}
          onClick={() => setZoomed((v) => !v)}
          aria-label={zoomed ? "Zoom out" : "Zoom in"}
          title={zoomed ? "Zoom out (-)" : "Zoom in (+)"}
        >
          {zoomed ? <ZoomOutRoundedIcon /> : <ZoomInRoundedIcon />}
        </IconButton>
        <IconButton
          size="small"
          component={MuiLink}
          href={item.MediaURL}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ color: "common.white" }}
          aria-label="Open original"
          title="Open original"
        >
          <OpenInNewRoundedIcon />
        </IconButton>
        <IconButton
          size="small"
          onClick={onClose}
          sx={{ color: "common.white" }}
          aria-label="Close"
          title="Close (Esc)"
        >
          <CloseRoundedIcon />
        </IconButton>
      </Stack>

      {/* Prev */}
      {total > 1 && (
        <IconButton
          onClick={goPrev}
          aria-label="Previous photo"
          sx={navButtonSx({ side: "left" })}
        >
          <ChevronLeftRoundedIcon fontSize="large" />
        </IconButton>
      )}

      {/* Image */}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
        onClick={onClose}
      >
        <Box
          component="img"
          src={item.MediaURL}
          alt={item.ShortDescription ?? `Photo ${index + 1}`}
          onClick={(e) => {
            e.stopPropagation();
            handleImageClick(e);
          }}
          sx={{
            maxWidth: zoomed ? "none" : "92vw",
            maxHeight: zoomed ? "none" : "88vh",
            width: zoomed ? "auto" : undefined,
            height: zoomed ? "auto" : undefined,
            transform: zoomed ? "scale(2.2)" : "scale(1)",
            transformOrigin: `${origin.x}% ${origin.y}%`,
            transition: "transform 240ms cubic-bezier(.2,.8,.2,1)",
            cursor: zoomed ? "zoom-out" : "zoom-in",
            objectFit: "contain",
            userSelect: "none",
            display: "block",
            boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
            borderRadius: 1,
          }}
          draggable={false}
        />
      </Box>

      {/* Next */}
      {total > 1 && (
        <IconButton
          onClick={goNext}
          aria-label="Next photo"
          sx={navButtonSx({ side: "right" })}
        >
          <ChevronRightRoundedIcon fontSize="large" />
        </IconButton>
      )}

      {/* Thumbnail strip */}
      {total > 1 && (
        <Stack
          direction="row"
          spacing={1}
          sx={{
            position: "absolute",
            bottom: 16,
            left: 0,
            right: 0,
            px: 2,
            py: 1,
            zIndex: 2,
            justifyContent: "center",
            overflowX: "auto",
          }}
        >
          {items.slice(0, 30).map((it, i) => (
            <Box
              key={i}
              role="button"
              tabIndex={0}
              onClick={() => onIndexChange(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onIndexChange(i);
              }}
              sx={{
                flexShrink: 0,
                width: 64,
                height: 44,
                borderRadius: 1,
                overflow: "hidden",
                cursor: "pointer",
                outline: i === index ? "2px solid #7c5cff" : "1px solid rgba(255,255,255,0.18)",
                opacity: i === index ? 1 : 0.65,
                transition: "opacity 150ms",
                "&:hover": { opacity: 1 },
              }}
            >
              {it.MediaURL && (
                <Box
                  component="img"
                  src={it.MediaURL}
                  alt=""
                  sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                  loading="lazy"
                />
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Dialog>
  );
}

function navButtonSx({ side }: { side: "left" | "right" }) {
  return {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    [side]: 16,
    color: "common.white",
    bgcolor: "rgba(0,0,0,0.35)",
    backdropFilter: "blur(4px)",
    "&:hover": { bgcolor: "rgba(0,0,0,0.55)" },
    zIndex: 2,
  } as const;
}
