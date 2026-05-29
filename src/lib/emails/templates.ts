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

const SUFFIX_ALT =
  "St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Rd|Road|Dr(?:ive)?|Ln|Lane|Way|Wy|Ct|Court|Pl(?:ace)?|Ter(?:race)?|Cir(?:cle)?|Pkwy|Parkway|Hwy|Highway|Aly|Alley|Row|Pk|Park";

const SHORT_SUFFIX: Record<string, string> = {
  ST: "St", STREET: "St",
  AVE: "Ave", AVENUE: "Ave",
  BLVD: "Blvd", BOULEVARD: "Blvd",
  RD: "Rd", ROAD: "Rd",
  DR: "Dr", DRIVE: "Dr",
  LN: "Ln", LANE: "Ln",
  WAY: "Way", WY: "Way",
  CT: "Ct", COURT: "Ct",
  PL: "Pl", PLACE: "Pl",
  TER: "Ter", TERRACE: "Ter",
  CIR: "Cir", CIRCLE: "Cir",
  PKWY: "Pkwy", PARKWAY: "Pkwy",
  HWY: "Hwy", HIGHWAY: "Hwy",
  ALY: "Aly", ALLEY: "Aly",
  ROW: "Row",
  PK: "Pk", PARK: "Pk",
};

function shortSuffix(raw: string): string {
  const key = raw.replace(/\./g, "").toUpperCase();
  return SHORT_SUFFIX[key] ?? raw;
}

// Splits "120 Dolores St, San Francisco, CA 94110" into its components,
// preserving the original street-name casing. Returns nulls for anything
// the regex can't pull out (e.g. a name-only address).
function parseStreet(address: string): {
  number: string | null;
  name: string | null;
  suffix: string | null;
} {
  const beforeComma = address.split(",")[0]?.trim() ?? "";
  const m = beforeComma.match(
    new RegExp(`^(\\d+(?:-\\d+)?)\\s+(.+?)(?:\\s+(${SUFFIX_ALT})\\.?)?$`, "i"),
  );
  if (!m) return { number: null, name: beforeComma || null, suffix: null };
  return {
    number: m[1] ?? null,
    name: m[2]?.trim() ?? null,
    suffix: m[3] ?? null,
  };
}

export function rentRollRequestEmail(input: RentRollEmailInput): RentRollEmail {
  const agentFirst = firstName(input.agentName);
  const userFirst = firstName(input.userName);
  const greeting = agentFirst ? `Hi ${agentFirst},` : "Hi there,";
  const signoff = userFirst ? `Thanks,\n${userFirst}` : "Thanks,";

  const { number, name, suffix } = parseStreet(input.listingAddress);
  const streetWithSuffix = name
    ? suffix
      ? `${name} ${shortSuffix(suffix)}.`
      : name
    : input.listingAddress;
  const numberAndName =
    number && name ? `${number} ${name}` : (name ?? input.listingAddress);

  const subject = `Listing at ${streetWithSuffix}`;
  const body = [
    greeting,
    "",
    `I really like the listing at ${numberAndName}.`,
    "",
    "Could I please get a copy of the rent roll and OM if you have them?",
    "",
    signoff,
  ].join("\n");

  return { subject, body };
}
