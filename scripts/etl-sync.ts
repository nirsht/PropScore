/**
 * Entry point for the Render Cron Job and the `pnpm etl:sync` command.
 * Runs a single incremental sync, prints a summary, and exits with code 0/1.
 */
import { runSync } from "@/server/etl/pipeline";

const maxRowsArg = process.argv.find((a) => a.startsWith("--max="));
const maxRows = maxRowsArg ? Number(maxRowsArg.split("=")[1]) : undefined;

async function main() {
  const started = Date.now();
  console.log(`[etl] starting sync${maxRows ? ` (maxRows=${maxRows})` : ""}…`);
  const summary = await runSync({ maxRows });
  const duration = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[etl] ${summary.status} — upserted=${summary.recordsUpserted}, scored=${summary.recordsScored}, cursor=${summary.cursorTo.toISOString()}, ${duration}s`,
  );
}

main().catch((err) => {
  console.error("[etl] failed:", err);
  process.exit(1);
});
