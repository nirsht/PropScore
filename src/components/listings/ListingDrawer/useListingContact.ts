import { strField } from "./fieldGuards";

type Contact = {
  agentName?: string | null;
  agentPhone?: string | null;
  agentEmail?: string | null;
  officeName?: string | null;
  officePhone?: string | null;
  officeEmail?: string | null;
};

export type ListingContactFields = {
  agentName: string | null;
  agentPhone: string | null;
  agentEmail: string | null;
  coAgentName: string | null;
  coAgentPhone: string | null;
  coAgentEmail: string | null;
  officeName: string | null;
  officePhone: string | null;
  officeEmail: string | null;
};

/**
 * Bridge `sfar` (IDX) strips agent phone/email, so on its own these reads
 * would all be null. The RentCast enrichment layer
 * (`scripts/enrich-contacts.ts` → `ListingContact`) fills them in by
 * address; we still fall back to `raw.*` so a future Bridge VOW feed
 * upgrade lights up the same UI without any drawer changes.
 *
 * RentCast doesn't expose a co-listing-agent field. Co-agent contact stays
 * Bridge-only until/unless we upgrade to a VOW feed.
 */
export function useListingContact(
  contact: Contact | null | undefined,
  raw: Record<string, unknown>,
): ListingContactFields {
  return {
    agentName: contact?.agentName ?? strField(raw.ListAgentFullName),
    agentPhone:
      contact?.agentPhone ??
      strField(raw.ListAgentDirectPhone) ??
      strField(raw.ListAgentOfficePhone),
    agentEmail: contact?.agentEmail ?? strField(raw.ListAgentEmail),

    coAgentName: strField(raw.CoListAgentFullName),
    coAgentPhone: strField(raw.CoListAgentDirectPhone),
    coAgentEmail: strField(raw.CoListAgentEmail),

    officeName: contact?.officeName ?? strField(raw.ListOfficeName),
    officePhone: contact?.officePhone ?? strField(raw.ListOfficePhone),
    officeEmail: contact?.officeEmail ?? null,
  };
}
