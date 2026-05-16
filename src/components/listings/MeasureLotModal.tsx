"use client";

import * as React from "react";
import {
  Box,
  Button,
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
import StraightenRoundedIcon from "@mui/icons-material/StraightenRounded";
import {
  type Point,
  buildInProgressLineGeoJson,
  buildPolygonGeoJson,
  computeAreaSqft,
} from "./MeasureLotModal/geoUtils";
import { SATELLITE_STYLE } from "./MeasureLotModal/mapConfig";
import { MeasureResults } from "./MeasureLotModal/MeasureResults";

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
          <Typography variant="h6">Can&apos;t measure this lot</Typography>
          <Typography variant="body2" color="text.secondary">
            This listing has no latitude/longitude in the MLS feed, so we
            can&apos;t center the map on it.
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

  const polygon = buildPolygonGeoJson(points);
  const inProgressLine = buildInProgressLineGeoJson(points);

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

      <MeasureResults
        measured={measured}
        apiLotSizeSqft={apiLotSizeSqft}
        delta={delta}
        ratio={ratio}
        driftPct={driftPct}
        pointCount={points.length}
        onUndo={() => setPoints((p) => p.slice(0, -1))}
        onReset={() => setPoints([])}
        onDone={onClose}
      />
    </Dialog>
  );
}
