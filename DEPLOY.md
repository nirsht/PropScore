# Deploying PropScore to Render

The goal of this doc is **zero manual env-var entry**. You'll click one
button to create the services, generate one API key, then run one command
that pushes every secret from your `.env` and triggers a deploy.

## TL;DR

```bash
# 1. (one-time) Click the blueprint deploy link, sign in, connect your GitHub.
open "https://render.com/deploy?repo=https://github.com/nirsht/PropScore"

# 2. (one-time) Create a Render API key:
#    https://dashboard.render.com/u/settings#api-keys
#    Add it to your local .env as RENDER_API_KEY.

# 3. Push every secret + redeploy in one command.
pnpm render:sync
```

That's it. From now on, every push to `main` auto-deploys via Render's
GitHub integration. The cron job (`propscore-etl-nightly`) runs nightly at
03:00 UTC.

---

## What gets deployed

`render.yaml` declares two services:

| Service                   | Type | Schedule       | Notes                                              |
|---------------------------|------|----------------|----------------------------------------------------|
| `propscore-web`           | Web  | always-on      | Build: `pnpm install && pnpm build`. Pre-deploy: `prisma migrate deploy && db:seed`. Start: `pnpm start`. |
| `propscore-etl-nightly`   | Cron | `0 3 * * *`    | Build: `pnpm install && prisma generate`. Start: `pnpm etl:sync`. |

Both connect to the same managed Postgres `propscore` (already provisioned
in your Render account — `render.yaml` doesn't try to recreate it).

---

## Step 1 — Blueprint deploy (UI, one-time)

1. Click **[Deploy to Render](https://render.com/deploy?repo=https://github.com/nirsht/PropScore)**
2. Sign in, authorize GitHub access if asked.
3. Render reads `render.yaml` and offers to create both services. Confirm.
4. The deploy will start — and probably **fail on the first run** because
   `DATABASE_URL`, `NEXTAUTH_SECRET`, `BRIDGE_SERVER_TOKEN`, and
   `OPENAI_API_KEY` aren't set yet. That's expected. We fix it in step 3.

If the dashboard prompts you for any env vars, you can leave them blank
or type `tbd` — the sync script will overwrite them anyway.

## Step 2 — Generate a Render API key

1. Go to https://dashboard.render.com/u/settings#api-keys
2. Click **Create API Key**, name it (e.g. "PropScore deploy"), copy the value.
3. Open your local `.env` and set:

   ```
   RENDER_API_KEY="rnd_…"
   ```

## Step 3 — Push secrets + deploy

```bash
pnpm render:sync
```

What it does:

- Looks up `propscore-web` and `propscore-etl-nightly` by name via the API.
- Reads from your `.env`:
  - `DATABASE_URL`
  - `NEXTAUTH_SECRET`
  - `BRIDGE_SERVER_TOKEN`
  - `OPENAI_API_KEY`
  - `NEXT_PUBLIC_MAP_STYLE_URL` (optional, web only)
- Pushes them to each service via `PUT /v1/services/<id>/env-vars`.
- Triggers a fresh deploy of each service.

Static config (`NODE_ENV`, `BRIDGE_DATASET`, `BRIDGE_BASE_URL`,
`OPENAI_MODEL`) lives in `render.yaml` and isn't synced.

The web app's URL appears in the dashboard once the deploy is healthy
(typically `https://propscore-web.onrender.com`). `NEXTAUTH_URL` is derived
from Render's auto-injected `RENDER_EXTERNAL_URL` so you don't need to set
it manually.

### Useful flags

```bash
pnpm render:sync:dry        # dry-run — print what would be pushed
pnpm render:sync -- --no-deploy   # update env vars without redeploying
```

---

## Verifying success

1. **Render dashboard** → both services should be **Live**. Click into the
   web service and confirm:
   - Logs show `next start` and a healthy boot.
   - The pre-deploy step ran `prisma migrate deploy && db:seed`.
2. Open the service URL → you should land on the sign-in page. Sign in with
   `test@propscore.local` / `123456`.
3. Click **Sync Now** in `/admin/sync` and watch the live log console.
4. **GitHub Actions** (`https://github.com/nirsht/PropScore/actions`)
   should show CI green on `main` for the latest commit.

If CI is red on `main`, fix locally + push — Render will not auto-deploy
broken code if your repo is set up to require checks (it auto-deploys on
push regardless, but the deploy will fail at build/typecheck time and
keep the previous version live).

---

## What's still manual (and why)

| Step                          | Manual? | Why                                                        |
|-------------------------------|---------|------------------------------------------------------------|
| GitHub repo connection        | Yes     | OAuth requires you in the loop the first time.             |
| Blueprint deploy (one click)  | Yes     | Same — first-time service creation.                        |
| API key generation            | Yes     | Render scopes API keys per-account; can't be programmatic. |
| Setting all env vars          | **No**  | Done by `pnpm render:sync`.                                 |
| Future deploys                | **No**  | `git push origin main` → autoDeploy in render.yaml.        |
| Future env updates            | **No**  | Update `.env` → `pnpm render:sync`.                         |

---

## Switching to Render's INTERNAL Postgres URL

The external URL works fine but is slower from inside Render's network.
After the first deploy, swap to the internal URL for lower latency:

1. In the Render dashboard, copy the **Internal Database URL** for
   `propscore` (looks like `postgresql://propscore_user:…@dpg-…/propscore`,
   no `.ohio-postgres.render.com` suffix).
2. Edit your local `.env`, replace `DATABASE_URL` with the internal one.
3. Run `pnpm render:sync` again.
4. Restore the external URL in `.env` for local dev (or use a separate
   `.env.render` file — see below if you want that pattern).

> **Heads up:** the internal URL only resolves from inside Render. Local
> `pnpm dev` against it will fail with a DNS error.
