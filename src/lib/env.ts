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

  NEXTAUTH_SECRET: z.string().min(16),
  NEXTAUTH_URL: z.string().url().default("http://localhost:3020"),

  NEXT_PUBLIC_MAP_STYLE_URL: z.string().optional().or(z.literal("")),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("\n❌ Invalid environment variables:\n", parsed.error.flatten().fieldErrors);
  throw new Error(
    "Environment validation failed. Copy .env.example to .env and fill in the required values.",
  );
}

export const env = parsed.data;
export type Env = typeof env;
