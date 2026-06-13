import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  runRentRollLlm,
  type EmailRentRollOutput,
  type RentRollAttachment,
} from "@/server/agents/email-rent-roll/agent";

/**
 * Parse the rent roll out of a user-uploaded ListingDocument. Mirrors
 * parseEmailRentRoll on the email path: runs the shared LLM call, persists
 * extractedRentRoll/Total/Occupancy onto the Listing when a rent roll is
 * found (source="manual_upload"), and writes the structured output back onto
 * the document. parseError is stored on the document so the UI can surface it
 * without failing the upload.
 */
export async function parseListingDocumentRentRoll(
  documentId: string,
): Promise<EmailRentRollOutput | { error: string }> {
  const doc = await db.listingDocument.findUnique({
    where: { id: documentId },
    include: {
      listing: {
        select: {
          mlsId: true,
          address: true,
          units: true,
          sqft: true,
          extractedUnitMix: true,
        },
      },
    },
  });
  if (!doc) throw new Error(`ListingDocument not found: ${documentId}`);
  const listing = doc.listing;

  const attachment: RentRollAttachment = {
    filename: doc.filename,
    mimeType: doc.mimeType,
    buffer: Buffer.from(doc.content),
  };

  const contextHeader = [
    "Listing context:",
    [
      `Listing: ${listing.address} (mlsId=${listing.mlsId})`,
      listing.units != null ? `Units: ${listing.units}` : null,
      listing.sqft != null ? `Building sqft: ${listing.sqft}` : null,
      listing.extractedUnitMix
        ? `Prior unit mix (from MLS extract): ${JSON.stringify(listing.extractedUnitMix)}`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
    "",
    `User-uploaded document: ${doc.filename} (${doc.mimeType})`,
  ].join("\n");

  const started = Date.now();
  let parsed: EmailRentRollOutput;
  try {
    parsed = await runRentRollLlm({
      contextHeader,
      attachments: [attachment],
    });
  } catch (err) {
    const errorMessage = (err as Error).message ?? "Unknown parse error";
    await db.listingDocument.update({
      where: { id: doc.id },
      data: { parseError: errorMessage.slice(0, 500) },
    });
    await db.agentTrace.create({
      data: {
        agentName: "listing-document-rent-roll",
        userId: doc.userId,
        input: { documentId: doc.id, listingMlsId: listing.mlsId },
        error: errorMessage.slice(0, 1000),
        latencyMs: Date.now() - started,
      },
    });
    return { error: errorMessage };
  }

  await db.aIEnrichment.create({
    data: {
      listingMlsId: listing.mlsId,
      agentName: "listing-document-rent-roll",
      output: parsed as object,
    },
  });
  await db.agentTrace.create({
    data: {
      agentName: "listing-document-rent-roll",
      userId: doc.userId,
      input: {
        documentId: doc.id,
        listingMlsId: listing.mlsId,
        filename: doc.filename,
      },
      output: parsed as object,
      latencyMs: Date.now() - started,
    },
  });

  if (parsed.rentRoll && parsed.rentRoll.length > 0) {
    await db.listing.update({
      where: { mlsId: listing.mlsId },
      data: {
        extractedRentRoll: parsed.rentRoll as unknown as Prisma.InputJsonValue,
        extractedTotalMonthlyRent:
          parsed.totalMonthlyRent != null ? Math.round(parsed.totalMonthlyRent) : null,
        extractedOccupancy: parsed.occupancy,
        extractedRentRollSource: "manual_upload",
        extractFetchedAt: new Date(),
      },
    });
  }

  await db.listingDocument.update({
    where: { id: doc.id },
    data: {
      parsedRentRoll: parsed.rentRoll
        ? (parsed.rentRoll as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      parsedAt: new Date(),
      parseError: null,
    },
  });

  return parsed;
}
