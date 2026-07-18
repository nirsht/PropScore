import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { buildConnectOAuthClient, verifyState } from "@/lib/google/gmail-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function backToEmails(status: "connected" | "error"): Response {
  const url = new URL("/emails", env.NEXTAUTH_URL);
  url.searchParams.set("gmail", status);
  return Response.redirect(url.toString(), 302);
}

// Completes the standalone Gmail connect flow: exchange the auth code for
// tokens and park them on the current user's Account row. Swap semantics —
// any prior Google account on this user (or any orphan row holding the same
// Google identity) is replaced, so "disconnect + connect a different mailbox"
// just works and no duplicate users are ever created.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const stateUserId = verifyState(searchParams.get("state"));

  if (searchParams.get("error") || !code || !stateUserId) {
    return backToEmails("error");
  }

  // Re-check the live session and ensure it matches the user that started the
  // flow — prevents stapling a mailbox onto the wrong account if the session
  // changed mid-flow.
  const session = await auth();
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id;
  if (!sessionUserId || sessionUserId !== stateUserId) {
    return backToEmails("error");
  }
  const userId = sessionUserId;

  try {
    const client = buildConnectOAuthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) return backToEmails("error");

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.GOOGLE_CLIENT_ID || undefined,
    });
    const providerAccountId = ticket.getPayload()?.sub;
    if (!providerAccountId) return backToEmails("error");

    await db.$transaction([
      // Clear this user's existing mailbox and reclaim this Google identity if
      // it's dangling on some other (orphan) row.
      db.account.deleteMany({
        where: {
          provider: "google",
          OR: [{ userId }, { providerAccountId }],
        },
      }),
      db.account.create({
        data: {
          userId,
          type: "oauth",
          provider: "google",
          providerAccountId,
          access_token: tokens.access_token ?? null,
          refresh_token: tokens.refresh_token ?? null,
          expires_at: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null,
          token_type: tokens.token_type ?? null,
          scope: tokens.scope ?? null,
          id_token: tokens.id_token ?? null,
        },
      }),
    ]);

    return backToEmails("connected");
  } catch {
    return backToEmails("error");
  }
}
