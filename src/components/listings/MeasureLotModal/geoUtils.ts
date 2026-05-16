export type Point = { lng: number; lat: number };

const SQM_TO_SQFT = 10.7639;
const EARTH_RADIUS_M = 6_378_137;

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

/**
 * Spherical excess (planimetric) area for a polygon defined by lng/lat
 * vertices. Plenty accurate for parcel-scale geometry — Karney's algorithm
 * would only matter for >100km polygons.
 */
export function computeAreaSqft(points: Point[]): number | null {
  if (points.length < 3) return null;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    total +=
      toRad(b.lng - a.lng) *
      (2 + Math.sin(toRad(a.lat)) + Math.sin(toRad(b.lat)));
  }
  const sqMeters = Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
  return sqMeters * SQM_TO_SQFT;
}

export function buildPolygonGeoJson(points: Point[]) {
  if (points.length < 3) return null;
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "Polygon" as const,
          coordinates: [
            [...points.map((p) => [p.lng, p.lat]), [points[0]!.lng, points[0]!.lat]],
          ],
        },
      },
    ],
  };
}

export function buildInProgressLineGeoJson(points: Point[]) {
  if (points.length < 2 || points.length >= 3) return null;
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "LineString" as const,
          coordinates: points.map((p) => [p.lng, p.lat]),
        },
      },
    ],
  };
}
