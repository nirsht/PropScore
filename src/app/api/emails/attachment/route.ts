import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getAttachment,
  GmailAuthError,
  GmailNotConnectedError,
} from "@/lib/google/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoredAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  gmailAttachmentId: string;
};

function isAttachmentArray(value: unknown): value is StoredAttachment[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) =>
        v &&
        typeof v === "object" &&
        typeof (v as StoredAttachment).filename === "string" &&
        typeof (v as StoredAttachment).gmailAttachmentId === "string",
    )
  );
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// RFC 5987 encoding for Content-Disposition filenames that may contain
// non-ASCII characters. Falls back to a sanitized ASCII filename for legacy
// clients via the plain `filename=` parameter.
function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  const encoded = encodeURIComponent(filename).replace(/['()]/g, escape);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return json(401, { error: "Unauthorized" });

  const { searchParams } = new URL(req.url);
  const messageId = searchParams.get("messageId");
  const attachmentId = searchParams.get("attachmentId");
  if (!messageId || !attachmentId) {
    return json(400, { error: "messageId and attachmentId are required" });
  }

  const msg = await db.emailMessage.findUnique({
    where: { id: messageId },
    include: { thread: { select: { userId: true } } },
  });
  if (!msg || msg.thread.userId !== userId) {
    return json(404, { error: "Not found" });
  }

  const attachments = isAttachmentArray(msg.attachments) ? msg.attachments : [];
  const att = attachments.find((a) => a.gmailAttachmentId === attachmentId);
  if (!att) return json(404, { error: "Not found" });

  let buffer: Buffer;
  try {
    buffer = await getAttachment(userId, msg.gmailMessageId, att.gmailAttachmentId);
  } catch (err) {
    if (err instanceof GmailNotConnectedError || err instanceof GmailAuthError) {
      return json(502, { error: "Gmail connection unavailable" });
    }
    throw err;
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": att.mimeType || "application/octet-stream",
      "Content-Disposition": contentDisposition(att.filename),
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
