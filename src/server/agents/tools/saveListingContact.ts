import { z } from "zod";
import { defineTool } from "../base/tools";
import { db } from "@/lib/db";

const inputSchema = z.object({
  mlsId: z.string().min(1),
  agentName: z.string().min(1).optional(),
  agentPhone: z.string().min(1).optional(),
  agentEmail: z.string().email().optional(),
  agentWebsite: z.string().min(1).optional(),
  officeName: z.string().min(1).optional(),
  officePhone: z.string().min(1).optional(),
  officeEmail: z.string().email().optional(),
  officeWebsite: z.string().min(1).optional(),
  // ListingContact has no dedicated column for a DRE/license number or other
  // free-form findings — stash them in `raw` rather than migrate the schema
  // for a field only the chat agent writes today.
  notes: z.string().min(1).optional(),
});

/**
 * save_listing_contact — write broker/office contact details the agent has
 * confirmed (via web search, or grounded Bridge/RentCast data) back onto
 * ListingContact with source "manual". Partial: only the fields provided
 * are overwritten, so a good RentCast value never gets clobbered by a
 * `null` the model didn't actually find.
 */
export const saveListingContactTool = defineTool({
  name: "save_listing_contact",
  description:
    "Save or update a listing's broker/office contact details (name, phone, email, website, DRE/license notes) once you've confirmed them. Only pass the fields you actually confirmed — anything omitted is left as-is. This is what makes the Contact button work for listings PropScore's automated enrichment missed.",
  input: inputSchema,
  run: async ({ mlsId, notes, ...fields }) => {
    const listing = await db.listing.findUnique({ where: { mlsId }, select: { mlsId: true } });
    if (!listing) throw new Error(`No listing found for mlsId ${mlsId}`);

    const providedFields = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined),
    );

    const existing = await db.listingContact.findUnique({ where: { listingMlsId: mlsId } });
    const raw = notes
      ? { ...(existing?.raw as object | undefined), manualNotes: notes }
      : existing?.raw;

    const saved = await db.listingContact.upsert({
      where: { listingMlsId: mlsId },
      create: {
        listingMlsId: mlsId,
        source: "manual",
        ...providedFields,
        raw: raw ?? undefined,
      },
      update: {
        source: "manual",
        ...providedFields,
        raw: raw ?? undefined,
        fetchedAt: new Date(),
      },
    });

    return {
      saved: true,
      listingMlsId: saved.listingMlsId,
      agentName: saved.agentName,
      agentEmail: saved.agentEmail,
      agentPhone: saved.agentPhone,
      officeName: saved.officeName,
    };
  },
});
