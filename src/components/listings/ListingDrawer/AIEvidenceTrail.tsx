import * as React from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import { formatAgo } from "@/lib/formatAgo";
import { fmtDate } from "./formatters";
import type { ListingForDetails } from "./types";

const SOURCE_FIELD_LABELS: Record<string, string> = {
  publicRemarks: "MLS public remarks",
  privateRemarks: "MLS private remarks",
};

const PHOTO_SOURCE_LABELS: Record<string, string> = {
  exterior_photo: "exterior listing photo",
  interior_photo: "interior listing photos",
  mixed: "listing photos",
};

type Conclusion = {
  label: string;
  value: string;
  // Verbatim source quote (text agents) — rendered as a blockquote.
  quote: string | null;
  // One-line visual cue (photo agent) — rendered italic, no quote frame.
  observation: string | null;
  attribution: string;
  date: Date | string;
};

function latestEnrichment(
  enrichments: ListingForDetails["enrichments"],
  agentName: string,
): NonNullable<ListingForDetails["enrichments"]>[number] | null {
  const matches = (enrichments ?? []).filter((e) => e.agentName === agentName);
  if (matches.length === 0) return null;
  return matches.reduce((latest, e) =>
    new Date(e.createdAt) > new Date(latest.createdAt) ? e : latest,
  );
}

// Surfaces only the fields the AI actually wrote into the Building details
// AI column (today: Units, Stories). Each conclusion shows the value plus the
// verbatim source snippet (text agents) or a concise visual observation
// (photo agent), so a reader can audit the cell. If the AI column has no
// values for this listing, the trail renders nothing.
export function AIEvidenceTrail({
  aiUnits,
  aiStories,
  enrichments,
}: {
  aiUnits: number | null;
  aiStories: number | null;
  enrichments: ListingForDetails["enrichments"];
}) {
  const conclusions: Conclusion[] = [];

  if (aiUnits != null) {
    const e = latestEnrichment(enrichments, "listing-extract");
    const out = (e?.output ?? {}) as Record<string, unknown>;
    const ev = (out.unitMixEvidence ?? null) as
      | { sourceQuote?: string; sourceField?: string }
      | null;
    const sourceLabel =
      ev && typeof ev.sourceField === "string"
        ? (SOURCE_FIELD_LABELS[ev.sourceField] ?? ev.sourceField)
        : "MLS remarks";
    conclusions.push({
      label: "Units",
      value: String(aiUnits),
      quote:
        ev && typeof ev.sourceQuote === "string" && ev.sourceQuote.trim()
          ? ev.sourceQuote.trim()
          : null,
      observation: null,
      attribution: ev ? `Extracted from ${sourceLabel}` : "Source not recorded for this run",
      date: e?.createdAt ?? new Date(),
    });
  }

  if (aiStories != null) {
    const e = latestEnrichment(enrichments, "building-vision");
    const out = (e?.output ?? {}) as Record<string, unknown>;
    const ev = (out.storiesEvidence ?? null) as
      | { sourceType?: string; observation?: string }
      | null;
    const sourceLabel =
      ev && typeof ev.sourceType === "string"
        ? (PHOTO_SOURCE_LABELS[ev.sourceType] ?? ev.sourceType)
        : "listing photos";
    conclusions.push({
      label: "Stories",
      value: String(aiStories),
      quote: null,
      observation:
        ev && typeof ev.observation === "string" && ev.observation.trim()
          ? ev.observation.trim()
          : null,
      attribution: ev ? `Inferred from ${sourceLabel}` : "Source not recorded for this run",
      date: e?.createdAt ?? new Date(),
    });
  }

  if (conclusions.length === 0) return null;

  return (
    <Accordion
      disableGutters
      elevation={0}
      sx={{
        mt: 1.5,
        bgcolor: "transparent",
        "&:before": { display: "none" },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreRoundedIcon />}
        sx={{ px: 0, minHeight: 32, "& .MuiAccordionSummary-content": { my: 0.5 } }}
      >
        <Typography variant="caption" color="text.secondary">
          Trail of evidence — how AI derived this column
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 0 }}>
        <Stack spacing={1.5} divider={<Divider flexItem />}>
          {conclusions.map((c) => (
            <ConclusionRow key={c.label} conclusion={c} />
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

function ConclusionRow({ conclusion }: { conclusion: Conclusion }) {
  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {conclusion.label}: {conclusion.value}
      </Typography>
      {conclusion.quote && (
        <Box
          sx={{
            borderLeft: 2,
            borderColor: "divider",
            pl: 1.25,
            mb: 0.5,
          }}
        >
          <Typography
            variant="body2"
            sx={{ fontStyle: "italic", whiteSpace: "pre-wrap" }}
          >
            “{conclusion.quote}”
          </Typography>
        </Box>
      )}
      {conclusion.observation && (
        <Typography
          variant="body2"
          sx={{ fontStyle: "italic", mb: 0.5, whiteSpace: "pre-wrap" }}
        >
          {conclusion.observation}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary">
        {conclusion.attribution} · {formatAgo(conclusion.date) ?? fmtDate(conclusion.date)}
      </Typography>
    </Box>
  );
}
