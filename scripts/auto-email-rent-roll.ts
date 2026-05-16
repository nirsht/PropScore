/**
 * Auto-create Gmail drafts for every active SF listing with price/sqft below
 * EMAIL_AUTO_PRICE_PER_SQFT (default $450). One draft per (user, listing) —
 * dedup is enforced at the DB layer via the unique constraint on
 * EmailThread(userId, listingMlsId), so re-running this script after the
 * initial sweep is a no-op.
 *
 * Designed to be a Render-cron lane in scripts/nightly.ts, but safe to run
 * manually.
 *
 * Usage:
 *   pnpm tsx scripts/auto-email-rent-roll.ts                 # gated by env.EMAIL_AUTO_ENABLED
 *   pnpm tsx scripts/auto-email-rent-roll.ts --dry-run       # log what *would* draft, no Gmail calls
 *   pnpm tsx scripts/auto-email-rent-roll.ts --limit=10
 *   EMAIL_AUTO_ENABLED=true pnpm tsx scripts/auto-email-rent-roll.ts
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createDraft, GmailNotConnectedError } from "@/lib/google/gmail";
import { rentRollRequestEmail } from "@/server/emails/templates";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

async function pickOperatorUser() {
  // Phase 1 model: first ADMIN user with a linked Google Account drives the
  // auto-trigger. Falls back to any user with a Google Account if no ADMIN
  // is linked (handles single-user dev where the seeded user is non-ADMIN).
  const linked = await db.user.findMany({
    where: { accounts: { some: { provider: "google" } } },
    orderBy: [{ role: "desc" }, { createdAt: "asc" }],
    take: 1,
  });
  return linked[0] ?? null;
}

async function main() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    console.log("[auto-email] GOOGLE_CLIENT_ID/SECRET unset — skipping.");
    return;
  }

  if (!env.EMAIL_AUTO_ENABLED && !dryRun) {
    console.log(
      "[auto-email] EMAIL_AUTO_ENABLED=false — skipping. Run with --dry-run to preview.",
    );
    return;
  }

  const operator = await pickOperatorUser();
  if (!operator) {
    console.log("[auto-email] No user has a linked Google account. Skipping.");
    return;
  }
  console.log(
    `[auto-email] Operator: ${operator.email} (role=${operator.role}). Threshold: $${env.EMAIL_AUTO_PRICE_PER_SQFT}/sqft. dryRun=${dryRun}`,
  );

  // SQL-level filter on price/effectiveSqft using the generated `pricePerSqft`
  // column added in the raw migration. We use $queryRaw to access it because
  // Prisma's typed model doesn't expose generated columns.
  const candidatesRaw = await db.$queryRaw<
    Array<{ mlsId: string; address: string; pricePerSqft: number }>
  >(Prisma.sql`
    SELECT l."mlsId" as "mlsId",
           l."address" as "address",
           l."pricePerSqft" as "pricePerSqft"
    FROM "Listing" l
    JOIN "ListingContact" c ON c."listingMlsId" = l."mlsId"
    LEFT JOIN "EmailThread" t
           ON t."listingMlsId" = l."mlsId" AND t."userId" = ${operator.id}
    WHERE l."status" = 'Active'
      AND c."agentEmail" IS NOT NULL
      AND c."agentEmail" != ''
      AND l."pricePerSqft" IS NOT NULL
      AND l."pricePerSqft" < ${env.EMAIL_AUTO_PRICE_PER_SQFT}
      AND t."id" IS NULL
    ORDER BY l."pricePerSqft" ASC
    ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}
  `);

  console.log(`[auto-email] ${candidatesRaw.length} listings qualify.`);

  if (dryRun) {
    for (const c of candidatesRaw) {
      console.log(
        `  - ${c.mlsId}  $${Math.round(c.pricePerSqft)}/sqft  ${c.address}`,
      );
    }
    return;
  }

  let drafted = 0;
  let skipped = 0;
  for (const c of candidatesRaw) {
    const listing = await db.listing.findUnique({
      where: { mlsId: c.mlsId },
      include: { contact: true },
    });
    if (!listing?.contact?.agentEmail) {
      skipped += 1;
      continue;
    }
    const { subject, body } = rentRollRequestEmail({
      listingAddress: listing.address,
      agentName: listing.contact.agentName ?? null,
      userName: operator.name ?? null,
    });

    try {
      const draft = await createDraft({
        userId: operator.id,
        to: listing.contact.agentEmail,
        subject,
        body,
      });
      await db.emailThread.create({
        data: {
          userId: operator.id,
          listingMlsId: listing.mlsId,
          gmailDraftId: draft.gmailDraftId,
          gmailThreadId: draft.gmailThreadId,
          status: "DRAFT",
          toEmail: listing.contact.agentEmail,
          subject,
          trigger: "auto_under_450",
        },
      });
      drafted += 1;
      console.log(
        `  ✓ drafted ${listing.mlsId}  → ${listing.contact.agentEmail}`,
      );
    } catch (err) {
      if (err instanceof GmailNotConnectedError) {
        console.error(
          `[auto-email] Operator disconnected mid-run. Aborting.`,
        );
        break;
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        // Race: another concurrent run inserted between our SELECT and INSERT.
        skipped += 1;
        continue;
      }
      console.error(
        `  ✗ ${listing.mlsId}: ${(err as Error).message ?? "unknown"}`,
      );
      skipped += 1;
    }
  }

  console.log(
    `[auto-email] done. drafted=${drafted} skipped=${skipped} total=${candidatesRaw.length}`,
  );
}

main()
  .catch((err) => {
    console.error("[auto-email] fatal:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
