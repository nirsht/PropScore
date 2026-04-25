import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Replaces the deprecated `package.json#prisma` block (removed in Prisma 7).
 * Keeps the seed command wired so `prisma migrate reset` / `db seed` work.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
