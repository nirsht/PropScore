# PropScore

MLS Property Opportunity Scoring System — pulls active listings from the Bridge Data Output API (`sfar` dataset), computes opportunity scores (Density, Vacancy, Motivation, Value-Add Weighted Avg), and gives a team a fast, beautiful UI to rank, filter, search and reason over them.

## Quickstart (one command from root)

```bash
git clone <repo> && cd PropScore
cp .env.example .env       # paste your secrets
pnpm install
pnpm dev                   # http://localhost:3020
```

Default seeded test user (works in local & production — same DB):

```
email:    test@propscore.local
password: 123456
```

## Stack

- **Next.js 15** App Router + **React 19**
- **tRPC v11** end-to-end type-safe APIs
- **Prisma + Postgres** (PostGIS + pg_trgm enabled) for fast filtering and geo queries
- **MUI (latest)** + **Recharts** + **MapLibre / react-map-gl**
- **NextAuth v5** (Credentials — email + bcrypt)
- **OpenAI API** with a per-feature agent layer (`nl-filter`, `set-reasoning`, `ai-scoring`)

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Validates env, runs `prisma generate`, starts Next on **port 3020** |
| `pnpm build` | Production build |
| `pnpm start` | Run the production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest |
| `pnpm etl:sync` | Run an incremental ETL sync (used by the Render Cron Job) |
| `pnpm bootstrap:bridge` | Sanity-check Bridge access; lists dataset metadata |
| `pnpm db:generate` | Regenerate Prisma client |
| `pnpm db:migrate` | Create/apply a migration (uses `SHADOW_DATABASE_URL`) |
| `pnpm db:deploy` | Apply pending migrations (used by Render's release command) |
| `pnpm db:seed` | Idempotently seed the default test user |
| `pnpm db:studio` | Open Prisma Studio |

## Deployment (Render)

`render.yaml` defines a Web Service + Cron Job, both pointing at the same `propscore` Postgres. Pushing to `main` triggers an auto-deploy; `pnpm db:deploy` runs as the release command. Cron schedule: daily 03:00 UTC (`pnpm etl:sync`).

## Architecture

See [`/Users/nirsh/.claude/plans/i-want-to-create-magical-treasure.md`](.) for the full plan; key folders:

```
src/
  app/                       Next.js App Router (UI, auth, /admin/sync)
  components/                MUI-themed components (FilterBar, ListingsGrid, NLQueryBox, MapView, charts)
  theme/                     MUI theme + CssVarsProvider config
  lib/                       env, db, auth, openai
  server/
    api/                     tRPC routers
    etl/                     Bridge client + pipeline + heuristic scoring
    agents/                  BaseAgent + per-feature agents (nl-filter, set-reasoning, ai-scoring)
prisma/                      schema, migrations, seed
scripts/                     dev / etl-sync / bootstrap-bridge
.github/workflows/ci.yml     typecheck, lint, prisma validate, vitest
render.yaml                  Web Service + Cron Job IaC
```
