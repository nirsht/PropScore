import { Prisma, PrismaClient } from "@prisma/client";

// Render's managed Postgres occasionally drops idle connections from the
// pool (Prisma surfaces this as P1017 "Server has closed the connection"),
// most often during long parallel nightly sweeps where many lanes share the
// pool. We retry transient drops with a small backoff so single-row reads /
// upserts don't fail the whole batch. Persistent failures still surface.
const TRANSIENT_PRISMA_CODES = new Set([
  "P1001", // can't reach DB
  "P1002", // server reached but timed out
  "P1017", // server has closed the connection
  "P2024", // timed out waiting for a connection from the pool
]);

function isTransientDbError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return TRANSIENT_PRISMA_CODES.has(err.code);
  }
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientRustPanicError) return false;
  if (err instanceof Error) {
    return /Server has closed the connection|Can't reach database server|Connection reset|ECONNRESET|read ECONNRESET/i.test(
      err.message,
    );
  }
  return false;
}

const RETRY_TRIES = 4;
const RETRY_BASE_MS = 250;

function makePrisma() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
  return base.$extends({
    name: "transient-retry",
    query: {
      async $allOperations({ args, query, model, operation }) {
        let lastErr: unknown;
        for (let attempt = 0; attempt < RETRY_TRIES; attempt++) {
          try {
            return await query(args);
          } catch (err) {
            lastErr = err;
            if (!isTransientDbError(err) || attempt === RETRY_TRIES - 1) throw err;
            const waitMs =
              RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 100);
            // eslint-disable-next-line no-console
            console.warn(
              `[db] transient ${model ?? "raw"}.${operation} error, retrying in ${waitMs}ms (attempt ${attempt + 2}/${RETRY_TRIES})`,
            );
            await new Promise((r) => setTimeout(r, waitMs));
          }
        }
        throw lastErr;
      },
    },
  });
}

type Db = ReturnType<typeof makePrisma>;

declare global {
  // eslint-disable-next-line no-var
  var __propscorePrisma: Db | undefined;
}

export const db: Db = globalThis.__propscorePrisma ?? makePrisma();

if (process.env.NODE_ENV !== "production") {
  globalThis.__propscorePrisma = db;
}
