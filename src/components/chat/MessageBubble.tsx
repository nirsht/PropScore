"use client";

import * as React from "react";
import { Box, Chip, Paper, Stack, Typography } from "@mui/material";
import BuildCircleOutlinedIcon from "@mui/icons-material/BuildCircleOutlined";
import ReportGmailerrorredOutlinedIcon from "@mui/icons-material/ReportGmailerrorredOutlined";
import type { UIMessage } from "./types";

const TOOL_LABELS: Record<string, string> = {
  search_listings: "Searched listings",
  get_listing: "Loaded listing",
  fetch_rent_comps: "Pulled rent comps",
  fetch_parcel: "Read SF Assessor parcel",
  trigger_ai_scoring: "Re-ran AI scoring",
  web_search: "Searched the web",
};

/**
 * Strip the [mls:<id>] markers out of the assistant text — they're rendered
 * as chips below the message instead.
 */
function stripCitations(text: string): string {
  return text.replace(/\[mls:[A-Za-z0-9_-]+\]/g, "").replace(/[ \t]+\n/g, "\n");
}

type Props = {
  message: UIMessage;
  onCitationClick?: (mlsId: string) => void;
};

export function MessageBubble({ message, onCitationClick }: Props) {
  const isUser = message.role === "USER";
  const isTool = message.role === "TOOL";
  const isError = message.errored;

  if (isTool) {
    const label = (message.toolName && TOOL_LABELS[message.toolName]) || message.toolName || "Tool";
    return (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ pl: 1, py: 0.5 }}>
        <BuildCircleOutlinedIcon sx={{ fontSize: 16, color: "text.disabled" }} />
        <Typography variant="caption" color="text.secondary">
          {label}
          {message.errored ? " — failed" : ""}
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack
      direction="row"
      justifyContent={isUser ? "flex-end" : "flex-start"}
      sx={{ width: "100%" }}
    >
      <Paper
        variant={isUser ? "elevation" : "outlined"}
        elevation={isUser ? 0 : 0}
        sx={{
          maxWidth: "85%",
          px: 1.5,
          py: 1,
          bgcolor: isUser ? "primary.main" : isError ? "error.50" : "background.paper",
          color: isUser ? "primary.contrastText" : isError ? "error.dark" : "text.primary",
          borderColor: isError ? "error.main" : undefined,
          borderRadius: 2,
          ...(isUser && { borderBottomRightRadius: 4 }),
          ...(!isUser && { borderBottomLeftRadius: 4 }),
        }}
      >
        {isError && (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
            <ReportGmailerrorredOutlinedIcon sx={{ fontSize: 16 }} />
            <Typography variant="caption" fontWeight={600}>
              Error
            </Typography>
          </Stack>
        )}

        <Typography
          component="div"
          variant="body2"
          sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        >
          {message.role === "ASSISTANT" ? stripCitations(message.content) : message.content}
          {message.pending && (
            <Box
              component="span"
              sx={{
                display: "inline-block",
                width: 8,
                height: 14,
                ml: 0.25,
                verticalAlign: "text-bottom",
                bgcolor: "currentColor",
                opacity: 0.4,
                animation: "blink 1s step-start infinite",
                "@keyframes blink": { "50%": { opacity: 0 } },
              }}
            />
          )}
        </Typography>

        {!isUser && message.citedMlsIds && message.citedMlsIds.length > 0 && (
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
            {message.citedMlsIds.map((id) => (
              <Chip
                key={id}
                label={id}
                size="small"
                clickable={Boolean(onCitationClick)}
                onClick={onCitationClick ? () => onCitationClick(id) : undefined}
                sx={{ fontFamily: "monospace", fontSize: 11 }}
              />
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

