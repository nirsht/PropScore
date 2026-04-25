import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __propscorePrisma: PrismaClient | undefined;
}

export const db: PrismaClient =
  globalThis.__propscorePrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__propscorePrisma = db;
}
