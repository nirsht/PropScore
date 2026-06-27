import type { NormalizedListing } from "../normalize";

/**
 * Live days-on-market derived from `postDate`. Bridge's `DaysOnMarket`
 * field is a static MLS snapshot and frequently reports 0, so we never
 * trust it for scoring — instead we count days since the listing was
 * posted, the same value the user-facing grid shows.
 */
export function daysSincePost(l: Pick<NormalizedListing, "postDate">): number {
  const ms = Date.now() - l.postDate.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}
