import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Matches the encoding scheme used for Gmail attachments — RFC 5987 for
// non-ASCII filenames with an ASCII fallback for legacy clients.
function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  const encoded = encodeURIComponent(filename).replace(/['()]/g, escape);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return json(401, { error: "Unauthorized" });

  const { id } = await ctx.params;
  const doc = await db.listingDocument.findUnique({ where: { id } });
  if (!doc || doc.userId !== userId) return json(404, { error: "Not found" });

  const buffer = Buffer.from(doc.content);
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": doc.mimeType || "application/octet-stream",
      "Content-Disposition": contentDisposition(doc.filename),
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return json(401, { error: "Unauthorized" });

  const { id } = await ctx.params;
  const doc = await db.listingDocument.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!doc || doc.userId !== userId) return json(404, { error: "Not found" });

  await db.listingDocument.delete({ where: { id } });
  return json(200, { deleted: true });
}
