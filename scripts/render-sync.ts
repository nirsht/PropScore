/**
 * Push secret env vars from `.env` to the three Render services that the
 * blueprint creates (`propscore-web`, `propscore-etl-daily`,
 * `propscore-etl-llm`), then trigger a redeploy of each.
 *
 * Required in `.env`:
 *   - RENDER_API_KEY        (from https://dashboard.render.com/u/settings#api-keys)
 *   - DATABASE_URL          (Render external Postgres URL)
 *   - NEXTAUTH_SECRET       (≥ 16 chars; `openssl rand -base64 32`)
 *   - BRIDGE_SERVER_TOKEN
 *   - OPENAI_API_KEY
 *
 * Optional in `.env`:
 *   - NEXT_PUBLIC_MAP_STYLE_URL  (web-only)
 *   - WALKSCORE_API_KEY          (web + daily cron)
 *   - TAVILY_API_KEY             (web-only — chat search)
 *   - RENTCAST_API_KEY           (web + daily cron — paused)
 *   - GOOGLE_CLIENT_ID/SECRET    (web + LLM cron — Gmail integration)
 *
 * Static env vars (NODE_ENV, BRIDGE_DATASET, BRIDGE_BASE_URL, OPENAI_MODEL)
 * live in `render.yaml` and don't need to be synced.
 *
 * NEXTAUTH_SECRET is pushed to the cron services too even though they
 * don't actually authenticate users — `src/lib/env.ts` validates it at
 * module-load time, so any cron script that touches the app's
 * `env`-importing modules (etl-sync → bridge-client → env) crashes
 * without it. Cleaner than carving env.ts up service-by-service.
 *
 * Usage:
 *   pnpm render:sync              # push env vars + redeploy all services
 *   pnpm render:sync --dry-run    # show what would be pushed
 *   pnpm render:sync --no-deploy  # push env vars only, skip redeploy
 */

const API = "https://api.render.com/v1";

const WEB_SERVICE_NAME = "propscore-web";
const CRON_DAILY_NAME = "propscore-etl-daily";
const CRON_LLM_NAME = "propscore-etl-llm";

type SecretMap = Record<string, string | undefined>;

function envOrDie(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    console.error(`✗ Missing ${name} in environment.`);
    process.exit(1);
  }
  return v;
}

function envOptional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : undefined;
}

// Render services in the same region as a managed Postgres should connect via
// the *internal* hostname (e.g. `dpg-xxxxx-a`), not the external one
// (`dpg-xxxxx-a.<region>-postgres.render.com`). External hostnames route
// through Render's public edge, which terminates SSL and is subject to
// proxy timeouts — the documented cause of intermittent
// `P1017: Server has closed the connection` during pre-deploy migrations.
// Internal connections stay inside the region, need no TLS, and are stable.
// Local `.env` keeps the external URL so developer laptops can still connect.
function toInternalDatabaseUrl(externalUrl: string): string {
  const u = new URL(externalUrl);
  const internalHostMatch = u.hostname.match(/^(dpg-[a-z0-9]+-a)\.[a-z]+-postgres\.render\.com$/);
  const internalHost = internalHostMatch?.[1];
  if (!internalHost) return externalUrl;
  u.hostname = internalHost;
  u.port = "";
  u.searchParams.delete("sslmode");
  return u.toString();
}

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const SKIP_DEPLOY = argv.includes("--no-deploy");

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const apiKey = envOrDie("RENDER_API_KEY");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Render API ${res.status} ${res.statusText} on ${path}\n${body}`);
  }
  // Some Render endpoints (notably POST /deploys) reply with a 2xx + empty
  // body. Parse defensively — text first, then JSON if non-empty.
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

type RenderService = {
  id: string;
  name: string;
  type: string;
};

async function findServiceId(name: string): Promise<string> {
  // /v1/services returns wrapped objects: [{ service: {...}, cursor: "..." }]
  const list = await api<Array<{ service: RenderService }>>(
    `/services?name=${encodeURIComponent(name)}&limit=20`,
  );
  const match = list
    .map((row) => row.service)
    .find((s) => s.name === name);
  if (!match) {
    throw new Error(
      `Couldn't find Render service named "${name}". Run the blueprint deploy first: https://render.com/deploy?repo=https://github.com/nirsht/PropScore`,
    );
  }
  return match.id;
}

async function setEnvVars(serviceId: string, vars: SecretMap, label: string) {
  // Render's bulk endpoint REPLACES non-static env vars (vars defined in
  // render.yaml with `value:` are not affected). So we only send our managed
  // keys here.
  const payload = Object.entries(vars)
    .filter(([, v]) => typeof v === "string" && v.length > 0)
    .map(([key, value]) => ({ key, value: value as string }));

  console.log(`→ ${label}: pushing ${payload.length} env vars`);
  for (const p of payload) {
    const masked = /SECRET|KEY|TOKEN|PASSWORD|DATABASE_URL/i.test(p.key)
      ? `${p.value.slice(0, 6)}…(${p.value.length} chars)`
      : p.value;
    console.log(`     ${p.key.padEnd(28)} = ${masked}`);
  }

  if (DRY_RUN) {
    console.log("     [dry-run — no changes pushed]");
    return;
  }

  await api(`/services/${serviceId}/env-vars`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

async function triggerDeploy(serviceId: string, label: string) {
  if (SKIP_DEPLOY || DRY_RUN) {
    if (SKIP_DEPLOY) console.log(`→ ${label}: skipping deploy (--no-deploy)`);
    return;
  }
  console.log(`→ ${label}: triggering deploy…`);
  const res = await api<{ id?: string }>(`/services/${serviceId}/deploys`, {
    method: "POST",
    body: JSON.stringify({ clearCache: "do_not_clear" }),
  });
  console.log(`     deploy ${res.id ? `id=${res.id}` : "queued"}`);
}

async function main() {
  console.log(DRY_RUN ? "[render-sync] DRY RUN — no API writes\n" : "[render-sync]\n");

  // Validate the variables we expect to push.
  const externalDatabaseUrl = envOrDie("DATABASE_URL");
  const DATABASE_URL = toInternalDatabaseUrl(externalDatabaseUrl);
  if (DATABASE_URL !== externalDatabaseUrl) {
    console.log(
      `  DATABASE_URL host → ${new URL(DATABASE_URL).hostname} (internal; external used locally)\n`,
    );
  } else {
    console.warn(
      `  ⚠ DATABASE_URL host doesn't match Render's external pattern; pushing as-is.\n`,
    );
  }
  const NEXTAUTH_SECRET = envOrDie("NEXTAUTH_SECRET");
  const BRIDGE_SERVER_TOKEN = envOrDie("BRIDGE_SERVER_TOKEN");
  const OPENAI_API_KEY = envOrDie("OPENAI_API_KEY");
  const NEXT_PUBLIC_MAP_STYLE_URL = envOptional("NEXT_PUBLIC_MAP_STYLE_URL");
  const WALKSCORE_API_KEY = envOptional("WALKSCORE_API_KEY");
  // Chat — optional. The web_search tool errors explicitly when invoked
  // without a key; the rest of chat works regardless.
  const TAVILY_API_KEY = envOptional("TAVILY_API_KEY");
  // Listing-agent contact enrichment. Optional: when missing,
  // contact-enrichment.ts no-ops and the drawer's "Listed by" / Brokerage
  // rows render empty (Bridge `sfar` IDX feed strips contact fields).
  const RENTCAST_API_KEY = envOptional("RENTCAST_API_KEY");
  // Gmail integration — used by emails-poll in the LLM cron, and by the
  // web service's NextAuth Google provider. Optional everywhere.
  const GOOGLE_CLIENT_ID = envOptional("GOOGLE_CLIENT_ID");
  const GOOGLE_CLIENT_SECRET = envOptional("GOOGLE_CLIENT_SECRET");

  // 1. Locate services.
  console.log("Looking up services on Render…");
  const [webId, cronDailyId, cronLlmId] = await Promise.all([
    findServiceId(WEB_SERVICE_NAME),
    findServiceId(CRON_DAILY_NAME),
    findServiceId(CRON_LLM_NAME),
  ]);
  console.log(`  ${WEB_SERVICE_NAME}      → ${webId}`);
  console.log(`  ${CRON_DAILY_NAME} → ${cronDailyId}`);
  console.log(`  ${CRON_LLM_NAME}   → ${cronLlmId}\n`);

  // 2. Push env vars.
  await setEnvVars(
    webId,
    {
      DATABASE_URL,
      NEXTAUTH_SECRET,
      BRIDGE_SERVER_TOKEN,
      OPENAI_API_KEY,
      ...(NEXT_PUBLIC_MAP_STYLE_URL ? { NEXT_PUBLIC_MAP_STYLE_URL } : {}),
      ...(WALKSCORE_API_KEY ? { WALKSCORE_API_KEY } : {}),
      ...(TAVILY_API_KEY ? { TAVILY_API_KEY } : {}),
      ...(RENTCAST_API_KEY ? { RENTCAST_API_KEY } : {}),
      ...(GOOGLE_CLIENT_ID ? { GOOGLE_CLIENT_ID } : {}),
      ...(GOOGLE_CLIENT_SECRET ? { GOOGLE_CLIENT_SECRET } : {}),
    },
    WEB_SERVICE_NAME,
  );
  // Daily cron: free pipeline (no OpenAI calls in this run, but env.ts
  // still requires OPENAI_API_KEY at import time, so push it).
  await setEnvVars(
    cronDailyId,
    {
      DATABASE_URL,
      NEXTAUTH_SECRET,
      BRIDGE_SERVER_TOKEN,
      OPENAI_API_KEY,
      ...(WALKSCORE_API_KEY ? { WALKSCORE_API_KEY } : {}),
      ...(RENTCAST_API_KEY ? { RENTCAST_API_KEY } : {}),
    },
    CRON_DAILY_NAME,
  );
  // LLM cron: vision/extract/ai-score/emails-poll. Needs Gmail OAuth
  // creds for the emails-poll stage.
  await setEnvVars(
    cronLlmId,
    {
      DATABASE_URL,
      NEXTAUTH_SECRET,
      BRIDGE_SERVER_TOKEN,
      OPENAI_API_KEY,
      ...(GOOGLE_CLIENT_ID ? { GOOGLE_CLIENT_ID } : {}),
      ...(GOOGLE_CLIENT_SECRET ? { GOOGLE_CLIENT_SECRET } : {}),
    },
    CRON_LLM_NAME,
  );

  // 3. Redeploy.
  await triggerDeploy(webId, WEB_SERVICE_NAME);
  await triggerDeploy(cronDailyId, CRON_DAILY_NAME);
  await triggerDeploy(cronLlmId, CRON_LLM_NAME);

  console.log("\n✓ done.");
  if (!DRY_RUN) {
    console.log(
      "Watch the deploys: https://dashboard.render.com — service tabs auto-update.",
    );
  }
}

main().catch((err) => {
  console.error("\n[render-sync] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
