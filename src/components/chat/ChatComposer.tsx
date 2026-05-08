"use client";

import * as React from "react";
import { IconButton, Stack, TextField, Tooltip } from "@mui/material";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
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
    <Stack
      spacing={1}
      sx={{
        p: 1.5,
        borderTop: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Stack direction="row" spacing={1} alignItems="flex-end">
        <TextField
          fullWidth
          multiline
          maxRows={6}
          size="small"
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={disabled || streaming}
        />

        {streaming ? (
          <Tooltip title="Stop">
            <IconButton color="error" onClick={onCancel}>
              <StopRoundedIcon />
            </IconButton>
          </Tooltip>
        ) : (
          <Tooltip title="Send (Enter)">
            <span>
              <IconButton color="primary" disabled={!canSend} onClick={send}>
                <SendRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Stack>
    </Stack>
  );
}
