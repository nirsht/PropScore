/**
 * Sync every active EmailThread against Gmail — fetch any new messages,
 * advance the DRAFT → SENT / SENT → REPLIED status, run the GPT-5 rent-roll
 * parser on new inbound messages.
 *
 * Designed to be a Render-cron lane in scripts/nightly.ts. Also exposed via
 * the `emails.syncNow` tRPC procedure for manual triggering from the UI.
 *
 * Usage:
 *   pnpm tsx scripts/poll-gmail-replies.ts                # every active thread
 *   pnpm tsx scripts/poll-gmail-replies.ts --max-age-min=30
 *   pnpm tsx scripts/poll-gmail-replies.ts --thread-id=<id>
 */
import { db } from "@/lib/db";
import { syncThread } from "@/server/emails/sync";

const args = process.argv.slice(2);
const maxAgeArg = args.find((a) => a.startsWith("--max-age-min="));
const maxAgeMin = maxAgeArg ? Number(maxAgeArg.split("=")[1]) : 30;
const threadIdArg = args.find((a) => a.startsWith("--thread-id="));
const targetThreadId = threadIdArg ? threadIdArg.split("=")[1] : undefined;

async function main() {
  const cutoff = new Date(Date.now() - maxAgeMin * 60_000);
  const threads = targetThreadId
    ? await db.emailThread.findMany({ where: { id: targetThreadId } })
    : await db.emailThread.findMany({
        where: {
          // Skip terminal states; FAILED is recoverable via UI "Re-parse".
          status: { in: ["DRAFT", "SENT", "REPLIED"] },
          OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: cutoff } }],
        },
        orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
      });

  console.log(
    `[poll-replies] ${threads.length} threads need sync (cutoff ${cutoff.toISOString()})`,
  );

  let totalNew = 0;
  let totalInbound = 0;
  let parsed = 0;
  for (const t of threads) {
    try {
      const result = await syncThread(t.id);
      totalNew += result.newMessages;
      totalInbound += result.newInboundMessages;
      if (result.parsedRentRoll) parsed += 1;
      if (result.newMessages > 0 || result.statusBefore !== result.statusAfter) {
        console.log(
          `  ✓ ${t.id}  +${result.newMessages} msgs (${result.newInboundMessages} inbound)  ${result.statusBefore} → ${result.statusAfter}`,
        );
      }
    } catch (err) {
      console.error(`  ✗ ${t.id}: ${(err as Error).message ?? "unknown"}`);
    }
  }

  console.log(
    `[poll-replies] done. threads=${threads.length} newMessages=${totalNew} newInbound=${totalInbound} parsed=${parsed}`,
  );
}

main()
  .catch((err) => {
    console.error("[poll-replies] fatal:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
