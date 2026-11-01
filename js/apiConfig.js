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

  /* ── FEMA National Risk Index (December 2025 release) — no key required ─
     FEMA's own ArcGIS Online copies of the NRI. Both answered direct from
     the published page with CORS headers (checked from Henry's browser,
     2026-10-31). The tract layer answers a point query (JSON geometry form);
     the county layer is queried by 5-digit STCOFIPS. Request only fields
     confirmed on both layers: a single unknown name in outFields fails the
     whole query. Riverine flood is IFLD_* in this release (RFLD_* is gone). */
  NRI_TRACT:
    'https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Census_Tracts/FeatureServer/0/query',
  NRI_COUNTY:
    'https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Counties/FeatureServer/0/query',
  /* hazards.fema.gov NRI API: did not answer on 2026-10-31 (FEMA's servers
     refuse Cloudflare's network). Kept only as a last-resort flood fallback
     through the relay. */
  FEMA_NRI_COUNTY:
    'https://hazards.fema.gov/nri/api/county',

  /* ── OpenFEMA disaster declarations — no key required ─────
     Answered direct with CORS from the published page (2026-10-31). Used
     only to raise a likelihood floor, never to lower one. */
  OPENFEMA_DECLARATIONS:
    'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries',

  /* ── EPA TRI (Toxics Release Inventory) — no key required ─
     Envirofacts column is `zip_code` (lowercase); FACILITY_ZIP never answers.
     The service sends Access-Control-Allow-Origin: *, so call it direct.  */
  EPA_TRI_ZIP:
    'https://data.epa.gov/efservice/TRI_FACILITY/zip_code',

  /* ── USGS landslide (Belair et al. 2024, doi:10.5066/P13KAGU3) ─────
     The 2024 national susceptibility map is a cached tile service only
     (512 px tiles, Web Mercator, levels 1 to 12, no query or identify). The
     app reads the pixel under the address from the level-12 tile in a
     canvas and matches its colour to the legend (CONUS is layerId 8).
     Tiles, legend, inventory and post-fire layers all answered direct with
     CORS from the published page (checked from Henry's browser, 2026-10-31).
     The old jIL9msH9OI208GCb landslide_susceptibility_US layer is gone.     */
  USGS_LANDSLIDE:
    'https://tiles.arcgis.com/tiles/v01gqwM5QqNysAAi/arcgis/rest/services/US_Landslide_Susceptibility/MapServer',
  // US Landslide Inventory v3, point layer 11 (count within 1 km)
  USGS_LANDSLIDE_INVENTORY:
    'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/US_Landslide_point_v2/FeatureServer/11/query',
  // USGS post-fire debris-flow assessments, layer 4 Basin Combined Hazard (count within 1 km)
  USGS_POSTFIRE:
    'https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/USGS_Post_Fire_Hazard_Assessment_Data/FeatureServer/4/query',

  /* ── EPA Water System Boundaries (v3) — no key required ───
     Community water system service areas as polygons (ArcGIS Online, EPA).
     A point query returns PWSID, PWS_Name, Population_Served_Count and
     Service_Area_Type. No polygon at a point usually means a private well.
     Sends CORS headers, so it is called direct (checked from Henry's
     browser, 2026-10-31). */
  EPA_WATER_BOUNDARIES:
    'https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Water_System_Boundaries/FeatureServer/0/query',

  /* ── EPA SDWIS violations through Envirofacts — no key required ─
     <base>/<PWSID>/JSON returns one row per violation with lowercase
     fields. Direct, about 1.5 s (checked 2026-10-31). */
  EPA_SDWIS_VIOLATIONS:
    'https://data.epa.gov/efservice/VIOLATION/PWSID',

  /* ── USDA Soil Data Access (SSURGO) — no key required ─────
     The only POST in the app: a form-encoded SQL query. Answers direct with
     CORS (108 to 544 ms, checked 2026-10-31). The relay is GET-only, so it
     cannot help with this one. */
  USDA_SDA:
    'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest',

  /* ── Iowa Environmental Mesonet: NWS warnings by point — no key required ─
     Every NWS watch and warning (VTEC) whose zone or county covers the
     point. Answers direct with CORS (checked 2026-10-31), but IEM asks not
     to be called from busy sites, so the app goes through the relay first
     (the Worker caches IEM answers for 30 days) and calls direct only when
     the relay is not set up or fails. Coordinates are rounded to 2 decimals
     so neighbours share one cached answer. */
  IEM_VTEC_BYPOINT:
    'https://mesonet.agron.iastate.edu/json/vtec_events_bypoint.py',

  /* ── NOAA NCEI 1991-2020 climate normals — no key required ─
     Search finds normals stations in a box (bbox order north,west,south,east);
     the data service returns the annual values for one station as strings
     with leading spaces. Both direct with CORS (checked 2026-10-31). */
  NCEI_SEARCH:
    'https://www.ncei.noaa.gov/access/services/search/v1/data',
  NCEI_DATA:
    'https://www.ncei.noaa.gov/access/services/data/v1',

  /* ── EPA AQI days by county (geopub map service) — no key required ─
     Monthly percent of days in each AQI category per county with a monitor.
     The capitalised /ArcGIS/ path answers; the lower-case one does not.
     Direct with CORS, about 600 ms (checked 2026-10-31). */
  EPA_AQI_COUNTY:
    'https://geopub.epa.gov/ArcGIS/rest/services/myenv/aqi/MapServer/0/query',
};
