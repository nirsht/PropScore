/**
 * Shared types reused across server, client, and agent layers.
 * Source of truth for filter shape: src/server/api/schemas/filter.ts
 */
export type Cursor = { valueAdd: number | null; mlsId: string } | null;

export type LatLng = { lat: number; lng: number };

export type RadiusFilter = { center: LatLng; meters: number };

export type PolygonFilter = { points: LatLng[] };
