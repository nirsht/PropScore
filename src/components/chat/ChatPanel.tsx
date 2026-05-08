"use client";

import * as React from "react";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import { trpc } from "@/lib/trpc/client";
import type { FilterInput } from "@/server/api/schemas/filter";
import { MessageBubble } from "./MessageBubble";
import { ChatComposer } from "./ChatComposer";
import { ConversationList } from "./ConversationList";
import { useChatStream } from "./useChatStream";
import type { ChatScope, UIMessage } from "./types";

type Props = {
  scope: ChatScope;
  listingMlsId?: string;
  /** GLOBAL only: snapshot taken at thread creation time. */
  filterSnapshot?: FilterInput;
  /** Visual mode — `panel` for drawers, `inline` for the page-top NL bar. */
  mode?: "panel" | "inline";
  /** Asset mode: when true, also render the per-listing thread list as a top
   * dropdown. Default true for ASSET, false otherwise. */
  showThreadSwitcher?: boolean;
  /** Click handler for [mls:<id>] citation chips. Defaults to no-op. */
  onCitationClick?: (mlsId: string) => void;
  /** Empty-state placeholder shown before the first message. */
  emptyHint?: React.ReactNode;
};

export function ChatPanel({
  scope,
  listingMlsId,
  filterSnapshot,
  mode = "panel",
  showThreadSwitcher,
  onCitationClick,
  emptyHint,
}: Props) {
  const utils = trpc.useUtils();
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<UIMessage | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const create = trpc.chat.create.useMutation();
  const get = trpc.chat.get.useQuery(
    { conversationId: activeId ?? "" },
    { enabled: Boolean(activeId) },
  );

  const list = trpc.chat.list.useQuery(
    { scope, listingMlsId, archived: false, limit: 25 },
    { enabled: scope === "ASSET" || mode === "panel" },
  );

  // Auto-pick the most recent conversation for this scope/listing on mount.
  React.useEffect(() => {
    if (activeId) return;
    const first = list.data?.[0];
    if (first) setActiveId(first.id);
  }, [activeId, list.data]);

  async function ensureConversationId(): Promise<string | null> {
    if (activeId) return activeId;
    try {
      const c = await create.mutateAsync({
        scope,
        listingMlsId: scope === "ASSET" ? listingMlsId : undefined,
        filterSnapshot: scope === "GLOBAL" ? filterSnapshot : undefined,
      });
      setActiveId(c.id);
      utils.chat.list.invalidate();
      return c.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start chat.");
      return null;
    }
  }

  const stream = useChatStream({
    onToken: (text) => {
      setDraft((prev) =>
        prev
          ? { ...prev, content: prev.content + text, pending: true }
          : {
              id: "draft",
              role: "ASSISTANT",
              content: text,
              pending: true,
              citedMlsIds: [],
            },
      );
    },
    onToolCallStart: ({ name, callId }) => {
      // Render a small tool-status row so the user sees what's happening
      // before the assistant continues.
      setDraft((prev) =>
        prev
          ? prev
          : { id: "draft", role: "ASSISTANT", content: "", pending: true, citedMlsIds: [] },
      );
      // Append a transient TOOL row to show "Pulling rent comps…"
      // (real tool result will be persisted server-side.)
      void name;
      void callId;
    },
    onToolResult: () => {
      /* Nothing to do here for now — refetch on `done` shows the canonical row. */
    },
    onCite: (mlsId) => {
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              citedMlsIds: prev.citedMlsIds?.includes(mlsId)
                ? prev.citedMlsIds
                : [...(prev.citedMlsIds ?? []), mlsId],
            }
          : prev,
      );
    },
    onMessageComplete: () => {
      /* Real row arrives via refetch on `done`. */
    },
    onDone: () => {
      setDraft(null);
      utils.chat.get.invalidate({ conversationId: activeId ?? "" });
      utils.chat.list.invalidate();
    },
    onError: (msg) => {
      setError(msg);
      setDraft(null);
    },
  });

  async function handleSend(text: string) {
    setError(null);
    const cid = await ensureConversationId();
    if (!cid) return;
    const optimistic: UIMessage = {
      id: `local-${Date.now()}`,
      role: "USER",
      content: text,
    };
    setDraft(null);
    void stream.send({ conversationId: cid, userMessage: text });
    // Locally extend the cached `get` result so the user sees their msg now.
    utils.chat.get.setData({ conversationId: cid }, (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: optimistic.id,
            conversationId: cid,
            role: "USER",
            content: optimistic.content,
            toolCalls: null,
            toolName: null,
            toolCallId: null,
            citedMlsIds: [],
            tokensIn: null,
            tokensOut: null,
            errored: false,
            createdAt: new Date(),
          } as unknown as (typeof prev.messages)[number],
        ],
      };
    });
  }

  function newChat() {
    setActiveId(null);
    setDraft(null);
    setError(null);
  }

  const messages: UIMessage[] = React.useMemo(() => {
    const fromServer = (get.data?.messages ?? []).map<UIMessage>((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolName: m.toolName ?? null,
      citedMlsIds: m.citedMlsIds ?? [],
      errored: m.errored,
    }));
    return draft ? [...fromServer, draft] : fromServer;
  }, [get.data, draft]);

  const showSwitcher =
    showThreadSwitcher ?? (scope === "ASSET" || mode === "panel");

  return (
    <Stack
      direction="row"
      sx={{
        height: mode === "inline" ? "min(60vh, 520px)" : "100%",
        minHeight: 0,
        bgcolor: "background.default",
        border: mode === "inline" ? 1 : 0,
        borderColor: "divider",
        borderRadius: mode === "inline" ? 1 : 0,
        overflow: "hidden",
      }}
    >
      {showSwitcher && mode === "panel" && (
        <Box sx={{ width: 220, borderRight: 1, borderColor: "divider", flexShrink: 0 }}>
          <ConversationList
            scope={scope}
            listingMlsId={listingMlsId}
            activeId={activeId}
            onSelect={setActiveId}
            onNew={newChat}
            emptyHint={emptyHint}
          />
        </Box>
      )}

      <Stack sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ m: 1 }}>
            {error}
          </Alert>
        )}

        {mode === "inline" && messages.length > 0 && (
          <Stack
            direction="row"
            spacing={1}
            sx={{ p: 0.5, borderBottom: 1, borderColor: "divider" }}
            justifyContent="flex-end"
          >
            <Button size="small" startIcon={<RefreshRoundedIcon />} onClick={newChat}>
              New chat
            </Button>
          </Stack>
        )}

        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 1.5 }}>
          {messages.length === 0 && (
            <Box sx={{ textAlign: "center", color: "text.secondary", mt: 4 }}>
              <Typography variant="body2">
                {emptyHint ??
                  (scope === "ASSET"
                    ? "Ask anything about this listing."
                    : "Ask anything about the listings on screen.")}
              </Typography>
            </Box>
          )}
          <Stack spacing={1.25}>
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onCitationClick={onCitationClick}
              />
            ))}
            <ScrollAnchor key={messages.length} />
          </Stack>
        </Box>

        <ChatComposer
          conversationId={activeId}
          streaming={stream.streaming}
          onSend={handleSend}
          onCancel={stream.cancel}
          placeholder={
            scope === "ASSET" ? "Ask about this listing…" : "Ask about these listings…"
          }
        />
      </Stack>
    </Stack>
  );
}

function ScrollAnchor() {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  });
  return <div ref={ref} />;
}

