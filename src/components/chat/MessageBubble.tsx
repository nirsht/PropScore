"use client";

import * as React from "react";
import { Avatar, Box, Chip, Stack, Typography } from "@mui/material";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
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
    const label =
      (message.toolName && TOOL_LABELS[message.toolName]) || message.toolName || "Tool";
    return (
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ pl: 5, py: 0.5, color: "text.secondary" }}
      >
        <BuildCircleOutlinedIcon sx={{ fontSize: 14 }} />
        <Typography variant="caption">
          {label}
          {message.errored ? " — failed" : ""}
        </Typography>
      </Stack>
    );
  }

  if (isUser) {
    return (
      <Stack direction="row" justifyContent="flex-end" sx={{ width: "100%", py: 0.5 }}>
        <Box
          sx={{
            maxWidth: "85%",
            px: 1.75,
            py: 1.1,
            bgcolor: (t) =>
              t.palette.mode === "dark" ? "primary.dark" : "primary.50",
            color: "text.primary",
            borderRadius: 3,
            borderTopRightRadius: 6,
          }}
        >
          <Typography
            variant="body2"
            sx={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: 14.5,
              lineHeight: 1.55,
            }}
          >
            {message.content}
          </Typography>
        </Box>
      </Stack>
    );
  }

  // Assistant: full-width, no bubble, with avatar (GPT-style).
  return (
    <Stack direction="row" spacing={1.5} sx={{ width: "100%", py: 1 }}>
      <Avatar
        sx={{
          width: 28,
          height: 28,
          mt: 0.25,
          bgcolor: isError ? "error.main" : "primary.main",
          color: "common.white",
          flexShrink: 0,
        }}
      >
        <AutoAwesomeRoundedIcon sx={{ fontSize: 16 }} />
      </Avatar>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        {isError && (
          <Stack
            direction="row"
            spacing={0.5}
            alignItems="center"
            sx={{ mb: 0.5, color: "error.main" }}
          >
            <ReportGmailerrorredOutlinedIcon sx={{ fontSize: 16 }} />
            <Typography variant="caption" fontWeight={600}>
              Error
            </Typography>
          </Stack>
        )}

        <Typography
          component="div"
          variant="body2"
          sx={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: isError ? "error.dark" : "text.primary",
            fontSize: 14.5,
            lineHeight: 1.65,
          }}
        >
          {stripCitations(message.content)}
          {message.pending && (
            <Box
              component="span"
              sx={{
                display: "inline-block",
                width: 7,
                height: 14,
                ml: 0.25,
                verticalAlign: "text-bottom",
                bgcolor: "currentColor",
                borderRadius: 0.5,
                opacity: 0.55,
                animation: "blink 1s step-start infinite",
                "@keyframes blink": { "50%": { opacity: 0 } },
              }}
            />
          )}
        </Typography>

        {message.citedMlsIds && message.citedMlsIds.length > 0 && (
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
            {message.citedMlsIds.map((id) => (
              <Chip
                key={id}
                label={id}
                size="small"
                clickable={Boolean(onCitationClick)}
                onClick={onCitationClick ? () => onCitationClick(id) : undefined}
                sx={{
                  fontFamily: "monospace",
                  fontSize: 11,
                  height: 22,
                  borderRadius: 1.5,
                }}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
