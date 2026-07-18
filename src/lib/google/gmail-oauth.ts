import crypto from "node:crypto";
import { google } from "googleapis";
import { env } from "../env";

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

// Gmail scopes for the rent-roll outreach feature.
//   gmail.compose  → create drafts (never sends, per product decision)
//   gmail.modify   → read message threads + apply labels for reply tracking
// openid/email/profile let us read the connected mailbox's identity for the
// providerAccountId + the "connected as" label.
export const GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
];

// Fixed callback path for the standalone mailbox-connect flow. Must be
// registered in the Google console's Authorized redirect URIs for every host
// (localhost, onrender, custom domain). We build the absolute URL from
// NEXTAUTH_URL so it matches the console entry exactly.
export const GMAIL_CALLBACK_PATH = "/api/gmail/callback";

export function gmailRedirectUri(): string {
  return `${env.NEXTAUTH_URL.replace(/\/$/, "")}${GMAIL_CALLBACK_PATH}`;
}

export function buildConnectOAuthClient(): OAuth2Client {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set");
  }
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    gmailRedirectUri(),
  );
}

// --- OAuth state: HMAC-signed so the callback can trust the userId that
// initiated the flow without a server-side store. ---------------------------

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function stateSecret(): string {
  const secret = env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required to sign the Gmail OAuth state");
  }
  return secret;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function signState(userId: string): string {
  const payload = b64url(JSON.stringify({ userId, ts: Date.now() }));
  const sig = b64url(
    crypto.createHmac("sha256", stateSecret()).update(payload).digest(),
  );
  return `${payload}.${sig}`;
}

export function verifyState(state: string | null): string | null {
  if (!state) return null;
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;

  const expected = b64url(
    crypto.createHmac("sha256", stateSecret()).update(payload).digest(),
  );
  // Constant-time compare; bail if lengths differ (timingSafeEqual throws).
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  try {
    const { userId, ts } = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { userId?: string; ts?: number };
    if (!userId || typeof ts !== "number") return null;
    if (Date.now() - ts > STATE_TTL_MS) return null;
    return userId;
  } catch {
    return null;
  }
}
