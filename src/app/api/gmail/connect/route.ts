import { auth } from "@/lib/auth";
import {
  buildConnectOAuthClient,
  GMAIL_SCOPES,
  signState,
} from "@/lib/google/gmail-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Starts the standalone Gmail mailbox-connect flow. This is intentionally NOT
// a NextAuth sign-in: the connected mailbox is an attachment on the currently
// logged-in user, not a login identity. The user stays whoever they signed in
// as (Credentials); we just park Google tokens on their Account row so the
// rent-roll outreach feature can send/read mail.
export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return new Response("Not authenticated", { status: 401 });
  }

  const client = buildConnectOAuthClient();
  const url = client.generateAuthUrl({
    access_type: "offline",
    // Force the consent screen so Google always returns a refresh_token, even
    // if this Google account was previously authorized.
    prompt: "consent",
    scope: GMAIL_SCOPES,
    state: signState(userId),
  });

  return Response.redirect(url, 302);
}
