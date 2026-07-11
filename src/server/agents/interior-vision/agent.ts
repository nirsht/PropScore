import { z } from "zod";
import OpenAI from "openai";
import { db } from "@/lib/db";
import { openai } from "@/lib/openai";
import {
  INTERIOR_ANALYSIS_SYSTEM_PROMPT,
  INTERIOR_SCREENING_SYSTEM_PROMPT,
} from "./prompt";
import {
  InteriorVisionOutput,
  RenovationLevelEnum,
  RoomTypeEnum,
  type InteriorVisionOutput as Output,
  type PhotoFinding,
  type RoomType,
} from "./schema";
import type { BridgeMediaItem } from "@/server/etl/bridge-client";
import type { Prisma } from "@prisma/client";

// Screening tags low-detail thumbnails to find the best kitchen/bathroom
// photos; 10 covers those rooms in a typical listing while cutting screening
// image tokens ~40%. gpt-4o-mini bills each low-detail image at a high token
// multiplier, so this batch is the biggest single cost driver in vision.
const MAX_PHOTOS_TO_TAG = 10;
const TARGET_ANALYSIS_PHOTOS = 2;
const SCREENING_MODEL = "gpt-4o-mini";
const ANALYSIS_MODEL = "gpt-4o-mini";
const FALLBACK_CONFIDENCE_MARGIN = 0.1;

async function withVisionRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const TRIES = 3;
  let lastErr: unknown;
  for (let i = 0; i < TRIES; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isUpstreamTimeout =
        err instanceof OpenAI.APIError &&
        err.status === 400 &&
        (err.code === "invalid_image_url" ||
          (typeof err.message === "string" && /Timeout while downloading/i.test(err.message)));
      if (!isUpstreamTimeout || i === TRIES - 1) throw err;
      const waitMs = 750 * 2 ** i;
      // eslint-disable-next-line no-console
      console.warn(`[interior-vision] ${label} upstream image timeout, retrying in ${waitMs}ms (attempt ${i + 2}/${TRIES})`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

// Lenient on roomType so an off-list label (e.g. "dining", "office") doesn't
// nuke the whole listing. mergeTags / coerceRoomType normalize to the enum.
const RawPhotoTag = z.object({
  index: z.number().int().min(0),
  roomType: z.string(),
  usefulnessForCondition: z.number().min(0).max(1),
});

const ScreeningOutput = z.object({
  photos: z.array(RawPhotoTag),
});

const AnalysisOutput = z.object({
  perPhoto: z.array(
    z.object({
      photoUrl: z.string().url(),
      roomType: z.string(),
      conditionScore: z.number().min(0).max(100),
      observations: z.array(z.string().min(1).max(240)).max(8),
    }),
  ),
  renovationLevel: RenovationLevelEnum,
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});

function coerceRoomType(s: string): RoomType {
  const parsed = RoomTypeEnum.safeParse(s);
  if (parsed.success) return parsed.data;
  // Common off-list labels we map to the closest enum bucket.
  const norm = s.toLowerCase().replace(/[\s_-]+/g, "");
  if (norm.includes("dining")) return "dining";
  if (norm.includes("office") || norm.includes("den") || norm.includes("study")) return "living";
  if (norm.includes("garage") || norm.includes("yard") || norm.includes("patio")) return "exterior";
  return "other";
}

// Room types we treat as informative for unit condition, ordered by priority.
const ROOM_PRIORITY: ReadonlyArray<RoomType> = [
  "kitchen",
  "bathroom",
  "fixture_detail",
  "floor_detail",
  "living",
  "dining",
  "bedroom",
  "laundry",
  "closet",
  "hallway",
  "other",
];

type TaggedPhoto = {
  index: number;
  url: string;
  bridgeCategory: string | undefined;
  roomType: RoomType;
  usefulnessForCondition: number;
};

/**
 * Two-tier interior vision pipeline:
 *  1. Tier 1 (gpt-4o-mini, low detail): tag every interior photo with a room
 *     type and a usefulness score.
 *  2. Tier 2 (gpt-4o-mini, high detail): aggregate condition signals from up to
 *     2 interior photos — preferring 1 kitchen + 1 bathroom — into a single
 *     renovationLevel + confidence + rationale.
 *
 * Falls back gracefully when the listing has no interior photos. Whatever the
 * outcome, the full output is written to AIEnrichment under agentName
 * "interior-vision" so we have history regardless of whether the interior
 * verdict wins the Reno overwrite vs. the exterior agent.
 */
export async function runInteriorVision(
  mlsId: string,
  userId: string | null,
): Promise<Output> {
  const listing = await db.listing.findUnique({
    where: { mlsId },
    select: {
      mlsId: true,
      raw: true,
      renovationLevel: true,
      renovationConfidence: true,
    },
  });
  if (!listing) throw new Error(`Listing not found: ${mlsId}`);

  const raw = (listing.raw ?? {}) as Record<string, unknown>;
  const media = (raw.Media as BridgeMediaItem[] | undefined) ?? [];
  const photos = media
    .filter((m) => typeof m.MediaURL === "string" && m.MediaURL.length)
    .sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0))
    .slice(0, MAX_PHOTOS_TO_TAG);

  if (photos.length === 0) {
    const empty: Output = {
      photoCount: 0,
      selectedPhotoUrls: [],
      perPhoto: [],
      renovationLevel: null,
      renovationConfidence: null,
      rationale: "No photos available for interior analysis.",
      skipReason: "no_media",
    };
    await persist(mlsId, listing.renovationLevel, listing.renovationConfidence, empty);
    return empty;
  }

  const trace = await db.agentTrace.create({
    data: {
      agentName: "interior-vision",
      userId: userId ?? null,
      input: { mlsId, photoCount: photos.length },
    },
  });
  const started = Date.now();
  let totalTokens = 0;

  try {
    // Tier 1 — tag each photo
    const screeningMessages = [
      { role: "system" as const, content: INTERIOR_SCREENING_SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: buildScreeningUserText(photos),
          },
          ...photos.map((p) => ({
            type: "image_url" as const,
            image_url: { url: p.MediaURL!, detail: "low" as const },
          })),
        ],
      },
    ];

    const screeningCompletion = await withVisionRetry("screening", () =>
      openai.chat.completions.create({
        model: SCREENING_MODEL,
        messages: screeningMessages,
        response_format: { type: "json_object" },
      }),
    );
    totalTokens += screeningCompletion.usage?.total_tokens ?? 0;
    const screeningRaw = screeningCompletion.choices[0]?.message.content ?? "{}";
    const screeningParsed = ScreeningOutput.safeParse(safeJSON(screeningRaw));
    if (!screeningParsed.success) {
      throw new Error(`interior-vision: screening output failed schema — ${screeningParsed.error.message}`);
    }

    const tagged = mergeTags(photos, screeningParsed.data.photos);
    const selected = pickAnalysisPhotos(tagged);

    if (selected.length === 0) {
      const noInteriors: Output = {
        photoCount: photos.length,
        selectedPhotoUrls: [],
        perPhoto: [],
        renovationLevel: null,
        renovationConfidence: null,
        rationale: "No interior photos found among the listing's media.",
        skipReason: "no_interior_photos",
      };
      await persist(mlsId, listing.renovationLevel, listing.renovationConfidence, noInteriors);
      await db.agentTrace.update({
        where: { id: trace.id },
        data: {
          output: noInteriors as object,
          tokens: totalTokens,
          latencyMs: Date.now() - started,
        },
      });
      return noInteriors;
    }

    // Tier 2 — analyze the selected interior photos
    const analysisMessages = [
      { role: "system" as const, content: INTERIOR_ANALYSIS_SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: buildAnalysisUserText(selected),
          },
          ...selected.map((p) => ({
            type: "image_url" as const,
            image_url: { url: p.url, detail: "high" as const },
          })),
        ],
      },
    ];

    const analysisCompletion = await withVisionRetry("analysis", () =>
      openai.chat.completions.create({
        model: ANALYSIS_MODEL,
        messages: analysisMessages,
        response_format: { type: "json_object" },
      }),
    );
    totalTokens += analysisCompletion.usage?.total_tokens ?? 0;
    const analysisRaw = analysisCompletion.choices[0]?.message.content ?? "{}";
    const analysisParsed = AnalysisOutput.safeParse(safeJSON(analysisRaw));
    if (!analysisParsed.success) {
      throw new Error(`interior-vision: analysis output failed schema — ${analysisParsed.error.message}`);
    }

    // The model echoes photoUrl per finding; trust the selected list as the
    // source of truth for selectedPhotoUrls so the output matches what we
    // actually sent (the model occasionally drops a row). Coerce roomType so
    // off-list labels like "dining" survive the schema check below.
    const perPhoto: PhotoFinding[] = analysisParsed.data.perPhoto
      .slice(0, TARGET_ANALYSIS_PHOTOS)
      .map((p) => ({ ...p, roomType: coerceRoomType(p.roomType) }));

    const out: Output = {
      photoCount: photos.length,
      selectedPhotoUrls: selected.map((s) => s.url),
      perPhoto,
      renovationLevel: analysisParsed.data.renovationLevel,
      renovationConfidence: analysisParsed.data.confidence,
      rationale: analysisParsed.data.rationale,
      skipReason: null,
    };

    InteriorVisionOutput.parse(out);
    await persist(mlsId, listing.renovationLevel, listing.renovationConfidence, out);
    await db.agentTrace.update({
      where: { id: trace.id },
      data: {
        output: out as object,
        tokens: totalTokens,
        latencyMs: Date.now() - started,
      },
    });
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.agentTrace.update({
      where: { id: trace.id },
      data: { tokens: totalTokens, latencyMs: Date.now() - started, error: message },
    });
    throw err;
  }
}

function buildScreeningUserText(photos: BridgeMediaItem[]): string {
  const lines = photos.map((p, i) => {
    const hint = typeof p.MediaCategory === "string" && p.MediaCategory.length
      ? ` (Bridge MediaCategory hint: ${p.MediaCategory})`
      : "";
    return `${i}.${hint}`;
  });
  return `Tag each of these ${photos.length} photos in order. Treat the Bridge MediaCategory hint as a soft suggestion only — confirm visually.\n${lines.join("\n")}`;
}

function buildAnalysisUserText(selected: TaggedPhoto[]): string {
  const lines = selected.map((s, i) => `${i}. roomType=${s.roomType} url=${s.url}`);
  return `Analyze the following ${selected.length} interior photo(s). For each, return a perPhoto entry citing concrete finish-era observations. Then return the aggregate verdict using the rules above.\n${lines.join("\n")}`;
}

type RawTag = z.infer<typeof RawPhotoTag>;

function mergeTags(photos: BridgeMediaItem[], tags: RawTag[]): TaggedPhoto[] {
  const byIndex = new Map<number, RawTag>();
  for (const t of tags) byIndex.set(t.index, t);
  return photos.map((p, i) => {
    const tag = byIndex.get(i);
    return {
      index: i,
      url: p.MediaURL!,
      bridgeCategory: typeof p.MediaCategory === "string" ? p.MediaCategory : undefined,
      // If the model dropped a row, default to "other" with low usefulness.
      roomType: tag ? coerceRoomType(tag.roomType) : "other",
      usefulnessForCondition: tag?.usefulnessForCondition ?? 0,
    };
  });
}

/**
 * Pick up to 2 photos prioritizing 1 kitchen + 1 bathroom (the rooms that
 * carry the most renovation signal). If only one of those rooms is present,
 * fall back to the next-most-useful interior photo by ROOM_PRIORITY then by
 * usefulnessForCondition. Excludes anything tagged "exterior".
 */
function pickAnalysisPhotos(tagged: TaggedPhoto[]): TaggedPhoto[] {
  const interiors = tagged.filter((t) => t.roomType !== "exterior");
  if (interiors.length === 0) return [];

  const picked: TaggedPhoto[] = [];
  const pickedUrls = new Set<string>();

  const pickBest = (predicate: (t: TaggedPhoto) => boolean) => {
    const candidates = interiors
      .filter((t) => !pickedUrls.has(t.url) && predicate(t))
      .sort((a, b) => b.usefulnessForCondition - a.usefulnessForCondition);
    const top = candidates[0];
    if (top) {
      picked.push(top);
      pickedUrls.add(top.url);
    }
  };

  pickBest((t) => t.roomType === "kitchen");
  pickBest((t) => t.roomType === "bathroom");

  // Fill remaining slots by priority list, skipping rooms we already have.
  for (const room of ROOM_PRIORITY) {
    if (picked.length >= TARGET_ANALYSIS_PHOTOS) break;
    pickBest((t) => t.roomType === room);
  }

  return picked.slice(0, TARGET_ANALYSIS_PHOTOS);
}

/**
 * Fallback chain decides whether the interior verdict overwrites the existing
 * (exterior-derived) Reno on the Listing row:
 *  1. If existing reno is null → always adopt the interior verdict (even if null).
 *  2. If interior confidence > existing confidence + 0.1 → adopt.
 *  3. Otherwise keep the existing exterior reno.
 *
 * AIEnrichment is always written so the interior verdict is preserved for
 * audit / drawer surfacing regardless of who wins the overwrite.
 */
async function persist(
  mlsId: string,
  existingLevel: import("@/server/agents/building-vision/schema").RenovationLevel | null,
  existingConfidence: number | null,
  out: Output,
) {
  const adopt = shouldAdoptInterior(existingLevel, existingConfidence, out);

  const data: Prisma.ListingUpdateInput = {
    visionFetchedAt: new Date(),
  };
  if (adopt) {
    data.renovationLevel = out.renovationLevel;
    data.renovationConfidence = out.renovationConfidence;
  }

  await db.listing.update({ where: { mlsId }, data });

  await db.aIEnrichment.create({
    data: {
      listingMlsId: mlsId,
      agentName: "interior-vision",
      output: { ...out, adoptedAsReno: adopt } as object,
    },
  });
}

export function shouldAdoptInterior(
  existingLevel: string | null,
  existingConfidence: number | null,
  out: Pick<Output, "renovationLevel" | "renovationConfidence" | "skipReason">,
): boolean {
  // If we didn't actually run analysis, never overwrite a real exterior verdict.
  if (out.skipReason) return existingLevel == null;

  if (existingLevel == null) return true;

  const existing = existingConfidence ?? 0;
  const candidate = out.renovationConfidence ?? 0;
  return candidate > existing + FALLBACK_CONFIDENCE_MARGIN;
}

function safeJSON(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
