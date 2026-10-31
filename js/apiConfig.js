/* =============================================================
   WORLD AWARE RISK ASSESSMENT — js/apiConfig.js
   API endpoint configuration, timeouts, and the World Aware relay.
   ============================================================= */

'use strict';

const API_CONFIG = {
  /* ── Timeouts ───────────────────────────────────────────── */
  TIMEOUT_MS:       10000,  // 10 s per API call
  PROXY_EXTRA_MS:   5000,   // extra time when routing via the relay (it has its own 10 s upstream timeout)

  /* ── World Aware relay ───────────────────────────────────
     One Cloudflare Worker that World Aware runs (source: relay/worker.js).
     It forwards GET requests to an allow-list of government hosts and adds
     the CORS header these services leave out. It keeps no logs.
     Set this to the workers.dev address printed by `wrangler deploy`,
     with no trailing slash (see relay/README.md). While it is empty, every
     lookup that needs the relay is skipped and labelled
     "Relay not configured" in the results.                              */
      RELAY_URL: 'https://wa-risk-relay.henrylmitchell-cloudflare.workers.dev',

  /* ── Geocoding (US Census Bureau) — no key required ─────── */
  CENSUS_GEOCODER:
    'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress',

  /* ── FEMA NFHL Flood Zones — no key required ──────────────
     Primary: Esri Living Atlas "USA Flood Hazard Areas" (FEMA NFHL data,
     same FLD_ZONE / ZONE_SUBTY fields). Sends CORS headers, so it is called
     direct. It holds only mapped hazard polygons: an empty answer at a point
     means unshaded Zone X (minimal hazard). FEMA's own servers refuse
     Cloudflare's network (checked 2026-10-31); FEMA_NFHL below is kept as a
     fallback through the relay. */
  ESRI_FLOOD_HAZARD:
    'https://services5.arcgis.com/7weheFjxuNkGGiZi/arcgis/rest/services/USA_Flood_Hazard_Areas_view/FeatureServer/0/query',
  FEMA_NFHL:
    'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query',

  /* ── USGS Seismic Design Values — no key required ───────
     Blocks browser CORS (checked 2026-10-25), so it goes through the relay. */
  USGS_SEISMIC:
    'https://earthquake.usgs.gov/ws/designmaps/nehrp-2020.json',

  /* ── USFS Wildfire Hazard Potential 2023 (270 m) — no key required ─
     Classified image service (Dillon 2023, RDS-2015-0047-4). The old
     EDW_WildfireHazardPotential_01 MapServer returns 404. Point lookups use
     the ImageServer "identify" operation; pixel values are
     1 very low, 2 low, 3 moderate, 4 high, 5 very high, 6 non-burnable, 7 water.
     apps.fs.usda.gov refuses Cloudflare's network (checked 2026-10-31), so this
     uses the Forest Service's copy of the same 2023 classified raster on the
     federal GeoPlatform. It sends CORS headers, so it is called direct. */
  USFS_WILDFIRE:
    'https://imagery.geoplatform.gov/iipp/rest/services/Fire_Aviation/USFS_EDW_RMRS_WildfireHazardPotentialClassified/ImageServer/identify',

  /* ── NOAA NWS Points — no key required ──────────────────── */
  NWS_POINTS: 'https://api.weather.gov/points',

  /* ── US Drought Monitor county statistics — no key required ─
     Returns CSV unless the request carries Accept: application/json, which
     the relay sets. Parameters: aoi=<5-digit FIPS>, startdate/enddate as
     M/D/YYYY, statisticsType=1 (cumulative D0..D4 percent of area).      */
  DROUGHT_MONITOR:
    'https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent',

  /* ── FEMA National Risk Index, county level — no key required ─ */
  FEMA_NRI_COUNTY:
    'https://hazards.fema.gov/nri/api/county',

  /* ── EPA TRI (Toxics Release Inventory) — no key required ─
     Envirofacts column is `zip_code` (lowercase); FACILITY_ZIP never answers.
     The service sends Access-Control-Allow-Origin: *, so call it direct.  */
  EPA_TRI_ZIP:
    'https://data.epa.gov/efservice/TRI_FACILITY/zip_code',

  /* ── USGS Landslide Susceptibility — not wired ────────────
     The old services.arcgis.com/jIL9msH9OI208GCb/.../landslide_susceptibility_US
     layer answers {"error":{"code":400,"message":"Invalid URL"}}. The current
     USGS national map (Belair et al. 2024, doi:10.5066/P13KAGU3) is published
     as file downloads only; no point-query service was found (2026-10-26).
     Empty means "no source": the landslide row stays an honest placeholder.
     See relay/README.md, "Open items".                                    */
  USGS_LANDSLIDE: '',
};
