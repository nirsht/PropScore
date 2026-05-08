import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { FilterInput } from "../schemas/filter";

const ScopeEnum = z.enum(["ASSET", "GLOBAL"]);

export const chatRouter = router({
  /**
   * Recent conversations for the current user. Optional scope/listing filter
   * to power the per-asset thread dropdown and the global drawer's list.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          scope: ScopeEnum.optional(),
          listingMlsId: z.string().optional(),
          archived: z.boolean().optional(),
          limit: z.number().int().min(1).max(100).default(50),
        })
        .optional()
        .default({ limit: 50 }),
    )
    .query(async ({ ctx, input }) => {
      const where: {
        userId: string;
        scope?: "ASSET" | "GLOBAL";
        listingMlsId?: string;
        archived?: boolean;
      } = { userId: ctx.user.id };
      if (input.scope) where.scope = input.scope;
      if (input.listingMlsId) where.listingMlsId = input.listingMlsId;
      if (typeof input.archived === "boolean") where.archived = input.archived;
      return ctx.db.chatConversation.findMany({
        where,
        orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
        take: input.limit,
        select: {
          id: true,
          scope: true,
          listingMlsId: true,
          title: true,
          pinned: true,
          archived: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }),

  /**
   * Full message history for one conversation.
   */
  get: protectedProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const convo = await ctx.db.chatConversation.findUnique({
        where: { id: input.conversationId },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
        },
      });
      if (!convo || convo.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return convo;
    }),

  /**
   * Create a new empty conversation. The first message gets sent via the
   * /api/chat/stream route so we capture its tokens as they stream in.
   */
  create: protectedProcedure
    .input(
      z.object({
        scope: ScopeEnum,
        listingMlsId: z.string().optional(),
        filterSnapshot: FilterInput.optional(),
        title: z.string().max(140).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.scope === "ASSET" && !input.listingMlsId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "ASSET conversations require listingMlsId",
        });
      }
      return ctx.db.chatConversation.create({
        data: {
          userId: ctx.user.id,
          scope: input.scope,
          listingMlsId: input.scope === "ASSET" ? input.listingMlsId : null,
          filterSnapshot:
            input.scope === "GLOBAL" && input.filterSnapshot
              ? (input.filterSnapshot as object)
              : undefined,
          title: input.title?.trim() || "New chat",
        },
        select: {
          id: true,
          scope: true,
          listingMlsId: true,
          title: true,
          createdAt: true,
        },
      });
    }),

  rename: protectedProcedure
    .input(z.object({ conversationId: z.string(), title: z.string().min(1).max(140) }))
    .mutation(async ({ ctx, input }) => {
      const convo = await ctx.db.chatConversation.findUnique({
        where: { id: input.conversationId },
        select: { userId: true },
      });
      if (!convo || convo.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return ctx.db.chatConversation.update({
        where: { id: input.conversationId },
        data: { title: input.title.trim() },
      });
    }),

  setPinned: protectedProcedure
    .input(z.object({ conversationId: z.string(), pinned: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const convo = await ctx.db.chatConversation.findUnique({
        where: { id: input.conversationId },
        select: { userId: true },
      });
      if (!convo || convo.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return ctx.db.chatConversation.update({
        where: { id: input.conversationId },
        data: { pinned: input.pinned },
      });
    }),

  setArchived: protectedProcedure
    .input(z.object({ conversationId: z.string(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const convo = await ctx.db.chatConversation.findUnique({
        where: { id: input.conversationId },
        select: { userId: true },
      });
      if (!convo || convo.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return ctx.db.chatConversation.update({
        where: { id: input.conversationId },
        data: { archived: input.archived },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ conversationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const convo = await ctx.db.chatConversation.findUnique({
        where: { id: input.conversationId },
        select: { userId: true },
      });
      if (!convo || convo.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      // Cascade deletes ChatMessage + ChatAttachment rows; R2 objects we
      // leave behind for now (sweep job can clean up by conversation prefix).
      await ctx.db.chatConversation.delete({ where: { id: input.conversationId } });
      return { ok: true };
    }),
});
