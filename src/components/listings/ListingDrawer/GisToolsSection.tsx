import { Box, Button, Paper, Stack, Tooltip, Typography } from "@mui/material";
import DirectionsWalkRoundedIcon from "@mui/icons-material/DirectionsWalkRounded";
import HomeWorkRoundedIcon from "@mui/icons-material/HomeWorkRounded";
import LayersRoundedIcon from "@mui/icons-material/LayersRounded";
import LocationOnRoundedIcon from "@mui/icons-material/LocationOnRounded";
import PublicRoundedIcon from "@mui/icons-material/PublicRounded";
import StraightenRoundedIcon from "@mui/icons-material/StraightenRounded";
import StreetviewRoundedIcon from "@mui/icons-material/StreetviewRounded";
import WaterDamageRoundedIcon from "@mui/icons-material/WaterDamageRounded";
import { CopyAndOpenLink, ToolLink } from "./ToolLinks";

// Redfin requires an internal /home/<id> for property pages and blocks
// server-side autocomplete via CloudFront, so we route through
// DuckDuckGo's `!ducky` bang — DDG redirects to the top Google result
// for `site:redfin.com <address>`, which is reliably the property page.
function buildRedfinUrl(fullAddress: string): string {
  return fullAddress
    ? `https://duckduckgo.com/?q=${encodeURIComponent(`!ducky site:redfin.com ${fullAddress}`)}`
    : "https://www.redfin.com";
}

// Zillow's `_rb` redirect expects dash-separated tokens, not URL-encoded
// spaces/commas — encodeURIComponent produces 404s.
function buildZillowUrl(fullAddress: string): string {
  const zillowSlug = fullAddress.replace(/,/g, "").trim().replace(/\s+/g, "-");
  return zillowSlug ? `https://www.zillow.com/homes/${zillowSlug}_rb/` : "https://www.zillow.com";
}

export function GisToolsSection({
  fullAddress,
  address,
  city,
  state,
  lat,
  lng,
  onMeasureClick,
}: {
  fullAddress: string;
  address: string | null | undefined;
  city: string | null | undefined;
  state: string | null | undefined;
  lat: number | null;
  lng: number | null;
  onMeasureClick: () => void;
}) {
  const redfinUrl = buildRedfinUrl(fullAddress);
  const zillowUrl = buildZillowUrl(fullAddress);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
        GIS &amp; external tools
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <ToolLink
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress || `${lat},${lng}`)}`}
          icon={<LocationOnRoundedIcon fontSize="small" />}
          label="Google Maps"
        />
        <ToolLink
          href={(() => {
            const query =
              lat != null && lng != null
                ? `${lat},${lng}`
                : [address, city, state]
                    .filter((p): p is string => Boolean(p))
                    .map((p) => encodeURIComponent(p))
                    .join(",+")
                    .replace(/%20/g, "+");
            const coords =
              lat != null && lng != null ? `/@${lat},${lng},150a,500d,35y,0h,0t,0r` : "";
            return `https://earth.google.com/web/search/${query}${coords}`;
          })()}
          icon={<PublicRoundedIcon fontSize="small" />}
          label="Google Earth (3D)"
        />
        <ToolLink
          href={
            lat != null && lng != null
              ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`
              : `https://www.google.com/maps?q=${encodeURIComponent(fullAddress)}&layer=c`
          }
          icon={<StreetviewRoundedIcon fontSize="small" />}
          label="Street View"
        />
        <ToolLink
          href={zillowUrl}
          icon={<HomeWorkRoundedIcon fontSize="small" />}
          label="Zillow"
        />
        <CopyAndOpenLink
          href={redfinUrl}
          icon={<HomeWorkRoundedIcon fontSize="small" />}
          label="Redfin"
          copyText={fullAddress}
        />
        <ToolLink
          href={`https://www.walkscore.com/score/${encodeURIComponent(fullAddress)}`}
          icon={<DirectionsWalkRoundedIcon fontSize="small" />}
          label="WalkScore"
        />
        <ToolLink
          href={`https://www.bing.com/maps?q=${encodeURIComponent(fullAddress)}&style=h`}
          icon={<LayersRoundedIcon fontSize="small" />}
          label="Bing Aerial"
        />
        <ToolLink
          href={`https://hazards-fema.maps.arcgis.com/apps/webappviewer/index.html?id=8b0adb51996444d4879338b5529aa9cd&find=${encodeURIComponent(fullAddress)}`}
          icon={<WaterDamageRoundedIcon fontSize="small" />}
          label="FEMA Flood"
        />
        <CopyAndOpenLink
          href="https://sfplanninggis.org/pim"
          icon={<LayersRoundedIcon fontSize="small" />}
          label="SF PIM"
          copyText={fullAddress}
        />
        <CopyAndOpenLink
          href="https://build.symbium.com"
          icon={<HomeWorkRoundedIcon fontSize="small" />}
          label="Symbium"
          copyText={fullAddress}
        />
        <Tooltip
          title="Trace the parcel on a satellite map and compare to the API's lot size"
          arrow
        >
          <Box component="span">
            <Button
              size="small"
              variant="outlined"
              color="primary"
              startIcon={<StraightenRoundedIcon fontSize="small" />}
              onClick={onMeasureClick}
              disabled={lat == null || lng == null}
            >
              Measure lot
            </Button>
          </Box>
        </Tooltip>
      </Stack>
    </Paper>
  );
}
