import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseListingDocumentRentRoll } from "@/server/agents/listing-document/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cost guard mirrors the email parser: 25MB max per upload. Same number lets
// us reuse the parser's batch ceiling without surprise.
const MAX_BYTES = 25 * 1024 * 1024;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return json(401, { error: "Unauthorized" });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: "Expected multipart/form-data" });
  }

  const listingMlsId = String(form.get("listingMlsId") ?? "").trim();
  const file = form.get("file");
  if (!listingMlsId) return json(400, { error: "listingMlsId is required" });
  if (!(file instanceof File)) return json(400, { error: "file is required" });
  if (file.size === 0) return json(400, { error: "Empty file" });
  if (file.size > MAX_BYTES) {
    return json(413, { error: `File exceeds ${MAX_BYTES} bytes` });
  }

  const listing = await db.listing.findUnique({
    where: { mlsId: listingMlsId },
    select: { mlsId: true },
  });
  if (!listing) return json(404, { error: "Listing not found" });

  const arrayBuffer = await file.arrayBuffer();
  const content = Buffer.from(arrayBuffer);

  const doc = await db.listingDocument.create({
    data: {
      userId,
      listingMlsId,
      filename: file.name || "upload",
      mimeType: file.type || "application/octet-stream",
      size: content.length,
      content,
    },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      size: true,
      createdAt: true,
    },
  });

  // Fire-and-await the parse so the UI's invalidation reflects a parsed state.
  // The parser itself catches errors and stores them on the document; we
  // still return 200 with the document id either way.
  const result = await parseListingDocumentRentRoll(doc.id);
  const parsed = "error" in result ? null : result;
  const parseError = "error" in result ? result.error : null;

  return json(200, { document: doc, parsed, parseError });
}
