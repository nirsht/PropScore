import { Prisma, PrismaClient } from "@prisma/client";

// Render's managed Postgres occasionally drops idle connections from the
// pool (Prisma surfaces this as P1017 "Server has closed the connection"),
// most often during long parallel nightly sweeps where many lanes share the
// pool. It also restarts itself periodically — during the restart window the
// server accepts TCP but rejects every query with `FATAL: the database
// system is in recovery mode` / `not yet accepting connections`, surfaced by
// Prisma as PrismaClientUnknownRequestError (no code). Recovery typically
// lasts 30–90s, so retries here cover both transient drops and full
// restarts. Persistent failures still surface.
const TRANSIENT_PRISMA_CODES = new Set([
  "P1001", // can't reach DB
  "P1002", // server reached but timed out
  "P1011", // error opening a TLS connection (Render edge drops the socket
  //          mid-handshake under load — e.g. "unexpected EOF")
  "P1017", // server has closed the connection
  "P2024", // timed out waiting for a connection from the pool
]);

const TRANSIENT_MESSAGE_RE =
  /Server has closed the connection|Can't reach database server|Connection reset|ECONNRESET|read ECONNRESET|Error opening a TLS connection|unexpected EOF|the database system is in recovery mode|the database system is not yet accepting connections|the database system is starting up|Consistent recovery state has not been yet reached|terminating connection due to administrator command/i;

function isTransientDbError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (TRANSIENT_PRISMA_CODES.has(err.code)) return true;
    return TRANSIENT_MESSAGE_RE.test(err.message);
  }
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientRustPanicError) return false;
  // Recovery-mode errors come through as PrismaClientUnknownRequestError
  // with no code; identify them by message.
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    return TRANSIENT_MESSAGE_RE.test(err.message);
  }
  if (err instanceof Error) {
    return TRANSIENT_MESSAGE_RE.test(err.message);
  }
  return false;
}

// Budget tuned to cover Render Postgres restart windows (typically 30–90s).
// 8 tries with capped exponential backoff = up to ~63s of retries before
// surfacing the failure. Per-listing loops still catch the final throw, so
// a longer-than-budget outage degrades to "errored listings re-tried next
// nightly" rather than a hard cron failure.
const RETRY_TRIES = 8;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 15_000;
// Wall-clock ceiling across ALL attempts for a single operation.
//
// The "~63s of retries" budget above only holds when each failure returns
// fast. It does not bound anything when the *query itself* is slow to fail:
// the nightly neighborhood backfill ran ~32 minutes before the server
// dropped its connection, so 8 attempts became 3h15m of the daily cron's
// 12h budget (see the 20260822000000_neighborhood_boundary_gist migration).
// Retrying is only ever meant to ride out a restart window, so once we've
// spent this long on one operation, stop and surface the error instead of
// silently multiplying a slow failure by RETRY_TRIES.
const RETRY_TOTAL_BUDGET_MS = 120_000;

function makePrisma() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
  return base.$extends({
    name: "transient-retry",
    query: {
      async $allOperations({ args, query, model, operation }) {
        let lastErr: unknown;
        const deadline = Date.now() + RETRY_TOTAL_BUDGET_MS;
        for (let attempt = 0; attempt < RETRY_TRIES; attempt++) {
          try {
            return await query(args);
          } catch (err) {
            lastErr = err;
            if (!isTransientDbError(err) || attempt === RETRY_TRIES - 1) throw err;
            const waitMs = Math.min(
              RETRY_MAX_MS,
              RETRY_BASE_MS * 2 ** attempt,
            ) + Math.floor(Math.random() * 250);
            if (Date.now() + waitMs >= deadline) {
              // eslint-disable-next-line no-console
              console.warn(
                `[db] transient ${model ?? "raw"}.${operation} error, but the ${RETRY_TOTAL_BUDGET_MS}ms retry budget is exhausted after ${attempt + 1} attempt(s) — surfacing`,
              );
              throw err;
            }
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
