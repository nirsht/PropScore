import { z } from "zod";
import { db } from "@/lib/db";
import { openai } from "@/lib/openai";
import { BEST_PHOTO_SYSTEM_PROMPT, BUILDING_ANALYSIS_SYSTEM_PROMPT } from "./prompt";
import { BuildingVisionOutput, RenovationLevelEnum, type BuildingVisionOutput as Output } from "./schema";
import type { BridgeMediaItem } from "@/server/etl/bridge-client";

const MAX_PHOTOS_TO_RANK = 12;
const SELECTOR_MODEL = "gpt-4o-mini";
const ANALYSIS_MODEL = "gpt-4o";

const SelectorOutput = z.object({
  bestIndex: z.number().int(),
  reason: z.string(),
});

const AnalysisOutput = z.object({
  stories: z.number().int().nullable(),
  hasBasement: z.boolean().nullable(),
  hasPenthouse: z.boolean().nullable(),
  renovationLevel: RenovationLevelEnum.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  rationale: z.string(),
});

/**
 * Analyze a listing's photos. Two-call pipeline:
 *  1. Cheap selector (gpt-4o-mini) ranks up to N thumbnails to pick the
 *     best exterior facade.
 *  2. Full analysis (gpt-4o) on that one photo returns stories, basement,
 *     penthouse, renovation level + confidence.
 *
 * Persists onto Listing for fast filtering and stores the full output in
 * AIEnrichment under agentName="building-vision".
 */
export async function runBuildingVision(
  mlsId: string,
  userId: string | null,
): Promise<Output> {
  const listing = await db.listing.findUnique({
    where: { mlsId },
    select: { mlsId: true, raw: true },
  });
  if (!listing) throw new Error(`Listing not found: ${mlsId}`);

  const raw = (listing.raw ?? {}) as Record<string, unknown>;
  const media = (raw.Media as BridgeMediaItem[] | undefined) ?? [];
  const photos = media
    .filter((m) => typeof m.MediaURL === "string" && m.MediaURL.length)
    .sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0))
    .slice(0, MAX_PHOTOS_TO_RANK);

  if (photos.length === 0) {
    const empty: Output = {
      bestPhotoUrl: null,
      bestPhotoReason: "No photos available for this listing.",
      stories: null,
      hasBasement: null,
      hasPenthouse: null,
      renovationLevel: null,
      renovationConfidence: null,
      rationale: "Cannot analyze a building without photos.",
    };
    await persist(mlsId, userId, empty);
    return empty;
  }

  const trace = await db.agentTrace.create({
    data: {
      agentName: "building-vision",
      userId: userId ?? null,
      input: { mlsId, photoCount: photos.length },
    },
  });
  const started = Date.now();
  let totalTokens = 0;

  try {
    // Step 1 — pick the best exterior photo
    const selectorMessages = [
      { role: "system" as const, content: BEST_PHOTO_SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: `Choose the best exterior facade photo from these ${photos.length} options. The index is the order shown.`,
          },
          ...photos.map((p) => ({
            type: "image_url" as const,
            image_url: { url: p.MediaURL!, detail: "low" as const },
          })),
        ],
      },
    ];

    const selectorCompletion = await openai.chat.completions.create({
      model: SELECTOR_MODEL,
      messages: selectorMessages,
      response_format: { type: "json_object" },
    });
    totalTokens += selectorCompletion.usage?.total_tokens ?? 0;
    const selectorRaw = selectorCompletion.choices[0]?.message.content ?? "{}";
    const selectorParsed = SelectorOutput.safeParse(safeJSON(selectorRaw));
    if (!selectorParsed.success) {
      throw new Error(`building-vision: selector output failed schema — ${selectorParsed.error.message}`);
    }

    const idx = selectorParsed.data.bestIndex;
    if (idx < 0 || idx >= photos.length) {
      const noExterior: Output = {
        bestPhotoUrl: null,
        bestPhotoReason: selectorParsed.data.reason,
        stories: null,
        hasBasement: null,
        hasPenthouse: null,
        renovationLevel: null,
        renovationConfidence: null,
        rationale: selectorParsed.data.reason,
      };
      await persist(mlsId, userId, noExterior);
      await db.agentTrace.update({
        where: { id: trace.id },
        data: {
          output: noExterior as object,
          tokens: totalTokens,
          latencyMs: Date.now() - started,
        },
      });
      return noExterior;
    }

    const bestPhoto = photos[idx]!;
    const bestPhotoUrl = bestPhoto.MediaURL!;

    // Step 2 — analyze the chosen photo
    const analysisMessages = [
      { role: "system" as const, content: BUILDING_ANALYSIS_SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "Analyze this building's exterior." },
          {
            type: "image_url" as const,
            image_url: { url: bestPhotoUrl, detail: "high" as const },
          },
        ],
      },
    ];

    const analysisCompletion = await openai.chat.completions.create({
      model: ANALYSIS_MODEL,
      messages: analysisMessages,
      response_format: { type: "json_object" },
    });
    totalTokens += analysisCompletion.usage?.total_tokens ?? 0;
    const analysisRaw = analysisCompletion.choices[0]?.message.content ?? "{}";
    const analysisParsed = AnalysisOutput.safeParse(safeJSON(analysisRaw));
    if (!analysisParsed.success) {
      throw new Error(`building-vision: analysis output failed schema — ${analysisParsed.error.message}`);
    }

    const out: Output = {
      bestPhotoUrl,
      bestPhotoReason: selectorParsed.data.reason,
      stories: analysisParsed.data.stories,
      hasBasement: analysisParsed.data.hasBasement,
      hasPenthouse: analysisParsed.data.hasPenthouse,
      renovationLevel: analysisParsed.data.renovationLevel,
      renovationConfidence: analysisParsed.data.confidence,
      rationale: analysisParsed.data.rationale,
    };

    BuildingVisionOutput.parse(out);
    await persist(mlsId, userId, out);
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

async function persist(mlsId: string, _userId: string | null, out: Output) {
  await db.listing.update({
    where: { mlsId },
    data: {
      aiStories: out.stories,
      aiHasBasement: out.hasBasement,
      aiHasPenthouse: out.hasPenthouse,
      aiBestPhotoUrl: out.bestPhotoUrl,
      renovationLevel: out.renovationLevel,
      renovationConfidence: out.renovationConfidence,
      visionFetchedAt: new Date(),
    },
  });

  await db.aIEnrichment.create({
    data: {
      listingMlsId: mlsId,
      agentName: "building-vision",
      output: out as object,
    },
  });
}

function safeJSON(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
