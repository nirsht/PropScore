import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { protectedProcedure, router, type TRPCContext } from "../trpc";
import { googleAuthEnabled } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  createDraft,
  getConnectedEmail,
  getConnectedName,
  GmailNotConnectedError,
  gmailDraftUrl,
  gmailThreadUrl,
  InvalidRecipientError,
} from "@/lib/google/gmail";
import { isValidEmailAddress } from "@/lib/email-address";
import { rentRollRequestEmail } from "@/lib/emails/templates";
import { syncThread } from "@/server/emails/sync";
import { parseEmailRentRoll } from "@/server/agents/email-rent-roll/agent";

const threadInclude = {
  messages: { orderBy: { receivedAt: "asc" } },
  listing: {
    select: {
      mlsId: true,
      address: true,
      price: true,
      sqft: true,
      units: true,
      neighborhood: true,
    },
  },
  // Sender/owner of the thread — surfaced as the "sent by" column on the
  // team-wide inbox.
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.EmailThreadInclude;

// Resolve who a draft should be created as. Defaults to the caller; a
// different `senderUserId` lets you draft into a teammate's mailbox. Throws
// PRECONDITION_FAILED if the chosen sender has no Gmail linked.
async function resolveSender(
  db: TRPCContext["db"],
  callerId: string,
  senderUserId: string | undefined,
): Promise<{ id: string; name: string | null }> {
  const targetId = senderUserId ?? callerId;
  const user = await db.user.findUnique({
    where: { id: targetId },
    select: { id: true, name: true },
  });
  if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Sender not found" });
  if (targetId !== callerId) {
    const account = await db.account.findFirst({
      where: { userId: targetId, provider: "google" },
      select: { id: true },
    });
    if (!account) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "The chosen sender hasn't connected Gmail.",
      });
    }
  }
  return user;
}

export const emailsRouter = router({
  // Is Gmail wired up at all (env) and does this user have a linked Google
  // account with valid scopes? Drives the Connect-Gmail pill + ContactCard
  // button visibility.
  connectionStatus: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.user.id },
      select: { name: true },
    });
    if (!googleAuthEnabled) {
      return {
        configured: false as const,
        connected: false as const,
        email: null,
        name: user?.name ?? null,
        userId: ctx.user.id,
      };
    }
    const email = await getConnectedEmail(ctx.user.id);
    return {
      configured: true as const,
      connected: Boolean(email),
      email,
      name: user?.name ?? null,
      userId: ctx.user.id,
    };
  }),

  // Manual click from ContactCard — creates a Gmail draft for the listing's
  // agent. Idempotent AND team-wide: if a thread already exists for the
  // listing (created by anyone), we return the existing draft URL and the
  // owner instead of inserting a duplicate. `senderUserId` picks which
  // teammate's mailbox the draft lands in (defaults to the caller).
  requestRentRoll: protectedProcedure
    .input(
      z.object({
        listingMlsId: z.string(),
        senderUserId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.emailThread.findUnique({
        where: { listingMlsId: input.listingMlsId },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      if (existing) {
        return {
          threadId: existing.id,
          alreadyExisted: true as const,
          owner: existing.user,
          ownedByCaller: existing.userId === ctx.user.id,
          draftUrl: existing.gmailDraftId
            ? gmailDraftUrl(existing.gmailDraftId)
            : existing.gmailThreadId
              ? gmailThreadUrl(existing.gmailThreadId)
              : null,
        };
      }

      const sender = await resolveSender(ctx.db, ctx.user.id, input.senderUserId);

      const listing = await ctx.db.listing.findUnique({
        where: { mlsId: input.listingMlsId },
        include: { contact: true },
      });
      if (!listing) throw new TRPCError({ code: "NOT_FOUND", message: "Listing not found" });
      const agentEmail = listing.contact?.agentEmail?.trim();
      if (!agentEmail) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No agent email on file for this listing. Refresh contact enrichment first.",
        });
      }
      if (!isValidEmailAddress(agentEmail)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "The agent contact on file isn't a valid email address. Refresh contact enrichment first.",
        });
      }

      // Sign off as the connected mailbox (the sender), falling back to the
      // app-login name only if the token carries no display name.
      const senderName = (await getConnectedName(sender.id)) ?? sender.name ?? null;
      const { subject, body } = rentRollRequestEmail({
        listingAddress: listing.address,
        agentName: listing.contact?.agentName ?? null,
        userName: senderName,
      });

      let draft: { gmailDraftId: string; gmailThreadId: string };
      try {
        draft = await createDraft({
          userId: sender.id,
          to: agentEmail,
          subject,
          body,
        });
      } catch (err) {
        if (err instanceof GmailNotConnectedError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Connect Gmail before requesting rent rolls.",
          });
        }
        throw err;
      }

      try {
        const thread = await ctx.db.emailThread.create({
          data: {
            userId: sender.id,
            listingMlsId: input.listingMlsId,
            gmailDraftId: draft.gmailDraftId,
            gmailThreadId: draft.gmailThreadId,
            status: "DRAFT",
            toEmail: agentEmail,
            subject,
            trigger: "manual",
          },
        });
        return {
          threadId: thread.id,
          alreadyExisted: false as const,
          draftUrl: gmailDraftUrl(draft.gmailDraftId),
        };
      } catch (err) {
        // Concurrent click — another thread was created for this listing
        // between findUnique and create. Surface the existing one rather
        // than 500ing.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          const dup = await ctx.db.emailThread.findUnique({
            where: { listingMlsId: input.listingMlsId },
            include: { user: { select: { id: true, name: true, email: true } } },
          });
          if (dup)
            return {
              threadId: dup.id,
              alreadyExisted: true as const,
              owner: dup.user,
              ownedByCaller: dup.userId === ctx.user.id,
              draftUrl: dup.gmailDraftId ? gmailDraftUrl(dup.gmailDraftId) : null,
            };
        }
        throw err;
      }
    }),

  // Bulk-draft button on /emails — creates Gmail drafts for every Active SF
  // listing whose price/sqft is below EMAIL_AUTO_PRICE_PER_SQFT whose listing
  // agent NOBODY on the team has emailed yet. Dedup is by recipient AGENT
  // EMAIL, not by listing: if the team already has a live thread to an agent
  // (for any listing), we skip every other listing that same agent holds so we
  // never double-contact them. Released threads (draft deleted before sending —
  // status DRAFT with a null gmailDraftId) don't count as "contacted".
  // `senderUserId` picks which teammate's mailbox the batch drafts into.
  bulkDraftUnderThreshold: protectedProcedure
    .input(z.object({ senderUserId: z.string().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
    const sender = await resolveSender(ctx.db, ctx.user.id, input?.senderUserId);
    // Same sender identity for every draft in the batch.
    const senderName = (await getConnectedName(sender.id)) ?? sender.name ?? null;

    const candidates = await ctx.db.$queryRaw<
      Array<{ mlsId: string; address: string; pricePerSqft: number }>
    >(Prisma.sql`
      SELECT l."mlsId" as "mlsId",
             l."address" as "address",
             l."pricePerSqft" as "pricePerSqft"
      FROM "Listing" l
      JOIN "ListingContact" c ON c."listingMlsId" = l."mlsId"
      LEFT JOIN "EmailThread" t
             ON LOWER(TRIM(t."toEmail")) = LOWER(TRIM(c."agentEmail"))
            AND NOT (t."status" = 'DRAFT' AND t."gmailDraftId" IS NULL)
      WHERE l."status" = 'Active'
        AND c."agentEmail" IS NOT NULL
        AND c."agentEmail" != ''
        AND l."pricePerSqft" IS NOT NULL
        AND l."pricePerSqft" < ${env.EMAIL_AUTO_PRICE_PER_SQFT}
        AND t."id" IS NULL
      ORDER BY l."pricePerSqft" ASC
    `);

    let drafted = 0;
    let skipped = 0;
    // Two candidate listings can share an agent; the SQL only dedups against
    // *existing* threads, so track agents drafted within this batch too (the
    // cheapest listing per agent wins — candidates are ordered by $/sqft).
    const seenAgents = new Set<string>();
    for (const c of candidates) {
      const listing = await ctx.db.listing.findUnique({
        where: { mlsId: c.mlsId },
        include: { contact: true },
      });
      const agentEmail = listing?.contact?.agentEmail?.trim();
      // The candidate SQL only checks the email is non-empty, not that it's a
      // real address. Contact enrichment often stores an agent name or a
      // placeholder word here, which Gmail rejects with "Invalid To header".
      // Skip those so one bad row doesn't abort the whole batch.
      if (!listing || !agentEmail || !isValidEmailAddress(agentEmail)) {
        skipped += 1;
        continue;
      }
      const agentKey = agentEmail.toLowerCase();
      if (seenAgents.has(agentKey)) {
        skipped += 1;
        continue;
      }
      seenAgents.add(agentKey);
      const { subject, body } = rentRollRequestEmail({
        listingAddress: listing.address,
        agentName: listing.contact?.agentName ?? null,
        userName: senderName,
      });

      try {
        const draft = await createDraft({
          userId: sender.id,
          to: agentEmail,
          subject,
          body,
        });
        await ctx.db.emailThread.create({
          data: {
            userId: sender.id,
            listingMlsId: listing.mlsId,
            gmailDraftId: draft.gmailDraftId,
            gmailThreadId: draft.gmailThreadId,
            status: "DRAFT",
            toEmail: agentEmail,
            subject,
            trigger: "auto_under_450",
          },
        });
        drafted += 1;
      } catch (err) {
        if (err instanceof GmailNotConnectedError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Connect Gmail before drafting rent-roll requests.",
          });
        }
        if (
          err instanceof InvalidRecipientError ||
          (err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002")
        ) {
          skipped += 1;
          continue;
        }
        throw err;
      }
    }

    return {
      drafted,
      skipped,
      total: candidates.length,
      threshold: env.EMAIL_AUTO_PRICE_PER_SQFT,
    };
  }),

  // Re-draft a "released" thread — one whose Gmail draft was deleted before it
  // was ever sent (status DRAFT with a null gmailDraftId, set by syncThread).
  // Creates a fresh draft in the caller's (or a chosen teammate's) mailbox and
  // transfers ownership, so anyone on the team can pick up and send an
  // abandoned draft. Rejected if the thread still has a live draft or has
  // already moved past DRAFT.
  reclaimThread: protectedProcedure
    .input(
      z.object({
        threadId: z.string(),
        senderUserId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const thread = await ctx.db.emailThread.findUnique({
        where: { id: input.threadId },
        include: { listing: { include: { contact: true } } },
      });
      if (!thread) throw new TRPCError({ code: "NOT_FOUND" });
      if (thread.status !== "DRAFT" || thread.gmailDraftId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This thread already has a live draft or has moved past the draft stage.",
        });
      }

      const sender = await resolveSender(ctx.db, ctx.user.id, input.senderUserId);
      const agentEmail =
        thread.listing.contact?.agentEmail?.trim() || thread.toEmail.trim();
      if (!agentEmail || !isValidEmailAddress(agentEmail)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "No valid agent email on file for this listing. Refresh contact enrichment first.",
        });
      }

      const senderName = (await getConnectedName(sender.id)) ?? sender.name ?? null;
      const { subject, body } = rentRollRequestEmail({
        listingAddress: thread.listing.address,
        agentName: thread.listing.contact?.agentName ?? null,
        userName: senderName,
      });

      let draft: { gmailDraftId: string; gmailThreadId: string };
      try {
        draft = await createDraft({
          userId: sender.id,
          to: agentEmail,
          subject,
          body,
        });
      } catch (err) {
        if (err instanceof GmailNotConnectedError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Connect Gmail before re-drafting.",
          });
        }
        throw err;
      }

      await ctx.db.emailThread.update({
        where: { id: thread.id },
        data: {
          userId: sender.id,
          gmailDraftId: draft.gmailDraftId,
          gmailThreadId: draft.gmailThreadId,
          toEmail: agentEmail,
          subject,
          status: "DRAFT",
          parseError: null,
        },
      });
      return {
        threadId: thread.id,
        draftUrl: gmailDraftUrl(draft.gmailDraftId),
      };
    }),

  // Per-listing lookup for the EmailHistorySection in the drawer. Team-wide:
  // returns the single thread for the listing whoever owns it.
  forListing: protectedProcedure
    .input(z.object({ listingMlsId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.emailThread.findUnique({
        where: { listingMlsId: input.listingMlsId },
        include: threadInclude,
      });
    }),

  // Cross-listing, team-wide inbox on the /emails page. `senderUserId` filters
  // to specific teammates' outreach.
  listThreads: protectedProcedure
    .input(
      z
        .object({
          status: z
            .array(z.enum(["DRAFT", "SENT", "REPLIED", "PARSED", "FAILED"]))
            .optional(),
          trigger: z.array(z.enum(["manual", "auto_under_450"])).optional(),
          senderUserId: z.array(z.string()).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const statusFilter = input?.status?.length ? { in: input.status } : undefined;
      const triggerFilter = input?.trigger?.length
        ? { in: input.trigger }
        : undefined;
      const senderFilter = input?.senderUserId?.length
        ? { in: input.senderUserId }
        : undefined;
      return ctx.db.emailThread.findMany({
        where: {
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(triggerFilter ? { trigger: triggerFilter } : {}),
          ...(senderFilter ? { userId: senderFilter } : {}),
        },
        include: threadInclude,
        orderBy: { createdAt: "desc" },
        take: 500,
      });
    }),

  getThread: protectedProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      const thread = await ctx.db.emailThread.findUnique({
        where: { id: input.threadId },
        include: threadInclude,
      });
      if (!thread) throw new TRPCError({ code: "NOT_FOUND" });
      return thread;
    }),

  // Connected teammate mailboxes — drives the "send from" picker and the
  // sender filter. Only users with a linked Google account can be a sender.
  connectedMailboxes: protectedProcedure.query(async ({ ctx }) => {
    const users = await ctx.db.user.findMany({
      where: { accounts: { some: { provider: "google" } } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });
    return users;
  }),

  // Team-wide aggregate for the /emails dashboard. Status funnel, per-user
  // breakdown, and how many under-threshold opportunities are still
  // un-contacted by anyone. `senderUserId` scopes the funnel + per-user rows to
  // specific teammates so the tiles recompute alongside the list filter; the
  // "un-contacted" opportunity count stays team-wide regardless.
  teamStats: protectedProcedure
    .input(z.object({ senderUserId: z.array(z.string()).optional() }).optional())
    .query(async ({ ctx, input }) => {
    const senderWhere = input?.senderUserId?.length
      ? { userId: { in: input.senderUserId } }
      : undefined;
    const [byStatus, byUser, uncontacted] = await Promise.all([
      ctx.db.emailThread.groupBy({
        by: ["status"],
        where: senderWhere,
        _count: { _all: true },
      }),
      ctx.db.emailThread.groupBy({
        by: ["userId", "status"],
        where: senderWhere,
        _count: { _all: true },
      }),
      ctx.db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "Listing" l
        JOIN "ListingContact" c ON c."listingMlsId" = l."mlsId"
        LEFT JOIN "EmailThread" t
               ON LOWER(TRIM(t."toEmail")) = LOWER(TRIM(c."agentEmail"))
              AND NOT (t."status" = 'DRAFT' AND t."gmailDraftId" IS NULL)
        WHERE l."status" = 'Active'
          AND c."agentEmail" IS NOT NULL
          AND c."agentEmail" != ''
          AND l."pricePerSqft" IS NOT NULL
          AND l."pricePerSqft" < ${env.EMAIL_AUTO_PRICE_PER_SQFT}
          AND t."id" IS NULL
      `),
    ]);

    const statusCounts = {
      DRAFT: 0,
      SENT: 0,
      REPLIED: 0,
      PARSED: 0,
      FAILED: 0,
    };
    for (const row of byStatus) statusCounts[row.status] = row._count._all;

    const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    // "Sent" for rate purposes = anything that left the draft stage.
    const sent =
      statusCounts.SENT + statusCounts.REPLIED + statusCounts.PARSED;
    const replied = statusCounts.REPLIED + statusCounts.PARSED;
    const replyRate = sent > 0 ? replied / sent : 0;

    // Fold the (userId, status) groups into one row per user.
    const perUserMap = new Map<
      string,
      { userId: string; total: number; drafted: number; sent: number; replied: number; parsed: number }
    >();
    for (const row of byUser) {
      const entry =
        perUserMap.get(row.userId) ??
        { userId: row.userId, total: 0, drafted: 0, sent: 0, replied: 0, parsed: 0 };
      const n = row._count._all;
      entry.total += n;
      if (row.status === "DRAFT") entry.drafted += n;
      if (row.status === "SENT") entry.sent += n;
      if (row.status === "REPLIED") entry.replied += n;
      if (row.status === "PARSED") entry.parsed += n;
      perUserMap.set(row.userId, entry);
    }
    const userIds = [...perUserMap.keys()];
    const users = userIds.length
      ? await ctx.db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));
    const perUser = [...perUserMap.values()]
      .map((e) => ({
        ...e,
        name: userById.get(e.userId)?.name ?? null,
        email: userById.get(e.userId)?.email ?? "",
      }))
      .sort((a, b) => b.total - a.total);

    return {
      total,
      statusCounts,
      replyRate,
      uncontacted: Number(uncontacted[0]?.count ?? 0),
      threshold: env.EMAIL_AUTO_PRICE_PER_SQFT,
      perUser,
    };
  }),

  // Manual sync — used by the "Sync now" button on the EmailsView. Team-wide:
  // each thread syncs via its own owner's Gmail token (see syncThread). The
  // same logic runs nightly via scripts/poll-gmail-replies.ts.
  syncNow: protectedProcedure
    .input(z.object({ threadId: z.string().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const threads = await ctx.db.emailThread.findMany({
        where: { id: input?.threadId },
      });
      let syncedCount = 0;
      let newInboundCount = 0;
      for (const t of threads) {
        const result = await syncThread(t.id);
        syncedCount += 1;
        newInboundCount += result.newInboundMessages;
      }
      return { syncedCount, newInboundCount };
    }),

  // Re-run the GPT-5 parser on a specific inbound message (e.g. after first
  // attempt errored or a new model becomes available). Team-wide — any member
  // can reparse any thread's messages.
  parseMessage: protectedProcedure
    .input(z.object({ messageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const msg = await ctx.db.emailMessage.findUnique({
        where: { id: input.messageId },
      });
      if (!msg) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const result = await parseEmailRentRoll(msg.id);
      return result;
    }),

  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.account.deleteMany({
      where: { userId: ctx.user.id, provider: "google" },
    });
    return { disconnected: true };
  }),
});
