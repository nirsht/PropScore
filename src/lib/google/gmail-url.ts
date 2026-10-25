// Deep links into Gmail. Client-safe (no googleapis / db imports) so the
// drawer, the inbox and the tRPC routers all build the same URL.
//
// The `/mail/u/<n>/` segment is a *browser-local* index into whatever Google
// accounts the user happens to be signed into — `u/0` is "whichever account
// signed in first", which is almost never the mailbox a draft actually lives
// in once the user has more than one. Gmail also accepts the mailbox address
// in that slot and resolves it to the right account (and prompts to sign in
// when it isn't signed in there), so we address every link by mailbox
// whenever we know which one owns the draft, and only fall back to `u/0`
// when we don't.
function gmailBase(mailbox?: string | null): string {
  const address = mailbox?.trim();
  const segment = address ? encodeURIComponent(address) : "0";
  return `https://mail.google.com/mail/u/${segment}`;
}

export function gmailDraftUrl(draftId: string, mailbox?: string | null): string {
  return `${gmailBase(mailbox)}/#drafts?compose=${draftId}`;
}

export function gmailThreadUrl(threadId: string, mailbox?: string | null): string {
  return `${gmailBase(mailbox)}/#all/${threadId}`;
}
