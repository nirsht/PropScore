"use client";

import * as React from "react";
import { Alert, Box, Button, Paper, Stack, Typography } from "@mui/material";
import Map, { Marker, Popup, NavigationControl, type MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc/client";
import { FilterProvider, useFilter } from "@/components/listings/filterStore";
import { ListingDrawer } from "@/components/listings/ListingDrawer";
import { useSelectedListing } from "@/components/listings/useSelectedListing";

const DEFAULT_CENTER = { lng: -122.43, lat: 37.77 };
const DEFAULT_ZOOM = 11.5;

const FREE_STYLE_FALLBACK = {
  version: 8,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

function MapInner() {
  const { state, set } = useFilter();
  const mapRef = React.useRef<MapRef | null>(null);
  const [popup, setPopup] = React.useState<{
    lng: number;
    lat: number;
    address: string;
    mlsId: string;
    valueAdd: number | null;
    price: number;
  } | null>(null);
  const [selectedMlsId, setSelectedMlsId] = useSelectedListing();
  const [drawMode, setDrawMode] = React.useState<"off" | "radius">("off");

  const query = trpc.listings.search.useQuery(
    { ...state, limit: 200 },
    { placeholderData: keepPreviousData },
  );

  const styleEnv = process.env.NEXT_PUBLIC_MAP_STYLE_URL;
  const mapStyle = styleEnv && styleEnv.length > 0 ? styleEnv : (FREE_STYLE_FALLBACK as object);

  function handleMapClick(e: { lngLat: { lng: number; lat: number } }) {
    if (drawMode !== "radius") return;
    set({
      radius: { lat: e.lngLat.lat, lng: e.lngLat.lng, meters: 1500 },
    });
    setDrawMode("off");
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Typography variant="h5">Map</Typography>
        <Typography variant="body2" color="text.secondary">
          {query.data?.rows.length ?? 0} listings
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          variant={drawMode === "radius" ? "contained" : "outlined"}
          onClick={() => setDrawMode((m) => (m === "radius" ? "off" : "radius"))}
        >
          {drawMode === "radius" ? "Click on map…" : "Filter by radius"}
        </Button>
        {state.radius && (
          <Button color="warning" onClick={() => set({ radius: undefined })}>
            Clear radius ({Math.round(state.radius.meters / 100) / 10}km)
          </Button>
        )}
      </Stack>

      {query.isError && <Alert severity="error">Failed to load listings.</Alert>}

      <Paper variant="outlined" sx={{ height: "calc(100vh - 200px)", overflow: "hidden" }}>
        <Map
          ref={mapRef}
          initialViewState={{
            longitude: DEFAULT_CENTER.lng,
            latitude: DEFAULT_CENTER.lat,
            zoom: DEFAULT_ZOOM,
          }}
          mapStyle={mapStyle as never}
          onClick={handleMapClick}
          style={{ width: "100%", height: "100%" }}
        >
          <NavigationControl position="top-right" />
          {(query.data?.rows ?? []).map((r) =>
            r.lat == null || r.lng == null ? null : (
              <Marker
                key={r.mlsId}
                longitude={r.lng}
                latitude={r.lat}
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  setPopup({
                    lng: r.lng!,
                    lat: r.lat!,
                    address: r.address,
                    mlsId: r.mlsId,
                    valueAdd: r.valueAddWeightedAvg,
                    price: r.price,
                  });
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background:
                      r.valueAddWeightedAvg != null && r.valueAddWeightedAvg >= 70
                        ? "#7c5cff"
                        : "#23d29a",
                    border: "2px solid #0a0a0c",
                    boxShadow: "0 0 0 1px rgba(255,255,255,0.4)",
                    cursor: "pointer",
                  }}
                />
              </Marker>
            ),
          )}
          {popup && (
            <Popup
              longitude={popup.lng}
              latitude={popup.lat}
              onClose={() => setPopup(null)}
              closeOnClick={false}
              anchor="top"
              maxWidth="280px"
            >
              <div style={{ minWidth: 200 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{popup.address}</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  ${popup.price.toLocaleString()} · Value-Add{" "}
                  {popup.valueAdd != null ? popup.valueAdd.toFixed(1) : "—"}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMlsId(popup.mlsId);
                    setPopup(null);
                  }}
                  style={{
                    marginTop: 8,
                    width: "100%",
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "#7c5cff",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Open details →
                </button>
              </div>
            </Popup>
          )}
        </Map>
      </Paper>

      <ListingDrawer mlsId={selectedMlsId} onClose={() => setSelectedMlsId(null)} />
    </Stack>
  );
}

export function MapView() {
  return (
    <FilterProvider>
      <MapInner />
    </FilterProvider>
  );
}
