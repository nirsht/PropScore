"use client";

import * as React from "react";
import {
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import PushPinRoundedIcon from "@mui/icons-material/PushPinRounded";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import { trpc } from "@/lib/trpc/client";
import type { ChatScope } from "./types";

type Props = {
  scope?: ChatScope;
  listingMlsId?: string;
  activeId: string | null;
  onSelect: (conversationId: string) => void;
  onNew: () => void;
  emptyHint?: React.ReactNode;
};

type ConvoRow = {
  id: string;
  title: string;
  pinned: boolean;
  updatedAt: string | Date;
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function bucketFor(date: Date): "Today" | "Yesterday" | "Previous 7 days" | "Older" {
  const now = startOfDay(new Date());
  const d = startOfDay(date);
  const diffDays = Math.round((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "Previous 7 days";
  return "Older";
}

const BUCKET_ORDER = ["Today", "Yesterday", "Previous 7 days", "Older"] as const;

export function ConversationList({
  scope,
  listingMlsId,
  activeId,
  onSelect,
  onNew,
  emptyHint,
}: Props) {
  const utils = trpc.useUtils();
  const list = trpc.chat.list.useQuery({
    scope,
    listingMlsId,
    archived: false,
    limit: 50,
  });
  const setPinned = trpc.chat.setPinned.useMutation({
    onSuccess: () => utils.chat.list.invalidate(),
  });
  const setArchived = trpc.chat.setArchived.useMutation({
    onSuccess: () => utils.chat.list.invalidate(),
  });
  const del = trpc.chat.delete.useMutation({
    onSuccess: () => utils.chat.list.invalidate(),
  });

  const [menuFor, setMenuFor] = React.useState<{ id: string; el: HTMLElement } | null>(null);
  const menuConvo = list.data?.find((c) => c.id === menuFor?.id);

  const grouped = React.useMemo(() => {
    const rows = (list.data ?? []) as ConvoRow[];
    const pinned = rows.filter((c) => c.pinned);
    const others = rows.filter((c) => !c.pinned);
    const buckets: Record<string, ConvoRow[]> = {};
    for (const c of others) {
      const key = bucketFor(new Date(c.updatedAt));
      (buckets[key] ??= []).push(c);
    }
    return { pinned, buckets };
  }, [list.data]);

  return (
    <Stack
      sx={{
        height: "100%",
        minHeight: 0,
        bgcolor: (t) => (t.palette.mode === "dark" ? "grey.900" : "grey.50"),
      }}
    >
      <Box sx={{ p: 1.5 }}>
        <Button
          fullWidth
          variant="outlined"
          startIcon={<AddRoundedIcon />}
          onClick={onNew}
          sx={{
            justifyContent: "flex-start",
            textTransform: "none",
            fontWeight: 500,
            borderRadius: 2,
            borderColor: "divider",
            color: "text.primary",
            bgcolor: "background.paper",
            "&:hover": {
              bgcolor: "background.paper",
              borderColor: "text.secondary",
            },
          }}
        >
          New chat
        </Button>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 1, pb: 1 }}>
        {list.data && list.data.length === 0 && (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {emptyHint ?? "No chats yet."}
            </Typography>
          </Box>
        )}

        {grouped.pinned.length > 0 && (
          <Section
            label="Pinned"
            rows={grouped.pinned}
            activeId={activeId}
            onSelect={onSelect}
            onMenuOpen={(id, el) => setMenuFor({ id, el })}
          />
        )}

        {BUCKET_ORDER.map((b) => {
          const rows = grouped.buckets[b];
          if (!rows || rows.length === 0) return null;
          return (
            <Section
              key={b}
              label={b}
              rows={rows}
              activeId={activeId}
              onSelect={onSelect}
              onMenuOpen={(id, el) => setMenuFor({ id, el })}
            />
          );
        })}
      </Box>

      <Menu
        open={!!menuFor}
        anchorEl={menuFor?.el ?? null}
        onClose={() => setMenuFor(null)}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      >
        <MenuItem
          onClick={() => {
            if (menuFor) {
              setPinned.mutate({
                conversationId: menuFor.id,
                pinned: !menuConvo?.pinned,
              });
            }
            setMenuFor(null);
          }}
        >
          <PushPinOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
          {menuConvo?.pinned ? "Unpin" : "Pin"}
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuFor) setArchived.mutate({ conversationId: menuFor.id, archived: true });
            setMenuFor(null);
          }}
        >
          <ArchiveOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
          Archive
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuFor && confirm("Delete this conversation? This can't be undone.")) {
              del.mutate({ conversationId: menuFor.id });
              if (activeId === menuFor.id) onNew();
            }
            setMenuFor(null);
          }}
          sx={{ color: "error.main" }}
        >
          <DeleteOutlineRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
          Delete
        </MenuItem>
      </Menu>
    </Stack>
  );
}

function Section({
  label,
  rows,
  activeId,
  onSelect,
  onMenuOpen,
}: {
  label: string;
  rows: ConvoRow[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onMenuOpen: (id: string, el: HTMLElement) => void;
}) {
  return (
    <Box sx={{ mb: 1 }}>
      <Typography
        variant="caption"
        sx={{
          display: "block",
          px: 1.5,
          pt: 1,
          pb: 0.5,
          color: "text.secondary",
          fontWeight: 600,
          letterSpacing: 0.2,
          fontSize: 11,
        }}
      >
        {label}
      </Typography>
      <Stack spacing={0.25}>
        {rows.map((c) => (
          <ConvoItem
            key={c.id}
            convo={c}
            active={c.id === activeId}
            onSelect={() => onSelect(c.id)}
            onMenuOpen={(el) => onMenuOpen(c.id, el)}
          />
        ))}
      </Stack>
    </Box>
  );
}

function ConvoItem({
  convo,
  active,
  onSelect,
  onMenuOpen,
}: {
  convo: ConvoRow;
  active: boolean;
  onSelect: () => void;
  onMenuOpen: (el: HTMLElement) => void;
}) {
  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      sx={{
        position: "relative",
        cursor: "pointer",
        px: 1.25,
        py: 0.85,
        mx: 0.25,
        borderRadius: 1.5,
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        bgcolor: active ? "action.selected" : "transparent",
        "&:hover": {
          bgcolor: active ? "action.selected" : "action.hover",
          "& .convo-actions": { opacity: 1 },
        },
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: -2,
        },
      }}
    >
      {convo.pinned && (
        <PushPinRoundedIcon sx={{ fontSize: 12, color: "text.disabled", flexShrink: 0 }} />
      )}
      <Typography
        variant="body2"
        noWrap
        sx={{
          flex: 1,
          minWidth: 0,
          fontSize: 13.5,
          fontWeight: active ? 500 : 400,
          color: "text.primary",
        }}
      >
        {convo.title}
      </Typography>
      <IconButton
        size="small"
        className="convo-actions"
        onClick={(e) => {
          e.stopPropagation();
          onMenuOpen(e.currentTarget);
        }}
        sx={{
          opacity: { xs: 1, md: active ? 1 : 0 },
          transition: "opacity 120ms",
          ml: "auto",
          flexShrink: 0,
          p: 0.25,
        }}
      >
        <MoreHorizRoundedIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  );
}
