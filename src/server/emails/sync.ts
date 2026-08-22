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
  /** The row was dropped — an unsent draft its owner deleted in Gmail. */
  deleted: boolean;
  statusBefore: string;
  statusAfter: string;
};

export type DraftOutcome = "delete" | "sent" | "keep";

/**
 * Decide the fate of a thread still sitting in DRAFT, given what Gmail says
 * about its draft and what messages the thread carries.
 *
 * - "delete" — the draft is gone and nothing ever left the mailbox: the owner
 *   deleted it before sending, so the row is dropped. The listing goes back
 *   into the un-contacted pool for the next bulk-draft run.
 * - "sent" — the draft is gone but the thread has an outbound message: sent.
 * - "keep" — nothing to conclude; leave the status where it is.
 */
export function resolveDraftOutcome(input: {
  status: string;
  sentAt: Date | null;
  draftStillExists: boolean;
  outboundSeen: boolean;
  inboundSeen: boolean;
}): DraftOutcome {
  if (input.status !== "DRAFT" || input.sentAt) return "keep";
  if (input.draftStillExists) return "keep";
  if (input.outboundSeen) return "sent";
  // An inbound-only thread is too odd to throw away — keep it for a human.
  if (input.inboundSeen) return "keep";
  return "delete";
}

/** Drop a thread row (messages cascade) and shape the SyncResult for it. */
async function deleteAbandonedThread(
  threadId: string,
  statusBefore: string,
): Promise<SyncResult> {
  await db.emailThread.delete({ where: { id: threadId } });
  return {
    threadId,
    newMessages: 0,
    newInboundMessages: 0,
    parsedRentRoll: false,
    deleted: true,
    statusBefore,
    statusAfter: "DELETED",
  };
}

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
    include: { messages: { select: { gmailMessageId: true, direction: true } } },
  });
  if (!thread) throw new Error(`EmailThread not found: ${threadId}`);
  // Older syncs recorded the unsent draft itself as an OUTBOUND row (Gmail
  // returns it as a message in the thread), so "has messages" isn't "has
  // replies" — only INBOUND rows mean a reply actually landed.
  const hadInbound = thread.messages.some((m) => m.direction === "INBOUND");
  if (!thread.gmailThreadId) {
    // No Gmail linkage and nothing sent: the draft was deleted before it went
    // out. (Older syncs "released" these rows instead of dropping them, which
    // left them stuck in the draft list forever — this cleans those up too.)
    if (
      resolveDraftOutcome({
        status: thread.status,
        sentAt: thread.sentAt,
        draftStillExists: false,
        outboundSeen: false,
        inboundSeen: hadInbound,
      }) === "delete"
    ) {
      return deleteAbandonedThread(thread.id, thread.status);
    }
    await db.emailThread.update({
      where: { id: threadId },
      data: { lastSyncedAt: new Date() },
    });
    return {
      threadId,
      newMessages: 0,
      newInboundMessages: 0,
      parsedRentRoll: false,
      deleted: false,
      statusBefore: thread.status,
      statusAfter: thread.status,
    };
  }

  const seen = new Set(thread.messages.map((m) => m.gmailMessageId));
  let gmailMessages: Awaited<ReturnType<typeof listThreadMessages>>;
  try {
    gmailMessages = await listThreadMessages(thread.userId, thread.gmailThreadId);
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 404) {
      // Thread no longer exists in Gmail. If it was an unsent draft (still in
      // DRAFT and never sent), the owner deleted it before sending — the
      // outreach never happened, so drop the row entirely and let the listing
      // fall back into the un-contacted pool. Anything that had progressed
      // past DRAFT is genuinely gone -> FAILED, and won't be retried nightly.
      const outcome = resolveDraftOutcome({
        status: thread.status,
        sentAt: thread.sentAt,
        draftStillExists: false,
        outboundSeen: false,
        inboundSeen: hadInbound,
      });
      if (outcome === "delete") {
        return deleteAbandonedThread(thread.id, thread.status);
      }
      await db.emailThread.update({
        where: { id: thread.id },
        data: {
          status: "FAILED",
          parseError:
            "Gmail thread no longer exists (deleted in Gmail) — sync disabled.",
          lastSyncedAt: new Date(),
        },
      });
      return {
        threadId,
        newMessages: 0,
        newInboundMessages: 0,
        parsedRentRoll: false,
        deleted: false,
        statusBefore: thread.status,
        statusAfter: "FAILED",
      };
    }
    throw err;
  }

  // Direction inference is anchored to thread.toEmail (the agent we wrote
  // to). Anything FROM that address is INBOUND; everything else (the user's
  // own sends from any of their Gmail aliases) is OUTBOUND.
  const agentEmailLower = thread.toEmail.toLowerCase();

  let newMessages = 0;
  const newInbound: { id: string }[] = [];
  let latestOutboundSeen = false;

  for (const msg of gmailMessages) {
    if (!msg.id) continue;
    // The unsent draft is one of the thread's messages. It isn't mail yet, so
    // don't record it and don't let it read as "the user sent something" —
    // otherwise a discarded draft can look like a send.
    if (msg.labelIds?.includes("DRAFT")) continue;
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

  // Determine new status. A draft that's gone from Gmail either went out
  // (outbound message in the thread -> SENT) or was thrown away before it went
  // out, in which case the row goes with it.
  let newStatus: typeof thread.status = thread.status;
  if (thread.status === "DRAFT") {
    const stillDraft = thread.gmailDraftId
      ? await draftExists(thread.userId, thread.gmailDraftId)
      : false;
    const outcome = resolveDraftOutcome({
      status: thread.status,
      sentAt: thread.sentAt,
      draftStillExists: stillDraft,
      outboundSeen: latestOutboundSeen,
      inboundSeen: hadInbound || newInbound.length > 0,
    });
    if (outcome === "delete") {
      return deleteAbandonedThread(thread.id, thread.status);
    }
    if (outcome === "sent") newStatus = "SENT";
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
    deleted: false,
    statusBefore: thread.status,
    statusAfter: parsedRentRoll ? "PARSED" : newStatus,
  };
}
