import { z } from "zod";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { adminProcedure, router } from "../trpc";

// Admin-only user management. Users are created here (or the seed script) —
// there is no public self-service sign-up. All procedures are gated by
// `adminProcedure` (throws FORBIDDEN for non-ADMIN callers).

const emailSchema = z.string().email().max(200);
const passwordSchema = z.string().min(6).max(100);
const roleSchema = z.enum(["USER", "ADMIN"]);

export const adminRouter = router({
  // Team roster for the /admin/users grid — each user plus whether they have a
  // Gmail mailbox linked and how much outreach they own.
  listUsers: adminProcedure.query(async ({ ctx }) => {
    const users = await ctx.db.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        accounts: {
          where: { provider: "google" },
          select: { id: true },
        },
        _count: { select: { emailThreads: true } },
      },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      createdAt: u.createdAt,
      gmailConnected: u.accounts.length > 0,
      threadCount: u._count.emailThreads,
    }));
  }),

  createUser: adminProcedure
    .input(
      z.object({
        email: emailSchema,
        password: passwordSchema,
        name: z.string().max(80).optional(),
        role: roleSchema.default("USER"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      const existing = await ctx.db.user.findUnique({ where: { email } });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
      }
      const hashedPassword = await bcrypt.hash(input.password, 10);
      const user = await ctx.db.user.create({
        data: {
          email,
          name: input.name?.trim() || null,
          hashedPassword,
          role: input.role,
        },
        select: { id: true, email: true, name: true, role: true },
      });
      return user;
    }),

  setRole: adminProcedure
    .input(z.object({ userId: z.string(), role: roleSchema }))
    .mutation(async ({ ctx, input }) => {
      // Guard against removing the last admin — otherwise nobody can manage
      // users anymore.
      if (input.role === "USER") {
        const target = await ctx.db.user.findUnique({
          where: { id: input.userId },
          select: { role: true },
        });
        if (target?.role === "ADMIN") {
          const adminCount = await ctx.db.user.count({ where: { role: "ADMIN" } });
          if (adminCount <= 1) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Cannot demote the last remaining admin.",
            });
          }
        }
      }
      await ctx.db.user.update({
        where: { id: input.userId },
        data: { role: input.role },
      });
      return { ok: true as const };
    }),

  resetPassword: adminProcedure
    .input(z.object({ userId: z.string(), password: passwordSchema }))
    .mutation(async ({ ctx, input }) => {
      const hashedPassword = await bcrypt.hash(input.password, 10);
      await ctx.db.user.update({
        where: { id: input.userId },
        data: { hashedPassword },
      });
      return { ok: true as const };
    }),
});
