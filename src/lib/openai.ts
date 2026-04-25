import OpenAI from "openai";
import { env } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var __propscoreOpenAI: OpenAI | undefined;
}

export const openai: OpenAI =
  globalThis.__propscoreOpenAI ??
  new OpenAI({
    apiKey: env.OPENAI_API_KEY,
  });

if (env.NODE_ENV !== "production") {
  globalThis.__propscoreOpenAI = openai;
}

export const OPENAI_MODEL = env.OPENAI_MODEL;
