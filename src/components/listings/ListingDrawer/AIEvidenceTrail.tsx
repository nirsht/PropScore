import * as React from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import { fmtDate, fmtMoney, unitTypeLabel } from "./formatters";
import type { ListingForDetails } from "./types";

const AGENT_LABELS: Record<string, string> = {
  "building-vision": "Photo vision",
  "listing-extract": "Listing remarks",
};

// AI column in the grid above is fed by `building-vision` (stories) and
// `listing-extract` (unit mix). Surface the rationales plus the structured
// observations that drove those numbers, so a reader can audit the AI cell.
export function AIEvidenceTrail({
  enrichments,
}: {
  enrichments: ListingForDetails["enrichments"];
}) {
  const relevant = (enrichments ?? []).filter((e) =>
    e.agentName === "building-vision" || e.agentName === "listing-extract",
  );
  if (relevant.length === 0) return null;

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
          {relevant.map((e) => (
            <EvidenceBlock key={e.id} enrichment={e} />
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

function EvidenceBlock({
  enrichment,
}: {
  enrichment: NonNullable<ListingForDetails["enrichments"]>[number];
}) {
  const label = AGENT_LABELS[enrichment.agentName] ?? enrichment.agentName;
  const out = (enrichment.output ?? {}) as Record<string, unknown>;
  const rationale = typeof out.rationale === "string" ? out.rationale : null;

  const facts: Array<[string, string]> = [];
  if (enrichment.agentName === "building-vision") {
    if (out.stories != null) facts.push(["Stories", String(out.stories)]);
    if (out.renovationLevel) {
      const conf = typeof out.renovationConfidence === "number"
        ? ` (${Math.round(out.renovationConfidence * 100)}% confidence)`
        : "";
      facts.push(["Renovation", `${String(out.renovationLevel).toLowerCase()}${conf}`]);
    }
    if (typeof out.hasBasement === "boolean") {
      facts.push(["Basement", out.hasBasement ? "yes" : "no"]);
    }
    if (typeof out.hasPenthouse === "boolean") {
      facts.push(["Penthouse", out.hasPenthouse ? "yes" : "no"]);
    }
    if (typeof out.bestPhotoReason === "string" && out.bestPhotoReason) {
      facts.push(["Hero photo pick", out.bestPhotoReason]);
    }
  } else if (enrichment.agentName === "listing-extract") {
    const um = Array.isArray(out.unitMix)
      ? (out.unitMix as Array<{ count?: number; beds: number | null; baths: number | null }>)
      : null;
    if (um && um.length) {
      const total = um.reduce((s, u) => s + (u.count ?? 0), 0);
      const breakdown = um
        .map((u) => unitTypeLabel(u.count ?? 0, u.beds, u.baths))
        .join("; ");
      facts.push(["Units", `${total} total — ${breakdown}`]);
    }
    if (typeof out.basementNotes === "string" && out.basementNotes) {
      facts.push(["Basement notes", out.basementNotes]);
    }
    if (typeof out.parkingNotes === "string" && out.parkingNotes) {
      facts.push(["Parking notes", out.parkingNotes]);
    }
    if (Array.isArray(out.recentCapex) && out.recentCapex.length) {
      facts.push(["Recent capex", (out.recentCapex as string[]).join(" · ")]);
    }
    if (typeof out.totalMonthlyRent === "number") {
      facts.push(["Total monthly rent", fmtMoney(out.totalMonthlyRent)]);
    }
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 0.5 }}>
        <Chip size="small" variant="outlined" label={label} />
        <Typography variant="caption" color="text.secondary">
          {fmtDate(enrichment.createdAt)}
        </Typography>
      </Stack>
      {rationale && (
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mb: facts.length ? 0.75 : 0 }}>
          {rationale}
        </Typography>
      )}
      {facts.length > 0 && (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            columnGap: 1.5,
            rowGap: 0.25,
          }}
        >
          {facts.map(([k, v]) => (
            <React.Fragment key={k}>
              <Typography variant="caption" color="text.secondary">
                {k}
              </Typography>
              <Typography variant="caption">{v}</Typography>
            </React.Fragment>
          ))}
        </Box>
      )}
      {!rationale && facts.length === 0 && (
        <Typography variant="caption" color="text.secondary">
          No structured evidence emitted by this run.
        </Typography>
      )}
    </Box>
  );
}
