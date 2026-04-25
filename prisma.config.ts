import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 6 stops auto-loading .env when a prisma.config.ts is present
// ("Prisma config detected, skipping environment variable loading."), so we
// restore the previous behavior explicitly. CI passes env vars through the
// workflow `env:` block — `loadEnv()` is a no-op when .env doesn't exist.
loadEnv();

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
