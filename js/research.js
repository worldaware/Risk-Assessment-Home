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
  runId:      0,    // bumped on every start/reset so a stale run cannot write results
};

/** Abandon any lookup in flight. Its late results are ignored. */
function cancelResearch() {
  _research.runId += 1;
  _research.isRunning = false;
}

/* Research step definitions (UI order) */
const STEPS = [
  { id: 'geocode',    label: 'Finding the address' },
  { id: 'flood',      label: 'Checking flood zones (FEMA)' },
  { id: 'earthquake', label: 'Checking earthquake hazard (USGS)' },
  { id: 'wildfire',   label: 'Checking wildfire hazard (Forest Service)' },
  { id: 'weather',    label: 'Confirming the state for weather estimates (NWS)' },
  { id: 'drought',    label: 'Checking drought conditions (Drought Monitor)' },
  { id: 'epa',        label: 'Checking for industrial sites nearby (EPA)' },
  { id: 'airquality', label: 'Estimating smoke and air quality risk' },
  { id: 'landslide',  label: 'Checking landslide susceptibility (USGS)' },
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
 * Try each proxy in API_CONFIG.CORS_PROXIES in order.
 * Returns parsed JSON from the first proxy that succeeds.
 * Throws if all proxies fail.
 */
async function fetchWithProxyCascade(targetUrl, timeoutMs) {
  const proxies = API_CONFIG.CORS_PROXIES;
  const totalTimeout = timeoutMs + API_CONFIG.PROXY_EXTRA_MS;
  let lastError = null;

  for (const proxy of proxies) {
    const wrappedUrl = proxy.url + encodeURIComponent(targetUrl);
    try {
      // Abort the underlying request on timeout instead of letting it run on;
      // no referrer so the relay never learns which page sent it.
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), totalTimeout);
      let response;
      try {
        response = await fetch(wrappedUrl, { signal: ctrl.signal, referrerPolicy: 'no-referrer' });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await proxy.extract(response);
      // Relays wrap upstream errors in HTTP 200. An ArcGIS/REST error object
      // is a failure, not an empty result.
      if (result === null || result === undefined) throw new Error('Empty body from relay');
      if (result && typeof result === 'object' && result.error) {
        throw new Error(`Upstream error ${result.error.code || ''} ${result.error.message || ''}`.trim());
      }
      console.log('[Proxy success]', proxy.name, '<-', targetUrl);
      return result;
    } catch (err) {
      console.warn('[Proxy failed]', proxy.name, err.message);
      lastError = err;
      // continue to next proxy
    }
  }

  throw new Error(`All CORS proxies failed for: ${targetUrl} (last: ${lastError?.message})`);
}

/**
 * Fetch via CORS proxy cascade — use for all government ArcGIS/EPA/NOAA
 * endpoints that block direct browser requests.
 * Returns parsed JSON of the actual API response.
 */
async function proxyFetch(url) {
  return fetchWithProxyCascade(url, API_CONFIG.TIMEOUT_MS);
}

/**
 * Direct fetch — for APIs that support CORS natively
 * (USGS earthquake, NOAA weather.gov, FCC).
 * No custom User-Agent: browsers set their own, and a custom one forces a
 * CORS preflight that some of these services reject.
 */
async function directFetch(url) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_CONFIG.TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const data = await resp.json();
  if (data && typeof data === 'object' && data.error) {
    throw new Error(`Upstream error ${data.error.code || ''} ${data.error.message || ''}`.trim());
  }
  return data;
}

/**
 * Round a coordinate to 4 decimals (about 11 m) before it leaves the browser
 * for any third-party relay. Flood, wildfire and landslide polygons are far
 * coarser than this, so nothing is lost.
 */
function _coarse(n) {
  return Number(Number(n).toFixed(4));
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
function _geoError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

const GEOCODE_MESSAGES = {
  NOT_FOUND:   'Address not found — check the spelling or skip to assess without a lookup.',
  UNREACHABLE: 'Couldn\u2019t reach the address lookup service — try again or skip.',
};

async function _geocode(address) {
  console.log('[Geocode] Starting for address:', address);

  let lat, lng, zip, stateAbbr, county, city, displayAddress;

  /* ── PRIMARY: Nominatim ────────────────────────────────── */
  const nominatimUrl =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encodeURIComponent(address)}&format=json&addressdetails=1&limit=1`;

  console.log('[Geocode] Nominatim URL:', nominatimUrl);

  let nominatimOk = false;
  let nominatimEmpty = false; // service answered but found nothing
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_CONFIG.TIMEOUT_MS);
    const resp  = await fetch(nominatimUrl, {
      signal:  ctrl.signal,
      headers: { 'Accept-Language': 'en' },
    });
    clearTimeout(timer);

    if (!resp.ok) throw new Error('Nominatim HTTP ' + resp.status);
    const results = await resp.json();
    console.log('[Geocode] Nominatim raw response:', results);

    if (!results || results.length === 0) {
      nominatimEmpty = true;
      throw new Error('no results');
    }

    const r = results[0];
    lat          = parseFloat(r.lat);
    lng          = parseFloat(r.lon);
    zip          = r.address?.postcode || '';
    // Nominatim's key is "ISO3166-2-lvl4" (hyphens), value like "US-CO"
    stateAbbr    = r.address?.['ISO3166-2-lvl4']?.split('-')[1] || '';
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
    console.log('[Geocode] Census fallback via proxy cascade:', censusUrl);

    let censusData;
    try {
      censusData = await fetchWithProxyCascade(censusUrl, API_CONFIG.TIMEOUT_MS);
      console.log('[Geocode] Census raw response:', censusData);
    } catch (censusErr) {
      console.warn('[Geocode] Census fallback also failed:', censusErr.message);
      // If the primary geocoder answered with no match, the address itself is the problem
      if (nominatimEmpty) throw _geoError('NOT_FOUND', 'Address not found');
      throw _geoError('UNREACHABLE', 'Could not reach geocoding service');
    }

    const matches = censusData?.result?.addressMatches;
    if (!matches || matches.length === 0) {
      throw _geoError('NOT_FOUND', 'Address not found');
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
    throw _geoError('NOT_FOUND', 'Address not found');
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

  // Third-party strings are rendered and used in URLs: keep only the shapes we expect.
  zip        = /^\d{5}/.test(String(zip || '')) ? String(zip).slice(0, 5) : '';
  fips5      = /^\d{5}$/.test(String(fips5 || '')) ? String(fips5) : '';
  stateFips  = fips5 ? fips5.slice(0, 2) : '';
  countyFips = fips5 ? fips5.slice(2) : '';
  stateAbbr  = /^[A-Z]{2}$/i.test(String(stateAbbr || '')) ? String(stateAbbr).toUpperCase() : '';

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

const FALLBACK_PREFIX = 'This source did not respond, so this is a placeholder.';

function _floodFallback() {
  return { score: 2, finding: `${FALLBACK_PREFIX} Check your flood zone at msc.fema.gov.`, confidence: 'Low', isFallback: true };
}
function _quakeFallback(stateAbbr) {
  const s = (stateAbbr || '').toUpperCase();
  const score = _QUAKE_HIGH_STATES.has(s) ? 4 : 1;
  return {
    score,
    finding: `${FALLBACK_PREFIX} Statewide estimate for ${s || 'an unknown state'}: ${score === 4 ? 'higher seismic activity' : 'lower seismic activity'}.`,
    confidence: 'Low', isFallback: true,
  };
}
function _wildfireFallback(stateAbbr) {
  const s = (stateAbbr || '').toUpperCase();
  let score, findingText;
  if (s === 'CO') {
    score       = 4;
    findingText = `${FALLBACK_PREFIX} Colorado-wide estimate, not specific to this address. Ask your fire district for a home assessment.`;
  } else if (_WILDFIRE_HIGH_STATES.has(s)) {
    score       = 3;
    findingText = `${FALLBACK_PREFIX} Statewide estimate for ${s}: elevated wildfire activity.`;
  } else {
    score       = 1;
    findingText = `${FALLBACK_PREFIX} Statewide estimate for ${s || 'an unknown state'}: lower wildfire activity.`;
  }
  return {
    score,
    finding: findingText,
    confidence: 'Low', isFallback: true,
  };
}
function _landslideFallback() {
  return { score: 1, finding: `${FALLBACK_PREFIX} Minimal landslide risk assumed.`, confidence: 'Low', isFallback: true };
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
    // NFHL layer 28 names this field ZONE_SUBTY; older code asked for ZONE_SUBTYPE
    subtype: (attrs.ZONE_SUBTY || attrs.ZONE_SUBTYPE || '').trim().toUpperCase(),
    sfha:    attrs.SFHA_TF === 'T' || attrs.SFHA_TF === true,
  };
}

async function _callFloodAPI(lat, lng, countyFips) {
  console.log('[FEMA Flood] Starting fetch for', lat, lng);
  const BASE = 'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query';
  const pointParams =
    `&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    `&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF&returnGeometry=false&f=json`;
  const femaMapUrl = `https://msc.fema.gov/portal/search#${encodeURIComponent(lat + ',' + lng)}`;
  const cLat = _coarse(lat), cLng = _coarse(lng);

  // ── Method A: NFHL point query ───────────────────────────
  try {
    const urlA = `${BASE}?geometry=${cLng},${cLat}${pointParams}`;
    const dataA = await proxyFetch(urlA);
    const parsed = _parseNFHLFeatures(dataA?.features);
    if (parsed && parsed.zone) {
      const r = mapFloodZoneToScore(parsed.zone, parsed.subtype);
      if (r.score !== null) {
        console.log('[FEMA Flood] Success via Method A — Zone:', parsed.zone, 'Score:', r.score);
        return { ...r, femaMapUrl, confidence: 'High' };
      }
    }
  } catch (e) {
    console.warn('[FEMA Flood] Method A failed:', e.message);
  }

  // ── Method B: MSC endpoint ────────────────────────────────
  try {
    const urlB =
      `https://msc.fema.gov/arcgis/rest/services/NFHL_National_Clip/NFHL_National_Clip/MapServer/28/query` +
      `?geometry=${cLng},${cLat}${pointParams}`;
    const dataB = await proxyFetch(urlB);
    const parsed = _parseNFHLFeatures(dataB?.features);
    if (parsed && parsed.zone) {
      const r = mapFloodZoneToScore(parsed.zone, parsed.subtype);
      if (r.score !== null) {
        console.log('[FEMA Flood] Success via Method B — Zone:', parsed.zone, 'Score:', r.score);
        return { ...r, femaMapUrl, confidence: 'High' };
      }
    }
  } catch (e) {
    console.warn('[FEMA Flood] Method B failed:', e.message);
  }

  // ── Method C: NFHL envelope query (wider bbox) ────────────
  try {
    const d = 0.01;
    const urlC =
      `${BASE}?where=1%3D1` +
      `&geometry=${cLng - d},${cLat - d},${cLng + d},${cLat + d}` +
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
      if (r.score !== null) {
        console.log('[FEMA Flood] Success via Method C — Zone:', zone, 'Score:', r.score);
        return { ...r, finding: `${r.finding} (most common zone within about 1 km, not this parcel)`, femaMapUrl, confidence: 'Medium' };
      }
    }
  } catch (e) {
    console.warn('[FEMA Flood] Method C failed:', e.message);
  }

  // ── Method D: FEMA National Risk Index (CORS-friendly) ────
  // NRI needs the full 5-digit state+county FIPS; the 3-digit county part
  // alone is shared by about twenty counties.
  if (countyFips && /^\d{5}$/.test(countyFips)) {
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
        return { score, finding: `${finding} — county-wide index, not this parcel`, femaMapUrl, confidence: 'Low' };
      }
    } catch (e) {
      console.warn('[FEMA Flood] Method D failed:', e.message);
    }
  }

  // ── All methods failed: report failure so the caller marks it Estimated ──
  throw new Error('No FEMA flood zone data retrieved');
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
  // The NEHRP-2020 service wraps its payload as { request, response: { data } }
  // and names the value "pgam" (site-modified peak ground acceleration).
  const d   = data?.response?.data ?? data?.data;
  const pga = d?.pgam ?? d?.pga;
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
    `${API_CONFIG.USFS_WILDFIRE}?geometry=${_coarse(lng)},${_coarse(lat)}` +
    `&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects` +
    `&outFields=WHP_Label,WHP_Category&returnGeometry=false&f=json`;

  // Any failure here throws, so _tracked marks the step as failed and
  // _compileFindings applies the state fallback with an honest "Estimated" tag.
  const data  = await proxyFetch(url);
  const feats = Array.isArray(data?.features) ? data.features : [];
  if (feats.length === 0) throw new Error('No USFS WHP polygon at this location');

  const attrs  = feats[0]?.attributes || {};
  const result = mapWHPToScore(attrs.WHP_Label || '', attrs.WHP_Category);
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

function _mostRecentTuesdayStr(now) {
  // Drought Monitor maps are dated Tuesday and published Thursday, so the
  // most recent published map is the Tuesday at least two days back.
  const today = now ? new Date(now) : new Date();
  const dow   = today.getDay();
  let back    = (dow - 2 + 7) % 7;
  if (back < 2) back += 7;
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
  const pad = n => String(n).padStart(2, '0');
  // Local-date formatting: toISOString() would shift evening dates to UTC's next day
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
    `${API_CONFIG.USGS_LANDSLIDE}?geometry=${_coarse(lng)},${_coarse(lat)}` +
    `&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects` +
    `&outFields=*&returnGeometry=false&f=json`;

  const data = await proxyFetch(url);
  const feats = Array.isArray(data?.features) ? data.features : [];

  let result;
  if (feats.length === 0) {
    throw new Error('No USGS landslide susceptibility polygon at this location');
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
  function addFinding(hazardId, hazardName, category, _apiKey, result, source, fallbackFn, extras) {
    if (!result) {
      const fb = fallbackFn ? fallbackFn() : null;
      if (fb) {
        findings.push({
          hazardId, hazardName, category,
          scoreAssigned: fb.score,
          // An estimate is a World Aware placeholder, not the named data source
          source: `World Aware placeholder (${source} did not respond)`,
          finding: fb.finding,
          confidence: 'Low',
          status: 'estimated',
          isOverridden: false,
          ...(extras || {}),
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
  // Carry femaMapUrl through so _buildFindingCard can show the FIRM link,
  // including on the placeholder path where the user most needs it.
  const femaMapUrl = (geocoded.lat && geocoded.lng)
    ? `https://msc.fema.gov/portal/search#${encodeURIComponent(geocoded.lat + ',' + geocoded.lng)}`
    : null;
  const floodWithUrl = flood ? { ...flood, femaMapUrl: flood.femaMapUrl || femaMapUrl } : null;
  addFinding(H_ID.FLOOD_RIVERINE, 'Flood (riverine)', 'Natural Hazards', 'flood', floodWithUrl, floodSrc, _floodFallback, { femaMapUrl });
  addFinding(H_ID.FLASH_FLOOD,    'Flash Flood',      'Natural Hazards', 'flood', floodWithUrl, floodSrc, _floodFallback, { femaMapUrl });

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

  // Air quality — derived. If either input was a placeholder, so is this.
  const epaHigh  = epa?.highHazardCount || 0;
  const aqResult = _deriveAirQualityScore(whpScore, epaHigh, stateAbbr);
  const aqDerivedFromData = !!(wildfire && epa);
  findings.push({
    hazardId: H_ID.AIR_QUALITY, hazardName: 'Air Quality Crisis', category: 'Industrial & CBRN',
    scoreAssigned: aqResult.score,
    source: aqDerivedFromData
      ? 'Derived from USFS wildfire hazard and EPA TRI industrial proximity'
      : 'World Aware placeholder (wildfire or industrial data did not respond)',
    finding:    aqDerivedFromData ? aqResult.finding : `${FALLBACK_PREFIX} ${aqResult.finding}`,
    confidence: aqDerivedFromData ? aqResult.confidence : 'Low',
    status: aqDerivedFromData ? 'success' : 'estimated', isOverridden: false,
  });

  // ── WEATHER HEURISTICS ────────────────────────────────────
  // These six scores come from a hand-written state table in scoreMapper.js.
  // The NWS call only confirms the state. Say so; do not cite NOAA for them.
  const weatherNote = stateAbbr
    ? `Statewide estimate for ${stateAbbr}, not specific to this address.`
    : 'Regional estimate; state could not be confirmed.';
  const weatherSrc = 'World Aware state-level rule of thumb (not NOAA data)';

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
      finding: `${score === 4 ? 'Likely' : score === 3 ? 'Possible' : 'Unlikely'}. ${weatherNote}`,
      confidence: 'Low',
      status: 'estimated', isOverridden: false,
    });
  });

  // ── DROUGHT ───────────────────────────────────────────────
  addFinding(H_ID.DROUGHT, 'Drought', 'Natural Hazards',
    'drought', drought, 'US Drought Monitor — county-level drought conditions',
    () => ({ score: 2, finding: `${FALLBACK_PREFIX} Colorado moves in and out of drought most years; check droughtmonitor.unl.edu.`, confidence: 'Low', isFallback: true }));

  // ── EPA TRI — Chemical + Wastewater ──────────────────────
  const epaChemResult = epa ? { score: epa.chemScore, finding: epa.finding, confidence: epa.confidence } : null;
  addFinding(H_ID.CHEMICAL_PLANT, 'Chemical Plant / Refinery Release', 'Industrial & CBRN',
    'epa', epaChemResult,
    'EPA Toxics Release Inventory (TRI) — regulated industrial facilities in ZIP code',
    () => ({ score: 2, finding: `${FALLBACK_PREFIX} Industrial proximity unknown.`, confidence: 'Low', isFallback: true }));

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

  const icons = { pending: 'circle-dashed', running: 'loader-circle', success: 'circle-check', error: 'triangle-alert' };
  iconEl.innerHTML = ic(icons[status] || 'circle-dashed');

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
  // Relay calls can take up to TIMEOUT_MS + PROXY_EXTRA_MS per relay, so the
  // outer cap has to be larger than one relay attempt or nothing ever lands.
  const cap = API_CONFIG.TIMEOUT_MS + API_CONFIG.PROXY_EXTRA_MS + 3000;
  return withTimeout(apiPromise, cap, stepId)
    .then(result => {
      // A null/undefined result is a failure, not a success with no data
      if (result === null || result === undefined) throw new Error('no result');
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
  const run = ++_research.runId;

  const staleErr = document.getElementById('research-error');
  if (staleErr) staleErr.classList.add('hidden');

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
    if (run !== _research.runId) return;   // user moved on while we waited
    _research.geocoded = geocoded;
    _setStep('geocode', 'success');
    console.log('[Research] Geocoding complete:', geocoded);
  } catch (err) {
    if (run !== _research.runId) return;
    _setStep('geocode', 'error');
    _research.isRunning = false;
    console.warn('[Research] Geocoding failed:', err.message);
    // Anything that is not a confirmed "no match" (timeouts, HTTP/network errors) is unreachable
    _showResearchError(err.code === 'NOT_FOUND' ? GEOCODE_MESSAGES.NOT_FOUND : GEOCODE_MESSAGES.UNREACHABLE);
    return;
  }

  // ── STEPS 1–7: PARALLEL API CALLS (spinners update independently) ──
  ['flood','earthquake','wildfire','weather','drought','epa','airquality','landslide']
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
      _tracked('drought',    _callDroughtAPI(fips5)),
      _tracked('epa',        _callEPAAPI(zip)),
      _tracked('landslide',  _callLandslideAPI(lat, lng)),
    ]);

  if (run !== _research.runId) return;   // cancelled while the lookups ran

  // Air quality is derived from wildfire and EPA; it is only a real result when both are
  _setStep('airquality', (wildfire && epa) ? 'success' : 'error');

  console.log('[Research] All API calls settled. Results:', {
    flood, earthquake, wildfire, weather, drought, epa, landslide
  });

  // ── COMPILE FINDINGS ──────────────────────────────────────
  try {
    _research.findings = _compileFindings(
      { flood, earthquake, wildfire, weather, drought, epa, landslide },
      geocoded
    );
    _research.hasResults = true;
  } catch (err) {
    console.warn('[Research] Could not compile findings:', err.message);
    _research.isRunning = false;
    _showResearchError('Something went wrong while reading the results. Try again, or skip the lookup.');
    return;
  }

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
  if (!_research.hasResults) {
    // Nothing researched: behave like "skip"
    if (typeof skipResearch === 'function') skipResearch();
    return;
  }

  // Include both 'success' and 'estimated' (fallback) findings
  const successFindings = _research.findings.filter(
    f => (f.status === 'success' || f.status === 'estimated') && f.scoreAssigned !== null
  );

  // STEP 1: Write likelihood scores to state. Impact is never invented:
  // the user rates impact on the Assess screen.
  const applied = [];
  successFindings.forEach(f => {
    if (!state.scores[f.hazardId]) state.scores[f.hazardId] = {};
    const entry = state.scores[f.hazardId];
    // Only skip if user manually entered a likelihood (not auto)
    if (entry.l > 0 && !entry.isAuto) return;
    applied.push(f);
    entry.l      = f.scoreAssigned;
    entry.isAuto = true;
    // Placeholders stay editable like any auto score, but are flagged so the
    // Results screen and the PDF never present them as researched data.
    entry.isEstimate = (f.status === 'estimated');
    // Clear legacy auto-generated notes; research details live in autoScoreOrigins
    if (typeof entry.notes === 'string' && entry.notes.startsWith('[Auto-scored from:')) entry.notes = '';
  });

  // STEP 2: Persist research metadata and the researched address
  state.researchAddress = _research.address;
  state.location        = _research.address || _research.geocoded?.displayAddress || state.location;
  state.researchReport  = {
    geocoded:  _research.geocoded,
    findings:  _research.findings,
    timestamp: new Date().toISOString(),
  };
  state.autoScoreOrigins = {};
  applied.forEach(f => {
    state.autoScoreOrigins[f.hazardId] = {
      source: f.source, finding: f.finding, confidence: f.confidence,
      status: f.status,
    };
  });

  // STEP 3: Save, then open Assess (showScreen builds the hazard list,
  // expands research categories and shows the "rate impact" banner)
  autoSave();
  showScreen('assessment');
}

/**
 * Remove all auto-scores from state (keep manual scores intact).
 */
function clearAutoScores() {
  // Research likelihoods the user has not changed still carry isAuto=true;
  // changing a likelihood by hand clears isAuto, so those values are kept.
  const autoIds = Object.keys(state.scores).filter(id => state.scores[id]?.isAuto && (parseInt(state.scores[id].l) || 0) > 0);
  if (autoIds.length === 0 && !state.researchReport) {
    _clearAutoScoresNow();
    return;
  }
  const msg = autoIds.length
    ? `Research a different address? This removes the ${autoIds.length} likelihood estimate${autoIds.length === 1 ? '' : 's'} from the current address research. Impact ratings, notes, and any likelihood you changed yourself are kept.`
    : 'Research a different address? This clears the current research results. Your own ratings and notes are kept.';
  showConfirm(msg, _clearAutoScoresNow);
}

function _clearAutoScoresNow() {
  Object.keys(state.scores).forEach(id => {
    if (state.scores[id]?.isAuto) {
      state.scores[id].l      = 0;
      state.scores[id].isAuto = false;
      if (typeof state.scores[id].notes === 'string' && state.scores[id].notes.startsWith('[Auto-scored from:')) {
        state.scores[id].notes = '';
      }
    }
  });
  state.researchReport    = null;
  state.researchAddress   = '';
  state.autoScoreOrigins  = {};
  autoSave();

  resetResearchUI();
  updateProgress();
}

/** Reset the Home research panel to an empty address form. */
function resetResearchUI() {
  cancelResearch();
  _research.address    = '';
  _research.geocoded   = null;
  _research.findings   = [];
  _research.hasResults = false;
  _showSection('input');
  const input = document.getElementById('research-address-input');
  if (input) input.value = '';
  const errEl = document.getElementById('research-error');
  if (errEl) errEl.classList.add('hidden');
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
    <p class="override-label">Set likelihood score</p>
    <div class="override-choices">
      ${[1,2,3,4,5].map(v => `
        <button class="override-score-btn ${v === finding.scoreAssigned ? 'selected' : ''}" aria-pressed="${v === finding.scoreAssigned}"
          onclick="_applyOverride(${hazardId}, ${v})">${v}</button>
      `).join('')}
      ${finding.isOverridden ? `<button class="btn btn-ghost btn-small override-revert-btn" onclick="_revertOverride(${hazardId})">${ic('rotate-ccw')} Revert to auto</button>` : ''}
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
    errEl.className = 'alert alert-error research-error-msg';
    errEl.setAttribute('role', 'alert');
    const inputSection = document.getElementById('research-input-section');
    if (inputSection) inputSection.appendChild(errEl);
  }
  errEl.innerHTML = `${ic('circle-alert')}<p></p>`;
  errEl.querySelector('p').textContent = msg;
  errEl.classList.remove('hidden');
  // The alert renders below the fold on a phone; bring it into view and
  // move focus so screen readers and keyboard users land on it too.
  errEl.setAttribute('tabindex', '-1');
  try { errEl.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* older browsers */ }
  errEl.focus({ preventScroll: true });
}

/* ---------------------------------------------------------------
   UI — LOADING STEPS
--------------------------------------------------------------- */

function _renderLoadingSteps() {
  const container = document.getElementById('research-steps-list');
  if (!container) return;

  container.innerHTML = STEPS.map(step => `
    <div class="research-step step-pending" id="step-${step.id}">
      <span class="step-icon">${ic('circle-dashed')}</span>
      <span class="step-label">${step.label}</span>
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
  // Keep anything the user already wrote; add the source once.
  const sourceLine = `Source: ${source} — manual lookup`;
  const existing   = typeof state.scores[hazardId].notes === 'string' ? state.scores[hazardId].notes : '';
  state.scores[hazardId].notes = existing.includes(sourceLine)
    ? existing
    : (existing.trim() ? `${existing.trim()}\n${sourceLine}` : sourceLine);
  if (typeof autoSave === 'function') autoSave();

  // Highlight the selected button and dim others in this card
  const card = document.getElementById(`manual-card-${hazardId}`);
  if (card) {
    card.querySelectorAll('.manual-score-btn').forEach(btn => {
      btn.classList.toggle('selected', parseInt(btn.dataset.score) === score);
    });
    const confirm = card.querySelector('.manual-score-confirm');
    if (confirm) {
      confirm.innerHTML = `${ic('circle-check')} Score ${score} saved to assessment.`;
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

  const title   = IS_PIPELINE ? 'Natural Gas Pipeline Leak / Explosion' : 'Nuclear / Radiological Incident';
  const badge   = 'Manual lookup required';
  const message = IS_PIPELINE
    ? 'Pipeline proximity data cannot be retrieved automatically — PHMSA does not provide a public address-level API.'
    : 'Nuclear facility proximity requires manual lookup — NRC does not provide a CORS-compatible public API.';
  const linkUrl = IS_PIPELINE
    ? 'https://pvnpms.phmsa.dot.gov/PublicViewer/'
    : 'https://www.nrc.gov/info-finder/facilities/';
  const linkLabel = IS_PIPELINE ? 'Open PHMSA pipeline map' : 'Open NRC facility search';
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
      <a href="${escHtml(linkUrl)}" target="_blank" rel="noopener" class="btn btn-secondary manual-action-btn">
        ${ic('external-link')} ${linkLabel}
      </a>
      ${instructions}
      <div class="manual-score-entry">
        <span class="manual-score-label">Enter likelihood score after lookup</span>
        <div class="manual-score-buttons">
          ${[1,2,3,4,5].map(v => `
            <button class="manual-score-btn ${currentScore === v ? 'selected' : ''}"
              data-score="${v}"
              onclick="applyManualScore(${hazardId}, ${v}, '${source.replace(/'/g, "\\'")}')">
              ${v}
            </button>`).join('')}
        </div>
        <span class="manual-score-confirm hidden" id="manual-confirm-${hazardId}">
          ${currentScore ? `${ic('circle-check')} Score ${currentScore} saved to assessment.` : ''}
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
  // 'estimated' = placeholder used; shown alongside success but counted separately
  const successful = findings.filter(f => f.status === 'success' || f.status === 'estimated');
  const fromData   = findings.filter(f => f.status === 'success');
  const estimated  = findings.filter(f => f.status === 'estimated');
  const failed     = findings.filter(f => f.status === 'error');

  const manualCount = Object.keys(MANUAL_REASONS).length;

  // Street name and city only: this card is often on a projector in a workshop.
  const countyLabel = geo.county ? `${escHtml(String(geo.county).replace(/ County$/i, ''))} County` : '';
  const placeLine   = [countyLabel, escHtml(geo.stateAbbr || '')].filter(Boolean).join(', ');

  const summaryHead = fromData.length > 0
    ? `<strong>Public data found for ${fromData.length} hazard${fromData.length === 1 ? '' : 's'}.</strong>`
    : `<strong>No public data sources responded.</strong>`;
  const summarySub  = [
    estimated.length > 0 ? `${estimated.length} ${estimated.length === 1 ? 'is a' : 'are'} rough placeholder${estimated.length === 1 ? '' : 's'} because a source did not respond.` : '',
    failed.length > 0 ? `${failed.length} could not be scored.` : '',
    `${manualCount} need your judgment.`,
  ].filter(Boolean).join(' ');

  let html = `
    <!-- Confirmed address -->
    <div class="report-address-card">
      <div class="report-address-icon">${ic('map-pin')}</div>
      <div class="report-address-info">
        <strong>${escHtml(geo.displayAddress)}</strong>
        ${placeLine ? `<span>${placeLine}</span>` : ''}
      </div>
    </div>

    <!-- Summary banner -->
    <div class="alert ${fromData.length > 0 ? 'alert-info' : 'alert-warning'} report-summary-banner">
      ${ic(fromData.length > 0 ? 'chart-column' : 'triangle-alert')}
      <div>
        ${summaryHead}<br>
        <span class="report-summary-sub">${summarySub}</span>
      </div>
    </div>

    <!-- Primary next step -->
    <div class="report-actions report-actions-top">
      <button class="btn btn-primary btn-large" id="research-continue-btn" onclick="applyResearchScores()">
        Continue to assessment
      </button>
      <p class="report-actions-note">Likelihood estimates are added to your assessment. You rate the impact for your household.</p>
      <button class="btn btn-ghost" id="research-restart-btn" onclick="clearAutoScores()">
        Research a different address
      </button>
    </div>

    <div class="research-details">
    <!-- API availability note -->
    <p class="report-aq-note">
      ${ic('wind')} <span>For real-time air quality, visit <strong>airnow.gov</strong> and enter your address for current AQI.</span>
    </p>
  `;

  // ── AUTO-SCORED HAZARDS ─────────────────────────────────────
  html += `<h3 class="report-section-heading">${ic('circle-check')} Likelihood filled in (${successful.length})</h3>`;

  if (successful.length > 0) {
    // Group by category
    const cats = {};
    successful.forEach(f => {
      if (!cats[f.category]) cats[f.category] = [];
      cats[f.category].push(f);
    });

    Object.keys(cats).forEach(cat => {
      html += `<div class="report-category-group">
        <div class="report-cat-label">${ic((typeof CATEGORY_ICONS !== 'undefined' && CATEGORY_ICONS[cat]) || 'circle-dashed')} ${escHtml(typeof catLabel === 'function' ? catLabel(cat) : cat)}</div>
      `;
      cats[cat].forEach(f => { html += _buildFindingCard(f); });
      html += `</div>`;
    });
  }

  // ── FAILED API CALLS ────────────────────────────────────────
  if (failed.length > 0) {
    html += `
      <div class="alert alert-warning report-unavailable">
        ${ic('triangle-alert')}
        <div>
          <p class="alert-title">${failed.length} data source${failed.length > 1 ? 's' : ''} unavailable</p>
          <p>These hazards were not auto-scored.</p>
          <ul>${failed.map(f => `<li>${escHtml(f.hazardName)}</li>`).join('')}</ul>
        </div>
      </div>
    `;
  }

  // ── MANUAL HAZARDS ────────────────────────────────────────
  html += `<h3 class="report-section-heading">${ic('pencil')} Needs your judgment (${Object.keys(MANUAL_REASONS).length} hazards)</h3>
  <p class="report-manual-intro">No public map covers these. You know them better than any database does. Most take a few seconds; skip any that do not apply.</p>
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

  html += `</div>`; // end .research-details

  container.innerHTML = html;
}

function _buildFindingCard(f) {
  const scoreLabel = _likelihoodLabel(f.scoreAssigned);

  const scoredBadge = f.status === 'estimated'
    ? `<span class="auto-scored-badge is-estimated">Rough estimate</span>`
    : `<span class="auto-scored-badge">From public data</span>`;
  const overrideBadge = f.isOverridden
    ? `<span class="override-badge">Overridden</span>` : '';
  const errorHtml = f.status === 'error'
    ? `<span class="finding-error">${ic('triangle-alert')} ${escHtml(cleanFindingText(f.finding))}</span>` : '';

  const showDetails = f.status === 'success' || f.status === 'estimated';

  return `
    <div class="finding-card" id="finding-card-${f.hazardId}">
      <div class="finding-card-top">
        <div class="finding-left">
          <span class="finding-name">${escHtml(f.hazardName)}</span>
          <span class="finding-tags">${scoredBadge}${overrideBadge}</span>
        </div>
        ${f.scoreAssigned !== null ? `
        <div class="finding-score">
          <span class="finding-score-num">L${f.scoreAssigned}</span>
          <span class="finding-score-label">${scoreLabel}</span>
        </div>` : ''}
      </div>
      ${showDetails ? `
      <div class="finding-details">
        <div class="finding-detail-row"><span class="finding-detail-key">Source</span> <span>${escHtml(f.source)}</span></div>
        <div class="finding-detail-row"><span class="finding-detail-key">Finding</span> <span>${escHtml(cleanFindingText(f.finding))}</span></div>
        <div class="finding-detail-row"><span class="finding-detail-key">Confidence</span> <span class="confidence-${String(f.confidence || '').toLowerCase().replace(/[^a-z]/g, '')}">${escHtml(String(f.confidence || ''))}</span></div>
      </div>
      ${f.femaMapUrl ? `
      <a href="${escHtml(f.femaMapUrl)}" target="_blank" rel="noopener" class="btn btn-secondary btn-small manual-action-btn">
        ${ic('external-link')} Check official FEMA flood map
      </a>
      <p class="manual-action-note">Verify at msc.fema.gov. Enter your address for the official FIRM panel for your parcel.</p>
      ` : ''}
      <button class="btn btn-ghost btn-small finding-override-btn" onclick="_overrideScore(${f.hazardId})">
        ${ic('pencil')} Change this
      </button>` : errorHtml}
    </div>
  `;
}

function _likelihoodLabel(score) {
  // Same words as the Guide and the Assess pickers (LIKELIHOOD_LABELS in app.js)
  const labels = (typeof LIKELIHOOD_LABELS !== 'undefined')
    ? LIKELIHOOD_LABELS
    : { 1: 'Extremely unlikely', 2: 'Unlikely', 3: 'Possible', 4: 'Likely', 5: 'Almost certain' };
  return labels[score] || '';
}

/* ---------------------------------------------------------------
   SCREEN INITIALIZATION (called by showScreen in app.js)
--------------------------------------------------------------- */

function initResearchScreen() {
  // Restore a previously completed research run (persisted in state)
  if (!_research.isRunning && !_research.hasResults &&
      typeof state !== 'undefined' && state.researchReport &&
      state.researchReport.geocoded && Array.isArray(state.researchReport.findings)) {
    _research.address    = state.researchAddress || '';
    _research.geocoded   = state.researchReport.geocoded;
    _research.findings   = state.researchReport.findings;
    _research.hasResults = true;
    const input = document.getElementById('research-address-input');
    if (input && !input.value) input.value = _research.address;
  }

  if (_research.isRunning) {
    _showSection('loading');
  } else if (_research.hasResults) {
    _showSection('results');
    _renderReport();
  } else {
    _showSection('input');
  }

  // Bind Enter key on address input
  const addrInput = document.getElementById('research-address-input');
  if (addrInput && !addrInput._researchBound) {
    addrInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') startResearch();
    });
    addrInput._researchBound = true;
  }
}
