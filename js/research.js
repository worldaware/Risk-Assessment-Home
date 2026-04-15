/* =============================================================
   WORLD AWARE RISK ASSESSMENT — js/research.js
   "Research My Area" — geocodes an address, queries 7 free
   government APIs in parallel, and pre-populates the hazard
   assessment with Likelihood scores.
   ============================================================= */

'use strict';

/* ---------------------------------------------------------------
   HAZARD ID CONSTANTS (mirrors HAZARD_DATA in app.js)
--------------------------------------------------------------- */
const H_ID = {
  WILDFIRE:           1,
  EARTHQUAKE:         2,
  FLOOD_RIVERINE:     3,
  FLASH_FLOOD:        4,
  SEVERE_THUNDERSTORM:5,
  TORNADO:            6,
  HURRICANE:          7,
  WINTER_STORM:       8,
  EXTREME_HEAT:       9,
  DROUGHT:            10,
  LANDSLIDE:          11,
  DUST_STORM:         14,
  CHEMICAL_PLANT:     15,
  WASTEWATER:         21,
  AIR_QUALITY:        23,
  WUI:                55,
};

/* Hazards that require manual input — with explanatory text */
const MANUAL_REASONS = {
  16: 'No free address-level API for hazmat route proximity. Check nearby rail/highway routes manually.',
  17: 'Pipeline proximity data requires PHMSA Public Viewer at pvnpms.phmsa.dot.gov.',
  18: 'Nuclear facility proximity requires NRC facility search at nrc.gov.',
  19: 'Agricultural chemical drift depends on nearby farm operations — local knowledge required.',
  20: 'Mine/quarry hazard requires local/county GIS or state mining office data.',
  22: 'Pandemic/biological risk is a contextual hazard — no address-level API exists.',
  24: 'Power outage history is not available via public API. Contact your utility provider.',
  25: 'Short-term outage risk mirrors Extended Power Outage — enter manually.',
  26: 'Natural gas service history is utility-specific — enter manually.',
  27: 'Municipal water service history is utility-specific — enter manually.',
  28: 'Sewer failure history is utility-specific — enter manually.',
  29: 'Internet outage risk is provider-specific — enter manually.',
  30: 'Cell network reliability is carrier-specific — enter manually.',
  31: 'Landline service is carrier-specific — enter manually.',
  32: 'Emergency services capacity requires local knowledge.',
  33: 'Hospital proximity/capacity requires local knowledge.',
  34: 'School/childcare closure risk is household-specific.',
  35: 'Public transit risk depends on your specific commute routes.',
  36: 'Road/bridge closure risk requires local knowledge of evacuation routes.',
  37: 'Water main break history is utility-specific — enter manually.',
  38: 'Fuel supply risk depends on local storage and access — enter manually.',
  39: 'Dam failure risk: check your local Emergency Action Plan for upstream dams.',
  40: 'Levee failure risk: check USACE / FEMA Levee screening data for your area.',
  41: 'Electrical substation risk requires utility infrastructure data.',
  42: 'Building structural condition is assessed by visual inspection.',
  43: 'Stormwater system capacity is known to local public works departments.',
  44: 'Cyber attack risk is context-dependent — enter manually.',
  45: 'Food supply disruption risk depends on local supply chain — enter manually.',
  46: 'Medication shortage risk depends on household pharmaceutical needs.',
  47: 'Medical equipment shortage depends on household medical needs.',
  48: 'Energy supply disruption risk depends on local storage capacity.',
  49: 'Building materials shortage follows regional disaster frequency.',
  50: 'Bottled water availability depends on local retail capacity.',
  51: 'Electronics/battery availability is regional — enter manually.',
  52: 'Banking disruption risk is contextual — enter manually.',
  53: 'Civil unrest risk is highly contextual — enter manually.',
  54: 'Active threat risk is highly contextual — enter manually.',
  56: 'Economic shock risk depends on household employment situation.',
  57: 'Housing instability depends on tenure, mortgage, and local market.',
  58: 'Animal/livestock disease depends on local agricultural context.',
  59: 'Isolation/evacuation difficulty requires local road knowledge.',
  60: 'Custom hazard — enter manually.',
  61: 'Custom hazard — enter manually.',
  62: 'Custom hazard — enter manually.',
};

/* ---------------------------------------------------------------
   RESEARCH STATE
--------------------------------------------------------------- */
let _research = {
  isRunning:  false,
  address:    '',
  geocoded:   null,
  findings:   [],   // { hazardId, hazardName, category, scoreAssigned, source, finding, confidence, status, isOverridden }
  stepStatuses: {}, // stepId → 'pending' | 'running' | 'success' | 'error'
  hasResults: false,
};

/* Research step definitions (UI order) */
const STEPS = [
  { id: 'geocode',    label: 'Geocoding address',             emoji: '📍' },
  { id: 'flood',      label: 'Checking flood zones (FEMA)',   emoji: '🌊' },
  { id: 'earthquake', label: 'Checking earthquake hazard (USGS)', emoji: '🌎' },
  { id: 'wildfire',   label: 'Checking wildfire risk (USFS)', emoji: '🔥' },
  { id: 'weather',    label: 'Checking severe weather patterns (NOAA)', emoji: '🌩️' },
  { id: 'epa',        label: 'Checking industrial facilities (EPA TRI)', emoji: '🏭' },
  { id: 'airquality', label: 'Assessing air quality risk',    emoji: '💨' },
  { id: 'landslide',  label: 'Checking landslide susceptibility (USGS)', emoji: '⛰️' },
];

/* ---------------------------------------------------------------
   FETCH UTILITIES
--------------------------------------------------------------- */

/**
 * Hard timeout using Promise.race — no call can hang forever.
 */
function withTimeout(promise, ms, label) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label || 'API'} timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

/**
 * Fetch via allorigins CORS proxy — use for all government ArcGIS/EPA/NOAA
 * endpoints that block direct browser requests.
 * Returns parsed JSON of the actual API response.
 */
async function proxyFetch(url) {
  const proxyUrl = API_CONFIG.CORS_PROXY + encodeURIComponent(url);
  const resp = await fetch(proxyUrl);
  if (!resp.ok) throw new Error('Proxy fetch failed: HTTP ' + resp.status);
  const wrapper = await resp.json();
  if (!wrapper || !wrapper.contents) throw new Error('Empty proxy response');
  return JSON.parse(wrapper.contents);
}

/**
 * Direct fetch with User-Agent — for APIs that support CORS natively
 * (USGS earthquake, NOAA weather.gov, FCC).
 */
async function directFetch(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'WorldAwareRiskApp/1.0 (beworldaware.com)' },
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

/* ---------------------------------------------------------------
   STEP 0 — GEOCODER
   Primary:  Nominatim (OpenStreetMap) — CORS-friendly, no key
   Fallback: Census Geocoder via allorigins proxy
   FIPS:     FCC Area API — CORS-friendly, no key
--------------------------------------------------------------- */

/**
 * Try Nominatim first; fall back to Census via allorigins proxy.
 * Then enrich with county FIPS from the FCC Area API.
 */
async function _geocode(address) {
  console.log('[Geocode] Starting for address:', address);

  let lat, lng, zip, stateAbbr, county, city, displayAddress;

  /* ── PRIMARY: Nominatim ────────────────────────────────── */
  const nominatimUrl =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encodeURIComponent(address)}&format=json&addressdetails=1&limit=1`;

  console.log('[Geocode] Nominatim URL:', nominatimUrl);

  let nominatimOk = false;
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_CONFIG.TIMEOUT_MS);
    const resp  = await fetch(nominatimUrl, {
      signal:  ctrl.signal,
      headers: {
        'Accept-Language': 'en',
        'User-Agent': 'WorldAwareRiskApp/1.0 (beworldaware.com)',
      },
    });
    clearTimeout(timer);

    if (!resp.ok) throw new Error('Nominatim HTTP ' + resp.status);
    const results = await resp.json();
    console.log('[Geocode] Nominatim raw response:', results);

    if (!results || results.length === 0) {
      throw new Error('no results');
    }

    const r = results[0];
    lat          = parseFloat(r.lat);
    lng          = parseFloat(r.lon);
    zip          = r.address?.postcode || '';
    stateAbbr    = r.address?.state_code || r.address?.ISO3166_2_lvl4?.split('-')[1] || '';
    county       = r.address?.county || r.address?.city || r.address?.town || '';
    city         = r.address?.city   || r.address?.town || r.address?.village || '';
    displayAddress = r.display_name || address;
    nominatimOk  = true;

    console.log('[Geocode] Nominatim success — lat:', lat, 'lng:', lng,
                'county:', county, 'state:', stateAbbr, 'zip:', zip);

  } catch (nominatimErr) {
    console.warn('[Geocode] Nominatim failed:', nominatimErr.message, '— trying Census fallback');
  }

  /* ── FALLBACK: Census Geocoder via allorigins proxy ──── */
  if (!nominatimOk) {
    const censusUrl =
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress` +
      `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
    const proxied = API_CONFIG.CORS_PROXY + encodeURIComponent(censusUrl);

    console.log('[Geocode] Census fallback URL (proxied):', proxied);

    let censusData;
    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), API_CONFIG.TIMEOUT_MS + API_CONFIG.PROXY_EXTRA_MS);
      const resp  = await fetch(proxied, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error('Census proxy HTTP ' + resp.status);
      const wrapper = await resp.json();
      if (!wrapper?.contents) throw new Error('Empty proxy response');
      censusData = JSON.parse(wrapper.contents);
      console.log('[Geocode] Census raw response:', censusData);
    } catch (censusErr) {
      console.error('[Geocode] Census fallback also failed:', censusErr.message);
      throw new Error('Could not reach geocoding service. Check your internet connection and try again.');
    }

    const matches = censusData?.result?.addressMatches;
    if (!matches || matches.length === 0) {
      throw new Error('Address not found. Double-check the street address, city, and state.');
    }

    const m  = matches[0];
    const co = m.coordinates || {};
    const cp = m.addressComponents || {};
    lat          = co.y;
    lng          = co.x;
    zip          = cp.zip    || '';
    stateAbbr    = cp.state  || '';
    county       = cp.county || '';
    city         = cp.city   || '';
    displayAddress = m.matchedAddress || address;

    console.log('[Geocode] Census success — lat:', lat, 'lng:', lng);
  }

  /* Validate we have usable coordinates */
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
    throw new Error('Address not found. Double-check the street address, city, and state.');
  }

  /* ── FIPS LOOKUP: FCC Area API ───────────────────────── */
  let fips5     = '';
  let stateFips = '';
  let countyFips = '';

  try {
    const fccUrl =
      `https://geo.fcc.gov/api/census/block/find` +
      `?latitude=${lat}&longitude=${lng}&format=json`;

    console.log('[Geocode] FCC FIPS URL:', fccUrl);

    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_CONFIG.TIMEOUT_MS);
    const resp  = await fetch(fccUrl, { signal: ctrl.signal });
    clearTimeout(timer);

    if (resp.ok) {
      const fcc = await resp.json();
      console.log('[Geocode] FCC response:', fcc);

      const fccFips  = fcc?.County?.FIPS  || '';
      const fccState = fcc?.State?.code   || '';
      const fccCounty = fcc?.County?.name || '';

      if (fccFips) {
        fips5      = fccFips;
        stateFips  = fccFips.slice(0, 2);
        countyFips = fccFips.slice(2);
      }
      // FCC state/county fill in any gaps from Nominatim
      if (!stateAbbr && fccState) stateAbbr = fccState;
      if (!county && fccCounty)   county    = fccCounty;

      console.log('[Geocode] FIPS:', fips5, 'state:', stateAbbr, 'county:', county);
    }
  } catch (fccErr) {
    // Non-fatal — drought will skip gracefully without FIPS
    console.warn('[Geocode] FCC FIPS lookup failed (non-fatal):', fccErr.message);
  }

  const result = {
    lat, lng, zip, stateAbbr,
    county:        county || '',
    city:          city   || '',
    stateFips, countyFips, fips5,
    displayAddress,
  };

  console.log('[Geocode] Final geocode result:', result);
  return result;
}

/* ---------------------------------------------------------------
   STATE-BASED FALLBACKS (used when an API fails or times out)
--------------------------------------------------------------- */

const _WILDFIRE_HIGH_STATES = new Set([
  'CA','OR','WA','NV','AZ','NM','CO','UT','ID','MT','WY'
]);
const _QUAKE_HIGH_STATES = new Set([
  'CA','AK','WA','OR','NV','UT','HI'
]);

function _floodFallback() {
  return { score: 2, finding: 'API unavailable — baseline flood risk assumed', confidence: 'Low', isFallback: true };
}
function _quakeFallback(stateAbbr) {
  const s = (stateAbbr || '').toUpperCase();
  const score = _QUAKE_HIGH_STATES.has(s) ? 4 : 1;
  return {
    score,
    finding: `API unavailable — state heuristic (${s || 'unknown'}): ${score === 4 ? 'High seismic state' : 'Low seismic state'}`,
    confidence: 'Low', isFallback: true,
  };
}
function _wildfireFallback(stateAbbr) {
  const s = (stateAbbr || '').toUpperCase();
  const score = _WILDFIRE_HIGH_STATES.has(s) ? 3 : 1;
  return {
    score,
    finding: `API unavailable — state heuristic (${s || 'unknown'}): ${score === 3 ? 'Elevated wildfire state' : 'Low wildfire state'}`,
    confidence: 'Low', isFallback: true,
  };
}
function _landslideFallback() {
  return { score: 1, finding: 'API unavailable — minimal landslide risk assumed', confidence: 'Low', isFallback: true };
}

/* ---------------------------------------------------------------
   API 1 — FLOOD RISK (FEMA NFHL) — 4-method waterfall
   A: NFHL point query via proxy (primary)
   B: FEMA MSC endpoint via proxy (fallback)
   C: NFHL envelope query via proxy (wider net)
   D: FEMA National Risk Index — direct fetch (CORS-friendly)
--------------------------------------------------------------- */

/** Parse a zone from ArcGIS features array; return null if empty. */
function _parseNFHLFeatures(feats) {
  if (!feats || feats.length === 0) return null;
  const attrs = feats[0]?.attributes || {};
  return {
    zone:    (attrs.FLD_ZONE || attrs.FLD_ZONE_NO || '').trim().toUpperCase(),
    subtype: (attrs.ZONE_SUBTYPE || '').trim().toUpperCase(),
    sfha:    attrs.SFHA_TF === 'T' || attrs.SFHA_TF === true,
  };
}

async function _callFloodAPI(lat, lng, countyFips) {
  console.log('[FEMA Flood] Starting fetch for', lat, lng);
  const BASE = 'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query';
  const pointParams =
    `&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    `&outFields=FLD_ZONE,ZONE_SUBTYPE,SFHA_TF&returnGeometry=false&f=json`;
  const femaMapUrl = `https://msc.fema.gov/portal/search#${encodeURIComponent(lat + ',' + lng)}`;

  // ── Method A: NFHL point query ───────────────────────────
  try {
    const urlA = `${BASE}?geometry=${lng},${lat}${pointParams}`;
    const dataA = await proxyFetch(urlA);
    const parsed = _parseNFHLFeatures(dataA?.features);
    if (parsed && parsed.zone) {
      const r = mapFloodZoneToScore(parsed.zone, parsed.subtype);
      console.log('[FEMA Flood] Success via Method A — Zone:', parsed.zone, 'Score:', r.score);
      return { ...r, femaMapUrl, confidence: 'High' };
    }
  } catch (e) {
    console.warn('[FEMA Flood] Method A failed:', e.message);
  }

  // ── Method B: MSC endpoint ────────────────────────────────
  try {
    const urlB =
      `https://msc.fema.gov/arcgis/rest/services/NFHL_National_Clip/NFHL_National_Clip/MapServer/28/query` +
      `?geometry=${lng},${lat}${pointParams}`;
    const dataB = await proxyFetch(urlB);
    const parsed = _parseNFHLFeatures(dataB?.features);
    if (parsed && parsed.zone) {
      const r = mapFloodZoneToScore(parsed.zone, parsed.subtype);
      console.log('[FEMA Flood] Success via Method B — Zone:', parsed.zone, 'Score:', r.score);
      return { ...r, femaMapUrl, confidence: 'High' };
    }
  } catch (e) {
    console.warn('[FEMA Flood] Method B failed:', e.message);
  }

  // ── Method C: NFHL envelope query (wider bbox) ────────────
  try {
    const d = 0.01;
    const urlC =
      `${BASE}?where=1%3D1` +
      `&geometry=${lng - d},${lat - d},${lng + d},${lat + d}` +
      `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects` +
      `&outFields=FLD_ZONE&returnGeometry=false&f=json`;
    const dataC = await proxyFetch(urlC);
    const feats = dataC?.features || [];
    if (feats.length > 0) {
      // Use most common zone in the bbox
      const zones = feats.map(f => (f?.attributes?.FLD_ZONE || '').trim().toUpperCase()).filter(Boolean);
      const freq  = {};
      zones.forEach(z => { freq[z] = (freq[z] || 0) + 1; });
      const zone  = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0] || '';
      const r = mapFloodZoneToScore(zone, '');
      console.log('[FEMA Flood] Success via Method C — Zone:', zone, 'Score:', r.score);
      return { ...r, femaMapUrl, confidence: 'Medium' };
    }
  } catch (e) {
    console.warn('[FEMA Flood] Method C failed:', e.message);
  }

  // ── Method D: FEMA National Risk Index (CORS-friendly) ────
  if (countyFips) {
    try {
      const urlD = `https://hazards.fema.gov/nri/api/county?fips=${countyFips}`;
      const datD = await directFetch(urlD);
      const row  = Array.isArray(datD) ? datD[0] : datD;
      const rfld = parseFloat(row?.RFLD_RISKS ?? row?.rfld_risks ?? -1);
      if (rfld >= 0) {
        let score, finding;
        if      (rfld >= 75) { score = 5; finding = `NRI: Very High riverine flood risk (score ${rfld.toFixed(0)}/100)`; }
        else if (rfld >= 50) { score = 4; finding = `NRI: High riverine flood risk (score ${rfld.toFixed(0)}/100)`; }
        else if (rfld >= 25) { score = 3; finding = `NRI: Moderate riverine flood risk (score ${rfld.toFixed(0)}/100)`; }
        else if (rfld >= 10) { score = 2; finding = `NRI: Low riverine flood risk (score ${rfld.toFixed(0)}/100)`; }
        else                 { score = 1; finding = `NRI: Very low riverine flood risk (score ${rfld.toFixed(0)}/100)`; }
        console.log('[FEMA Flood] Success via Method D — NRI score:', rfld, 'Likelihood:', score);
        return { score, finding, femaMapUrl, confidence: 'Medium' };
      }
    } catch (e) {
      console.warn('[FEMA Flood] Method D failed:', e.message);
    }
  }

  // ── All methods failed ────────────────────────────────────
  console.warn('[FEMA Flood] All methods failed — returning low-confidence default');
  return {
    score: 2,
    finding: 'No FEMA flood zone data retrieved. Check msc.fema.gov manually.',
    femaMapUrl, confidence: 'Low',
  };
}

/* ---------------------------------------------------------------
   API 2 — EARTHQUAKE HAZARD (USGS NEHRP)
   Route: direct (USGS supports browser CORS natively)
--------------------------------------------------------------- */

async function _callEarthquakeAPI(lat, lng) {
  console.log('[USGS Earthquake] Starting fetch for', lat, lng);
  const url =
    `${API_CONFIG.USGS_SEISMIC}?latitude=${lat}&longitude=${lng}` +
    `&riskCategory=III&siteClass=D&title=query`;

  const data = await directFetch(url);
  const pga = data?.data?.pga;
  if (pga === undefined || pga === null) throw new Error('No PGA data returned');
  const result = mapPGAToScore(pga);
  console.log('[USGS Earthquake] Result:', result);
  return result;
}

/* ---------------------------------------------------------------
   API 3 — WILDFIRE HAZARD POTENTIAL (USFS)
   Route: proxy-first (USFS ArcGIS blocks browser CORS)
--------------------------------------------------------------- */

async function _callWildfireAPI(lat, lng) {
  console.log('[USFS Wildfire] Starting fetch for', lat, lng);
  const url =
    `${API_CONFIG.USFS_WILDFIRE}?geometry=${lng},${lat}` +
    `&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects` +
    `&outFields=WHP_Label,WHP_Category&returnGeometry=false&f=json`;

  const data = await proxyFetch(url);
  const feats = data?.features || [];

  let result;
  if (feats.length === 0) {
    result = { score: 2, finding: 'No USFS WHP data at this location — area may not be mapped', confidence: 'Low' };
  } else {
    const attrs = feats[0]?.attributes || {};
    result = mapWHPToScore(attrs.WHP_Label || '', attrs.WHP_Category);
  }
  console.log('[USFS Wildfire] Result:', result);
  return result;
}

/* ---------------------------------------------------------------
   API 4 — SEVERE WEATHER PATTERNS (NOAA NWS)
   Route: direct (weather.gov supports browser CORS natively)
--------------------------------------------------------------- */

async function _callWeatherAPI(lat, lng) {
  console.log('[NOAA Weather] Starting fetch for', lat, lng);
  const url = `${API_CONFIG.NWS_POINTS}/${lat.toFixed(4)},${lng.toFixed(4)}`;

  const data = await directFetch(url);
  const props = data?.properties || {};
  const stateAbbr  = props?.relativeLocation?.properties?.state || '';
  const countyUrl  = props?.county || '';
  const countyCode = countyUrl.split('/').pop() || '';

  const result = { stateAbbr, countyCode, success: true };
  console.log('[NOAA Weather] Result:', result);
  return result;
}

/* ---------------------------------------------------------------
   API 4b — DROUGHT (NOAA Drought Monitor)
   Route: proxy-first (Drought Monitor blocks browser CORS)
--------------------------------------------------------------- */

function _mostRecentTuesdayStr() {
  const today = new Date();
  const dow   = today.getDay();
  const back  = (dow - 2 + 7) % 7;
  const d     = new Date(today);
  d.setDate(today.getDate() - back);
  return d.toISOString().split('T')[0];
}

async function _callDroughtAPI(fips5) {
  if (!fips5) throw new Error('No FIPS code available');
  console.log('[Drought Monitor] Starting fetch for FIPS', fips5);

  const date = _mostRecentTuesdayStr();
  const url  =
    `${API_CONFIG.DROUGHT_MONITOR}?mode=table&aoi=county&date=${date}&fips=${fips5}`;

  const parsed = await proxyFetch(url);

  const row = Array.isArray(parsed) ? parsed[0] : null;
  if (!row) throw new Error('No drought data row returned');

  const result = mapDroughtToScore({
    D4: parseFloat(row.D4) || 0,
    D3: parseFloat(row.D3) || 0,
    D2: parseFloat(row.D2) || 0,
    D1: parseFloat(row.D1) || 0,
    D0: parseFloat(row.D0) || 0,
  });
  console.log('[Drought Monitor] Result:', result);
  return result;
}

/* ---------------------------------------------------------------
   API 5 — INDUSTRIAL FACILITIES (EPA TRI)
   Route: proxy-first (EPA blocks browser CORS)
--------------------------------------------------------------- */

async function _callEPAAPI(zip) {
  if (!zip) throw new Error('No ZIP code');
  console.log('[EPA TRI] Starting fetch for ZIP', zip);

  const url  = `${API_CONFIG.EPA_TRI_ZIP}/${zip}/JSON`;
  const data = await proxyFetch(url);

  if (!Array.isArray(data)) throw new Error('Unexpected EPA TRI response format');

  let highHazardCount = 0;
  let potwCount = 0;

  data.forEach(fac => {
    const sic  = fac.SIC || fac.PRIMARY_SIC || fac.NAICS || '';
    const name = (fac.FACILITY_NAME || fac.FAC_NAME || '').toLowerCase();
    const cls  = classifyFacilitySIC(sic);
    if (cls === 'high-hazard') highHazardCount++;
    if (cls === 'potw' ||
        name.includes('wastewater') ||
        name.includes('sewage') ||
        name.includes('treatment plant')) potwCount++;
  });

  const totalCount = data.length;
  const chemResult = mapTRIToChemScore(highHazardCount, totalCount, zip);
  const result = { ...chemResult, highHazardCount, totalCount, potwCount };
  console.log('[EPA TRI] Result:', result);
  return result;
}

/* ---------------------------------------------------------------
   API 6 — LANDSLIDE SUSCEPTIBILITY (USGS)
   Route: proxy-first (ArcGIS blocks browser CORS)
--------------------------------------------------------------- */

async function _callLandslideAPI(lat, lng) {
  console.log('[USGS Landslide] Starting fetch for', lat, lng);
  const url =
    `${API_CONFIG.USGS_LANDSLIDE}?geometry=${lng},${lat}` +
    `&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects` +
    `&outFields=*&returnGeometry=false&f=json`;

  const data = await proxyFetch(url);
  const feats = data?.features || [];

  let result;
  if (feats.length === 0) {
    result = { score: 1, finding: 'No USGS landslide susceptibility data for this location', confidence: 'Low' };
  } else {
    const attrs = feats[0]?.attributes || {};
    const level =
      attrs.SusceptibilityClass ||
      attrs.Susceptibility ||
      attrs.CLASS ||
      attrs.LABEL ||
      attrs.GRIDCODE;
    result = mapLandslideToScore(level);
  }
  console.log('[USGS Landslide] Result:', result);
  return result;
}

/* ---------------------------------------------------------------
   DERIVED: AIR QUALITY SCORE
--------------------------------------------------------------- */

function _deriveAirQualityScore(whpScore, epaHighHazardCount, stateAbbr) {
  const HIGH_POLLUTION_METROS = new Set([
    'CA','TX','IL','MI','PA','OH','IN'
  ]);

  let score = 2; // default
  let finding = 'Regional air quality estimate based on wildfire and industrial proximity';
  let confidence = 'Low';

  if (whpScore >= 4) {
    score = 4;
    finding = `Elevated AQ risk from wildfire smoke potential (WHP: ${whpScore})`;
    confidence = 'Medium';
  }
  if (epaHighHazardCount >= 3) {
    score = Math.min(5, score + 1);
    finding += ` + ${epaHighHazardCount} high-hazard industrial facilities nearby`;
    confidence = 'Medium';
  } else if (epaHighHazardCount >= 1 && score < 3) {
    score = 3;
    finding += ` + industrial facilities in area`;
    confidence = 'Medium';
  }
  if (HIGH_POLLUTION_METROS.has((stateAbbr || '').toUpperCase()) && score < 3) {
    score = 3;
    finding = 'Region associated with elevated urban air pollution (wildfire/industrial)';
    confidence = 'Low';
  }

  return { score, finding, confidence };
}

/* ---------------------------------------------------------------
   COMPILE ALL API RESULTS → FINDINGS ARRAY
--------------------------------------------------------------- */

function _compileFindings(apiResults, geocoded) {
  const {
    flood, earthquake, wildfire, weather, drought, epa, landslide,
  } = apiResults;

  const stateAbbr     = geocoded.stateAbbr || weather?.stateAbbr || '';
  const weatherScores = getStateWeatherScores(stateAbbr);
  const findings      = [];

  /**
   * Add a finding. If result is null (API failed), apply a fallback score
   * from `fallbackFn` and mark it as estimated — never leave score null.
   */
  function addFinding(hazardId, hazardName, category, _apiKey, result, source, fallbackFn) {
    if (!result) {
      const fb = fallbackFn ? fallbackFn() : null;
      if (fb) {
        findings.push({
          hazardId, hazardName, category,
          scoreAssigned: fb.score,
          source,
          finding: `⚠️ Estimated (data unavailable): ${fb.finding}`,
          confidence: 'Low',
          status: 'estimated',
          isOverridden: false,
        });
      } else {
        findings.push({
          hazardId, hazardName, category,
          scoreAssigned: null,
          source, finding: 'Data temporarily unavailable — enter manually',
          confidence: 'N/A', status: 'error', isOverridden: false,
        });
      }
    } else {
      findings.push({
        hazardId, hazardName, category,
        scoreAssigned: result.score,
        source,
        finding:    result.finding,
        confidence: result.confidence,
        status: 'success',
        isOverridden: false,
        // Optional extras carried through from specific APIs
        femaMapUrl: result.femaMapUrl || null,
      });
    }
  }

  // ── FLOOD ─────────────────────────────────────────────────
  const floodSrc = 'FEMA National Flood Hazard Layer (NFHL) / National Risk Index';
  // Carry femaMapUrl through so _buildFindingCard can show the FIRM link
  const floodWithUrl = flood ? { ...flood } : null;
  addFinding(H_ID.FLOOD_RIVERINE, 'Flood (riverine)', 'Natural Hazards', 'flood', floodWithUrl, floodSrc, _floodFallback);
  addFinding(H_ID.FLASH_FLOOD,    'Flash Flood',      'Natural Hazards', 'flood', floodWithUrl, floodSrc, _floodFallback);

  // ── EARTHQUAKE ────────────────────────────────────────────
  addFinding(H_ID.EARTHQUAKE, 'Earthquake', 'Natural Hazards',
    'earthquake', earthquake, 'USGS NEHRP 2020 Seismic Design Values — Peak Ground Acceleration',
    () => _quakeFallback(stateAbbr));

  // ── WILDFIRE + WUI + AQ boost ────────────────────────────
  const whpSrc = 'USFS Wildfire Hazard Potential dataset — national fuel/landscape conditions';
  addFinding(H_ID.WILDFIRE, 'Wildfire', 'Natural Hazards', 'wildfire', wildfire, whpSrc,
    () => _wildfireFallback(stateAbbr));
  addFinding(H_ID.WUI, 'Wildland-Urban Interface Encroachment', 'Other & Human-Caused',
    'wildfire', wildfire, whpSrc, () => _wildfireFallback(stateAbbr));

  // WUI sub-note: also drives AQ
  const whpScore = wildfire?.score || 2;

  // Air quality — derived
  const epaHigh  = epa?.highHazardCount || 0;
  const aqResult = _deriveAirQualityScore(whpScore, epaHigh, stateAbbr);
  findings.push({
    hazardId: H_ID.AIR_QUALITY, hazardName: 'Air Quality Crisis', category: 'Industrial & CBRN',
    scoreAssigned: aqResult.score,
    source: 'Derived from USFS wildfire hazard, EPA TRI industrial proximity, and regional patterns',
    finding:    aqResult.finding,
    confidence: aqResult.confidence,
    status: 'success', isOverridden: false,
  });

  // ── WEATHER HEURISTICS ────────────────────────────────────
  const weatherNote = stateAbbr
    ? `State: ${stateAbbr} — regional historical patterns`
    : 'Regional historical patterns (state lookup)';
  const weatherSrc = 'NOAA NWS regional patterns and state-level historical hazard data';

  const weatherMap = [
    { id: H_ID.SEVERE_THUNDERSTORM, name: 'Severe Thunderstorm', key: 'severeThunderstorm' },
    { id: H_ID.TORNADO,             name: 'Tornado',             key: 'tornado' },
    { id: H_ID.HURRICANE,           name: 'Hurricane / Tropical Storm', key: 'hurricane' },
    { id: H_ID.WINTER_STORM,        name: 'Winter Storm / Ice Storm',   key: 'winterStorm' },
    { id: H_ID.EXTREME_HEAT,        name: 'Extreme Heat',        key: 'extremeHeat' },
    { id: H_ID.DUST_STORM,          name: 'Dust Storm / Haboob', key: 'dustStorm' },
  ];

  weatherMap.forEach(({ id, name, key }) => {
    const score = weatherScores[key] || 2;
    findings.push({
      hazardId: id, hazardName: name, category: 'Natural Hazards',
      scoreAssigned: score,
      source: weatherSrc,
      finding: `State-based heuristic (${stateAbbr || 'unknown'}): ${score === 4 ? 'Likely' : score === 3 ? 'Possible' : 'Unlikely'} ${weatherNote}`,
      confidence: stateAbbr ? 'Medium' : 'Low',
      status: 'success', isOverridden: false,
    });
  });

  // ── DROUGHT ───────────────────────────────────────────────
  addFinding(H_ID.DROUGHT, 'Drought', 'Natural Hazards',
    'drought', drought, 'NOAA Drought Monitor — county-level drought conditions',
    () => ({ score: 2, finding: 'API unavailable — moderate drought risk assumed as baseline', confidence: 'Low', isFallback: true }));

  // ── EPA TRI — Chemical + Wastewater ──────────────────────
  const epaChemResult = epa ? { score: epa.chemScore, finding: epa.finding, confidence: epa.confidence } : null;
  addFinding(H_ID.CHEMICAL_PLANT, 'Chemical Plant / Refinery Release', 'Industrial & CBRN',
    'epa', epaChemResult,
    'EPA Toxics Release Inventory (TRI) — regulated industrial facilities in ZIP code',
    () => ({ score: 2, finding: 'API unavailable — industrial proximity unknown', confidence: 'Low', isFallback: true }));

  if (epa) {
    const potw = epa.potwCount > 0;
    findings.push({
      hazardId: H_ID.WASTEWATER, hazardName: 'Wastewater / Sewage Release', category: 'Industrial & CBRN',
      scoreAssigned: potw ? 2 : 1,
      source: 'EPA TRI — wastewater treatment facility proximity',
      finding: potw
        ? `${epa.potwCount} wastewater/treatment facilit${epa.potwCount > 1 ? 'ies' : 'y'} found in ZIP ${geocoded.zip}`
        : `No wastewater treatment facilities found in ZIP ${geocoded.zip}`,
      confidence: 'Medium', status: 'success', isOverridden: false,
    });
  } else {
    findings.push({
      hazardId: H_ID.WASTEWATER, hazardName: 'Wastewater / Sewage Release', category: 'Industrial & CBRN',
      scoreAssigned: null, source: 'EPA TRI',
      finding: 'Data temporarily unavailable — enter manually',
      confidence: 'N/A', status: 'error', isOverridden: false,
    });
  }

  // ── LANDSLIDE ─────────────────────────────────────────────
  addFinding(H_ID.LANDSLIDE, 'Landslide / Mudslide', 'Natural Hazards',
    'landslide', landslide, 'USGS National Landslide Susceptibility dataset',
    _landslideFallback);

  return findings;
}

/* ---------------------------------------------------------------
   STEP STATUS HELPERS
--------------------------------------------------------------- */

function _setStep(stepId, status) {
  _research.stepStatuses[stepId] = status;
  _renderStepItem(stepId, status);
}

function _renderStepItem(stepId, status) {
  const el = document.getElementById(`step-${stepId}`);
  if (!el) return;

  const iconEl = el.querySelector('.step-icon');
  const step   = STEPS.find(s => s.id === stepId);
  if (!step || !iconEl) return;

  const icons = { pending: '⏳', running: '⏳', success: '✅', error: '⚠️' };
  iconEl.textContent = icons[status] || '⏳';

  el.className = `research-step step-${status}`;
}

/* ---------------------------------------------------------------
   MAIN RESEARCH RUNNER
--------------------------------------------------------------- */

/**
 * Wrap an API promise so it:
 *  1. Has a hard 8-second timeout
 *  2. Updates its spinner step immediately when it settles
 *  3. Never rejects (returns null on failure so Promise.allSettled
 *     always has 7 fulfilled slots — one per API)
 */
function _tracked(stepId, apiPromise) {
  return withTimeout(apiPromise, 8000, stepId)
    .then(result => {
      _setStep(stepId, 'success');
      return result;
    })
    .catch(err => {
      console.warn(`[Research] ${stepId} failed:`, err.message);
      _setStep(stepId, 'error');
      return null;   // null signals "_compileFindings" to use fallback
    });
}

async function startResearch() {
  const input = document.getElementById('research-address-input');
  if (!input) return;

  const address = (input.value || '').trim();
  if (!address) {
    _showResearchError('Please enter a street address before researching.');
    return;
  }

  if (_research.isRunning) return;
  _research.isRunning = true;

  // Reset state
  _research.address    = address;
  _research.geocoded   = null;
  _research.findings   = [];
  _research.hasResults = false;
  STEPS.forEach(s => { _research.stepStatuses[s.id] = 'pending'; });

  // Show loading UI
  _showSection('loading');
  _renderLoadingSteps();

  // ── STEP 0: GEOCODE (must complete first) ─────────────────
  _setStep('geocode', 'running');
  let geocoded;
  try {
    geocoded = await withTimeout(_geocode(address), 15000, 'Geocoding');
    _research.geocoded = geocoded;
    _setStep('geocode', 'success');
    console.log('[Research] Geocoding complete:', geocoded);
  } catch (err) {
    _setStep('geocode', 'error');
    _research.isRunning = false;
    console.error('[Research] Geocoding failed:', err.message);
    _showResearchError(
      err.message.includes('not found') || err.message.includes('Double-check')
        ? 'Address not found. Double-check the street address, city, and state.'
        : 'Could not reach geocoding service. Check your internet connection and try again.'
    );
    return;
  }

  // ── STEPS 1–7: PARALLEL API CALLS (spinners update independently) ──
  ['flood','earthquake','wildfire','weather','epa','airquality','landslide']
    .forEach(id => _setStep(id, 'running'));

  const { lat, lng, zip, fips5, countyFips } = geocoded;

  console.log('[Research] Starting parallel API calls for lat:', lat, 'lng:', lng, 'zip:', zip, 'fips5:', fips5);

  // Air quality is always derived — mark it running separately
  // and resolve it after the other calls finish
  const [flood, earthquake, wildfire, weather, drought, epa, landslide] =
    await Promise.all([
      _tracked('flood',      _callFloodAPI(lat, lng, countyFips)),
      _tracked('earthquake', _callEarthquakeAPI(lat, lng)),
      _tracked('wildfire',   _callWildfireAPI(lat, lng)),
      _tracked('weather',    _callWeatherAPI(lat, lng)),
      _tracked('weather',    _callDroughtAPI(fips5)),   // shares weather step display
      _tracked('epa',        _callEPAAPI(zip)),
      _tracked('landslide',  _callLandslideAPI(lat, lng)),
    ]);

  // Air quality is always derivable — mark success after others settle
  _setStep('airquality', 'success');

  console.log('[Research] All API calls settled. Results:', {
    flood, earthquake, wildfire, weather, drought, epa, landslide
  });

  // ── COMPILE FINDINGS ──────────────────────────────────────
  _research.findings = _compileFindings(
    { flood, earthquake, wildfire, weather, drought, epa, landslide },
    geocoded
  );
  _research.hasResults = true;

  // ── SHOW RESULTS (always — even if all APIs failed) ───────
  _research.isRunning = false;
  _showSection('results');
  _renderReport();
}

/* ---------------------------------------------------------------
   APPLY SCORES TO ASSESSMENT
--------------------------------------------------------------- */

/**
 * Apply all successful auto-scores to state.scores.
 * Does NOT overwrite scores the user manually set unless
 * the existing score already carries isAuto=true.
 */
function applyResearchScores() {
  if (!_research.hasResults) return;

  const successFindings = _research.findings.filter(f => f.status === 'success' && f.scoreAssigned !== null);

  successFindings.forEach(f => {
    if (!state.scores[f.hazardId]) state.scores[f.hazardId] = {};
    const entry = state.scores[f.hazardId];

    // Respect manual entries — only overwrite if slot is empty or was itself auto-scored
    const hasManualScore = entry.l > 0 && !entry.isAuto;
    if (hasManualScore) return;

    entry.l     = f.scoreAssigned;
    entry.isAuto = true;

    // Store auto-note (don't overwrite existing manual notes)
    const autoNote =
      `[Auto-scored from: ${f.source}]\n` +
      `Finding: ${f.finding}\n` +
      `Confidence: ${f.confidence}`;
    if (!entry.notes || entry.isAuto) entry.notes = autoNote;
  });

  // Persist research metadata on state
  state.researchAddress    = _research.address;
  state.researchReport     = {
    geocoded:  _research.geocoded,
    findings:  _research.findings,
    timestamp: new Date().toISOString(),
  };
  state.autoScoreOrigins = {};
  successFindings.forEach(f => {
    state.autoScoreOrigins[f.hazardId] = {
      source: f.source, finding: f.finding, confidence: f.confidence,
    };
  });

  autoSave();

  // Navigate to assessment and expand auto-scored categories
  showScreen('assessment');
  initAssessmentUI();
  _expandScoredCategories(successFindings.map(f => f.hazardId));

  // Show a banner on the assessment screen
  _showAutoScoreBanner(successFindings.length);
}

/**
 * Remove all auto-scores from state (keep manual scores intact).
 */
function clearAutoScores() {
  Object.keys(state.scores).forEach(id => {
    if (state.scores[id]?.isAuto) {
      state.scores[id].l      = 0;
      state.scores[id].isAuto = false;
      state.scores[id].notes  = '';
    }
  });
  state.researchReport    = null;
  state.researchAddress   = '';
  state.autoScoreOrigins  = {};
  autoSave();

  // Rebuild hazard list to remove badges
  if (typeof buildHazardList === 'function') buildHazardList();
  updateProgress();

  _showSection('input');
  document.getElementById('research-address-input').value = '';
}

function _expandScoredCategories(hazardIds) {
  const scoredCats = new Set(
    HAZARD_DATA.filter(h => hazardIds.includes(h.id)).map(h => h.category)
  );
  document.querySelectorAll('.category-section').forEach(section => {
    const catName = section.dataset.category;
    if (!scoredCats.has(catName)) return;
    const rows    = section.querySelector('.category-rows');
    const chevron = section.querySelector('.cat-chevron');
    if (rows && rows.classList.contains('collapsed')) {
      rows.classList.remove('collapsed');
      if (chevron) chevron.style.transform = 'rotate(180deg)';
    }
  });
  if (window.feather) feather.replace();
}

function _showAutoScoreBanner(count) {
  // Remove any existing banner first
  const old = document.getElementById('auto-score-banner');
  if (old) old.remove();

  const banner = document.createElement('div');
  banner.id = 'auto-score-banner';
  banner.className = 'auto-score-banner';
  banner.innerHTML = `
    <div class="auto-score-banner-inner">
      <span>🔍 <strong>${count} hazards</strong> pre-scored from government data. Review and set Impact scores to complete.</span>
      <button class="btn-small btn-ghost" onclick="showScreen('research')">View Report</button>
      <button class="auto-score-banner-close" onclick="this.closest('#auto-score-banner').remove()">✕</button>
    </div>
  `;
  const header = document.querySelector('.assessment-header');
  if (header) header.insertAdjacentElement('afterend', banner);
}

/* ---------------------------------------------------------------
   OVERRIDE SCORE (in research report)
--------------------------------------------------------------- */

function _overrideScore(hazardId) {
  const finding = _research.findings.find(f => f.hazardId === hazardId);
  if (!finding) return;

  const cardEl = document.getElementById(`finding-card-${hazardId}`);
  if (!cardEl) return;

  // If override UI already showing, remove it
  const existing = cardEl.querySelector('.override-ui');
  if (existing) { existing.remove(); return; }

  const overrideDiv = document.createElement('div');
  overrideDiv.className = 'override-ui';
  overrideDiv.innerHTML = `
    <p class="override-label">Set Likelihood score:</p>
    <div class="override-choices">
      ${[1,2,3,4,5].map(v => `
        <button class="override-score-btn ${v === finding.scoreAssigned ? 'selected' : ''}"
          onclick="_applyOverride(${hazardId}, ${v})">${v}</button>
      `).join('')}
      ${finding.isOverridden ? `<button class="override-revert-btn" onclick="_revertOverride(${hazardId})">↺ Revert to auto</button>` : ''}
    </div>
  `;
  cardEl.appendChild(overrideDiv);
}

function _applyOverride(hazardId, score) {
  const finding = _research.findings.find(f => f.hazardId === hazardId);
  if (!finding) return;
  finding.scoreAssigned = score;
  finding.isOverridden  = true;
  // Re-render just this card
  const cardEl = document.getElementById(`finding-card-${hazardId}`);
  if (cardEl) cardEl.outerHTML = _buildFindingCard(finding);
}

function _revertOverride(hazardId) {
  const finding = _research.findings.find(f => f.hazardId === hazardId);
  if (!finding) return;
  finding.isOverridden = false;
  // The scoreAssigned keeps whatever the API returned — no stored original needed
  const cardEl = document.getElementById(`finding-card-${hazardId}`);
  if (cardEl) cardEl.outerHTML = _buildFindingCard(finding);
}

/* ---------------------------------------------------------------
   UI — SECTION VISIBILITY
--------------------------------------------------------------- */

function _showSection(which) {
  const sections = { input: 'research-input-section', loading: 'research-loading', results: 'research-results' };
  Object.values(sections).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  if (sections[which]) {
    const el = document.getElementById(sections[which]);
    if (el) el.classList.remove('hidden');
  }
}

function _showResearchError(msg) {
  _showSection('input');
  let errEl = document.getElementById('research-error');
  if (!errEl) {
    errEl = document.createElement('div');
    errEl.id = 'research-error';
    errEl.className = 'research-error-msg';
    const inputSection = document.getElementById('research-input-section');
    if (inputSection) inputSection.appendChild(errEl);
  }
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
}

/* ---------------------------------------------------------------
   UI — LOADING STEPS
--------------------------------------------------------------- */

function _renderLoadingSteps() {
  const container = document.getElementById('research-steps-list');
  if (!container) return;

  container.innerHTML = STEPS.map(step => `
    <div class="research-step step-pending" id="step-${step.id}">
      <span class="step-icon">⏳</span>
      <span class="step-label">${step.emoji} ${step.label}</span>
    </div>
  `).join('');
}

/* ---------------------------------------------------------------
   MANUAL LOOKUP SCORE ENTRY
   Called from inline score buttons in rich manual cards.
--------------------------------------------------------------- */

/**
 * Apply a user-entered score from a manual lookup card to the assessment.
 * Does NOT set isAuto — this is a manual entry sourced from user research.
 */
function applyManualScore(hazardId, score, source) {
  if (!state.scores[hazardId]) state.scores[hazardId] = {};
  state.scores[hazardId].l     = score;
  state.scores[hazardId].isAuto = false;
  state.scores[hazardId].notes = `Source: ${source} — manual lookup`;
  if (typeof autoSave === 'function') autoSave();

  // Highlight the selected button and dim others in this card
  const card = document.getElementById(`manual-card-${hazardId}`);
  if (card) {
    card.querySelectorAll('.manual-score-btn').forEach(btn => {
      btn.classList.toggle('selected', parseInt(btn.dataset.score) === score);
    });
    const confirm = card.querySelector('.manual-score-confirm');
    if (confirm) {
      confirm.textContent = `✅ Score ${score} saved to assessment.`;
      confirm.classList.remove('hidden');
    }
  }
}

/**
 * Build a rich interactive manual-lookup card for pipeline (17) or nuclear (18).
 */
function _buildManualLookupCard(hazardId) {
  const IS_PIPELINE = (hazardId === 17);
  const IS_NUCLEAR  = (hazardId === 18);

  if (!IS_PIPELINE && !IS_NUCLEAR) return '';

  const title   = IS_PIPELINE ? '🔧 Natural Gas Pipeline Leak / Explosion' : '☢️ Nuclear / Radiological Incident';
  const badge   = '🔗 MANUAL LOOKUP REQUIRED';
  const message = IS_PIPELINE
    ? 'Pipeline proximity data cannot be retrieved automatically — PHMSA does not provide a public address-level API.'
    : 'Nuclear facility proximity requires manual lookup — NRC does not provide a CORS-compatible public API.';
  const linkUrl = IS_PIPELINE
    ? 'https://pvnpms.phmsa.dot.gov/PublicViewer/'
    : 'https://www.nrc.gov/info-finder/facilities/';
  const linkLabel = IS_PIPELINE ? '🗺️ Open PHMSA Pipeline Map' : '☢️ Open NRC Facility Search';
  const source    = IS_PIPELINE
    ? 'PHMSA Public Viewer (pvnpms.phmsa.dot.gov) — manual lookup'
    : 'NRC Info Finder (nrc.gov) — manual lookup';

  const instructions = IS_PIPELINE ? `
    <ol class="manual-instructions">
      <li>Click the link above to open the PHMSA Public Viewer</li>
      <li>Enter your address or navigate to your neighborhood</li>
      <li>Red lines = gas transmission pipelines</li>
      <li>Blue lines = hazardous liquid pipelines (crude oil, fuels)</li>
      <li>Return here and enter your Likelihood score:<br>
        <em>No pipelines within 1 mile → score 1<br>
        Pipelines within 1 mile → score 2<br>
        Pipelines within 0.5 mile → score 3<br>
        Pipeline directly adjacent to neighborhood → score 4</em>
      </li>
    </ol>` : `
    <ol class="manual-instructions">
      <li>Click the link above to open the NRC Info Finder</li>
      <li>Select 'Power Reactors' and your state</li>
      <li>Also check 'Materials' licensees for medical/industrial sources</li>
      <li>Return here and enter your Likelihood score:<br>
        <em>No nuclear facilities within 50 miles → score 1<br>
        Research reactor or medical facility within 10 miles → score 2<br>
        Nuclear power plant within 10–50 miles → score 3<br>
        Nuclear power plant within 10 miles → score 4</em>
      </li>
    </ol>`;

  const currentScore = state?.scores?.[hazardId]?.l || 0;

  return `
    <div class="manual-lookup-card" id="manual-card-${hazardId}">
      <div class="manual-lookup-top">
        <span class="manual-lookup-title">${title}</span>
        <span class="manual-lookup-badge">${badge}</span>
      </div>
      <p class="manual-lookup-message">${escHtml(message)}</p>
      <a href="${escHtml(linkUrl)}" target="_blank" rel="noopener" class="manual-action-btn">
        ${linkLabel}
      </a>
      ${instructions}
      <div class="manual-score-entry">
        <span class="manual-score-label">Enter Likelihood score after lookup:</span>
        <div class="manual-score-buttons">
          ${[1,2,3,4,5].map(v => `
            <button class="manual-score-btn ${currentScore === v ? 'selected' : ''}"
              data-score="${v}"
              onclick="applyManualScore(${hazardId}, ${v}, '${source.replace(/'/g, "\\'")}')">
              ${v}
            </button>`).join('')}
        </div>
        <span class="manual-score-confirm hidden" id="manual-confirm-${hazardId}">
          ${currentScore ? `✅ Score ${currentScore} saved to assessment.` : ''}
        </span>
      </div>
    </div>`;
}

/* ---------------------------------------------------------------
   UI — RESEARCH REPORT
--------------------------------------------------------------- */

function _renderReport() {
  const container = document.getElementById('research-report-content');
  if (!container) return;

  const geo        = _research.geocoded;
  const findings   = _research.findings;
  // 'estimated' = fallback score used; show alongside success
  const successful = findings.filter(f => f.status === 'success' || f.status === 'estimated');
  const failed     = findings.filter(f => f.status === 'error');

  // How many hazards in total that could be auto-scored
  const autoHazardCount = Object.keys(H_ID).length; // 16
  const manualCount     = Object.keys(MANUAL_REASONS).length;

  let html = `
    <!-- Confirmed address -->
    <div class="report-address-card">
      <div class="report-address-icon">📍</div>
      <div class="report-address-info">
        <strong>${escHtml(geo.displayAddress)}</strong>
        <span>${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)} | ${escHtml(geo.county)} County, ${geo.stateAbbr}</span>
        ${geo.zip ? `<span>ZIP: ${geo.zip}  · County FIPS: ${geo.fips5 || 'N/A'}</span>` : ''}
      </div>
    </div>

    <!-- Summary banner -->
    <div class="report-summary-banner">
      <div class="report-summary-icon">📊</div>
      <div>
        <strong>We auto-scored ${successful.length} hazards</strong> from government data.<br>
        <span class="report-summary-sub">${failed.length > 0 ? `${failed.length} source${failed.length > 1 ? 's' : ''} unavailable · ` : ''}${manualCount} hazards require your input.</span>
      </div>
    </div>

    <!-- API availability note -->
    <p class="report-aq-note">
      💨 For real-time air quality, visit <strong>airnow.gov</strong> and enter your address for current AQI.
    </p>
  `;

  // ── AUTO-SCORED HAZARDS ─────────────────────────────────────
  html += `<h3 class="report-section-heading">✅ Auto-Scored Hazards (${successful.length})</h3>`;

  if (successful.length > 0) {
    // Group by category
    const cats = {};
    successful.forEach(f => {
      if (!cats[f.category]) cats[f.category] = [];
      cats[f.category].push(f);
    });

    Object.keys(cats).forEach(cat => {
      const catColor = (typeof CATEGORY_COLORS !== 'undefined' && CATEGORY_COLORS[cat]) || '#333';
      html += `<div class="report-category-group">
        <div class="report-cat-label" style="background:${catColor}">${escHtml(cat)}</div>
      `;
      cats[cat].forEach(f => { html += _buildFindingCard(f); });
      html += `</div>`;
    });
  }

  // ── FAILED API CALLS ────────────────────────────────────────
  if (failed.length > 0) {
    html += `
      <div class="report-unavailable">
        <strong>⚠️ ${failed.length} data source${failed.length > 1 ? 's' : ''} unavailable</strong> — these hazards were not auto-scored:
        <ul>${failed.map(f => `<li>${escHtml(f.hazardName)}</li>`).join('')}</ul>
      </div>
    `;
  }

  // ── MANUAL HAZARDS ────────────────────────────────────────
  html += `<h3 class="report-section-heading">✏️ Needs Your Input (${Object.keys(MANUAL_REASONS).length} hazards)</h3>
  <p class="report-manual-intro">These hazards cannot be scored from public APIs. Guidance below:</p>
  <div class="report-manual-list">`;

  // Only show hazards that aren't already in the auto-scored list
  const autoScoredIds = new Set(findings.map(f => f.hazardId));
  Object.entries(MANUAL_REASONS).forEach(([id, reason]) => {
    if (autoScoredIds.has(parseInt(id))) return; // already handled
    const numId = parseInt(id);
    // Pipeline (17) and Nuclear (18) get rich interactive cards
    if (numId === 17 || numId === 18) {
      html += _buildManualLookupCard(numId);
      return;
    }
    const hazard = (typeof HAZARD_DATA !== 'undefined') ? HAZARD_DATA.find(h => h.id === numId) : null;
    const name   = hazard ? hazard.name : `Hazard #${id}`;
    html += `
      <div class="report-manual-item">
        <strong>${escHtml(name)}</strong>
        <span>${escHtml(reason)}</span>
      </div>`;
  });

  html += `</div>`;

  // ── ACTION BUTTONS ────────────────────────────────────────
  html += `
    <div class="report-actions">
      <button class="btn-primary btn-large" onclick="applyResearchScores()">
        ✅ Apply These Scores to My Assessment
      </button>
      <button class="btn-secondary" onclick="showScreen('assessment')">
        📋 Review Assessment First
      </button>
      <button class="btn-ghost btn-small" onclick="clearAutoScores()">
        🗑️ Clear &amp; Start Over
      </button>
    </div>
  `;

  container.innerHTML = html;
}

function _buildFindingCard(f) {
  const scoreColor = _likelihoodColor(f.scoreAssigned);
  const scoreLabel = _likelihoodLabel(f.scoreAssigned);
  const catColor   = (typeof CATEGORY_COLORS !== 'undefined' && CATEGORY_COLORS[f.category]) || '#333';

  const scoredBadge = f.status === 'estimated'
    ? `<span class="auto-scored-badge" style="background:#E67E22">⚠️ ESTIMATED</span>`
    : `<span class="auto-scored-badge">🔍 AUTO-SCORED</span>`;
  const overrideBadge = f.isOverridden
    ? `<span class="override-badge">✏️ Overridden</span>` : '';
  const errorHtml = f.status === 'error'
    ? `<span class="finding-error">⚠️ ${escHtml(f.finding)}</span>` : '';

  const showDetails = f.status === 'success' || f.status === 'estimated';

  return `
    <div class="finding-card" id="finding-card-${f.hazardId}">
      <div class="finding-card-top">
        <div class="finding-left">
          <span class="finding-name">${escHtml(f.hazardName)}</span>
          <span class="finding-cat-badge" style="background:${catColor}">${escHtml(f.category)}</span>
          ${scoredBadge}
          ${overrideBadge}
        </div>
        ${f.scoreAssigned !== null ? `
        <div class="finding-score" style="background:${scoreColor.bg};color:${scoreColor.text}">
          <span class="finding-score-num">${f.scoreAssigned}</span>
          <span class="finding-score-label">${scoreLabel}</span>
        </div>` : ''}
      </div>
      ${showDetails ? `
      <div class="finding-details">
        <div class="finding-detail-row"><span class="finding-detail-key">Source:</span> <span>${escHtml(f.source)}</span></div>
        <div class="finding-detail-row"><span class="finding-detail-key">Finding:</span> <span>${escHtml(f.finding)}</span></div>
        <div class="finding-detail-row"><span class="finding-detail-key">Confidence:</span> <span class="confidence-${(f.confidence||'').toLowerCase()}">${f.confidence}</span></div>
      </div>
      ${f.femaMapUrl ? `
      <a href="${escHtml(f.femaMapUrl)}" target="_blank" rel="noopener" class="manual-action-btn">
        🗺️ Check Official FEMA Flood Map
      </a>
      <p class="manual-action-note">Verify at msc.fema.gov — enter your address for the official FIRM panel for your parcel.</p>
      ` : ''}
      <button class="btn-small btn-ghost finding-override-btn" onclick="_overrideScore(${f.hazardId})">
        ✏️ Override Score
      </button>` : errorHtml}
    </div>
  `;
}

function _likelihoodColor(score) {
  if (!score) return { bg: '#f4f4f4', text: '#888' };
  if (score >= 5) return { bg: '#FADBD8', text: '#C0392B' };
  if (score >= 4) return { bg: '#FDEBD0', text: '#E67E22' };
  if (score >= 3) return { bg: '#FEF9E7', text: '#9A7D0A' };
  return                 { bg: '#D5F5E3', text: '#27AE60' };
}

function _likelihoodLabel(score) {
  const labels = { 1: 'UNLIKELY', 2: 'LOW', 3: 'POSSIBLE', 4: 'LIKELY', 5: 'ALMOST CERTAIN' };
  return labels[score] || '—';
}

/* ---------------------------------------------------------------
   SCREEN INITIALIZATION (called by showScreen in app.js)
--------------------------------------------------------------- */

function initResearchScreen() {
  // If we already have results, restore them; else show input
  if (_research.hasResults) {
    _showSection('results');
    _renderReport();
    return;
  }

  // If state has a prior research report (from localStorage), reload it
  if (state.researchReport && state.researchReport.findings) {
    _research.geocoded   = state.researchReport.geocoded;
    _research.findings   = state.researchReport.findings;
    _research.address    = state.researchAddress || '';
    _research.hasResults = true;
    _showSection('results');
    _renderReport();
    return;
  }

  // Fresh state — show input
  _showSection('input');

  // Pre-populate address field from last known location
  const addrInput = document.getElementById('research-address-input');
  if (addrInput && state.location) {
    addrInput.value = addrInput.value || state.location;
  }

  // Bind Enter key on address input
  if (addrInput && !addrInput._researchBound) {
    addrInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') startResearch();
    });
    addrInput._researchBound = true;
  }

  // Remove any stale error message
  const errEl = document.getElementById('research-error');
  if (errEl) errEl.classList.add('hidden');
}
