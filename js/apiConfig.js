/* =============================================================
   WORLD AWARE RISK ASSESSMENT — js/apiConfig.js
   API endpoint configuration, timeouts, and CORS proxy.
   ============================================================= */

'use strict';

const API_CONFIG = {
  /* ── Timeouts ───────────────────────────────────────────── */
  TIMEOUT_MS:       10000,  // 10 s per API call
  PROXY_EXTRA_MS:   5000,   // extra time when routing via CORS proxy

  /* ── CORS Proxy Cascade ──────────────────────────────────
     Tried in order. First success wins. extractor handles each proxy's
     unique response format and returns a parsed JS object.            */
  CORS_PROXIES: [
    {
      name: 'allorigins',
      url:  'https://api.allorigins.win/get?url=',
      extract: async (response) => {
        const data = await response.json();
        return JSON.parse(data.contents);
      },
    },
    {
      name: 'corsproxy.io',
      url:  'https://corsproxy.io/?',
      extract: async (response) => await response.json(),
    },
    {
      name: 'codetabs',
      url:  'https://api.codetabs.com/v1/proxy?quest=',
      extract: async (response) => await response.json(),
    },
  ],

  // Backwards-compatibility alias — points at the first proxy URL
  CORS_PROXY: 'https://api.allorigins.win/get?url=',

  /* ── Geocoding (US Census Bureau) — no key required ─────── */
  CENSUS_GEOCODER:
    'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress',

  /* ── FEMA NFHL Flood Zones — no key required ────────────── */
  FEMA_NFHL:
    'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query',

  /* ── USGS Seismic Design Values — no key required ───────── */
  USGS_SEISMIC:
    'https://earthquake.usgs.gov/ws/designmaps/nehrp-2020.json',

  /* ── USFS Wildfire Hazard Potential — no key required ───── */
  USFS_WILDFIRE:
    'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_WildfireHazardPotential_01/MapServer/0/query',

  /* ── NOAA NWS Points — no key required ──────────────────── */
  NWS_POINTS: 'https://api.weather.gov/points',

  /* ── NOAA Drought Monitor — no key required ─────────────── */
  DROUGHT_MONITOR:
    'https://droughtmonitor.unl.edu/DmData/GISData.aspx',

  /* ── EPA TRI (Toxics Release Inventory) — no key required ─ */
  EPA_TRI_ZIP:
    'https://data.epa.gov/efservice/TRI_FACILITY/FACILITY_ZIP',

  /* ── USGS Landslide Susceptibility — no key required ────── */
  USGS_LANDSLIDE:
    'https://services.arcgis.com/jIL9msH9OI208GCb/arcgis/rest/services/landslide_susceptibility_US/FeatureServer/0/query',
};
