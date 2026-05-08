/**
 * Walk Score API client. Free tier = 5,000 calls/day. Used by
 * `scripts/refresh-walkscore.ts` to populate Listing.walkScore for the
 * Location Rating card.
 *
 * The key is optional: when `WALKSCORE_API_KEY` is unset the client returns
 * null and the caller skips persistence. This lets dev/CI boot without a
 * key and degrades the Location Rating to its neighborhood-only fallback.
 *
 * Walk Score's free endpoint:
 *   https://api.walkscore.com/score?format=json&address=...&lat=...&lon=...&wsapikey=KEY
 *
 * Response status codes (per their docs):
 *   1  = success
 *   2  = score being calculated, retry later
 *   30 = invalid lat/lng
 *   31 = invalid API key
 *   40 = quota exceeded
 *   41 = ip blocked
 *   42 = referer blocked
 */

import { env } from "@/lib/env";

const BASE_URL = "https://api.walkscore.com/score";

export type WalkScoreResult = {
  walkScore: number;
};

export type WalkScoreFetchOutcome =
  | { ok: true; data: WalkScoreResult }
  | { ok: false; reason: "no_key" | "calculating" | "quota" | "rate_limit" | "invalid" | "error"; status?: number };

export async function fetchWalkScore(args: {
  lat: number;
  lng: number;
  address: string;
}): Promise<WalkScoreFetchOutcome> {
  const apiKey = env.WALKSCORE_API_KEY;
  if (!apiKey) return { ok: false, reason: "no_key" };

  const url =
    `${BASE_URL}?` +
    new URLSearchParams({
      format: "json",
      address: args.address,
      lat: String(args.lat),
      lon: String(args.lng),
      wsapikey: apiKey,
    }).toString();

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 429) return { ok: false, reason: "rate_limit", status: 429 };
  if (!res.ok) return { ok: false, reason: "error", status: res.status };

  const body = (await res.json()) as { status?: number; walkscore?: number };
  switch (body.status) {
    case 1: {
      if (typeof body.walkscore !== "number") {
        return { ok: false, reason: "error", status: res.status };
      }
      return { ok: true, data: { walkScore: Math.round(body.walkscore) } };
    }
    case 2:
      return { ok: false, reason: "calculating", status: body.status };
    case 40:
      return { ok: false, reason: "quota", status: body.status };
    case 30:
    case 31:
      return { ok: false, reason: "invalid", status: body.status };
    default:
      return { ok: false, reason: "error", status: body.status };
  }
}
