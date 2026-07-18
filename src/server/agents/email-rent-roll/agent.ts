import type { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { openai } from "@/lib/openai";
import { getAttachment } from "@/lib/google/gmail";
import { RentRollEntry } from "@/server/agents/listing-extract/schema";

// Output schema — strict subset of ListingExtractOutput for the email path.
// We only ingest what the agent actually shares (rent roll + occupancy).
// Other ADU/unit-mix fields stay owned by the listing-extract agent.
export const EmailRentRollOutput = z.object({
  rentRoll: z.array(RentRollEntry).nullable(),
  totalMonthlyRent: z.number().nullable(),
  occupancy: z.number().min(0).max(1).nullable(),
  // One-sentence summary of what was found / why it was empty. Surfaced in
  // EmailHistorySection so the user can audit a no-op parse. Cap is generous
  // and the parser clamps the model's text to it (see runRentRollLlm) — a
  // verbose rationale must never discard an otherwise-valid rent roll.
  rationale: z.string().min(1).max(800),
});
export type EmailRentRollOutput = z.infer<typeof EmailRentRollOutput>;

// Cost guards — kill switches before we touch the LLM. Numbers picked to fit a
// reasonable agent rent-roll (≤5 small files, ≤25 MB total).
const MAX_ATTACHMENTS = 5;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

const SYSTEM_PROMPT = `You parse rent rolls out of real-estate broker emails.

The user will share an email body and any attachments the broker sent (rent roll
PDF, photo, spreadsheet, etc.). Your job is to extract a clean rent roll for
the building.

Rules:
- Emit one entry per unit. Set "kind" on every row: "residential" for dwellings
  (default), "commercial" for a retail / office / store / restaurant / market
  space. Include a mixed-use building's commercial row (with its rent) marked
  kind:"commercial" rather than dropping it. Skip parking-only rows.
- "rent" = current actual monthly rent in dollars (numeric, no $ sign). If a
  unit is vacant (rent = $0, blank, or "vacant"), KEEP the row and set
  rent: null — preserve beds/baths/sqft/unitLabel/moveInDate so the consumer
  can show the vacant unit with a market/proforma estimate. Reduce occupancy
  proportionally.
- "beds" and "baths" — if the table doesn't list them per-unit, infer from
  the building's listed unit mix (e.g. "10x 1BR/1BA" → beds=1, baths=1 for
  all rows). Use null when truly unknowable.
- "sqft" — populate when the rent roll lists it per unit.
- "unitLabel" — short identifier from the rent roll (Unit 1, A, 101). Trim
  to ≤40 chars.
- "moveInDate" — verbatim move-in / lease-start text when the row lists it
  ("12/1/1992", "04/15/2025", "Vacant", "MTM", "2021"). Drives buyout
  assessment for rent-controlled tenancies. Null when absent.
- "totalMonthlyRent" — the building's gross in-place rent: sum of "rent" across
  ALL rentRoll entries, residential AND commercial, treating null/vacant as 0.
  Round to a whole dollar.
- "occupancy" — fraction in [0,1]. occupied_units / total_units (count the
  commercial unit in both when it's leased).
- If you cannot find a rent roll at all, return rentRoll=null and write a
  rationale explaining what you saw instead (e.g. "Agent declined to share").
- NEVER fabricate rents. If a value is illegible, omit that field, not the row.
- Output JSON conforming to the response schema. No prose outside JSON.`;

const PER_PDF_PAGE_CAP = 20;

type AttachmentInput = {
  filename: string;
  mimeType: string;
  size: number;
  gmailAttachmentId: string;
};

/// Attachment shape used by the shared buffer-based parser. The email path
/// fetches buffers from Gmail before calling in; the manual-upload path reads
/// bytes straight out of ListingDocument.
export type RentRollAttachment = {
  filename: string;
  mimeType: string;
  buffer: Buffer;
};

async function fetchAttachmentBuffer(
  userId: string,
  gmailMessageId: string,
  attachmentId: string,
): Promise<Buffer> {
  return getAttachment(userId, gmailMessageId, attachmentId);
}

async function pdfToText(buf: Buffer): Promise<string> {
  // Lazy-load pdf-parse: its transitive pdfjs-dist runs `new DOMMatrix()` at
  // module init, which crashes any route whose bundle eagerly pulls this file
  // (e.g. listings tRPC, via the root router). Defer to call time so only the
  // email-parse path pays the cost.
  let parser: PDFParse | null = null;
  try {
    const { PDFParse } = await import("pdf-parse");
    parser = new PDFParse({ data: buf });
    const result = await parser.getText();
    return (result.text ?? "").trim();
  } catch {
    return "";
  } finally {
    if (parser) await parser.destroy().catch(() => undefined);
  }
}

function xlsxToText(buf: Buffer): string {
  try {
    const wb = XLSX.read(buf, { type: "buffer" });
    const chunks: string[] = [];
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet);
      if (csv.trim()) {
        chunks.push(`# Sheet: ${sheetName}\n${csv}`);
      }
    }
    return chunks.join("\n\n");
  } catch {
    return "";
  }
}

// Content block builder. We emit a text block per attachment with extracted
// text where possible, and an image_url block for image attachments (and PDFs
// that yielded no text). The user message is a single multimodal turn.
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

async function buildAttachmentBlocks(
  attachments: RentRollAttachment[],
): Promise<ContentBlock[]> {
  const out: ContentBlock[] = [];
  let totalBytes = 0;
  const slice = attachments.slice(0, MAX_ATTACHMENTS);

  for (const att of slice) {
    const buf = att.buffer;
    if (totalBytes + buf.length > MAX_TOTAL_BYTES) {
      out.push({
        type: "text",
        text: `[Skipped ${att.filename}: total attachment size would exceed ${MAX_TOTAL_BYTES} bytes]`,
      });
      continue;
    }
    totalBytes += buf.length;

    const mime = att.mimeType.toLowerCase();

    if (mime === "application/pdf" || att.filename.toLowerCase().endsWith(".pdf")) {
      const text = await pdfToText(buf);
      if (text && text.length > 60) {
        out.push({
          type: "text",
          text: `# Attachment: ${att.filename} (PDF, text-extracted)\n\n${text.slice(0, 60_000)}`,
        });
      } else {
        // Scanned PDF — pass as image to GPT vision. We send the raw PDF
        // bytes inline; modern OpenAI vision endpoints accept PDF data URIs
        // up to ~20 pages.
        const dataUrl = `data:application/pdf;base64,${buf.toString("base64")}`;
        out.push({
          type: "text",
          text: `# Attachment: ${att.filename} (PDF, image — first ${PER_PDF_PAGE_CAP} pages)`,
        });
        out.push({ type: "image_url", image_url: { url: dataUrl } });
      }
      continue;
    }

    if (mime.startsWith("image/")) {
      const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
      out.push({ type: "text", text: `# Attachment: ${att.filename} (image)` });
      out.push({ type: "image_url", image_url: { url: dataUrl } });
      continue;
    }

    if (
      mime === "text/csv" ||
      mime === "application/vnd.ms-excel" ||
      mime.includes("spreadsheetml") ||
      att.filename.toLowerCase().match(/\.(csv|xls|xlsx)$/)
    ) {
      const csv = xlsxToText(buf);
      out.push({
        type: "text",
        text: `# Attachment: ${att.filename} (spreadsheet)\n\n${csv.slice(0, 60_000)}`,
      });
      continue;
    }

    if (mime.startsWith("text/")) {
      out.push({
        type: "text",
        text: `# Attachment: ${att.filename} (text)\n\n${buf.toString("utf8").slice(0, 30_000)}`,
      });
      continue;
    }

    out.push({
      type: "text",
      text: `[Attachment ${att.filename} (${mime}) skipped — unsupported MIME type]`,
    });
  }
  return out;
}

function buildResponseSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      rentRoll: {
        anyOf: [
          { type: "null" },
          {
            type: "array",
            items: {
              type: "object",
              properties: {
                rent: { anyOf: [{ type: "number" }, { type: "null" }] },
                beds: { anyOf: [{ type: "integer" }, { type: "null" }] },
                baths: { anyOf: [{ type: "number" }, { type: "null" }] },
                kind: { type: "string", enum: ["residential", "commercial"] },
                sqft: { anyOf: [{ type: "number" }, { type: "null" }] },
                unitLabel: { anyOf: [{ type: "string" }, { type: "null" }] },
                moveInDate: { anyOf: [{ type: "string" }, { type: "null" }] },
              },
              required: ["rent", "beds", "baths"],
            },
          },
        ],
      },
      totalMonthlyRent: { anyOf: [{ type: "number" }, { type: "null" }] },
      occupancy: { anyOf: [{ type: "number" }, { type: "null" }] },
      rationale: { type: "string", maxLength: 800 },
    },
    required: ["rentRoll", "totalMonthlyRent", "occupancy", "rationale"],
  };
}

/**
 * Pure LLM call: turn a listing context + buffer attachments into a structured
 * rent-roll output. No persistence; callers (email reply, manual upload)
 * persist into their own tables and write their own AgentTrace.
 */
export async function runRentRollLlm(args: {
  contextHeader: string;
  attachments: RentRollAttachment[];
}): Promise<EmailRentRollOutput> {
  const attachmentBlocks = await buildAttachmentBlocks(args.attachments);
  const userBlocks: ContentBlock[] = [
    { type: "text", text: args.contextHeader },
    ...attachmentBlocks,
  ];
  const completion = await openai.chat.completions.create({
    model: env.OPENAI_RENT_ROLL_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      // OpenAI types accept multimodal content as an array of parts when
      // the role is user. The Node SDK's types are slightly stricter; we
      // cast to the SDK's expected shape.
      { role: "user", content: userBlocks as unknown as string },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "email_rent_roll_output",
        schema: buildResponseSchema(),
        strict: false,
      },
    },
  });
  const text = completion.choices[0]?.message?.content ?? "";
  const json = JSON.parse(text);
  // Defensive clamp: the rationale is a human-readable note, but a verbose
  // model occasionally overshoots the schema cap — and a rent roll is far too
  // valuable to throw away over a long sentence. Trim to the schema max so a
  // good parse always survives.
  if (json && typeof json.rationale === "string" && json.rationale.length > 800) {
    json.rationale = json.rationale.slice(0, 797).trimEnd() + "…";
  }
  return EmailRentRollOutput.parse(json);
}

/**
 * Parse the rent roll out of an inbound email message. Multimodal single-shot
 * call to OPENAI_RENT_ROLL_MODEL (default gpt-5). Persists into Listing
 * (extractedRentRoll / extractedTotalMonthlyRent / extractedOccupancy /
 * extractedRentRollSource="email_reply") and onto EmailMessage.parsedRentRoll.
 * Updates the thread status to PARSED on success, FAILED on schema mismatch.
 */
export async function parseEmailRentRoll(emailMessageId: string): Promise<EmailRentRollOutput> {
  const message = await db.emailMessage.findUnique({
    where: { id: emailMessageId },
    include: {
      thread: {
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
      },
    },
  });
  if (!message) throw new Error(`EmailMessage not found: ${emailMessageId}`);
  if (message.direction !== "INBOUND") {
    throw new Error(`Not an inbound message: ${emailMessageId}`);
  }
  const thread = message.thread;
  const listing = thread.listing;

  const attachments = (message.attachments as AttachmentInput[] | null) ?? [];

  // Fetch buffers from Gmail before handing off to the buffer-based parser.
  // Per-attachment failures are surfaced as text blocks in the prompt so the
  // model still gets a useful signal from whatever did fetch.
  const rentRollAttachments: RentRollAttachment[] = [];
  const fetchNotes: string[] = [];
  for (const att of attachments) {
    try {
      const buffer = await fetchAttachmentBuffer(
        thread.userId,
        message.gmailMessageId,
        att.gmailAttachmentId,
      );
      rentRollAttachments.push({
        filename: att.filename,
        mimeType: att.mimeType,
        buffer,
      });
    } catch (err) {
      fetchNotes.push(`[Failed to fetch ${att.filename}: ${(err as Error).message}]`);
    }
  }

  const listingContext = [
    `Listing: ${listing.address} (mlsId=${listing.mlsId})`,
    listing.units != null ? `Units: ${listing.units}` : null,
    listing.sqft != null ? `Building sqft: ${listing.sqft}` : null,
    listing.extractedUnitMix
      ? `Prior unit mix (from MLS extract): ${JSON.stringify(listing.extractedUnitMix)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const contextHeader = [
    "Listing context:",
    listingContext,
    "",
    "Email reply from:",
    `${message.fromEmail}`,
    "",
    "Subject:",
    message.subject,
    "",
    "Body:",
    message.bodyText ?? "(empty)",
    ...(fetchNotes.length ? ["", ...fetchNotes] : []),
  ].join("\n");

  const started = Date.now();
  let parsed: EmailRentRollOutput;
  try {
    parsed = await runRentRollLlm({
      contextHeader,
      attachments: rentRollAttachments,
    });

    await db.aIEnrichment.create({
      data: {
        listingMlsId: listing.mlsId,
        agentName: "email-rent-roll",
        output: parsed as object,
      },
    });

    await db.agentTrace.create({
      data: {
        agentName: "email-rent-roll",
        userId: thread.userId,
        input: {
          emailMessageId: message.id,
          listingMlsId: listing.mlsId,
          attachmentCount: attachments.length,
        },
        output: parsed as object,
        latencyMs: Date.now() - started,
      },
    });
  } catch (err) {
    const errorMessage = (err as Error).message ?? "Unknown parse error";
    await db.emailThread.update({
      where: { id: thread.id },
      data: {
        status: "FAILED",
        parseError: errorMessage.slice(0, 500),
      },
    });
    await db.agentTrace.create({
      data: {
        agentName: "email-rent-roll",
        userId: thread.userId,
        input: { emailMessageId: message.id, listingMlsId: listing.mlsId },
        error: errorMessage.slice(0, 1000),
        latencyMs: Date.now() - started,
      },
    });
    throw err;
  }

  // Persist into Listing and EmailMessage. We only overwrite listing rent
  // roll if the parse actually yielded one — otherwise we leave the AI-
  // extracted fields alone and mark the thread as REPLIED-but-empty.
  if (parsed.rentRoll && parsed.rentRoll.length > 0) {
    await db.listing.update({
      where: { mlsId: listing.mlsId },
      data: {
        extractedRentRoll: parsed.rentRoll as unknown as Prisma.InputJsonValue,
        extractedTotalMonthlyRent:
          parsed.totalMonthlyRent != null ? Math.round(parsed.totalMonthlyRent) : null,
        extractedOccupancy: parsed.occupancy,
        extractedRentRollSource: "email_reply",
        extractFetchedAt: message.receivedAt,
      },
    });
  }

  await db.emailMessage.update({
    where: { id: message.id },
    data: {
      parsedRentRoll: parsed.rentRoll
        ? (parsed.rentRoll as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
  });

  await db.emailThread.update({
    where: { id: thread.id },
    data: {
      status: parsed.rentRoll && parsed.rentRoll.length > 0 ? "PARSED" : "REPLIED",
      parsedAt: parsed.rentRoll && parsed.rentRoll.length > 0 ? new Date() : null,
      parseError: null,
    },
  });

  return parsed;
}
