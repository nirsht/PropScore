import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export type TRPCContext = {
  db: typeof db;
  user: { id: string; email: string; role: "USER" | "ADMIN" } | null;
};

export const createTRPCContext = async (): Promise<TRPCContext> => {
  const session = await auth();
  return {
    db,
    user:
      session?.user && (session.user as { id?: string }).id
        ? {
            id: (session.user as { id: string }).id,
            email: session.user.email ?? "",
            role: ((session.user as { role?: "USER" | "ADMIN" }).role ?? "USER"),
          }
        : null,
  };
};

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "ADMIN") throw new TRPCError({ code: "FORBIDDEN" });
  return next({ ctx });
});
