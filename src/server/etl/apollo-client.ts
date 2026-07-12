import { env } from "@/lib/env";

/**
 * Apollo People-Match client — the last resort in the contact-enrichment
 * chain (Bridge → LLM agent → Apollo). We match a listing agent by name +
 * brokerage and read back their email. Phone numbers on Apollo are
 * credit-gated and revealed asynchronously via a webhook we don't run, so
 * this client is deliberately email-only — we never pass `reveal_phone_number`.
 *
 * Docs: https://docs.apollo.io/reference/people-enrichment
 *
 * Auth:    `X-Api-Key: <token>` header
 * Limits:  plan-dependent. We throttle to 5 req/s, well under every tier.
 */

const THROTTLE_MIN_INTERVAL_MS = 200; // ≤ 5 req/s
const MAX_RETRIES = 4;

/** Apollo returns this sentinel address when an email exists but isn't unlocked. */
const LOCKED_EMAIL = "email_not_unlocked@domain.com";

export type ApolloContact = {
  agentName: string | null;
  agentEmail: string | null;
  agentPhone: string | null;
  officeName: string | null;
  officePhone: string | null;
};

type ApolloPerson = {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone_numbers?: Array<{ raw_number?: string | null; sanitized_number?: string | null }> | null;
  organization?: { name?: string | null; phone?: string | null } | null;
};

type ApolloMatchResponse = { person?: ApolloPerson | null };

let lastRequestAt = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + THROTTLE_MIN_INTERVAL_MS - now);
  lastRequestAt = now + wait;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function request<T>(
  url: string,
  body: Record<string, unknown>,
  attempt = 0,
): Promise<T | null> {
  if (!env.APOLLO_API_KEY) return null;
  await throttle();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Api-Key": env.APOLLO_API_KEY,
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  // 404 = no person matched — treat as a miss, not an error.
  if (res.status === 404) return null;

  if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
    if (attempt >= MAX_RETRIES) {
      throw new Error(
        `Apollo ${res.status} after ${attempt} retries: ${await res.text()}`,
      );
    }
    const retryAfter = Number(res.headers.get("Retry-After"));
    const delay =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(30_000, 2 ** attempt * 500);
    await new Promise((r) => setTimeout(r, delay));
    return request<T>(url, body, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`Apollo ${res.status} ${res.statusText}: ${await res.text()}`);
  }

  return (await res.json()) as T;
}

function cleanEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  if (!trimmed || trimmed.toLowerCase() === LOCKED_EMAIL) return null;
  return trimmed;
}

/**
 * Match a listing agent by name + brokerage and return their email (plus any
 * phone/office fields Apollo returns synchronously — no async reveal). Returns
 * `null` when the key is missing, Apollo has no match, or the match carries
 * no usable email.
 */
export async function lookupAgentContact(params: {
  firstName?: string | null;
  lastName?: string | null;
  organizationName?: string | null;
}): Promise<ApolloContact | null> {
  const firstName = params.firstName?.trim();
  const lastName = params.lastName?.trim();
  if (!firstName && !lastName) return null;

  const body: Record<string, unknown> = {
    first_name: firstName,
    last_name: lastName,
    reveal_personal_emails: true,
  };
  const org = params.organizationName?.trim();
  if (org) body.organization_name = org;

  const url = `${env.APOLLO_BASE_URL}/people/match`;
  const data = await request<ApolloMatchResponse>(url, body);
  const person = data?.person;
  if (!person) return null;

  const agentEmail = cleanEmail(person.email);
  const phone = person.phone_numbers?.find(
    (p) => p.sanitized_number || p.raw_number,
  );
  const agentPhone = phone?.sanitized_number ?? phone?.raw_number ?? null;
  const officeName = person.organization?.name?.trim() || null;
  const officePhone = person.organization?.phone?.trim() || null;

  // No usable email and no phone → nothing worth persisting from Apollo.
  if (!agentEmail && !agentPhone) return null;

  return {
    agentName: person.name?.trim() || null,
    agentEmail,
    agentPhone,
    officeName,
    officePhone,
  };
}
