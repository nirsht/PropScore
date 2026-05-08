import type { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { makeChatAssetAgent } from "@/server/agents/chat-asset/agent";
import { makeChatGlobalAgent } from "@/server/agents/chat-global/agent";
import type { ChatStreamEvent, StoredChatMessage } from "@/server/agents/base/ChatAgent";

// Long-running streaming response — needs the Node runtime, not edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  conversationId: z.string(),
  userMessage: z.string().min(1).max(10_000),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Bad request" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const convo = await db.chatConversation.findUnique({
    where: { id: body.conversationId },
    select: {
      id: true,
      userId: true,
      scope: true,
      listingMlsId: true,
      filterSnapshot: true,
      title: true,
    },
  });
  if (!convo || convo.userId !== userId) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userRow = await db.chatMessage.create({
    data: {
      conversationId: convo.id,
      role: "USER",
      content: body.userMessage,
    },
  });

  // If this is the first user message, auto-title the conversation.
  if (convo.title === "New chat") {
    const auto = body.userMessage.trim().split(/\n/)[0]!.slice(0, 80);
    await db.chatConversation.update({
      where: { id: convo.id },
      data: { title: auto || "New chat" },
    });
  } else {
    await db.chatConversation.update({
      where: { id: convo.id },
      data: { updatedAt: new Date() },
    });
  }

  // Build stored history (the agent rebuilds the OpenAI messages array
  // from this).
  const allMessages = await db.chatMessage.findMany({
    where: { conversationId: convo.id },
    orderBy: { createdAt: "asc" },
  });

  const history: StoredChatMessage[] = allMessages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    toolCalls: m.toolCalls,
    toolName: m.toolName,
    toolCallId: m.toolCallId,
  }));

  const agent =
    convo.scope === "ASSET"
      ? makeChatAssetAgent(convo.listingMlsId!)
      : makeChatGlobalAgent(convo.filterSnapshot);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: ChatStreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      try {
        for await (const ev of agent.runStream({
          conversationId: convo.id,
          history,
          userMessageId: userRow.id,
        })) {
          send(ev);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
