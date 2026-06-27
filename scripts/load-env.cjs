// Node-version-agnostic dotenv preloader. Wired in via `tsx -r` from every
// pnpm script — replaces the previous `--env-file-if-exists=.env` flag,
// which Render's cron runtime silently mis-parsed even with .nvmrc bumped
// to 20.18.1 (cron exited `node: .env: not found` / exit code 9).
//
// dotenv.config() is a no-op on missing files (returns { error } but never
// throws), and won't override env vars already set by the host — so
// Render's injected vars take precedence.
const fs = require("node:fs");
if (fs.existsSync(".env")) {
  require("dotenv").config();
}
