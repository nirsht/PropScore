"use client";

import * as React from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import Map, {
  Layer,
  Marker,
  NavigationControl,
  Source,
  type MapRef,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import UndoRoundedIcon from "@mui/icons-material/UndoRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import StraightenRoundedIcon from "@mui/icons-material/StraightenRounded";

type Point = { lng: number; lat: number };

const SATELLITE_STYLE = {
  version: 8,
  sources: {
    sat: {
      type: "raster" as const,
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      maxzoom: 19,
    },
    labels: {
      type: "raster" as const,
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: "sat", type: "raster" as const, source: "sat" },
    { id: "labels", type: "raster" as const, source: "labels" },
  ],
};

const SQM_TO_SQFT = 10.7639;
const EARTH_RADIUS_M = 6_378_137;

/**
 * Spherical excess (planimetric) area for a polygon defined by lng/lat
 * vertices. Plenty accurate for parcel-scale geometry — Karney's algorithm
 * would only matter for >100km polygons.
 */
function computeAreaSqft(points: Point[]): number | null {
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

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

const fmt = (n: number) => `${Math.round(n).toLocaleString()} sqft`;

export function MeasureLotModal({
  open,
  onClose,
  lat,
  lng,
  address,
  apiLotSizeSqft,
}: {
  open: boolean;
  onClose: () => void;
  lat: number | null;
  lng: number | null;
  address: string;
  apiLotSizeSqft: number | null;
}) {
  const mapRef = React.useRef<MapRef | null>(null);
  const [points, setPoints] = React.useState<Point[]>([]);

  // Reset on open so a fresh measurement starts every time.
  React.useEffect(() => {
    if (!open) setPoints([]);
  }, [open]);

  if (lat == null || lng == null) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <Stack sx={{ p: 3 }} spacing={1}>
          <Typography variant="h6">Can't measure this lot</Typography>
          <Typography variant="body2" color="text.secondary">
            This listing has no latitude/longitude in the MLS feed, so we can't
            center the map on it.
          </Typography>
          <Box sx={{ alignSelf: "flex-end", mt: 1 }}>
            <Button variant="contained" onClick={onClose}>
              Close
            </Button>
          </Box>
        </Stack>
      </Dialog>
    );
  }

  const measured = computeAreaSqft(points);
  const haveBoth = measured != null && apiLotSizeSqft != null;
  const delta = haveBoth ? measured! - apiLotSizeSqft! : null;
  const ratio = haveBoth ? measured! / apiLotSizeSqft! : null;
  const driftPct =
    delta != null && apiLotSizeSqft ? Math.abs(delta) / apiLotSizeSqft : null;

  function handleMapClick(e: { lngLat: { lng: number; lat: number } }) {
    setPoints((prev) => [...prev, { lng: e.lngLat.lng, lat: e.lngLat.lat }]);
  }

  function updatePoint(i: number, ll: { lng: number; lat: number }) {
    setPoints((prev) => prev.map((p, idx) => (idx === i ? { lng: ll.lng, lat: ll.lat } : p)));
  }

  const polygon =
    points.length >= 3
      ? {
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
        }
      : null;

  const inProgressLine =
    points.length >= 2 && points.length < 3
      ? {
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
        }
      : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      slotProps={{ paper: { sx: { bgcolor: "background.default", height: { md: "85vh" } } } }}
    >
      {/* Header */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{
          px: 2,
          py: 1.25,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <StraightenRoundedIcon fontSize="small" color="primary" />
        <Box sx={{ overflow: "hidden", flex: 1 }}>
          <Typography variant="subtitle2" sx={{ lineHeight: 1.2 }}>
            Measure lot
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {address}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseRoundedIcon />
        </IconButton>
      </Stack>

      {/* Map */}
      <Box sx={{ position: "relative", flex: 1, minHeight: 360 }}>
        <Map
          ref={mapRef}
          initialViewState={{
            longitude: lng,
            latitude: lat,
            zoom: 18.5,
          }}
          mapStyle={SATELLITE_STYLE as never}
          onClick={handleMapClick}
          style={{ width: "100%", height: "100%" }}
          cursor={"crosshair"}
        >
          <NavigationControl position="top-right" />

          {polygon && (
            <Source id="poly" type="geojson" data={polygon}>
              <Layer
                id="poly-fill"
                type="fill"
                paint={{ "fill-color": "#7c5cff", "fill-opacity": 0.28 }}
              />
              <Layer
                id="poly-outline"
                type="line"
                paint={{ "line-color": "#7c5cff", "line-width": 2.5 }}
              />
            </Source>
          )}
          {inProgressLine && (
            <Source id="ipline" type="geojson" data={inProgressLine}>
              <Layer
                id="ipline-stroke"
                type="line"
                paint={{
                  "line-color": "#7c5cff",
                  "line-width": 2,
                  "line-dasharray": [2, 2],
                }}
              />
            </Source>
          )}

          {points.map((p, i) => (
            <Marker
              key={i}
              longitude={p.lng}
              latitude={p.lat}
              draggable
              onDragEnd={(e) => updatePoint(i, e.lngLat)}
            >
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: "#fff",
                  border: "2px solid #7c5cff",
                  boxShadow: "0 0 0 2px rgba(0,0,0,0.45)",
                  cursor: "grab",
                }}
              />
            </Marker>
          ))}
        </Map>

        {/* Instruction overlay */}
        <Box
          sx={{
            position: "absolute",
            top: 12,
            left: 12,
            background: "rgba(8,8,12,0.78)",
            color: "common.white",
            px: 1.5,
            py: 1,
            borderRadius: 1.5,
            backdropFilter: "blur(4px)",
            maxWidth: 280,
          }}
        >
          <Typography variant="caption" sx={{ display: "block", lineHeight: 1.45 }}>
            Click to drop corners around the parcel. Drag pins to refine.
            {points.length < 3 && ` ${3 - points.length} more needed.`}
            {points.length >= 3 && ` ${points.length} corners — measuring live.`}
          </Typography>
        </Box>
      </Box>

      {/* Results + actions */}
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        alignItems={{ md: "center" }}
        sx={{
          px: 2,
          py: 1.5,
          borderTop: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ flex: 1 }}>
          <Stat
            label="Measured"
            value={measured != null ? fmt(measured) : "—"}
            emphasis
          />
          <Stat
            label="API"
            value={apiLotSizeSqft != null ? fmt(apiLotSizeSqft) : "—"}
          />
          {delta != null && (
            <Stat
              label="Δ vs API"
              value={`${delta > 0 ? "+" : ""}${Math.round(delta).toLocaleString()} sqft`}
              tone={driftPct != null && driftPct > 0.2 ? "warn" : "ok"}
            />
          )}
          {ratio != null && (
            <Stat label="Ratio" value={`${Math.round(ratio * 100)}%`} />
          )}
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center">
          {points.length > 0 && (
            <Chip
              size="small"
              variant="outlined"
              label={`${points.length} corner${points.length === 1 ? "" : "s"}`}
            />
          )}
          <Button
            size="small"
            startIcon={<UndoRoundedIcon fontSize="small" />}
            onClick={() => setPoints((p) => p.slice(0, -1))}
            disabled={!points.length}
          >
            Undo
          </Button>
          <Button
            size="small"
            startIcon={<RefreshRoundedIcon fontSize="small" />}
            onClick={() => setPoints([])}
            disabled={!points.length}
          >
            Reset
          </Button>
          <Button variant="contained" size="small" onClick={onClose}>
            Done
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  emphasis,
  tone,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: "ok" | "warn";
}) {
  const color =
    tone === "warn" ? "warning.main" : emphasis ? "primary.main" : "text.primary";
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant={emphasis ? "h6" : "body1"}
        sx={{ fontWeight: emphasis ? 700 : 500, color, lineHeight: 1.2 }}
      >
        {value}
      </Typography>
    </Box>
  );
}
