import { google, type gmail_v1 } from "googleapis";
import { db } from "../db";
import { env } from "../env";

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

// Token refresh slack — refresh 60s before the access_token actually expires
// so concurrent calls don't race the expiry boundary.
const REFRESH_SLACK_MS = 60_000;

export class GmailNotConnectedError extends Error {
  constructor(userId: string) {
    super(`User ${userId} has no Google account linked`);
    this.name = "GmailNotConnectedError";
  }
}

export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailAuthError";
  }
}

function buildOAuthClient(): OAuth2Client {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new GmailAuthError("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set");
  }
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
}

async function getOAuthClientForUser(userId: string): Promise<OAuth2Client> {
  const account = await db.account.findFirst({
    where: { userId, provider: "google" },
  });
  if (!account) throw new GmailNotConnectedError(userId);
  if (!account.refresh_token) {
    throw new GmailAuthError(
      "Google account is linked but has no refresh_token. Disconnect and reconnect Gmail to grant offline access.",
    );
  }

  const client = buildOAuthClient();
  client.setCredentials({
    access_token: account.access_token ?? undefined,
    refresh_token: account.refresh_token,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
    scope: account.scope ?? undefined,
    token_type: account.token_type ?? undefined,
  });

  const expiresAtMs = account.expires_at ? account.expires_at * 1000 : 0;
  const needsRefresh = !expiresAtMs || expiresAtMs - REFRESH_SLACK_MS < Date.now();
  if (needsRefresh) {
    const { credentials } = await client.refreshAccessToken();
    await db.account.update({
      where: { id: account.id },
      data: {
        access_token: credentials.access_token ?? account.access_token,
        expires_at: credentials.expiry_date
          ? Math.floor(credentials.expiry_date / 1000)
          : account.expires_at,
        token_type: credentials.token_type ?? account.token_type,
        // refresh_token is rotated only when Google issues a new one
        refresh_token: credentials.refresh_token ?? account.refresh_token,
        scope: credentials.scope ?? account.scope,
        id_token: credentials.id_token ?? account.id_token,
      },
    });
  }

  return client;
}

export async function getGmailClient(userId: string): Promise<gmail_v1.Gmail> {
  const auth = await getOAuthClientForUser(userId);
  return google.gmail({ version: "v1", auth });
}

function isGoogleAuthError(err: unknown): boolean {
  if (err instanceof GmailNotConnectedError) return true;
  if (err instanceof GmailAuthError) return true;
  // googleapis errors expose `code`/`status`; refresh failures from
  // gtoken expose `response.status`. Treat 401/403 as "not connected"
  // so a stale/revoked token surfaces as a Connect-Gmail prompt
  // instead of a 500.
  const candidate = err as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  const code = candidate?.code ?? candidate?.status ?? candidate?.response?.status;
  return code === 401 || code === 403;
}

export async function getConnectedEmail(userId: string): Promise<string | null> {
  try {
    const gmail = await getGmailClient(userId);
    const profile = await gmail.users.getProfile({ userId: "me" });
    return profile.data.emailAddress ?? null;
  } catch (err) {
    if (isGoogleAuthError(err)) return null;
    throw err;
  }
}

// RFC-2822 message construction. base64url per Gmail API requirements.
function encodeRfc2822({
  to,
  from,
  subject,
  body,
}: {
  to: string;
  from?: string;
  subject: string;
  body: string;
}): string {
  const headers = [
    `To: ${to}`,
    from ? `From: ${from}` : null,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
  ].filter(Boolean);
  const message = `${headers.join("\r\n")}\r\n\r\n${body}`;
  return Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function createDraft(params: {
  userId: string;
  to: string;
  subject: string;
  body: string;
}): Promise<{ gmailDraftId: string; gmailThreadId: string }> {
  const gmail = await getGmailClient(params.userId);
  const raw = encodeRfc2822({
    to: params.to,
    subject: params.subject,
    body: params.body,
  });
  const draft = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw } },
  });
  const draftId = draft.data.id;
  const threadId = draft.data.message?.threadId;
  if (!draftId || !threadId) {
    throw new GmailAuthError("Gmail did not return draft id / thread id");
  }
  return { gmailDraftId: draftId, gmailThreadId: threadId };
}

export function gmailDraftUrl(draftId: string): string {
  return `https://mail.google.com/mail/u/0/#drafts?compose=${draftId}`;
}

export function gmailThreadUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${threadId}`;
}

// --- Reply polling helpers ---------------------------------------------------

export type GmailHeader = { name?: string | null; value?: string | null };

export function headerValue(headers: GmailHeader[] | undefined, name: string): string | null {
  if (!headers) return null;
  const lower = name.toLowerCase();
  for (const h of headers) {
    if (h.name?.toLowerCase() === lower) return h.value ?? null;
  }
  return null;
}

export function parseFromAddress(from: string | null): string | null {
  if (!from) return null;
  // "Name <addr@x.com>" or "addr@x.com"
  const angle = from.match(/<([^>]+)>/);
  if (angle?.[1]) return angle[1].trim().toLowerCase();
  return from.trim().toLowerCase();
}

export function decodeBodyPart(data: string | null | undefined): string | null {
  if (!data) return null;
  // Gmail uses base64url
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export type ExtractedPart = {
  bodyText: string | null;
  attachments: Array<{
    filename: string;
    mimeType: string;
    size: number;
    gmailAttachmentId: string;
  }>;
};

// Walks a Gmail MessagePart tree, concatenating text/plain parts and listing
// attachments. Falls back to text/html (stripped) if no plain text exists.
export function extractMessageContent(payload: gmail_v1.Schema$MessagePart | undefined): ExtractedPart {
  const out: ExtractedPart = { bodyText: null, attachments: [] };
  if (!payload) return out;

  const plainChunks: string[] = [];
  const htmlChunks: string[] = [];

  function walk(part: gmail_v1.Schema$MessagePart) {
    const mime = part.mimeType ?? "";
    const filename = part.filename ?? "";
    const attachmentId = part.body?.attachmentId ?? null;
    if (filename && attachmentId) {
      out.attachments.push({
        filename,
        mimeType: mime,
        size: part.body?.size ?? 0,
        gmailAttachmentId: attachmentId,
      });
      return;
    }
    if (mime === "text/plain") {
      const txt = decodeBodyPart(part.body?.data);
      if (txt) plainChunks.push(txt);
    } else if (mime === "text/html") {
      const html = decodeBodyPart(part.body?.data);
      if (html) htmlChunks.push(html);
    }
    for (const sub of part.parts ?? []) walk(sub);
  }

  walk(payload);

  if (plainChunks.length > 0) {
    out.bodyText = plainChunks.join("\n").trim();
  } else if (htmlChunks.length > 0) {
    // Cheap HTML strip — good enough for parser context; full fidelity lives
    // in Gmail itself.
    out.bodyText = htmlChunks
      .join("\n")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return out;
}

export async function listThreadMessages(
  userId: string,
  threadId: string,
): Promise<gmail_v1.Schema$Message[]> {
  const gmail = await getGmailClient(userId);
  const thread = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });
  return thread.data.messages ?? [];
}

export async function getAttachment(
  userId: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const gmail = await getGmailClient(userId);
  const att = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });
  const data = att.data.data;
  if (!data) throw new GmailAuthError("Gmail returned attachment with no data");
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export async function draftExists(userId: string, draftId: string): Promise<boolean> {
  try {
    const gmail = await getGmailClient(userId);
    await gmail.users.drafts.get({ userId: "me", id: draftId });
    return true;
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 404) return false;
    throw err;
  }
}
