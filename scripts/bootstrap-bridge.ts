/**
 * Sanity-check the Bridge connection and explore the schema.
 *
 *   1. Fetch the OData $metadata document (proves auth works).
 *   2. Enumerate every EntitySet and look for ones that hold media.
 *   3. Find which EntityType actually owns MediaURL/MediaKey.
 *   4. Probe each candidate endpoint against a real listing.
 */
import { fetchListingMedia, fetchMetadata, searchAll } from "@/server/etl/bridge-client";
import { env } from "@/lib/env";

async function main() {
  console.log(`[bootstrap] dataset=${env.BRIDGE_DATASET} base=${env.BRIDGE_BASE_URL}`);
  console.log("[bootstrap] fetching metadata…");
  const xml = await fetchMetadata();
  console.log(`[bootstrap] metadata length: ${xml.length} chars`);

  // ---- Schema introspection ----
  const entitySets = uniq(
    Array.from(xml.matchAll(/<EntitySet\s+Name="([^"]+)"/g)).map((m) => m[1]!),
  );
  const entityTypes = uniq(
    Array.from(xml.matchAll(/<EntityType\s+Name="([^"]+)"/g)).map((m) => m[1]!),
  );
  console.log(`[bootstrap] EntitySets (${entitySets.length}):`, entitySets.join(", "));
  console.log(
    `[bootstrap] EntityTypes that look media-ish:`,
    entityTypes.filter((n) => /media|photo|image/i.test(n)).join(", ") || "(none)",
  );

  // Find which EntityType *contains* MediaURL — that's the type we need to query.
  const typeBlocks = Array.from(
    xml.matchAll(/<EntityType\s+Name="([^"]+)"[\s\S]*?<\/EntityType>/g),
  );
  const typesWithMediaURL = typeBlocks
    .filter((m) => /Property\s+Name="MediaURL"/i.test(m[0]))
    .map((m) => m[1]!);
  console.log(
    `[bootstrap] EntityTypes containing MediaURL:`,
    typesWithMediaURL.join(", ") || "(none)",
  );

  // Map EntityTypes to EntitySets (case-insensitive) so we know what to GET.
  const setForType = new Map<string, string>();
  for (const set of entitySets) {
    const re = new RegExp(`<EntitySet\\s+Name="${set}"\\s+EntityType="[^"]*\\.([^"]+)"`, "i");
    const m = xml.match(re);
    if (m && m[1]) setForType.set(m[1], set);
  }
  const candidateMediaSets = typesWithMediaURL
    .map((t) => setForType.get(t))
    .filter((v): v is string => !!v);
  console.log(`[bootstrap] candidate Media EntitySets:`, candidateMediaSets.join(", ") || "(none)");

  // What FK fields does each media type expose? (we'll try filtering on them)
  for (const t of typesWithMediaURL) {
    const block = typeBlocks.find((m) => m[1] === t)?.[0] ?? "";
    const props = Array.from(block.matchAll(/<Property\s+Name="([^"]+)"/g)).map((m) => m[1]!);
    const fks = props.filter((p) =>
      /^(ResourceRecordKey|ResourceRecordKeyNumeric|ListingKey|ListingId|MediaObjectID|ResourceName)$/i.test(
        p,
      ),
    );
    console.log(`[bootstrap]   ${t} foreign-key-ish fields:`, fks.join(", "));
  }

  // ---- Property entity introspection ----
  const propertyBlock =
    typeBlocks.find((m) => m[1] === "Property")?.[0] ?? "";
  const propertyFields = Array.from(
    propertyBlock.matchAll(/<Property\s+Name="([^"]+)"[^>]*Type="([^"]+)"/g),
  ).map((m) => ({ name: m[1]!, type: m[2]! }));
  const mediaLikeFieldsOnProperty = propertyFields.filter((f) =>
    /media|photo|image|virtual|tour|url/i.test(f.name),
  );
  console.log(
    `\n[bootstrap] Property has ${propertyFields.length} fields. Media-like fields directly on Property:`,
  );
  for (const f of mediaLikeFieldsOnProperty) {
    console.log(`   - ${f.name.padEnd(40)} ${f.type}`);
  }
  if (mediaLikeFieldsOnProperty.length === 0) {
    console.log("   (none)");
  }

  // ---- Sample listings ----
  console.log("\n[bootstrap] fetching first page of active listings…");
  const result = await searchAll({
    filter: "StandardStatus eq 'Active'",
    maxRows: 5,
  });
  console.log(`[bootstrap] sample (${result.fetched} rows):`);
  for (const r of result.records) {
    console.log(
      "  -",
      r.ListingId ?? r.ListingKey,
      "|",
      r.UnparsedAddress ?? "—",
      "|",
      r.PropertyType ?? r.PropertySubType,
      "|",
      r.ListPrice,
    );
  }

  const first = result.records[0];
  if (!first) return;
  const listingKey = String(first.ListingKey ?? "");
  const listingId = String(first.ListingId ?? "");

  // ---- Probe each candidate media set against the first listing ----
  console.log(
    `\n[bootstrap] probing each candidate set for ListingKey=${listingKey} / ListingId=${listingId}…`,
  );

  const tries: Array<{ set: string; field: string; key: string; quoted: boolean }> = [];
  for (const set of candidateMediaSets) {
    for (const key of [listingKey, listingId].filter(Boolean)) {
      for (const field of [
        "ResourceRecordKey",
        "ResourceRecordKeyNumeric",
        "ListingKey",
        "ListingId",
      ]) {
        // Try both quoted (string) and unquoted (numeric) values.
        tries.push({ set, field, key, quoted: true });
        if (/^\d+$/.test(key)) tries.push({ set, field, key, quoted: false });
      }
    }
  }

  for (const t of tries) {
    const value = t.quoted ? `'${t.key.replace(/'/g, "''")}'` : t.key;
    const filter = encodeURIComponent(`${t.field} eq ${value}`);
    const url = `${env.BRIDGE_BASE_URL}/${env.BRIDGE_DATASET}/${t.set}?$filter=${filter}&$top=3&access_token=${env.BRIDGE_SERVER_TOKEN}`;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const status = res.status;
      const body = (await res.json().catch(() => ({}))) as { value?: unknown[]; error?: unknown };
      const count = Array.isArray(body.value) ? body.value.length : 0;
      const ok = status === 200;
      const summary = `${ok ? "✓" : "✗"} ${status} ${t.set} ${t.field}${
        t.quoted ? "" : "(num)"
      }=${t.key}  count=${count}`;
      if (ok && count > 0) {
        console.log(`${summary}  FIRST-ITEM-KEYS: ${Object.keys((body.value as object[])[0] ?? {}).join(",")}`);
      } else if (ok) {
        console.log(summary);
      } else {
        console.log(`${summary}  err=${JSON.stringify(body.error ?? body).slice(0, 140)}`);
      }
    } catch (err) {
      console.log(`✗ ${t.set} ${t.field}=${t.key}  fetch threw: ${(err as Error).message}`);
    }
  }

  // ---- Try $select-ing every media-like field directly off Property ----
  if (mediaLikeFieldsOnProperty.length > 0) {
    const selectFields = mediaLikeFieldsOnProperty.map((f) => f.name);
    const url = `${env.BRIDGE_BASE_URL}/${env.BRIDGE_DATASET}/Property?$filter=${encodeURIComponent(
      `ListingKey eq '${(listingKey || listingId).replace(/'/g, "''")}'`,
    )}&$top=1&$select=${encodeURIComponent(selectFields.join(","))}&access_token=${env.BRIDGE_SERVER_TOKEN}`;
    console.log(`\n[bootstrap] $select-ing those fields directly on Property:`);
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const body = await res.json();
      console.log(`  → status=${res.status}`);
      console.log(`  → payload: ${JSON.stringify(body).slice(0, 600)}`);
    } catch (err) {
      console.log(`  → fetch threw: ${(err as Error).message}`);
    }
  }

  // ---- Also try the legacy in-client fetch as a control ----
  console.log("\n[bootstrap] for reference, the in-client fetcher result:");
  const media = await fetchListingMedia(listingKey || listingId);
  console.log(`  → ${media.items.length} items via "${media.via}"`);
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

main().catch((err) => {
  console.error("[bootstrap] failed:", err);
  process.exit(1);
});
