// Outbound email copy for rent-roll outreach. Phase 1 ships a single template;
// the auto-trigger and the manual ContactCard button both go through here so
// any future copy edits land everywhere at once.

export type RentRollEmailInput = {
  listingAddress: string;
  agentName?: string | null;
  userName?: string | null;
};

export type RentRollEmail = {
  subject: string;
  body: string;
};

function firstName(full?: string | null): string | null {
  if (!full) return null;
  const trimmed = full.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

export function rentRollRequestEmail(input: RentRollEmailInput): RentRollEmail {
  const agentFirst = firstName(input.agentName);
  const userFirst = firstName(input.userName);
  const greeting = agentFirst ? `Hi ${agentFirst},` : "Hi there,";
  const signoff = userFirst ? `Thanks,\n${userFirst}` : "Thanks";

  const subject = `${input.listingAddress} — interested, rent roll?`;
  const body = [
    greeting,
    "",
    `Saw your ${input.listingAddress} listing — looks like a strong building. Could you please share the rent roll, including move-in date and sqft for each unit?`,
    "",
    "Happy to move quickly with a strong offer if the numbers work.",
    "",
    signoff,
  ].join("\n");

  return { subject, body };
}
