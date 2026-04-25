/**
 * Entry point for the Render Cron Job and the `pnpm etl:sync` command.
 * Runs a single incremental sync, prints a summary, and exits with code 0/1.
 *
 * Flags:
 *   --max=N    cap rows pulled this run
 *   --full     ignore the cursor — pull every active listing. Use after a
 *              schema change that adds new fields (so existing rows are
 *              re-upserted with the new $select).
 */
import { runSync } from "@/server/etl/pipeline";

const args = process.argv.slice(2);
const maxRowsArg = args.find((a) => a.startsWith("--max="));
const maxRows = maxRowsArg ? Number(maxRowsArg.split("=")[1]) : undefined;
const full = args.includes("--full");

async function main() {
  const started = Date.now();
  console.log(
    `[etl] starting sync${full ? " (FULL — ignoring cursor)" : ""}${
      maxRows ? ` (maxRows=${maxRows})` : ""
    }…`,
  );
  const summary = await runSync({
    maxRows,
    ...(full ? { since: new Date(0) } : {}),
  });
  const duration = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[etl] ${summary.status} — upserted=${summary.recordsUpserted}, scored=${summary.recordsScored}, cursor=${summary.cursorTo.toISOString()}, ${duration}s`,
  );
}

main().catch((err) => {
  console.error("[etl] failed:", err);
  process.exit(1);
});
