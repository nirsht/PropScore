import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { protectedProcedure, router } from "../trpc";
import { googleAuthEnabled } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  createDraft,
  getConnectedEmail,
  GmailNotConnectedError,
  gmailDraftUrl,
  gmailThreadUrl,
} from "@/lib/google/gmail";
import { rentRollRequestEmail } from "@/server/emails/templates";
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
} satisfies Prisma.EmailThreadInclude;

export const emailsRouter = router({
  // Is Gmail wired up at all (env) and does this user have a linked Google
  // account with valid scopes? Drives the Connect-Gmail pill + ContactCard
  // button visibility.
  connectionStatus: protectedProcedure.query(async ({ ctx }) => {
    if (!googleAuthEnabled) {
      return { configured: false as const, connected: false as const, email: null };
    }
    const email = await getConnectedEmail(ctx.user.id);
    return {
      configured: true as const,
      connected: Boolean(email),
      email,
    };
  }),

  // Manual click from ContactCard — creates a Gmail draft for the listing's
  // agent. Idempotent: if a thread already exists for (user, listing) we
  // return the existing draft URL instead of inserting a duplicate.
  requestRentRoll: protectedProcedure
    .input(z.object({ listingMlsId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.emailThread.findUnique({
        where: {
          userId_listingMlsId: {
            userId: ctx.user.id,
            listingMlsId: input.listingMlsId,
          },
        },
      });
      if (existing) {
        return {
          threadId: existing.id,
          alreadyExisted: true as const,
          draftUrl: existing.gmailDraftId
            ? gmailDraftUrl(existing.gmailDraftId)
            : existing.gmailThreadId
              ? gmailThreadUrl(existing.gmailThreadId)
              : null,
        };
      }

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

      const user = await ctx.db.user.findUnique({ where: { id: ctx.user.id } });
      const { subject, body } = rentRollRequestEmail({
        listingAddress: listing.address,
        agentName: listing.contact?.agentName ?? null,
        userName: user?.name ?? null,
      });

      let draft: { gmailDraftId: string; gmailThreadId: string };
      try {
        draft = await createDraft({
          userId: ctx.user.id,
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
            userId: ctx.user.id,
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
        // Concurrent click — another draft was created between findUnique
        // and create. Surface the existing one rather than 500ing.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          const dup = await ctx.db.emailThread.findUnique({
            where: {
              userId_listingMlsId: {
                userId: ctx.user.id,
                listingMlsId: input.listingMlsId,
              },
            },
          });
          if (dup)
            return {
              threadId: dup.id,
              alreadyExisted: true as const,
              draftUrl: dup.gmailDraftId ? gmailDraftUrl(dup.gmailDraftId) : null,
            };
        }
        throw err;
      }
    }),

  // Bulk-draft button on /emails — creates Gmail drafts for every Active SF
  // listing whose price/sqft is below EMAIL_AUTO_PRICE_PER_SQFT and that
  // doesn't already have a thread for this user. The EmailThread unique
  // constraint on (userId, listingMlsId) is the source of truth for dedup,
  // so listings the user has already drafted/sent/replied to are skipped.
  bulkDraftUnderThreshold: protectedProcedure.mutation(async ({ ctx }) => {
    const user = await ctx.db.user.findUnique({ where: { id: ctx.user.id } });
    if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });

    const candidates = await ctx.db.$queryRaw<
      Array<{ mlsId: string; address: string; pricePerSqft: number }>
    >(Prisma.sql`
      SELECT l."mlsId" as "mlsId",
             l."address" as "address",
             l."pricePerSqft" as "pricePerSqft"
      FROM "Listing" l
      JOIN "ListingContact" c ON c."listingMlsId" = l."mlsId"
      LEFT JOIN "EmailThread" t
             ON t."listingMlsId" = l."mlsId" AND t."userId" = ${ctx.user.id}
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
    for (const c of candidates) {
      const listing = await ctx.db.listing.findUnique({
        where: { mlsId: c.mlsId },
        include: { contact: true },
      });
      const agentEmail = listing?.contact?.agentEmail?.trim();
      if (!listing || !agentEmail) {
        skipped += 1;
        continue;
      }
      const { subject, body } = rentRollRequestEmail({
        listingAddress: listing.address,
        agentName: listing.contact?.agentName ?? null,
        userName: user.name ?? null,
      });

      try {
        const draft = await createDraft({
          userId: ctx.user.id,
          to: agentEmail,
          subject,
          body,
        });
        await ctx.db.emailThread.create({
          data: {
            userId: ctx.user.id,
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
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
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

  // Per-listing lookup for the EmailHistorySection in the drawer.
  forListing: protectedProcedure
    .input(z.object({ listingMlsId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.emailThread.findUnique({
        where: {
          userId_listingMlsId: {
            userId: ctx.user.id,
            listingMlsId: input.listingMlsId,
          },
        },
        include: threadInclude,
      });
    }),

  // Cross-listing inbox on the /emails page.
  listThreads: protectedProcedure
    .input(
      z
        .object({
          status: z
            .enum(["DRAFT", "SENT", "REPLIED", "PARSED", "FAILED"])
            .optional(),
          trigger: z.enum(["manual", "auto_under_450"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.emailThread.findMany({
        where: {
          userId: ctx.user.id,
          status: input?.status,
          trigger: input?.trigger,
        },
        include: threadInclude,
        orderBy: { createdAt: "desc" },
        take: 200,
      });
    }),

  getThread: protectedProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      const thread = await ctx.db.emailThread.findFirst({
        where: { id: input.threadId, userId: ctx.user.id },
        include: threadInclude,
      });
      if (!thread) throw new TRPCError({ code: "NOT_FOUND" });
      return thread;
    }),

  // Manual sync — used by the "Sync now" button on the EmailsView. The same
  // logic runs nightly via scripts/poll-gmail-replies.ts.
  syncNow: protectedProcedure
    .input(z.object({ threadId: z.string().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const threads = await ctx.db.emailThread.findMany({
        where: {
          userId: ctx.user.id,
          id: input?.threadId,
        },
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
  // attempt errored or a new model becomes available).
  parseMessage: protectedProcedure
    .input(z.object({ messageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const msg = await ctx.db.emailMessage.findUnique({
        where: { id: input.messageId },
        include: { thread: true },
      });
      if (!msg || msg.thread.userId !== ctx.user.id) {
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
