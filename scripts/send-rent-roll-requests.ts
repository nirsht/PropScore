/**
 * Daily auto-send: email the listing agent of each newly-created, under-
 * threshold Active asset asking for the rent roll — automatically, no human
 * review. Meant to run as a Render cron shortly after the daily base ETL
 * (which pulls new listings from Bridge). Replies are picked up later by the
 * `emails:poll` stage (LLM cron) and parsed.
 *
 * Candidate = an Active listing with a valid agent email, pricePerSqft below
 * EMAIL_AUTO_PRICE_PER_SQFT, created within the last --days days, and with NO
 * existing EmailThread for the sending user (the `@@unique([userId,
 * listingMlsId])` on EmailThread is the source-of-truth dedup — we never email
 * the same asset twice). Mirrors the candidate logic of the
 * `emails.bulkDraftUnderThreshold` tRPC mutation, but SENDS instead of drafts
 * and adds the created-recently window.
 *
 * Sends from every connected Google mailbox (each User with a `google`
 * Account), resolving the sender exactly as the app does.
 *
 * Usage:
 *   pnpm emails:request                 # send (last 2 days, all mailboxes)
 *   pnpm emails:request --dry-run       # list what WOULD be sent, send nothing
 *   pnpm emails:request --days=7        # widen the created-recently window
 *   pnpm emails:request --max=10        # cap sends per mailbox (default: no cap)
 *   pnpm emails:request --user=<userId> # restrict to one mailbox
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  sendEmail,
  getConnectedName,
  GmailNotConnectedError,
  InvalidRecipientError,
} from "@/lib/google/gmail";
import { isValidEmailAddress } from "@/lib/email-address";
import { rentRollRequestEmail } from "@/lib/emails/templates";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const daysArg = args.find((a) => a.startsWith("--days="));
const DAYS = daysArg ? Number(daysArg.split("=")[1]) : 2;
const maxArg = args.find((a) => a.startsWith("--max="));
const MAX_PER_USER = maxArg ? Number(maxArg.split("=")[1]) : Infinity;
const userArg = args.find((a) => a.startsWith("--user="));
const ONLY_USER = userArg ? userArg.split("=")[1] : undefined;

if (!Number.isFinite(DAYS) || DAYS <= 0) {
  console.error(`Invalid --days value: ${daysArg}`);
  process.exit(1);
}

type Candidate = { mlsId: string; address: string; pricePerSqft: number };

async function sendForUser(userId: string, cutoff: Date) {
  const user = await db.user.findUnique({ where: { id: userId } });
  const senderName = (await getConnectedName(userId)) ?? user?.name ?? null;

  const candidates = await db.$queryRaw<Candidate[]>(Prisma.sql`
    SELECT l."mlsId" as "mlsId",
           l."address" as "address",
           l."pricePerSqft" as "pricePerSqft"
    FROM "Listing" l
    JOIN "ListingContact" c ON c."listingMlsId" = l."mlsId"
    LEFT JOIN "EmailThread" t
           ON t."listingMlsId" = l."mlsId" AND t."userId" = ${userId}
    WHERE l."status" = 'Active'
      AND l."deletedAt" IS NULL
      AND c."agentEmail" IS NOT NULL
      AND c."agentEmail" != ''
      AND l."pricePerSqft" IS NOT NULL
      AND l."pricePerSqft" < ${env.EMAIL_AUTO_PRICE_PER_SQFT}
      AND l."createdAt" >= ${cutoff}
      AND t."id" IS NULL
    ORDER BY l."pricePerSqft" ASC
  `);

  console.log(
    `\n[${userId}] ${candidates.length} candidate(s) (created ≥ ${cutoff.toISOString()}, pricePerSqft < ${env.EMAIL_AUTO_PRICE_PER_SQFT})`,
  );

  let sent = 0;
  let skipped = 0;
  for (const c of candidates) {
    if (sent >= MAX_PER_USER) {
      console.log(`  … --max=${MAX_PER_USER} reached; stopping.`);
      break;
    }
    const listing = await db.listing.findUnique({
      where: { mlsId: c.mlsId },
      include: { contact: true },
    });
    const agentEmail = listing?.contact?.agentEmail?.trim();
    // Candidate SQL only checks non-empty; enrichment sometimes stores a name
    // or placeholder here, which Gmail rejects. Skip so one bad row doesn't
    // abort the batch.
    if (!listing || !agentEmail || !isValidEmailAddress(agentEmail)) {
      skipped += 1;
      continue;
    }
    const { subject, body } = rentRollRequestEmail({
      listingAddress: listing.address,
      agentName: listing.contact?.agentName ?? null,
      userName: senderName,
    });

    if (DRY_RUN) {
      console.log(
        `  [dry-run] → ${agentEmail}  "${subject}"  (${listing.address}, $${c.pricePerSqft}/sqft)`,
      );
      sent += 1;
      continue;
    }

    try {
      const res = await sendEmail({ userId, to: agentEmail, subject, body });
      await db.emailThread.create({
        data: {
          userId,
          listingMlsId: listing.mlsId,
          gmailThreadId: res.gmailThreadId,
          status: "SENT",
          sentAt: new Date(),
          toEmail: agentEmail,
          subject,
          // Reuse the existing trigger so the Emails UI badge/filter keep
          // working; SENT status + sentAt distinguish cron-sent from a
          // bulk draft the user hasn't sent yet.
          trigger: "auto_under_450",
        },
      });
      console.log(`  ✓ ${agentEmail}  "${subject}"  (${listing.address})`);
      sent += 1;
    } catch (err) {
      if (err instanceof GmailNotConnectedError) {
        console.error(`  ✗ Gmail not connected for ${userId}; aborting user.`);
        break;
      }
      // Bad recipient, or a concurrent insert already created the thread
      // (unique violation) — skip, don't abort the batch.
      if (
        err instanceof InvalidRecipientError ||
        (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
      ) {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }

  console.log(
    `[${userId}] ${DRY_RUN ? "would send" : "sent"}=${sent} skipped=${skipped} of ${candidates.length}`,
  );
  return { sent, skipped, total: candidates.length };
}

async function main() {
  const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  console.log(
    `[send-rent-roll-requests] ${DRY_RUN ? "DRY RUN — " : ""}window=${DAYS}d threshold=${env.EMAIL_AUTO_PRICE_PER_SQFT} maxPerUser=${MAX_PER_USER}`,
  );

  const accounts = await db.account.findMany({
    where: { provider: "google", ...(ONLY_USER ? { userId: ONLY_USER } : {}) },
    select: { userId: true },
    distinct: ["userId"],
  });
  if (accounts.length === 0) {
    console.log("No connected Google mailboxes found — nothing to do.");
    return;
  }

  let totalSent = 0;
  let totalSkipped = 0;
  for (const a of accounts) {
    const r = await sendForUser(a.userId, cutoff);
    totalSent += r.sent;
    totalSkipped += r.skipped;
  }

  console.log(
    `\n[send-rent-roll-requests] done. mailboxes=${accounts.length} ${DRY_RUN ? "would send" : "sent"}=${totalSent} skipped=${totalSkipped}`,
  );
}

main()
  .catch((err) => {
    console.error("[send-rent-roll-requests] fatal:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
