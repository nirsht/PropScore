/**
 * Server-side glue for user location calibrations (see the pure
 * `blendCalibration` in ./location.ts and the `LocationCalibration` model).
 *
 * Calibrations are few (user-entered, one per corrected address), so we load
 * the whole set into memory and measure distance in JS with haversine rather
 * than issuing a PostGIS query per listing. PostGIS is used only to find which
 * *listings* fall inside a calibration's radius when a calibration changes
 * (see `listingMlsIdsWithinRadius`), where the candidate set is large.
 */
import type { db } from "@/lib/db";
import { CALIB_RADIUS_M, type NearbyCalibration } from "./location";

type Db = typeof db;

/** A calibration reduced to what scoring needs. */
export type LoadedCalibration = {
  id: string;
  lat: number;
  lng: number;
  calibratedScore: number;
};

/**
 * Within this many metres a calibration is treated as an exact match for a
 * listing (a hard override), not merely a nearby influence. Covers float
 * rounding between the listing's and the calibration's stored coordinates.
 */
export const EXACT_MATCH_M = 5;

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Stable dedup key for a physical point (~1m at SF latitudes). Re-calibrating
 * the same spot upserts on this key instead of creating a duplicate row.
 */
export function pointKeyFor(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

/**
 * Given a listing's coordinates and the loaded calibration set, split them
 * into the exact override (if any, the closest within EXACT_MATCH_M) and the
 * nearby influences within CALIB_RADIUS_M — the exact input to
 * `blendCalibration`.
 */
export function calibrationInputsFor(
  lat: number,
  lng: number,
  calibrations: ReadonlyArray<LoadedCalibration>,
): { exact: { calibratedScore: number } | null; nearby: NearbyCalibration[] } {
  let exact: { calibratedScore: number; distance: number } | null = null;
  const nearby: NearbyCalibration[] = [];

  for (const c of calibrations) {
    const distanceMeters = haversineMeters(lat, lng, c.lat, c.lng);
    if (distanceMeters <= EXACT_MATCH_M) {
      if (exact == null || distanceMeters < exact.distance) {
        exact = { calibratedScore: c.calibratedScore, distance: distanceMeters };
      }
    }
    if (distanceMeters <= CALIB_RADIUS_M) {
      nearby.push({ distanceMeters, calibratedScore: c.calibratedScore });
    }
  }

  return {
    exact: exact ? { calibratedScore: exact.calibratedScore } : null,
    nearby,
  };
}

/** Load every calibration (small set) for in-memory distance scoring. */
export function loadCalibrations(db: Db): Promise<LoadedCalibration[]> {
  return db.locationCalibration.findMany({
    select: { id: true, lat: true, lng: true, calibratedScore: true },
  });
}

/**
 * Upsert a calibration keyed on its rounded point, then set the PostGIS `geom`
 * column via raw SQL (the column isn't modeled by Prisma). Returns the row id.
 */
export async function upsertCalibration(
  db: Db,
  input: {
    lat: number;
    lng: number;
    calibratedScore: number;
    label?: string | null;
    listingMlsId?: string | null;
    note?: string | null;
    createdBy?: string | null;
  },
): Promise<string> {
  const pointKey = pointKeyFor(input.lat, input.lng);
  const row = await db.locationCalibration.upsert({
    where: { pointKey },
    create: {
      lat: input.lat,
      lng: input.lng,
      pointKey,
      calibratedScore: input.calibratedScore,
      label: input.label ?? null,
      listingMlsId: input.listingMlsId ?? null,
      note: input.note ?? null,
      createdBy: input.createdBy ?? null,
    },
    update: {
      calibratedScore: input.calibratedScore,
      label: input.label ?? null,
      listingMlsId: input.listingMlsId ?? null,
      note: input.note ?? null,
      createdBy: input.createdBy ?? null,
    },
    select: { id: true },
  });
  await db.$executeRaw`
    UPDATE "LocationCalibration"
       SET "geom" = ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography
     WHERE "id" = ${row.id}`;
  return row.id;
}

/**
 * MLS ids of every listing whose point falls within `radiusMeters` of the
 * given coordinate — the set to re-score after a calibration changes. Uses the
 * GiST-indexed `Listing.geom` column.
 */
export async function listingMlsIdsWithinRadius(
  db: Db,
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ mlsId: string }>>`
    SELECT "mlsId"
      FROM "Listing"
     WHERE "geom" IS NOT NULL
       AND ST_DWithin(
             "geom",
             ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
             ${radiusMeters}
           )`;
  return rows.map((r) => r.mlsId);
}
