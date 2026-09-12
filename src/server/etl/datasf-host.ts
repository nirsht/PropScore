/**
 * Canonical DataSF Socrata host, shared by every DataSF client.
 *
 * DataSF migrated from `data.sfgov.org` to `data.sf.gov`. The old host still
 * 301-redirects plain reads (`$where` / `$order` / `$limit` survive), which is
 * why most lanes kept working — but its redirect layer answers `403 Forbidden`
 * with an nginx error page, not a Socrata error, to *any* request carrying a
 * `$select`. That took out every projection and aggregate query we make
 * (crime, landuse, code-enforcement, dbi-complaints, housing-inventory,
 * soft-story) with no hint that the host was the cause.
 *
 * Keeping the host here means the next migration is a one-line change.
 */
export const DATASF_HOST = "https://data.sf.gov";

/**
 * Build the URL for a Socrata resource, e.g. `datasfResource("wg3w-h783")`.
 * GeoJSON endpoints pass `"geojson"` as the extension.
 */
export function datasfResource(id: string, ext: "json" | "geojson" = "json"): string {
  return `${DATASF_HOST}/resource/${id}.${ext}`;
}
