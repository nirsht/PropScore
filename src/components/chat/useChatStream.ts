"use client";

import * as React from "react";
import type { ChatStreamEvent } from "./types";

type ChatStreamCallbacks = {
  onToken: (text: string) => void;
  onToolCallStart: (e: { name: string; callId: string }) => void;
  onToolResult: (e: { callId: string; name: string; ok: boolean; preview?: string }) => void;
  onCite: (mlsId: string) => void;
  onMessageComplete: (e: {
    role: "ASSISTANT" | "TOOL";
    messageId: string;
    content: string;
    toolName?: string | null;
    citedMlsIds?: string[];
  }) => void;
  onDone: () => void;
  onError: (message: string) => void;
};

/**
 * Drive a single user-turn against /api/chat/stream. Yields events to the
 * caller via callbacks; manages an AbortController so the caller can cancel.
 *
 * Caller is responsible for: persisting/optimistic-rendering the user's
 * own message, swapping the streaming assistant draft into the message list,
 * and refetching the conversation after `onDone` for canonical state.
 */
export function useChatStream(opts: ChatStreamCallbacks) {
  const [streaming, setStreaming] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  const send = React.useCallback(
    async (input: {
      conversationId: string;
      userMessage: string;
    }) => {
      const ac = new AbortController();
      abortRef.current = ac;
      setStreaming(true);
      try {
        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          let msg = `HTTP ${res.status}`;
          try {
            const j = await res.json();
            if (j?.error) msg = String(j.error);
          } catch {
            /* ignore */
          }
          optsRef.current.onError(msg);
          setStreaming(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Parse `data: ...\n\n` SSE frames.
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const line = frame.startsWith("data: ") ? frame.slice(6) : frame;
            if (!line) continue;
            try {
              const ev = JSON.parse(line) as ChatStreamEvent;
              dispatch(ev, optsRef.current);
            } catch {
              // skip malformed frame
            }
          }
        }
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") {
          // user cancelled — silent
        } else {
          optsRef.current.onError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [],
  );

  const cancel = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  return { send, cancel, streaming };
}

function dispatch(ev: ChatStreamEvent, o: ChatStreamCallbacks) {
  switch (ev.type) {
    case "token":
      o.onToken(ev.text);
      break;
    case "tool_call_start":
      o.onToolCallStart({ name: ev.name, callId: ev.callId });
      break;
    case "tool_result":
      o.onToolResult({ callId: ev.callId, name: ev.name, ok: ev.ok, preview: ev.preview });
      break;
    case "cite":
      o.onCite(ev.mlsId);
      break;
    case "message_complete":
      o.onMessageComplete({
        role: ev.role,
        messageId: ev.messageId,
        content: ev.content,
        toolName: ev.toolName ?? null,
        citedMlsIds: ev.citedMlsIds ?? [],
      });
      break;
    case "done":
      o.onDone();
      break;
    case "error":
      o.onError(ev.message);
      break;
    default:
      break;
  }
}
