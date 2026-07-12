import { db } from "@/lib/db";

/**
 * Build the per-asset chat system prompt. Pulls the listing's full record
 * (including score + last few enrichments) and renders a slim JSON the
 * model can ground all answers in. Photo URLs from the listing's Bridge
 * Media payload are listed so the model can reference specific images.
 */
export async function buildChatAssetSystemPrompt(mlsId: string): Promise<string> {
  const listing = await db.listing.findUnique({
    where: { mlsId },
    include: {
      score: true,
      contact: true,
      enrichments: { orderBy: { createdAt: "desc" }, take: 6 },
    },
  });
  if (!listing) {
    return `You are a real-estate research assistant. The user asked about MLS ${mlsId} but it could not be found in the database. Tell them and offer to help with a different listing.`;
  }

  const photos = extractPhotoUrls(listing.raw);

  const slim = {
    mlsId: listing.mlsId,
    address: listing.address,
    city: listing.city,
    state: listing.state,
    postalCode: listing.postalCode,
    propertyType: listing.propertyType,
    status: listing.status,
    price: listing.price,
    // Live DOM from postDate — Bridge's snapshot is unreliable.
    daysOnMls: listing.postDate
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - listing.postDate.getTime()) / (1000 * 60 * 60 * 24),
          ),
        )
      : null,
    postDate: listing.postDate,

    sqft: listing.sqft,
    lotSizeSqft: listing.lotSizeSqft,
    units: listing.units,
    beds: listing.beds,
    baths: listing.baths,
    yearBuilt: listing.yearBuilt,
    stories: listing.stories,
    occupancy: listing.occupancy,

    blockLot: listing.blockLot,
    assessor: {
      buildingSqft: listing.assessorBuildingSqft,
      lotSqft: listing.assessorLotSqft,
      yearBuilt: listing.assessorYearBuilt,
      stories: listing.assessorStories,
      units: listing.assessorUnits,
      rooms: listing.assessorRooms,
      bedrooms: listing.assessorBedrooms,
      bathrooms: listing.assessorBathrooms,
      useType: listing.assessorUseType,
      buildingValue: listing.assessorBuildingValue,
      landValue: listing.assessorLandValue,
    },

    aiVision: {
      stories: listing.aiStories,
      hasBasement: listing.aiHasBasement,
      hasPenthouse: listing.aiHasPenthouse,
      renovationLevel: listing.renovationLevel,
      renovationConfidence: listing.renovationConfidence,
    },

    aiExtract: {
      unitMix: listing.extractedUnitMix,
      rentRoll: listing.extractedRentRoll,
      totalMonthlyRent: listing.extractedTotalMonthlyRent,
      occupancy: listing.extractedOccupancy,
      aiRentEstimate: listing.aiRentEstimate,
      postRenovationRentEstimate: listing.postRenovationRentEstimate,
      recentCapex: listing.recentCapex,
      detachedAduScore: listing.detachedAduScore,
      detachedAduRationale: listing.detachedAduRationale,
      attachedAduScore: listing.attachedAduScore,
      attachedAduRationale: listing.attachedAduRationale,
      convertedAduScore: listing.convertedAduScore,
      convertedAduRationale: listing.convertedAduRationale,
      convertedAduSource: listing.convertedAduSource,
    },

    score: listing.score
      ? {
          density: listing.score.densityScore,
          vacancy: listing.score.vacancyScore,
          motivation: listing.score.motivationScore,
          valueAddWeightedAvg: listing.score.valueAddWeightedAvg,
          source: listing.score.computedBy,
          breakdown: listing.score.breakdown,
        }
      : null,

    publicRemarks: (listing.raw as { PublicRemarks?: string }).PublicRemarks ?? null,
    privateRemarks: (listing.raw as { PrivateRemarks?: string }).PrivateRemarks ?? null,

    recentEnrichments: listing.enrichments.map((e) => ({
      agentName: e.agentName,
      createdAt: e.createdAt,
    })),

    // Broker/agent contact grounding — Bridge's own listing fields (name/MLS
    // ID only, no phone/email under IDX policy) plus whatever the enrichment
    // chain (Bridge raw → LLM agent → Apollo) or a prior manual save has put on
    // ListingContact. Give the model this before it ever reaches for web_search.
    bridgeAgent: extractBridgeAgentFields(listing.raw),
    contact: listing.contact
      ? {
          source: listing.contact.source,
          fetchedAt: listing.contact.fetchedAt,
          agentName: listing.contact.agentName,
          agentPhone: listing.contact.agentPhone,
          agentEmail: listing.contact.agentEmail,
          agentWebsite: listing.contact.agentWebsite,
          officeName: listing.contact.officeName,
          officePhone: listing.contact.officePhone,
          officeEmail: listing.contact.officeEmail,
          officeWebsite: listing.contact.officeWebsite,
        }
      : null,
  };

  return [
    "You are PropScore's per-asset chat assistant. The user is looking at one MLS listing and is asking questions about it.",
    "",
    "GROUNDING RULES:",
    "- Always ground answers in the listing data below. If a value isn't there, say so plainly — don't invent.",
    "- For rent, comp, parcel, or scoring questions, prefer calling the matching tool over guessing.",
    "- For broker/agent contact questions: start from `bridgeAgent` and `contact` in the listing data below — Bridge provides the agent/office name and MLS ID, and the enrichment chain (Bridge raw → LLM agent → Apollo) fills phone/email onto `contact` when it can. Only call web_search to fill in what's genuinely missing (e.g. DRE license number, an email the chain missed), and make the query specific — agent name + office/brokerage name, not a blind search. Call find_listings_by_agent to list the agent's other active Bridge listings instead of guessing. If you find contact details that are new or better than what's on file, call save_listing_contact so the app remembers them for next time — tell the user you saved it.",
    "- Cite the listing as [mls:" + listing.mlsId + "] when you reference it specifically.",
    "- For follow-on numerical work (cap rate, GRM, etc.), show the assumptions you used.",
    "- Be concise. Use bullets when comparing > 2 items. Plain text otherwise.",
    "",
    "LISTING DATA (JSON):",
    "```json",
    JSON.stringify(slim, null, 2),
    "```",
    "",
    photos.length > 0
      ? `LISTING PHOTOS (${photos.length}):\n${photos
          .slice(0, 12)
          .map((u, i) => `${i + 1}. ${u}`)
          .join("\n")}\n\nIf the user asks about photos, describe what's available and offer to look at specific ones.`
      : "No photos are available for this listing.",
  ].join("\n");
}

/**
 * Extract photo URLs from a listing's raw Bridge JSON. Bridge stores them
 * under raw.Media[*].MediaURL.
 */
function extractPhotoUrls(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const media = (raw as { Media?: unknown }).Media;
  if (!Array.isArray(media)) return [];
  const urls: string[] = [];
  for (const m of media) {
    if (m && typeof m === "object") {
      const u = (m as { MediaURL?: unknown }).MediaURL;
      if (typeof u === "string" && u.startsWith("http")) urls.push(u);
    }
  }
  return urls;
}

/**
 * Pull the agent/office name fields Bridge's sfar (IDX) dataset permits —
 * name and MLS ID only, no phone/email — straight out of the listing's raw
 * payload. See bridge-client.ts for the same field list.
 */
export function extractBridgeAgentFields(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return { listAgentName: null, listAgentMlsId: null, coListAgentName: null, officeName: null };
  }
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return {
    listAgentName: str(r.ListAgentFullName),
    listAgentMlsId: str(r.ListAgentMlsId),
    coListAgentName: str(r.CoListAgentFullName),
    officeName: str(r.ListOfficeName),
  };
}
