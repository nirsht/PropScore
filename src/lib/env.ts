import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3020),

  DATABASE_URL: z.string().url(),
  SHADOW_DATABASE_URL: z.string().url().optional().or(z.literal("")),

  BRIDGE_SERVER_TOKEN: z.string().min(1),
  BRIDGE_DATASET: z.string().min(1).default("sfar"),
  BRIDGE_BASE_URL: z.string().url().default("https://api.bridgedataoutput.com/api/v2/OData"),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-4o-2024-11-20"),

  // Optional. Populates Listing.walkScore via the Walk Score API. When
  // missing, walkscore-client.ts short-circuits with null and the Location
  // Rating card falls back to the neighborhood-safety component only.
  WALKSCORE_API_KEY: z.string().optional().or(z.literal("")),

  // Web/auth-only — consumed solely by src/lib/auth.ts. ETL & CLI scripts
  // import this module transitively (etl-sync → bridge-client → env) but never
  // authenticate a user, so hard-requiring it here crashed every cron run that
  // legitimately lacks the secret. Optional at parse time; auth.ts hard-fails
  // the web server when it's missing (see requireAuthSecret there), so the web
  // app is no less strict than before.
  NEXTAUTH_SECRET: z.string().min(16).optional(),
  // Render auto-injects RENDER_EXTERNAL_URL. Locally we fall back to
  // localhost:3020. Setting NEXTAUTH_URL explicitly is rarely needed.
  NEXTAUTH_URL: z
    .string()
    .url()
    .optional(),
  RENDER_EXTERNAL_URL: z.string().url().optional(),

  NEXT_PUBLIC_MAP_STYLE_URL: z.string().optional().or(z.literal("")),

  // Chat — Tavily web search. Optional in dev: web_search tool errors
  // explicitly when called without a key.
  TAVILY_API_KEY: z.string().optional().or(z.literal("")),

  // RentCast — fills agent + brokerage phone/email by address. Bridge `sfar`
  // (IDX) strips contact fields, so this is the enrichment source until/
  // unless we get a Bridge VOW feed approved. Free tier 50 req/mo at
  // https://www.rentcast.io/api. When the key is missing, contact-enrichment
  // no-ops and the drawer's "Listed by" / Brokerage rows stay blank.
  RENTCAST_API_KEY: z.string().optional().or(z.literal("")),
  RENTCAST_BASE_URL: z
    .string()
    .url()
    .default("https://api.rentcast.io/v1"),

  // Gmail integration — per-user OAuth via NextAuth Google provider.
  // Tokens land in the existing Account table. Used for creating
  // rent-roll request drafts and polling agent replies.
  GOOGLE_CLIENT_ID: z.string().optional().or(z.literal("")),
  GOOGLE_CLIENT_SECRET: z.string().optional().or(z.literal("")),

  // Phase-2 rent-roll parser (separate from OPENAI_MODEL so we don't
  // disturb other extraction paths). gpt-5-mini by default — the full gpt-5
  // was ~8× the per-token cost for a marginal quality gain on this
  // structured-extraction task. Override to gpt-5 per environment if a
  // specific inbox needs the stronger model.
  OPENAI_RENT_ROLL_MODEL: z.string().min(1).default("gpt-5-mini"),

  // Bulk-draft button threshold: drafts are created for active listings
  // with price/sqft below this value. Dedup is enforced at the DB layer
  // via the EmailThread (userId, listingMlsId) unique constraint.
  EMAIL_AUTO_PRICE_PER_SQFT: z.coerce.number().positive().default(450),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("\n❌ Invalid environment variables:\n", parsed.error.flatten().fieldErrors);
  throw new Error(
    "Environment validation failed. Copy .env.example to .env and fill in the required values.",
  );
}

export const env = {
  ...parsed.data,
  NEXTAUTH_URL:
    parsed.data.NEXTAUTH_URL ??
    parsed.data.RENDER_EXTERNAL_URL ??
    `http://localhost:${parsed.data.PORT}`,
};
export type Env = typeof env;
