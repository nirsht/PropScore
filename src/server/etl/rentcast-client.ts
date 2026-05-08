import { env } from "@/lib/env";

/**
 * RentCast sale-listings client. We only call the address-lookup endpoint;
 * the response carries `listingAgent` + `listingOffice` objects with
 * `{ name, phone, email, website }` — the fields Bridge `sfar` strips under
 * IDX policy.
 *
 * Docs: https://developers.rentcast.io/reference/property-listings-schema
 *
 * Auth:    `X-Api-Key: <token>` header
 * Limits:  plan-dependent (free 50/mo, Foundation 1k/mo). We throttle to
 *          5 req/s which is well under the per-second ceiling on every tier.
 */

const THROTTLE_MIN_INTERVAL_MS = 200; // ≤ 5 req/s
const MAX_RETRIES = 4;

export type RentCastContact = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
};

export type RentCastSaleListing = {
  id?: string;
  formattedAddress?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  status?: string;
  listingAgent?: RentCastContact | null;
  listingOffice?: RentCastContact | null;
  // Catch-all so we can persist the raw blob without losing fields.
  [key: string]: unknown;
};

let lastRequestAt = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + THROTTLE_MIN_INTERVAL_MS - now);
  lastRequestAt = now + wait;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function request<T>(url: string, attempt = 0): Promise<T | null> {
  if (!env.RENTCAST_API_KEY) return null;
  await throttle();

  const res = await fetch(url, {
    headers: {
      "X-Api-Key": env.RENTCAST_API_KEY,
      Accept: "application/json",
    },
  });

  // 404 = no listing matched — treat as a miss, not an error.
  if (res.status === 404) return null;

  if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
    if (attempt >= MAX_RETRIES) {
      throw new Error(
        `RentCast ${res.status} after ${attempt} retries: ${await res.text()}`,
      );
    }
    const retryAfter = Number(res.headers.get("Retry-After"));
    const delay =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(30_000, 2 ** attempt * 500);
    await new Promise((r) => setTimeout(r, delay));
    return request<T>(url, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`RentCast ${res.status} ${res.statusText}: ${await res.text()}`);
  }

  return (await res.json()) as T;
}

/**
 * Look up the active sale listing for a given address. Returns the first
 * match (RentCast occasionally returns variants for unit-numbered addresses);
 * `null` if RentCast has no record.
 *
 * The API accepts a single `address` query param and is forgiving about
 * format — we pass the full one-line address (street + city + state + zip).
 */
export async function lookupSaleListingByAddress(
  fullAddress: string,
): Promise<RentCastSaleListing | null> {
  if (!fullAddress.trim()) return null;
  const params = new URLSearchParams({ address: fullAddress, limit: "1" });
  const url = `${env.RENTCAST_BASE_URL}/listings/sale?${params.toString()}`;
  const data = await request<RentCastSaleListing[] | RentCastSaleListing>(url);
  if (!data) return null;
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}
