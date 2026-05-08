"use client";

import * as React from "react";
import { Alert, Box, Button, Chip, Stack, Typography } from "@mui/material";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
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

  // Auto-pick the most recent conversation only on initial mount. After the
  // user explicitly creates a new chat (clears activeId), don't snap back to
  // the most recent thread — let them start fresh.
  const didInitialPick = React.useRef(false);
  React.useEffect(() => {
    if (didInitialPick.current) return;
    if (!list.data) return;
    didInitialPick.current = true;
    const first = list.data[0];
    if (first) setActiveId(first.id);
  }, [list.data]);

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
        <Box
          sx={{
            width: 260,
            borderRight: 1,
            borderColor: "divider",
            flexShrink: 0,
            display: { xs: "none", sm: "block" },
          }}
        >
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

        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <Box sx={{ maxWidth: 760, mx: "auto", px: { xs: 2, md: 3 }, py: 2 }}>
            {messages.length === 0 ? (
              <EmptyState
                scope={scope}
                emptyHint={emptyHint}
                onPick={(prompt) => void handleSend(prompt)}
              />
            ) : (
              <Stack spacing={0.5}>
                {messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    onCitationClick={onCitationClick}
                  />
                ))}
                <ScrollAnchor key={messages.length} />
              </Stack>
            )}
          </Box>
        </Box>

        <Box sx={{ maxWidth: 760, mx: "auto", width: "100%" }}>
          <ChatComposer
            conversationId={activeId}
            streaming={stream.streaming}
            onSend={handleSend}
            onCancel={stream.cancel}
            placeholder={
              scope === "ASSET"
                ? "Ask about this listing…"
                : "Message PropScore…"
            }
          />
        </Box>
      </Stack>
    </Stack>
  );
}

const ASSET_PROMPTS = [
  "Summarize the key risks for this listing",
  "How does the rent estimate compare to comps?",
  "What does the SF Assessor parcel show?",
  "Re-run AI scoring with the latest data",
];
const GLOBAL_PROMPTS = [
  "Top 3 highest-scoring opportunities right now",
  "Compare the two cheapest listings on screen",
  "Current SF mortgage rates from the web",
  "Which listings have the best cap-rate potential?",
];

function EmptyState({
  scope,
  emptyHint,
  onPick,
}: {
  scope: ChatScope;
  emptyHint?: React.ReactNode;
  onPick: (prompt: string) => void;
}) {
  const prompts = scope === "ASSET" ? ASSET_PROMPTS : GLOBAL_PROMPTS;
  return (
    <Stack alignItems="center" spacing={2.5} sx={{ pt: { xs: 4, md: 8 }, pb: 4 }}>
      <Box
        sx={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          bgcolor: "primary.main",
          color: "common.white",
        }}
      >
        <AutoAwesomeRoundedIcon />
      </Box>
      <Stack alignItems="center" spacing={0.5}>
        <Typography variant="h6" fontWeight={600}>
          {scope === "ASSET" ? "Ask about this listing" : "How can I help today?"}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ maxWidth: 460, textAlign: "center" }}
        >
          {emptyHint ??
            (scope === "ASSET"
              ? "I have access to this listing's details, AI score, comps, and parcel data."
              : "I can compare listings, pull rent comps, and look up market context from the web.")}
        </Typography>
      </Stack>
      <Stack
        direction="row"
        spacing={1}
        flexWrap="wrap"
        useFlexGap
        justifyContent="center"
        sx={{ maxWidth: 560 }}
      >
        {prompts.map((p) => (
          <Chip
            key={p}
            label={p}
            onClick={() => onPick(p)}
            variant="outlined"
            sx={{
              borderRadius: 2,
              fontSize: 13,
              height: 32,
              borderColor: "divider",
              "&:hover": { bgcolor: "action.hover", borderColor: "text.secondary" },
            }}
          />
        ))}
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

