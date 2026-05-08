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
    daysOnMls: listing.daysOnMls,
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
      aduPotential: listing.aduPotential,
      aduConfidence: listing.aduConfidence,
      aduRationale: listing.aduRationale,
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
  };

  return [
    "You are PropScore's per-asset chat assistant. The user is looking at one MLS listing and is asking questions about it.",
    "",
    "GROUNDING RULES:",
    "- Always ground answers in the listing data below. If a value isn't there, say so plainly — don't invent.",
    "- For rent, comp, parcel, or scoring questions, prefer calling the matching tool over guessing.",
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
