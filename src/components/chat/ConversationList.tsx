"use client";

import * as React from "react";
import {
  Box,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from "@mui/material";
import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import PushPinRoundedIcon from "@mui/icons-material/PushPinRounded";
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

  return (
    <Stack sx={{ height: "100%", minHeight: 0 }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ p: 1, borderBottom: 1, borderColor: "divider" }}
      >
        <Typography variant="overline" color="text.secondary" sx={{ flex: 1, pl: 0.5 }}>
          Chats
        </Typography>
        <IconButton size="small" onClick={onNew} title="New chat">
          <Box component="span" sx={{ fontSize: 20, lineHeight: 1, fontWeight: 300 }}>
            +
          </Box>
        </IconButton>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {list.data && list.data.length === 0 && (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {emptyHint ?? "No chats yet."}
            </Typography>
          </Box>
        )}
        <List dense disablePadding>
          {list.data?.map((c) => {
            const active = c.id === activeId;
            return (
              <ListItemButton
                key={c.id}
                selected={active}
                onClick={() => onSelect(c.id)}
                sx={{ pr: 5 }}
              >
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      {c.pinned && (
                        <PushPinRoundedIcon sx={{ fontSize: 12, color: "text.disabled" }} />
                      )}
                      <Typography variant="body2" noWrap>
                        {c.title}
                      </Typography>
                    </Stack>
                  }
                  secondary={new Date(c.updatedAt).toLocaleDateString()}
                  primaryTypographyProps={{ noWrap: true, fontSize: 13 }}
                  secondaryTypographyProps={{ fontSize: 11 }}
                />
                <IconButton
                  size="small"
                  edge="end"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuFor({ id: c.id, el: e.currentTarget });
                  }}
                  sx={{ position: "absolute", right: 4 }}
                >
                  <MoreVertRoundedIcon fontSize="small" />
                </IconButton>
              </ListItemButton>
            );
          })}
        </List>
      </Box>

      <Menu
        open={!!menuFor}
        anchorEl={menuFor?.el ?? null}
        onClose={() => setMenuFor(null)}
      >
        <MenuItem
          onClick={() => {
            if (menuFor) {
              const c = list.data?.find((x) => x.id === menuFor.id);
              setPinned.mutate({ conversationId: menuFor.id, pinned: !c?.pinned });
            }
            setMenuFor(null);
          }}
        >
          <PushPinOutlinedIcon fontSize="small" sx={{ mr: 1 }} />
          {list.data?.find((x) => x.id === menuFor?.id)?.pinned ? "Unpin" : "Pin"}
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuFor) setArchived.mutate({ conversationId: menuFor.id, archived: true });
            setMenuFor(null);
          }}
        >
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
          Delete
        </MenuItem>
      </Menu>
    </Stack>
  );
}
