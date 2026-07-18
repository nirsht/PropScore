/**
 * One-off cleanup for the old Gmail-as-login flow.
 *
 * Before Gmail was moved to a standalone connect flow, clicking "Connect Gmail"
 * signed in with the Google provider. When the Gmail address didn't match the
 * app login email, NextAuth created a *new* user for the mailbox and parked the
 * Google Account on it — leaving orphan users with a password-less login and a
 * stray Google Account.
 *
 * This script deletes those orphans: users with NO hashedPassword (i.e. they
 * were never a real Credentials login). Deleting a user cascades its Account
 * rows (onDelete: Cascade), so the stray Google tokens go with them.
 *
 * Dry-run by default. Pass --apply to actually delete.
 *
 *   npx tsx -r ./scripts/load-env.cjs scripts/cleanup-gmail-orphan-users.ts
 *   npx tsx -r ./scripts/load-env.cjs scripts/cleanup-gmail-orphan-users.ts --apply
 */
import { db } from "@/lib/db";

async function main() {
  const apply = process.argv.includes("--apply");

  const users = await db.user.findMany({
    select: {
      id: true,
      email: true,
      hashedPassword: true,
      accounts: { select: { provider: true, providerAccountId: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${users.length} user(s):`);
  for (const u of users) {
    const providers = u.accounts.map((a) => a.provider).join(", ") || "—";
    const kind = u.hashedPassword ? "PASSWORD (keep)" : "no-password (ORPHAN)";
    console.log(`  • ${u.email}  [${kind}]  accounts: ${providers}`);
  }

  const orphans = users.filter((u) => !u.hashedPassword);
  if (orphans.length === 0) {
    console.log("\nNo password-less orphan users to delete. Nothing to do.");
    await db.$disconnect();
    return;
  }

  console.log(
    `\n${apply ? "Deleting" : "[dry-run] Would delete"} ${orphans.length} orphan user(s):`,
  );
  for (const o of orphans) console.log(`  - ${o.email} (${o.id})`);

  if (!apply) {
    console.log("\nRe-run with --apply to delete. (Accounts cascade with the user.)");
    await db.$disconnect();
    return;
  }

  const result = await db.user.deleteMany({
    where: { id: { in: orphans.map((o) => o.id) } },
  });
  console.log(`\nDeleted ${result.count} orphan user(s) and their Account rows.`);

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
