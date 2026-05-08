"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Box, Drawer, IconButton, Stack, Typography } from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import ChatBubbleOutlineRoundedIcon from "@mui/icons-material/ChatBubbleOutlineRounded";
import { ChatPanel } from "./ChatPanel";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Right-anchored global chat drawer reachable from the AppBar. Provides a
 * conversation list rail + a single ChatPanel for the active thread.
 * Citation chips navigate to /listings?listing=<id>, which the listings
 * page picks up to auto-open the per-listing drawer.
 */
export function GlobalChatDrawer({ open, onClose }: Props) {
  const router = useRouter();

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: { xs: "100%", md: 880, lg: 960 },
            maxWidth: "100vw",
            display: "flex",
            flexDirection: "column",
            bgcolor: "background.default",
          },
        },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{
          px: 2,
          py: 1.25,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            bgcolor: "primary.main",
            color: "common.white",
            display: "grid",
            placeItems: "center",
          }}
        >
          <ChatBubbleOutlineRoundedIcon sx={{ fontSize: 16 }} />
        </Box>
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight={600} lineHeight={1.2}>
            PropScore Assistant
          </Typography>
          <Typography variant="caption" color="text.secondary" lineHeight={1.2}>
            Ask across all listings
          </Typography>
        </Stack>
        <IconButton size="small" onClick={onClose} aria-label="Close chat">
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
        <ChatPanel
          scope="GLOBAL"
          mode="panel"
          onCitationClick={(mlsId) => {
            router.push(`/listings?listing=${encodeURIComponent(mlsId)}`);
            onClose();
          }}
          emptyHint="Ask anything about the listings — comparisons, market context, web facts (mortgage rates, zoning), specific MLS lookups."
        />
      </Box>
    </Drawer>
  );
}
