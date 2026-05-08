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
            width: { xs: "100%", md: 720 },
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
        spacing={1}
        sx={{ p: 1.5, borderBottom: 1, borderColor: "divider" }}
      >
        <ChatBubbleOutlineRoundedIcon fontSize="small" />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          Ask across all listings
        </Typography>
        <IconButton size="small" onClick={onClose}>
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
