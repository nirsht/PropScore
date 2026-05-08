"use client";

import * as React from "react";
import { Box, IconButton, InputBase, Tooltip, Typography } from "@mui/material";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";

type Props = {
  conversationId: string | null;
  disabled?: boolean;
  streaming: boolean;
  placeholder?: string;
  onSend: (text: string) => void;
  onCancel?: () => void;
};

export function ChatComposer({
  disabled,
  streaming,
  placeholder = "Ask anything about this listing…",
  onSend,
  onCancel,
}: Props) {
  const [text, setText] = React.useState("");
  const canSend = !disabled && !streaming && text.trim().length > 0;

  function send() {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  }

  return (
    <Box sx={{ p: 1.5, pt: 1, bgcolor: "background.default" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-end",
          gap: 0.5,
          bgcolor: "background.paper",
          border: 1,
          borderColor: "divider",
          borderRadius: 4,
          px: 1.75,
          py: 1,
          transition: "border-color 120ms, box-shadow 120ms",
          "&:focus-within": {
            borderColor: "primary.main",
            boxShadow: (t) => `0 0 0 3px ${t.palette.primary.main}1f`,
          },
        }}
      >
        <InputBase
          fullWidth
          multiline
          maxRows={8}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={disabled}
          sx={{
            flex: 1,
            fontSize: 14.5,
            lineHeight: 1.55,
            py: 0.5,
            "& textarea": {
              "&::placeholder": { color: "text.disabled", opacity: 1 },
            },
          }}
        />

        {streaming ? (
          <Tooltip title="Stop generating">
            <IconButton
              onClick={onCancel}
              size="small"
              sx={{
                bgcolor: "text.primary",
                color: "background.paper",
                "&:hover": { bgcolor: "text.secondary" },
                width: 32,
                height: 32,
              }}
            >
              <StopRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        ) : (
          <Tooltip title={canSend ? "Send (Enter)" : "Type a message"}>
            <span>
              <IconButton
                disabled={!canSend}
                onClick={send}
                size="small"
                sx={{
                  bgcolor: canSend ? "text.primary" : "action.disabledBackground",
                  color: canSend ? "background.paper" : "text.disabled",
                  "&:hover": {
                    bgcolor: canSend ? "text.secondary" : "action.disabledBackground",
                  },
                  "&.Mui-disabled": {
                    bgcolor: "action.disabledBackground",
                    color: "text.disabled",
                  },
                  width: 32,
                  height: 32,
                }}
              >
                <ArrowUpwardRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Box>

      <Typography
        variant="caption"
        sx={{
          display: "block",
          textAlign: "center",
          mt: 0.75,
          color: "text.disabled",
          fontSize: 11,
        }}
      >
        Press <Box component="kbd" sx={kbd}>Enter</Box> to send,{" "}
        <Box component="kbd" sx={kbd}>Shift</Box>+<Box component="kbd" sx={kbd}>Enter</Box> for
        new line
      </Typography>
    </Box>
  );
}

const kbd = {
  fontFamily: "monospace",
  fontSize: 10.5,
  px: 0.5,
  py: 0.1,
  border: 1,
  borderColor: "divider",
  borderRadius: 0.75,
  bgcolor: "background.paper",
  color: "text.secondary",
};
