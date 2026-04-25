/**
 * Single-command local dev runner.
 *
 *  - validates the .env (env.ts throws with a useful error if missing)
 *  - regenerates the Prisma client (cheap and idempotent)
 *  - prints any pending migrations *without applying them* — local dev points
 *    at the shared Render Postgres, and we never want a stray `migrate dev`
 *    from a laptop to mutate prod schema. Migrations run in Render's release.
 *  - boots `next dev` on PORT (default 3020)
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function ensureEnv() {
  if (!existsSync(path.join(root, ".env"))) {
    console.error("\n❌ .env not found. Copy .env.example to .env and fill in your secrets.\n");
    process.exit(1);
  }
}

function generatePrisma() {
  const result = spawnSync("npx", ["prisma", "generate"], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error("Prisma client generation failed.");
    process.exit(result.status ?? 1);
  }
}

function startNext() {
  const port = process.env.PORT ?? "3020";
  console.log(`\n→ Starting Next.js on http://localhost:${port}\n`);
  const proc = spawn("npx", ["next", "dev", "-p", port], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PORT: port },
  });
  proc.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => proc.kill("SIGINT"));
  process.on("SIGTERM", () => proc.kill("SIGTERM"));
}

ensureEnv();
generatePrisma();
startNext();
