import { db } from "@/lib/db";
import {
  draftExists,
  extractMessageContent,
  headerValue,
  listThreadMessages,
  parseFromAddress,
} from "@/lib/google/gmail";
import { parseEmailRentRoll } from "@/server/agents/email-rent-roll/agent";

export type SyncResult = {
  threadId: string;
  newMessages: number;
  newInboundMessages: number;
  parsedRentRoll: boolean;
  statusBefore: string;
  statusAfter: string;
};

/**
 * Sync one EmailThread against Gmail: fetch every message in the thread,
 * insert any we haven't seen, advance the status machine, and (if a new
 * inbound message arrived) kick off the GPT-5 rent-roll parser.
 *
 * Idempotent: re-running on a fully-synced thread is a no-op aside from
 * lastSyncedAt.
 */
export async function syncThread(threadId: string): Promise<SyncResult> {
  const thread = await db.emailThread.findUnique({
    where: { id: threadId },
    include: { messages: { select: { gmailMessageId: true } } },
  });
  if (!thread) throw new Error(`EmailThread not found: ${threadId}`);
  if (!thread.gmailThreadId) {
    await db.emailThread.update({
      where: { id: threadId },
      data: { lastSyncedAt: new Date() },
    });
    return {
      threadId,
      newMessages: 0,
      newInboundMessages: 0,
      parsedRentRoll: false,
      statusBefore: thread.status,
      statusAfter: thread.status,
    };
  }

  const seen = new Set(thread.messages.map((m) => m.gmailMessageId));
  const gmailMessages = await listThreadMessages(thread.userId, thread.gmailThreadId);

  // Direction inference is anchored to thread.toEmail (the agent we wrote
  // to). Anything FROM that address is INBOUND; everything else (the user's
  // own sends from any of their Gmail aliases) is OUTBOUND.
  const agentEmailLower = thread.toEmail.toLowerCase();

  let newMessages = 0;
  let newInbound: { id: string }[] = [];
  let latestOutboundSeen = false;

  for (const msg of gmailMessages) {
    if (!msg.id) continue;
    if (seen.has(msg.id)) {
      // Even if we've seen it, track whether it's outbound for status flip.
      const fromHeader = headerValue(msg.payload?.headers ?? undefined, "From");
      const fromAddr = parseFromAddress(fromHeader);
      if (fromAddr && fromAddr !== agentEmailLower) {
        latestOutboundSeen = true;
      }
      continue;
    }

    const headers = msg.payload?.headers ?? undefined;
    const fromHeader = headerValue(headers, "From");
    const toHeader = headerValue(headers, "To");
    const subjectHeader = headerValue(headers, "Subject");
    const dateHeader = headerValue(headers, "Date");
    const fromAddr = parseFromAddress(fromHeader) ?? "";
    const toAddr = parseFromAddress(toHeader) ?? agentEmailLower;

    const isInbound = fromAddr === agentEmailLower;

    const receivedAt = dateHeader ? new Date(dateHeader) : new Date(Number(msg.internalDate ?? Date.now()));
    const content = extractMessageContent(msg.payload ?? undefined);

    const row = await db.emailMessage.create({
      data: {
        threadId: thread.id,
        gmailMessageId: msg.id,
        direction: isInbound ? "INBOUND" : "OUTBOUND",
        fromEmail: fromAddr || "(unknown)",
        toEmail: toAddr,
        subject: subjectHeader ?? thread.subject,
        snippet: msg.snippet ?? null,
        bodyText: content.bodyText,
        receivedAt,
        attachments: content.attachments.length > 0 ? content.attachments : undefined,
      },
    });
    seen.add(msg.id);
    newMessages += 1;
    if (isInbound) newInbound.push({ id: row.id });
    else latestOutboundSeen = true;
  }

  // Determine new status.
  let newStatus: typeof thread.status = thread.status;
  if (thread.status === "DRAFT") {
    if (thread.gmailDraftId) {
      // If the draft no longer exists in Gmail AND we've seen an outbound
      // message in the thread, the user sent it.
      const stillDraft = await draftExists(thread.userId, thread.gmailDraftId);
      if (!stillDraft && latestOutboundSeen) {
        newStatus = "SENT";
      }
    } else if (latestOutboundSeen) {
      newStatus = "SENT";
    }
  }
  if (newInbound.length > 0 && newStatus !== "PARSED") {
    newStatus = "REPLIED";
  }

  await db.emailThread.update({
    where: { id: thread.id },
    data: {
      status: newStatus,
      sentAt: newStatus === "SENT" && !thread.sentAt ? new Date() : thread.sentAt,
      lastSyncedAt: new Date(),
    },
  });

  // Parse newly arrived inbound messages with GPT-5. We loop sequentially —
  // typical thread has 1 inbound; rare back-and-forth gets parsed in order
  // so the most recent rent roll wins.
  let parsedRentRoll = false;
  for (const m of newInbound) {
    try {
      const out = await parseEmailRentRoll(m.id);
      if (out.rentRoll && out.rentRoll.length > 0) parsedRentRoll = true;
    } catch (err) {
      // parseEmailRentRoll already wrote parseError onto the thread.
      // Continue with the next message rather than aborting the sync.
      // eslint-disable-next-line no-console
      console.error(`[emails-sync] parse failed for message ${m.id}:`, err);
    }
  }

  return {
    threadId,
    newMessages,
    newInboundMessages: newInbound.length,
    parsedRentRoll,
    statusBefore: thread.status,
    statusAfter: parsedRentRoll ? "PARSED" : newStatus,
  };
}
