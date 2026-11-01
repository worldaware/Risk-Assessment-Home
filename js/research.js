/* =============================================================
   WORLD AWARE RISK ASSESSMENT — js/research.js
   "Research My Area" — geocodes an address, queries free
   government APIs in parallel (FEMA, USGS, USFS, NWS, Drought
   Monitor, EPA), and pre-populates the hazard assessment with
   Likelihood scores.
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
  CHEMICAL_PLANT:     15,
  AIR_QUALITY:        23,   // "Smoke and bad air days" (absorbed dust storm in v3)
  HIGH_WIND:          63,
};
// v3.0.0 dropped the dust storm (14), wastewater (21) and WUI (55) findings:
// those hazards merged into smoke, water outage and wildfire.

/* Names and categories as in HAZARD_DATA (app.js), so findings read the same as the Assess screen. */
const H_NAME = {
  1:  'Wildfire',
  2:  'Earthquake',
  3:  'River and creek flood',
  4:  'Flash flood',
  5:  'Hail and severe thunderstorms',
  6:  'Tornado',
  7:  'Hurricane',
  8:  'Winter storm and extreme cold',
  9:  'Extreme heat',
  10: 'Drought and watering limits',
  11: 'Landslide, rockfall and debris flow after fire',
  15: 'Chemical spill from road, rail or a nearby plant',
  23: 'Smoke and bad air days',
  63: 'High wind',
};
const H_CAT = { 15: 'Industrial & CBRN' };
function _hCat(id) { return H_CAT[id] || 'Natural Hazards'; }

/* Hazards no public source can score for an address, with what to check instead */
const MANUAL_REASONS = {
  17: 'For big gas transmission lines, check the PHMSA pipeline map at pvnpms.phmsa.dot.gov. For the main on your street, you know it better than any map.',
  18: 'Nuclear facility proximity requires the NRC facility search at nrc.gov.',
  11: 'The USGS landslide map did not load for this address. Look it up at https://www.usgs.gov/tools/us-landslide-inventory-and-susceptibility-map and rate it higher for a steep slope or a burn scar above you.',
  20: 'Old mine workings and quarries are on county and Colorado Geological Survey maps. Local knowledge helps.',
  22: 'Disease outbreaks are regional. No address-level data exists.',
  24: 'Outage history is not public. Check your utility\'s planned shutoff map (Xcel publishes one) and how often your street loses power.',
  27: 'Water main breaks and boil orders are tracked by your water provider. Enter what you know.',
  36: 'Depends on how many roads lead out of your neighborhood and what could block them. Local knowledge required.',
  53: 'Civil unrest depends on where you live and work. Enter what you know.',
  54: 'Active threat risk depends on local context. Enter what you know.',
  63: 'FEMA wind records did not load for this address. Rate it from what you see on your street: downed limbs, roof damage, shutoffs.',
  64: 'Radon is only known by testing the house. Haven\'t tested: rate it 3. Tested high: 5. Tested low: 1.',
  65: 'House fire depends on the home itself: heating, wiring, dryer and cooking. Enter what you know.',
  66: 'Swelling clay is mapped by the Colorado Geological Survey. Cracked foundations or sticking doors are a sign.',
  60: 'Custom hazard. Enter manually.',
  61: 'Custom hazard. Enter manually.',
  62: 'Custom hazard. Enter manually.',
};

/**
 * Whether research should leave a hazard alone because it is marked
 * "Does not apply here". A pre-marked hazard (naAuto) still gets research
 * when the address is outside Colorado, since that mark assumed Colorado.
 */
function _researchSkipsNa(hazardId, stateAbbr) {
  const e = (typeof state !== 'undefined' && state && state.scores) ? state.scores[hazardId] : null;
  if (!e || !e.na) return false;
  if (e.naAuto && _outsideColorado(stateAbbr)) return false;
  return true;
}

function _outsideColorado(stateAbbr) {
  const s = String(stateAbbr || '').toUpperCase();
  return !!s && s !== 'CO';
}

/** Clear the pre-marked "Does not apply here" marks (naAuto). Used when the address is outside Colorado. */
function clearAutoNotApplicable() {
  if (typeof state === 'undefined' || !state || !state.scores) return [];
  const cleared = [];
  Object.keys(state.scores).forEach(id => {
    const e = state.scores[id];
    if (e && e.naAuto) { delete e.na; delete e.naAuto; cleared.push(parseInt(id, 10)); }
  });
  return cleared;
}

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
  failCodes:  {},   // stepId → error code of a failed lookup (e.g. RELAY_NOT_CONFIGURED)
};

/** Abandon any lookup in flight. Its late results are ignored. */
function cancelResearch() {
  _research.runId += 1;
  _research.isRunning = false;
}

/* Research step definitions (UI order) */
const STEPS = [
  { id: 'geocode',    label: 'Finding the address' },
  { id: 'nri',        label: 'Checking FEMA National Risk Index for your census tract' },
  { id: 'flood',      label: 'Checking flood zones (FEMA)' },
  { id: 'earthquake', label: 'Checking earthquake hazard (USGS)' },
  { id: 'wildfire',   label: 'Checking wildfire hazard (Forest Service)' },
  { id: 'weather',    label: 'Confirming the state for weather estimates (NWS)' },
  { id: 'drought',    label: 'Checking drought conditions (Drought Monitor)' },
  { id: 'epa',        label: 'Checking for industrial sites nearby (EPA)' },
  { id: 'airquality', label: 'Estimating smoke and air quality risk' },
  { id: 'landslide',  label: 'Checking landslide susceptibility and records nearby (USGS)' },
  { id: 'declarations', label: 'Checking FEMA disaster declarations for your county' },
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

/** Error codes that change the wording of a placeholder finding. */
const RELAY_NOT_CONFIGURED = 'RELAY_NOT_CONFIGURED';
const NO_SOURCE            = 'NO_SOURCE';

function _codedError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * Fetch a government endpoint through the World Aware relay
 * (API_CONFIG.RELAY_URL, a Cloudflare Worker; source in relay/worker.js).
 * Returns the parsed JSON of the upstream response.
 * Throws a RELAY_NOT_CONFIGURED error, without any network call, while
 * RELAY_URL is empty.
 */
async function relayFetch(targetUrl) {
  const base = String(API_CONFIG.RELAY_URL || '').trim().replace(/\/+$/, '');
  if (!base) throw _codedError(RELAY_NOT_CONFIGURED, 'Relay not configured');

  const wrappedUrl   = base + '/?url=' + encodeURIComponent(targetUrl);
  const totalTimeout = API_CONFIG.TIMEOUT_MS + API_CONFIG.PROXY_EXTRA_MS;

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
    throw new Error(`Relay HTTP ${response.status}`);
  }

  const result = await response.json();
  // ArcGIS services wrap errors in HTTP 200. An error object is a failure,
  // not an empty result.
  if (result === null || result === undefined) throw new Error('Empty body from relay');
  if (result && typeof result === 'object' && result.error) {
    throw new Error(`Upstream error ${result.error.code || ''} ${result.error.message || ''}`.trim());
  }
  return result;
}

/**
 * Thin alias kept so call sites do not churn. Use for every government
 * endpoint that blocks direct browser requests.
 */
async function proxyFetch(url) {
  return relayFetch(url);
}

/**
 * Direct fetch — for APIs that support CORS natively
 * (NOAA weather.gov, EPA Envirofacts).
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
 * through the relay. Flood, wildfire and landslide polygons are far
 * coarser than this, so nothing is lost.
 */
function _coarse(n) {
  return Number(Number(n).toFixed(4));
}

/* ---------------------------------------------------------------
   STEP 0 — GEOCODER
   Primary:  Nominatim (OpenStreetMap) — CORS-friendly, no key
   Fallback: Census Geocoder via the World Aware relay
   FIPS:     FCC Area API — CORS-friendly, no key
--------------------------------------------------------------- */

/**
 * Try Nominatim first; fall back to Census via the World Aware relay.
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

  /* ── FALLBACK: Census Geocoder via the World Aware relay ── */
  if (!nominatimOk) {
    const censusUrl =
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress` +
      `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
    console.log('[Geocode] Census fallback via relay:', censusUrl);

    let censusData;
    try {
      censusData = await relayFetch(censusUrl);
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

/* Source line of the state weather table, and how the summary spots it. */
const WEATHER_RULE_SRC = 'World Aware state-level rule of thumb (not NOAA data)';
function _isRuleOfThumb(f) {
  return !!f && f.status === 'estimated' && /rule of thumb/i.test(String(f.source || ''));
}

/* Placeholder wording when we know why a lookup could not run. */
const FALLBACK_REASONS = {
  [RELAY_NOT_CONFIGURED]: {
    prefix: 'Relay not configured, so this is a placeholder.',
    source: () => 'World Aware placeholder (relay not configured)',
  },
  [NO_SOURCE]: {
    prefix: 'No public address-level source is available for this yet, so this is a placeholder.',
    source: (src) => `World Aware placeholder (no working lookup for ${src} yet)`,
  },
};

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
// Landslide has no placeholder score: when the USGS map and the NRI tract
// value both fail, the hazard goes to "Needs your judgment" (MANUAL_REASONS[11]).

/* ---------------------------------------------------------------
   API 1 — FLOOD RISK (FEMA NFHL) — waterfall
   0: Esri Living Atlas copy of NFHL, direct (primary)
   A: NFHL point query via relay
   B: FEMA MSC NFHL point query via relay
   D: FEMA National Risk Index county IFLD_AFREQ (ArcGIS Online, direct),
      then the hazards.fema.gov NRI API through the relay as a last resort
   There is no envelope ("most common zone nearby") method: it could give
   this parcel a neighbour's zone.
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

/** Read the first present field, trying each name as given and in lower case. */
function _pickField(row, names) {
  if (!row || typeof row !== 'object') return undefined;
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null && row[n] !== '') return row[n];
    const lc = n.toLowerCase();
    if (row[lc] !== undefined && row[lc] !== null && row[lc] !== '') return row[lc];
  }
  return undefined;
}

/** Unwrap the first record from an NRI API response of unknown envelope. */
function _firstNRIRow(data) {
  if (Array.isArray(data)) return data[0] || null;
  if (!data || typeof data !== 'object') return null;
  for (const k of ['data', 'items', 'results', 'counties']) {
    if (Array.isArray(data[k])) return data[k][0] || null;
  }
  if (Array.isArray(data.features)) return data.features[0]?.attributes || data.features[0]?.properties || null;
  return data;
}

/**
 * County-level flood frequency from the National Risk Index.
 * NRI annualized frequency is "recorded hazard occurrences (event-days) per
 * year" across the whole county. It says nothing about this parcel, so the
 * Likelihood is capped at 3 and tagged Low confidence. The December 2025
 * release names riverine flooding "Inland Flooding" (IFLD_AFREQ); RFLD_* is
 * on neither layer (checked 2026-10-31). The relay fallback still tries both.
 */
function _mapNRIFloodFrequency(afreq, countyName) {
  const f = parseFloat(afreq);
  if (!isFinite(f) || f < 0) return null;
  const where = countyName ? `in ${countyName}` : 'in this county';
  let score, words;
  if (f >= 1)        { score = 3; words = 'most years'; }
  else if (f >= 0.1) { score = 2; words = 'some years'; }
  else               { score = 1; words = 'rarely'; }
  return {
    score,
    finding: `FEMA National Risk Index: flooding recorded ${words} ${where} ` +
             `(about ${f < 0.1 ? f.toFixed(3) : f.toFixed(1)} event-days a year) — county-wide, not this parcel`,
    confidence: 'Low',
  };
}

async function _callFloodAPI(lat, lng, fips5, nriPromise) {
  console.log('[FEMA Flood] Starting fetch for', lat, lng);
  const BASE = API_CONFIG.FEMA_NFHL;
  const pointParams =
    `&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    `&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF&returnGeometry=false&f=json`;
  const femaMapUrl = `https://msc.fema.gov/portal/search#${encodeURIComponent(lat + ',' + lng)}`;
  const cLat = _coarse(lat), cLng = _coarse(lng);

  // ── Method 0: Esri Living Atlas copy of NFHL, direct (CORS) ─────
  // Only mapped hazard polygons are in this layer, so a valid answer with
  // no features means unshaded Zone X (minimal hazard).
  try {
    const url0  = `${API_CONFIG.ESRI_FLOOD_HAZARD}?geometry=${cLng},${cLat}${pointParams}`;
    const data0 = await directFetch(url0);
    if (Array.isArray(data0?.features)) {
      const parsed = _parseNFHLFeatures(data0.features) || { zone: 'X', subtype: '', sfha: false };
      const r = mapFloodZoneToScore(parsed.zone, parsed.subtype);
      if (r.score !== null) {
        console.log('[FEMA Flood] Success via Method 0 (Esri NFHL copy) — Zone:', parsed.zone, 'Score:', r.score);
        return { ...r, femaMapUrl, confidence: 'High' };
      }
    }
  } catch (e) {
    console.warn('[FEMA Flood] Method 0 failed:', e.message);
  }

  const relayOn = !!String(API_CONFIG.RELAY_URL || '').trim();

  if (relayOn) {
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
  }

  // ── Method D: FEMA National Risk Index, county level ─────
  // NRI needs the full 5-digit state+county FIPS; the 3-digit county part
  // alone is shared by about twenty counties. The county row normally comes
  // from the NRI step already running in parallel; without it, ask directly.
  if (fips5 && /^\d{5}$/.test(fips5)) {
    try {
      let row = null;
      if (nriPromise) row = (await nriPromise)?.county || null;
      if (!row) row = await _fetchNRICounty(fips5);
      const afreq = _pickField(row, ['IFLD_AFREQ']);
      const r = _mapNRIFloodFrequency(afreq, _nriCountyLabel(row?.COUNTY));
      if (r) {
        console.log('[FEMA Flood] Success via Method D (NRI county IFLD_AFREQ):', afreq, 'Likelihood:', r.score);
        return { ...r, femaMapUrl };
      }
      console.warn('[FEMA Flood] Method D: no IFLD_AFREQ on the county row');
    } catch (e) {
      console.warn('[FEMA Flood] Method D failed:', e.message);
    }

    // ── Method D2: hazards.fema.gov NRI API through the relay (last resort) ──
    if (relayOn) {
      try {
        const row   = _firstNRIRow(await proxyFetch(`${API_CONFIG.FEMA_NRI_COUNTY}?fips=${fips5}`));
        const afreq = _pickField(row, ['IFLD_AFREQ', 'RFLD_AFREQ']);
        const name  = _pickField(row, ['COUNTY', 'COUNTYNAME']);
        const r = _mapNRIFloodFrequency(afreq, name ? String(name).replace(/[<>&"]/g, '') : '');
        if (r) {
          console.log('[FEMA Flood] Success via Method D2 (hazards.fema.gov):', afreq, 'Likelihood:', r.score);
          return { ...r, femaMapUrl };
        }
      } catch (e) {
        console.warn('[FEMA Flood] Method D2 failed:', e.message);
      }
    }
  }

  // Say why when the relay methods could not run, instead of "no data".
  if (!relayOn) throw _codedError(RELAY_NOT_CONFIGURED, 'Relay not configured');

  // ── All methods failed: report failure so the caller marks it Estimated ──
  throw new Error('No FEMA flood zone data retrieved');
}

/* ---------------------------------------------------------------
   API 2 — EARTHQUAKE HAZARD (USGS NEHRP)
   Route: relay (the designmaps service blocks browser CORS, checked 2026-10-25)
--------------------------------------------------------------- */

async function _callEarthquakeAPI(lat, lng) {
  console.log('[USGS Earthquake] Starting fetch for', lat, lng);
  const url =
    `${API_CONFIG.USGS_SEISMIC}?latitude=${_coarse(lat)}&longitude=${_coarse(lng)}` +
    `&riskCategory=III&siteClass=D&title=query`;

  const data = await proxyFetch(url);
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
   API 3 — WILDFIRE HAZARD POTENTIAL (USFS WHP 2023, 270 m)
   Route: direct (GeoPlatform copy sends CORS headers; apps.fs.usda.gov blocks Cloudflare)
   ImageServer identify returns { value: "4", ... } for the pixel under the
   point, or "NoData" outside the mapped area.
--------------------------------------------------------------- */

async function _callWildfireAPI(lat, lng) {
  console.log('[USFS Wildfire] Starting fetch for', lat, lng);
  const point = { x: _coarse(lng), y: _coarse(lat), spatialReference: { wkid: 4326 } };
  const url =
    `${API_CONFIG.USFS_WILDFIRE}?geometry=${encodeURIComponent(JSON.stringify(point))}` +
    `&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json`;

  // Any failure here throws, so _tracked marks the step as failed and
  // _compileFindings applies the state fallback with an honest "Estimated" tag.
  const data = await directFetch(url);
  const raw  = data?.value ?? data?.properties?.Values?.[0];
  const cat  = parseInt(raw, 10);
  if (!(cat >= 1 && cat <= 7)) throw new Error(`No USFS WHP class at this location (value: ${raw})`);

  const result = mapWHPToScore('', cat);
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
   API 4b — DROUGHT (US Drought Monitor county statistics)
   Route: relay (usdmdataservices blocks browser CORS)
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

/** M/D/YYYY in local time, the date format the Drought Monitor API wants. */
function _usdmDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

async function _callDroughtAPI(fips5) {
  if (!fips5) throw new Error('No FIPS code available');
  console.log('[Drought Monitor] Starting fetch for FIPS', fips5);

  // Five weeks back guarantees at least one published weekly map.
  const end   = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 35);
  const url   =
    `${API_CONFIG.DROUGHT_MONITOR}?aoi=${fips5}` +
    `&startdate=${_usdmDate(start)}&enddate=${_usdmDate(end)}&statisticsType=1`;

  // The relay sends Accept: application/json; without it the API returns CSV.
  const parsed = await proxyFetch(url);
  const rows   = Array.isArray(parsed) ? parsed : [];
  if (rows.length === 0) throw new Error('No drought data row returned');

  // Latest week first. Dates arrive as "20261020" or ISO strings; digits sort either way.
  const dateKey = r => String(_pickField(r, ['MapDate', 'ValidStart']) || '').replace(/\D/g, '');
  const row = rows.slice().sort((x, y) => dateKey(y).localeCompare(dateKey(x)))[0];

  const pct = k => parseFloat(_pickField(row, [k])) || 0;
  const result = mapDroughtToScore({
    D4: pct('D4'), D3: pct('D3'), D2: pct('D2'), D1: pct('D1'), D0: pct('D0'),
  });
  console.log('[Drought Monitor] Result:', result, 'map date:', dateKey(row));
  return result;
}

/* ---------------------------------------------------------------
   API 5 — INDUSTRIAL FACILITIES (EPA TRI)
   Route: direct (Envirofacts sends Access-Control-Allow-Origin: *)
--------------------------------------------------------------- */

async function _callEPAAPI(zip) {
  if (!zip) throw new Error('No ZIP code');
  console.log('[EPA TRI] Starting fetch for ZIP', zip);

  const url  = `${API_CONFIG.EPA_TRI_ZIP}/${zip}/JSON`;
  // Envirofacts allows direct browser calls (verified 2026-10-25); no relay needed
  const data = await directFetch(url);

  if (!Array.isArray(data)) throw new Error('Unexpected EPA TRI response format');

  let highHazardCount = 0;
  let potwCount = 0;

  data.forEach(fac => {
    // Envirofacts returns lowercase keys; keep the old uppercase fallbacks
    const sic  = fac.sic || fac.primary_sic || fac.SIC || fac.PRIMARY_SIC || '';
    const name = (fac.facility_name || fac.FACILITY_NAME || fac.FAC_NAME || '').toLowerCase();
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
   API 6 — FEMA NATIONAL RISK INDEX (December 2025 release)
   Route: direct. FEMA's ArcGIS Online copies of the tract and county
   layers send CORS headers (checked 2026-10-31). One step feeds hail,
   high wind, winter storm, tornado, the flood Method D fallback and the
   landslide fallback. Likelihood uses <HAZ>_AFREQ (events or event-days a
   year); the _RISKR ratings mix in exposure and vulnerability, so they
   describe consequence, not likelihood.
--------------------------------------------------------------- */

const NRI_RELEASE    = 'December 2025 release';
const NRI_SRC_TRACT  = `FEMA National Risk Index (census tract), ${NRI_RELEASE}`;
const NRI_SRC_COUNTY = `FEMA National Risk Index (county), ${NRI_RELEASE}`;

/* Fields confirmed on both December 2025 layers (Henry's browser, 2026-10-31).
   One unknown name in outFields fails the whole query, so ask for no others. */
const NRI_CONFIRMED_FIELDS = [
  'HAIL_AFREQ', 'TRND_AFREQ', 'SWND_AFREQ', 'WNTW_AFREQ', 'CWAV_AFREQ', 'HWAV_AFREQ',
  'LNDS_AFREQ', 'LTNG_AFREQ', 'IFLD_AFREQ', 'WFIR_RISKR',
];
const NRI_TRACT_FIELDS  = ['TRACTFIPS', 'COUNTY'].concat(NRI_CONFIRMED_FIELDS);
const NRI_COUNTY_FIELDS = ['STCOFIPS', 'COUNTY', 'AREA'].concat(NRI_CONFIRMED_FIELDS);

/** ArcGIS point geometry in the JSON form (the short "x,y" form returned nothing on one service). */
function _esriPointParam(lat, lng) {
  return encodeURIComponent(JSON.stringify({ x: _coarse(lng), y: _coarse(lat), spatialReference: { wkid: 4326 } }));
}

function _nriTractUrl(lat, lng) {
  return `${API_CONFIG.NRI_TRACT}?geometry=${_esriPointParam(lat, lng)}` +
    `&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    `&outFields=${NRI_TRACT_FIELDS.join(',')}&returnGeometry=false&f=json`;
}

function _nriCountyUrl(fips5) {
  return `${API_CONFIG.NRI_COUNTY}?where=${encodeURIComponent(`STCOFIPS='${fips5}'`)}` +
    `&outFields=${NRI_COUNTY_FIELDS.join(',')}&returnGeometry=false&f=json`;
}

function _firstAttributes(data) {
  if (!data || !Array.isArray(data.features)) throw new Error('Unexpected NRI response');
  return data.features[0]?.attributes || null;
}

async function _fetchNRICounty(fips5) {
  if (!/^\d{5}$/.test(String(fips5 || ''))) throw new Error('No 5-digit FIPS');
  return _firstAttributes(await directFetch(_nriCountyUrl(fips5)));
}

/** Tract row by point and county row by FIPS, in parallel. Throws only if both fail. */
async function _callNRIAPI(lat, lng, fips5) {
  console.log('[FEMA NRI] Starting tract and county queries');
  const tractP = directFetch(_nriTractUrl(lat, lng)).then(_firstAttributes)
    .catch(e => { console.warn('[FEMA NRI] tract query failed:', e.message); return null; });
  const countyP = _fetchNRICounty(fips5)
    .catch(e => { console.warn('[FEMA NRI] county query failed:', e.message); return null; });
  const [tract, county] = await Promise.all([tractP, countyP]);
  if (!tract && !county) throw new Error('No National Risk Index row for this address');
  console.log('[FEMA NRI] tract:', tract && tract.TRACTFIPS, 'county:', county && county.COUNTY);
  return { tract, county };
}

/** A finite, non-negative number, or null for a missing field. */
function _nriNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return (isFinite(n) && n >= 0) ? n : null;
}

/** 1 below cuts[0], 2 from cuts[0], ... 5 from cuts[3]. */
function _binScore(v, cuts) {
  let s = 1;
  cuts.forEach(c => { if (v >= c) s += 1; });
  return s;
}

/** Plain number for a finding sentence: 6.3, 0.70, 0.019. */
function _fmtRate(v) {
  if (!(v > 0)) return '0';
  if (v >= 10) return String(Math.round(v));
  if (v >= 1)  return v.toFixed(1);
  if (v >= 0.1) return v.toFixed(2);
  if (v < 0.0001) return 'less than 0.0001';
  return String(Number(v.toPrecision(2)));
}

/** NRI names counties without the word "County"; add the usual one. */
function _nriCountyLabel(name, stateAbbr) {
  const n = String(name || '').replace(/[<>&"]/g, '').trim();
  if (!n) return '';
  if (/\b(county|parish|borough|census area|municipality|city)\b/i.test(n)) return n;
  const st = String(stateAbbr || '').toUpperCase();
  return `${n} ${st === 'LA' ? 'Parish' : st === 'AK' ? 'Borough' : 'County'}`;
}

/** Hail (id 5): tract HAIL_AFREQ, hail reports a year in the area. */
function _mapNRIHail(afreq) {
  const f = _nriNum(afreq);
  if (f === null) return null;
  return {
    score: _binScore(f, [1, 2, 3.5, 5]),
    finding: `About ${_fmtRate(f)} hail events a year recorded near this tract (FEMA NRI)`,
    confidence: 'High',
  };
}

/** High wind (id 63): tract SWND_AFREQ. NRI strong wind comes from SPC thunderstorm wind reports. */
function _mapNRIWind(afreq) {
  const f = _nriNum(afreq);
  if (f === null) return null;
  return {
    score: _binScore(f, [1, 2, 3, 5]),
    finding: `About ${_fmtRate(f)} damaging wind events a year recorded near this tract (FEMA NRI). ` +
             'Thunderstorm wind only; downslope windstorms are not counted.',
    confidence: 'Medium',
  };
}

/** Winter storm and extreme cold (id 8): tract WNTW_AFREQ, plus one level for frequent cold waves. */
function _mapNRIWinter(wntwAfreq, cwavAfreq) {
  const w = _nriNum(wntwAfreq);
  if (w === null) return null;
  const c = _nriNum(cwavAfreq);
  const base = _binScore(w, [2, 5, 10, 15]);
  const cold = c !== null && c >= 2;
  return {
    score: cold ? Math.min(5, base + 1) : base,
    finding: `About ${_fmtRate(w)} winter weather days a year recorded for this tract (FEMA NRI)` +
             (cold ? `; about ${_fmtRate(c)} cold wave days a year add one level` : ''),
    confidence: 'High',
  };
}

/**
 * Tornado (id 6): county TRND_AFREQ per 1,000 square miles. Tract tornado
 * frequency scales with tract size, so the county density is used.
 */
function _mapNRITornado(trndAfreq, areaSqMi, countyLabel) {
  const t = _nriNum(trndAfreq);
  const a = _nriNum(areaSqMi);
  if (t === null || !a) return null;
  const d = t / a * 1000;
  return {
    score: _binScore(d, [0.2, 0.5, 0.8, 1.0]),
    density: d,
    finding: `About ${d.toFixed(2)} tornadoes a year per 1,000 square miles in ${countyLabel || 'this county'} (FEMA NRI). This is a county-wide rate; the tool cannot narrow it to this address`,
    confidence: 'Medium',
  };
}

/** Landslide fallback (id 11): tract LNDS_AFREQ. A tract average cannot see this lot's slope. */
function _mapNRILandslide(afreq) {
  const f = _nriNum(afreq);
  if (f === null) return null;
  return {
    score: _binScore(f, [0.001, 0.01, 0.05, 0.2]),
    finding: `About ${_fmtRate(f)} landslides a year in this census tract (tract-level, FEMA NRI). ` +
             'The USGS slope map did not load, and a tract average cannot tell whether this lot is on a slope',
    confidence: 'Low',
  };
}

/* ---------------------------------------------------------------
   API 7 — LANDSLIDE (USGS)
   Route: direct (tiles.arcgis.com and services.arcgis.com send CORS).
   1. Susceptibility: the 2024 national map exists only as cached tiles, so
      the pixel under the address is read from the level-12 tile in a canvas
      and matched to the legend colours.
   2. Modifiers: USGS inventory landslides and post-fire debris-flow basins
      within 1 km each add one level.
   When the tile or canvas fails, _compileFindings falls back to the NRI
   tract value, then to "Needs your judgment".
--------------------------------------------------------------- */

const LS_SRC          = 'USGS landslide susceptibility 2024 (90 m)';
const LS_LEVEL        = 12;
const LS_TILE_PX      = 512;
const LS_RES_L12      = 19.1092570712683;    // metres per pixel at level 12 (service JSON)
const LS_ORIGIN       = 20037508.342787;     // Web Mercator tiling origin
const LS_LEGEND_LAYER = 8;                   // CONUS
const LS_TOLERANCE    = 40;                  // max RGB distance to a legend colour
// Built-in copy of the CONUS legend colours (read from the live legend, 2026-10-31).
const LS_LEGEND_FALLBACK = { 1: [251, 213, 117], 2: [247, 168, 20], 3: [241, 129, 129], 4: [231, 33, 36], 5: [114, 16, 15] };

/** Level-12 tile row/col and the pixel inside it for a WGS84 point. */
function _lsTileFor(lat, lng) {
  const R = 6378137;
  const x = R * lng * Math.PI / 180;
  const y = R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const span = LS_TILE_PX * LS_RES_L12;
  const fc = (x + LS_ORIGIN) / span;
  const fr = (LS_ORIGIN - y) / span;
  const col = Math.floor(fc), row = Math.floor(fr);
  return {
    level: LS_LEVEL, row, col,
    px: Math.min(LS_TILE_PX - 1, Math.floor((fc - col) * LS_TILE_PX)),
    py: Math.min(LS_TILE_PX - 1, Math.floor((fr - row) * LS_TILE_PX)),
  };
}

/** Most common colour in a flat RGBA array. Near-transparent pixels count as one "no colour" value. */
function _lsModeColor(data) {
  const counts = new Map();
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3];
    const key = a < 16 ? 'none' : `${data[i]},${data[i + 1]},${data[i + 2]},${a}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = null, n = -1;
  counts.forEach((c, k) => { if (c > n) { best = k; n = c; } });
  if (best === null || best === 'none') return [0, 0, 0, 0];
  return best.split(',').map(Number);
}

/**
 * Legend class for a pixel: 0 for no colour (negligible), 1 to 5 for the
 * nearest legend colour within the tolerance (RGB only; the layer is drawn
 * at 75% opacity), or null when nothing is close enough.
 */
function _lsMatchClass(rgba, table, tolerance) {
  if (!rgba || rgba.length < 4 || rgba[3] < 16) return 0;
  const tol = tolerance === undefined ? LS_TOLERANCE : tolerance;
  let best = null, bestD = Infinity;
  Object.keys(table || {}).forEach(k => {
    const c = table[k];
    const d = Math.sqrt((rgba[0] - c[0]) ** 2 + (rgba[1] - c[1]) ** 2 + (rgba[2] - c[2]) ** 2);
    if (d < bestD) { bestD = d; best = Number(k); }
  });
  return bestD <= tol ? best : null;
}

/** Susceptibility class (0 = negligible) and nearby records -> finding. */
function _landslideResult(cls, inventoryCount, postfireCount) {
  const BASE = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 5 };
  let score = BASE[cls];
  if (score === undefined) return null;
  const notes = [];
  if (inventoryCount > 0) notes.push(`${inventoryCount === 1 ? 'A landslide is' : `${inventoryCount} landslides are`} recorded within 1 km in the USGS landslide inventory`);
  if (postfireCount > 0) notes.push('a USGS post-fire debris-flow basin lies within 1 km');
  if (notes.length) score = Math.min(5, score + 1);
  const head = cls === 0
    ? 'No susceptibility mapped at this point (negligible)'
    : `Susceptibility class ${cls} of 5 at this point`;
  const skipped = [];
  if (inventoryCount === null) skipped.push('landslide inventory');
  if (postfireCount === null) skipped.push('post-fire debris-flow basins');
  let finding = head;
  if (notes.length) finding += `. Raised one level: ${notes.join(', and ')}`;
  if (skipped.length) finding += `. Not checked: ${skipped.join(' and ')}`;
  finding += '. The map rates the slope at this point; debris can also arrive from slopes above it';
  return { score, finding, confidence: (cls === 0 || cls >= 4) ? 'High' : 'Medium', susceptibilityClass: cls };
}

function _lsLoadImage(src) {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') { reject(new Error('Images are not available here')); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Image did not load'));
    img.src = src;
  });
}

/** RGBA of a w x h block. Throws when the canvas is tainted (no CORS) or missing. */
function _lsReadPixels(img, x, y, w, h) {
  if (typeof document === 'undefined' || !document.createElement) throw new Error('No canvas');
  const canvas = document.createElement('canvas');
  canvas.width  = img.naturalWidth  || img.width;
  canvas.height = img.naturalHeight || img.height;
  const cx = canvas.getContext && canvas.getContext('2d', { willReadFrequently: true });
  if (!cx) throw new Error('No 2D canvas');
  cx.drawImage(img, 0, 0);
  try {
    return cx.getImageData(x, y, w, h).data;
  } finally {
    canvas.width = canvas.height = 0;   // release the bitmap right away
  }
}

/** Most common colour of the 3 x 3 block around (px, py) in a tile. */
async function _lsSample(tileUrl, px, py) {
  const img = await withTimeout(_lsLoadImage(tileUrl), API_CONFIG.TIMEOUT_MS, 'Landslide tile');
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (w !== LS_TILE_PX || h !== LS_TILE_PX) {
    throw new Error(`Landslide tile is ${w} x ${h}, expected ${LS_TILE_PX} x ${LS_TILE_PX}`);
  }
  const x0 = Math.max(0, Math.min(LS_TILE_PX - 3, px - 1));
  const y0 = Math.max(0, Math.min(LS_TILE_PX - 3, py - 1));
  let data;
  try {
    data = _lsReadPixels(img, x0, y0, 3, 3);
  } catch (e) {
    throw new Error(`Landslide tile could not be read: ${e.message}`);
  }
  return _lsModeColor(data);
}

/* Legend colours, read once per session from the service's own legend. */
let _lsLegendCache = null;

async function _lsFetchLegend() {
  const data  = await directFetch(`${API_CONFIG.USGS_LANDSLIDE}/legend?f=json`);
  const layer = (Array.isArray(data?.layers) ? data.layers : []).find(l => l && l.layerId === LS_LEGEND_LAYER);
  if (!layer || !Array.isArray(layer.legend)) throw new Error('No CONUS legend');
  const table = {};
  for (const e of layer.legend) {
    const cls = parseInt(e && e.label, 10);
    if (!(cls >= 1 && cls <= 5) || !e.imageData) continue;
    const type = /^image\/(png|jpeg|gif)$/.test(e.contentType || '') ? e.contentType : 'image/png';
    const img  = await withTimeout(_lsLoadImage(`data:${type};base64,${e.imageData}`), API_CONFIG.TIMEOUT_MS, 'Legend swatch');
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const d = _lsReadPixels(img, Math.floor(w / 2), Math.floor(h / 2), 1, 1);
    if (d[3] > 0) table[cls] = [d[0], d[1], d[2]];
  }
  if (Object.keys(table).length !== 5) throw new Error('Legend has ' + Object.keys(table).length + ' of 5 colours');
  return { table, fromService: true };
}

/** Live legend colours, or the built-in copy when the legend cannot be read (retried next run). */
function _lsLegendTable() {
  if (!_lsLegendCache) {
    _lsLegendCache = withTimeout(_lsFetchLegend(), API_CONFIG.TIMEOUT_MS, 'Landslide legend').catch(e => {
      console.warn('[USGS Landslide] legend not read, using built-in colours:', e.message);
      _lsLegendCache = null;
      return { table: LS_LEGEND_FALLBACK, fromService: false };
    });
  }
  return _lsLegendCache;
}

/** Count of features within 1 km of the point, or throws. */
async function _lsCountWithin1km(baseUrl, lat, lng) {
  const url = `${baseUrl}?geometry=${_esriPointParam(lat, lng)}` +
    `&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    `&distance=1000&units=esriSRUnit_Meter&returnCountOnly=true&f=json`;
  const data = await directFetch(url);
  const n = Number(data && data.count);
  if (!isFinite(n) || n < 0) throw new Error('No count in response');
  return n;
}

async function _callLandslideAPI(lat, lng) {
  console.log('[USGS Landslide] Starting for', _coarse(lat), _coarse(lng));
  const t = _lsTileFor(lat, lng);
  const tileUrl = `${API_CONFIG.USGS_LANDSLIDE}/tile/${t.level}/${t.row}/${t.col}`;

  // Modifiers run alongside the tile; a failed one is reported, not fatal.
  const invP = _lsCountWithin1km(API_CONFIG.USGS_LANDSLIDE_INVENTORY, lat, lng)
    .catch(e => { console.warn('[USGS Landslide] inventory not checked:', e.message); return null; });
  const pfP  = _lsCountWithin1km(API_CONFIG.USGS_POSTFIRE, lat, lng)
    .catch(e => { console.warn('[USGS Landslide] post-fire basins not checked:', e.message); return null; });

  const [legend, rgba] = await Promise.all([_lsLegendTable(), _lsSample(tileUrl, t.px, t.py)]);
  const cls = _lsMatchClass(rgba, legend.table);
  if (cls === null) throw new Error(`Tile colour ${rgba.join(',')} matches no legend class`);

  const [inv, pf] = await Promise.all([invP, pfP]);
  const result = _landslideResult(cls, inv, pf);
  if (!result) throw new Error(`No landslide result for class ${cls}`);
  console.log('[USGS Landslide] tile', `${t.level}/${t.row}/${t.col}`, 'px', t.px, t.py, 'rgba', rgba.join(','),
    'class', cls, 'legend from service:', legend.fromService, 'result:', result);
  return { ...result, source: LS_SRC };
}

/* ---------------------------------------------------------------
   API 8 — FEMA DISASTER DECLARATIONS (OpenFEMA)
   Route: direct (CORS, checked 2026-10-31). Counts county declarations by
   incident type since 2000 and only ever raises a likelihood floor.
--------------------------------------------------------------- */

const DECLARATIONS_SINCE = 2000;

async function _callDeclarationsAPI(stateFips, countyFips) {
  if (!/^\d{2}$/.test(String(stateFips || '')) || !/^\d{3}$/.test(String(countyFips || ''))) {
    throw new Error('No county FIPS');
  }
  const filter = `fipsStateCode eq '${stateFips}' and fipsCountyCode eq '${countyFips}'`;
  const url = `${API_CONFIG.OPENFEMA_DECLARATIONS}?$filter=${encodeURIComponent(filter)}` +
    `&$select=disasterNumber,incidentType,declarationDate,fipsCountyCode&$top=1000`;
  const data = await directFetch(url);
  const rows = data && data.DisasterDeclarationsSummaries;
  if (!Array.isArray(rows)) throw new Error('Unexpected OpenFEMA response');
  const counts = _countDeclarations(rows, DECLARATIONS_SINCE);
  console.log('[OpenFEMA] declarations since', DECLARATIONS_SINCE, counts);
  return counts;
}

/** Count by incidentType. Statewide rows (county '000') and rows before sinceYear are left out. */
function _countDeclarations(rows, sinceYear) {
  const counts = {};
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach(r => {
    if (!r || typeof r !== 'object') return;
    if (String(r.fipsCountyCode) === '000') return;
    const year = new Date(r.declarationDate).getUTCFullYear();
    if (!(year >= sinceYear)) return;
    const type = String(r.incidentType || '').trim();
    if (!type) return;
    // One disaster can be listed more than once for a county
    if (r.disasterNumber !== undefined && r.disasterNumber !== null) {
      const key = `${r.disasterNumber}`;
      if (seen.has(key)) return;
      seen.add(key);
    }
    counts[type] = (counts[type] || 0) + 1;
  });
  return counts;
}

/* Floors: [count needed, minimum likelihood], highest first. */
const DECLARATION_FLOORS = [
  { types: ['Fire'],                          words: 'fire',                   ids: [1],    rules: [[6, 4], [3, 3]] },
  { types: ['Flood'],                         words: 'flood',                  ids: [3, 4], rules: [[3, 3]] },
  { types: ['Snowstorm', 'Severe Ice Storm'], words: 'snowstorm or ice storm', ids: [8],    rules: [[2, 3]] },
  { types: ['Tornado'],                       words: 'tornado',                ids: [6],    rules: [[2, 3]] },
  { types: ['Hurricane', 'Typhoon'],          words: 'hurricane or typhoon',   ids: [7],    rules: [[2, 3]] },
];

/**
 * Raise (never lower) finding scores where FEMA has declared several
 * disasters of that type in the county. Never creates a finding.
 * Returns the hazard ids it changed.
 */
function _applyDeclarationFloors(findings, counts, countyLabel, stateAbbr) {
  const changed = [];
  if (!counts || typeof counts !== 'object' || !Array.isArray(findings)) return changed;
  const where = countyLabel || 'this county';
  DECLARATION_FLOORS.forEach(fl => {
    const n = fl.types.reduce((sum, t) => sum + (Number(counts[t]) || 0), 0);
    const rule = fl.rules.find(([need]) => n >= need);
    if (!rule) return;
    const floor = rule[1];
    fl.ids.forEach(id => {
      if (_researchSkipsNa(id, stateAbbr)) return;
      const f = findings.find(x => x.hazardId === id);
      if (!f || typeof f.scoreAssigned !== 'number' || f.scoreAssigned >= floor) return;
      f.scoreAssigned = floor;
      f.finding = `${String(f.finding || '').replace(/\.?\s*$/, '.')} FEMA has declared ${n} ${fl.words} disasters in ${where} since ${DECLARATIONS_SINCE}.`;
      changed.push(id);
    });
  });
  return changed;
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
    flood, earthquake, wildfire, weather, drought, epa, landslide, nri, declarations,
  } = apiResults;

  const stateAbbr     = geocoded.stateAbbr || weather?.stateAbbr || '';
  const weatherScores = getStateWeatherScores(stateAbbr);
  const findings      = [];
  const nriTract      = (nri && nri.tract)  || null;
  const nriCounty     = (nri && nri.county) || null;
  const countyLabel   = _nriCountyLabel(nriCounty && nriCounty.COUNTY, stateAbbr) ||
                        _nriCountyLabel(String(geocoded.county || '').replace(/ County$/i, ''), stateAbbr);

  /**
   * Add a finding. If result is null (API failed), apply a fallback score
   * from `fallbackFn` and mark it as estimated — never leave score null.
   */
  function addFinding(hazardId, hazardName, category, _apiKey, result, source, fallbackFn, extras) {
    if (!result) {
      const fb = fallbackFn ? fallbackFn() : null;
      if (fb) {
        // Say why when we know: relay not set up, or no source exists yet
        const why = FALLBACK_REASONS[(_research.failCodes || {})[_apiKey]];
        findings.push({
          hazardId, hazardName, category,
          scoreAssigned: fb.score,
          // An estimate is a World Aware placeholder, not the named data source
          source: why ? why.source(source) : `World Aware placeholder (${source} did not respond)`,
          finding: why ? String(fb.finding).replace(FALLBACK_PREFIX, why.prefix) : fb.finding,
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
  addFinding(H_ID.FLOOD_RIVERINE, H_NAME[3], _hCat(3), 'flood', floodWithUrl, floodSrc, _floodFallback, { femaMapUrl });
  addFinding(H_ID.FLASH_FLOOD,    H_NAME[4], _hCat(4), 'flood', floodWithUrl, floodSrc, _floodFallback, { femaMapUrl });

  // ── EARTHQUAKE ────────────────────────────────────────────
  addFinding(H_ID.EARTHQUAKE, H_NAME[2], _hCat(2),
    'earthquake', earthquake, 'USGS NEHRP 2020 Seismic Design Values — Peak Ground Acceleration',
    () => _quakeFallback(stateAbbr));

  // ── WILDFIRE + AQ boost ───────────────────────────────────
  // (The v2 WUI finding repeated this one; WUI merged into Wildfire in v3.)
  const whpSrc = 'USFS Wildfire Hazard Potential 2023 (270 m) — national fuel/landscape conditions';
  addFinding(H_ID.WILDFIRE, H_NAME[1], _hCat(1), 'wildfire', wildfire, whpSrc,
    () => _wildfireFallback(stateAbbr));

  // Wildfire hazard also drives the smoke estimate
  const whpScore = wildfire?.score || 2;

  // Air quality — derived. If either input was a placeholder, so is this.
  const epaHigh  = epa?.highHazardCount || 0;
  const aqResult = _deriveAirQualityScore(whpScore, epaHigh, stateAbbr);
  const aqDerivedFromData = !!(wildfire && epa);
  const aqRelayOff = !wildfire && (_research.failCodes || {}).wildfire === RELAY_NOT_CONFIGURED;
  findings.push({
    hazardId: H_ID.AIR_QUALITY, hazardName: H_NAME[23], category: _hCat(23),
    scoreAssigned: aqResult.score,
    source: aqDerivedFromData
      ? 'Derived from USFS wildfire hazard and EPA TRI industrial proximity'
      : aqRelayOff ? FALLBACK_REASONS[RELAY_NOT_CONFIGURED].source()
      : 'World Aware placeholder (wildfire or industrial data did not respond)',
    finding:    aqDerivedFromData ? aqResult.finding
      : `${aqRelayOff ? FALLBACK_REASONS[RELAY_NOT_CONFIGURED].prefix : FALLBACK_PREFIX} ${aqResult.finding}`,
    confidence: aqDerivedFromData ? aqResult.confidence : 'Low',
    status: aqDerivedFromData ? 'success' : 'estimated', isOverridden: false,
  });

  // ── WEATHER ───────────────────────────────────────────────
  // Hail, winter storm and tornado come from the FEMA National Risk Index
  // when it answers. The state table in scoreMapper.js (getStateWeatherScores)
  // is the fallback; the NWS call only confirms the state, so the fallback
  // never cites NOAA.
  // Extreme heat stays on the state rule of thumb on purpose: NRI HWAV_AFREQ
  // rates Boulder "Very Low" (0.79 heat wave days a year) against about 33
  // days a year at or above 90 F in the 1991-2020 normals, because it counts
  // only heat events the local NWS office logged. v3.3 adds NOAA normals.
  // Hurricane also stays on the rule of thumb (skipped when ruled out).
  const weatherNote = stateAbbr
    ? `Statewide estimate for ${stateAbbr}, not specific to this address.`
    : 'Regional estimate; state could not be confirmed.';
  const weatherSrc = WEATHER_RULE_SRC;
  const nriWeather = {
    [H_ID.SEVERE_THUNDERSTORM]: nriTract  ? _mapNRIHail(nriTract.HAIL_AFREQ) : null,
    [H_ID.TORNADO]:             nriCounty ? _mapNRITornado(nriCounty.TRND_AFREQ, nriCounty.AREA, countyLabel) : null,
    [H_ID.WINTER_STORM]:        nriTract  ? _mapNRIWinter(nriTract.WNTW_AFREQ, nriTract.CWAV_AFREQ) : null,
  };
  const nriSource = {
    [H_ID.SEVERE_THUNDERSTORM]: NRI_SRC_TRACT,
    [H_ID.TORNADO]:             NRI_SRC_COUNTY,
    [H_ID.WINTER_STORM]:        NRI_SRC_TRACT,
  };

  const weatherMap = [
    { id: H_ID.SEVERE_THUNDERSTORM, key: 'severeThunderstorm' },
    { id: H_ID.TORNADO,             key: 'tornado' },
    { id: H_ID.HURRICANE,           key: 'hurricane' },
    { id: H_ID.WINTER_STORM,        key: 'winterStorm' },
    { id: H_ID.EXTREME_HEAT,        key: 'extremeHeat' },
  ];

  weatherMap.forEach(({ id, key }) => {
    // A hazard ruled out for this place gets no estimate (Hurricane arrives
    // ruled out for Colorado; an address elsewhere clears that mark).
    if (_researchSkipsNa(id, stateAbbr)) return;
    const fromNri = nriWeather[id];
    if (fromNri) {
      findings.push({
        hazardId: id, hazardName: H_NAME[id], category: _hCat(id),
        scoreAssigned: fromNri.score,
        source: nriSource[id],
        finding: fromNri.finding,
        confidence: fromNri.confidence,
        status: 'success', isOverridden: false,
      });
      return;
    }
    const score = weatherScores[key] || 2;
    findings.push({
      hazardId: id, hazardName: H_NAME[id], category: _hCat(id),
      scoreAssigned: score,
      source: weatherSrc,
      finding: `${score === 4 ? 'Likely' : score === 3 ? 'Possible' : 'Unlikely'}. ${weatherNote}`,
      confidence: 'Low',
      status: 'estimated', isOverridden: false,
    });
  });

  // ── HIGH WIND ─────────────────────────────────────────────
  // NRI thunderstorm wind only. There is no state rule of thumb for wind,
  // so without NRI it stays on the "Needs your judgment" list.
  const wind = nriTract ? _mapNRIWind(nriTract.SWND_AFREQ) : null;
  if (wind && !_researchSkipsNa(H_ID.HIGH_WIND, stateAbbr)) {
    findings.push({
      hazardId: H_ID.HIGH_WIND, hazardName: H_NAME[63], category: _hCat(63),
      scoreAssigned: wind.score,
      source: NRI_SRC_TRACT,
      finding: wind.finding,
      confidence: wind.confidence,
      status: 'success', isOverridden: false,
    });
  }

  // ── DROUGHT ───────────────────────────────────────────────
  addFinding(H_ID.DROUGHT, H_NAME[10], _hCat(10),
    'drought', drought, 'US Drought Monitor — county-level drought conditions',
    () => ({ score: 2, finding: `${FALLBACK_PREFIX} Colorado moves in and out of drought most years; check droughtmonitor.unl.edu.`, confidence: 'Low', isFallback: true }));

  // ── EPA TRI: chemical spill ──────────────────────────────
  // EPA covers plants in the ZIP code only; rail lines and freight highways
  // are part of this hazard too, so the finding says to check them.
  const railNote = 'Rail lines and freight highways are not in this data; check the routes near you yourself.';
  const epaChemResult = epa ? { score: epa.chemScore, finding: `${epa.finding}. ${railNote}`, confidence: epa.confidence } : null;
  addFinding(H_ID.CHEMICAL_PLANT, H_NAME[15], _hCat(15),
    'epa', epaChemResult,
    'EPA Toxics Release Inventory (TRI) — regulated industrial facilities in ZIP code',
    () => ({ score: 2, finding: `${FALLBACK_PREFIX} Industrial proximity unknown. ${railNote}`, confidence: 'Low', isFallback: true }));

  // ── LANDSLIDE ─────────────────────────────────────────────
  // USGS 2024 susceptibility at the point; if the tile or canvas failed, the
  // NRI tract frequency (Low confidence); if that is missing too, no finding,
  // and the hazard is listed under "Needs your judgment" with the USGS map link.
  const landslideNri = landslide ? null : (nriTract ? _mapNRILandslide(nriTract.LNDS_AFREQ) : null);
  if (landslide) {
    findings.push({
      hazardId: H_ID.LANDSLIDE, hazardName: H_NAME[11], category: _hCat(11),
      scoreAssigned: landslide.score,
      source: landslide.source || LS_SRC,
      finding: landslide.finding,
      confidence: landslide.confidence,
      status: 'success', isOverridden: false,
    });
  } else if (landslideNri) {
    findings.push({
      hazardId: H_ID.LANDSLIDE, hazardName: H_NAME[11], category: _hCat(11),
      scoreAssigned: landslideNri.score,
      source: NRI_SRC_TRACT,
      finding: landslideNri.finding,
      confidence: landslideNri.confidence,
      status: 'success', isOverridden: false,
    });
  }

  // ── FEMA DECLARATION FLOORS (raise only, after everything else) ──
  if (declarations) {
    // Floors are an extra; a bug here must not discard the findings.
    try {
      _applyDeclarationFloors(findings, declarations, countyLabel, stateAbbr);
    } catch (e) {
      console.warn('[OpenFEMA] floors not applied:', e.message);
    }
  }

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
      if (err && err.code) _research.failCodes[stepId] = err.code;
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
  _research.failCodes  = {};
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

  // ── PARALLEL API CALLS (spinners update independently) ──
  ['nri','flood','earthquake','wildfire','weather','drought','epa','airquality','landslide','declarations']
    .forEach(id => _setStep(id, 'running'));

  const { lat, lng, zip, fips5, stateFips, countyFips } = geocoded;

  console.log('[Research] Starting parallel API calls for lat:', lat, 'lng:', lng, 'zip:', zip, 'fips5:', fips5);

  // Air quality is always derived — mark it running separately
  // and resolve it after the other calls finish
  // One NRI call feeds hail, wind, winter, tornado, the flood fallback and
  // the landslide fallback. Flood waits on it only if it reaches Method D.
  const nriP = _tracked('nri', _callNRIAPI(lat, lng, fips5));
  const [nri, flood, earthquake, wildfire, weather, drought, epa, landslide, declarations] =
    await Promise.all([
      nriP,
      _tracked('flood',      _callFloodAPI(lat, lng, fips5, nriP)),
      _tracked('earthquake', _callEarthquakeAPI(lat, lng)),
      _tracked('wildfire',   _callWildfireAPI(lat, lng)),
      _tracked('weather',    _callWeatherAPI(lat, lng)),
      _tracked('drought',    _callDroughtAPI(fips5)),
      _tracked('epa',        _callEPAAPI(zip)),
      _tracked('landslide',  _callLandslideAPI(lat, lng)),
      _tracked('declarations', _callDeclarationsAPI(stateFips, countyFips)),
    ]);

  if (run !== _research.runId) return;   // cancelled while the lookups ran

  // Air quality is derived from wildfire and EPA; it is only a real result when both are
  _setStep('airquality', (wildfire && epa) ? 'success' : 'error');

  console.log('[Research] All API calls settled. Results:', {
    nri, flood, earthquake, wildfire, weather, drought, epa, landslide, declarations
  });

  // ── COMPILE FINDINGS ──────────────────────────────────────
  try {
    _research.findings = _compileFindings(
      { flood, earthquake, wildfire, weather, drought, epa, landslide, nri, declarations },
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

  // Hurricane, tsunami and volcanic ash arrive ruled out because they assume
  // Colorado. An address in another state clears those marks.
  if (_outsideColorado(_research.geocoded?.stateAbbr)) clearAutoNotApplicable();

  // Include both 'success' and 'estimated' (fallback) findings, and skip
  // hazards marked "Does not apply here" or no longer in HAZARD_DATA
  const known = id => typeof HAZARD_DATA === 'undefined' || HAZARD_DATA.some(h => h.id === id);
  const successFindings = _research.findings.filter(
    f => (f.status === 'success' || f.status === 'estimated') && f.scoreAssigned !== null &&
         known(f.hazardId) && !(state.scores[f.hazardId] && state.scores[f.hazardId].na)
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

const H_NAME_MANUAL = { 17: 'Gas leak or explosion', 18: 'Nuclear or radiological incident' };

/**
 * Build a rich interactive manual-lookup card for pipeline (17) or nuclear (18).
 */
function _buildManualLookupCard(hazardId) {
  const IS_PIPELINE = (hazardId === 17);
  const IS_NUCLEAR  = (hazardId === 18);

  if (!IS_PIPELINE && !IS_NUCLEAR) return '';

  const title   = IS_PIPELINE ? H_NAME_MANUAL[17] : H_NAME_MANUAL[18];
  const badge   = 'Manual lookup required';
  const message = IS_PIPELINE
    ? 'Pipeline proximity cannot be looked up automatically. PHMSA has no public address-level API.'
    : 'Nuclear facility proximity needs a manual lookup. NRC has no public API this tool can call.';
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
  // Hazards marked "Does not apply here" are not filled in, so they are
  // left out of every count and list and named once below.
  // Same rule as applyResearchScores: a pre-mark is cleared for an address outside Colorado.
  const isRuledOut = f => _researchSkipsNa(f.hazardId, geo && geo.stateAbbr);
  const ruledOut   = findings.filter(isRuledOut);
  const live       = findings.filter(f => !isRuledOut(f));
  const successful = live.filter(f => f.status === 'success' || f.status === 'estimated');
  const fromData   = live.filter(f => f.status === 'success');
  const estimated  = live.filter(f => f.status === 'estimated');
  const failed     = live.filter(f => f.status === 'error');

  // Hazards that need the user's judgment: not covered by a finding and not ruled out
  const findingIds = new Set(findings.map(f => f.hazardId));
  const manualIds = Object.keys(MANUAL_REASONS).map(Number).filter(id => {
    if (findingIds.has(id)) return false;
    const hz = (typeof HAZARD_DATA !== 'undefined') ? HAZARD_DATA.find(h => h.id === id) : null;
    if (typeof HAZARD_DATA !== 'undefined' && !hz) return false;
    // Custom slots are listed only once the user has named them
    if (hz && hz.isCustom && !(typeof state !== 'undefined' && state.customNames && state.customNames[id] && state.customNames[id].name)) return false;
    return !(typeof state !== 'undefined' && state.scores && state.scores[id] && state.scores[id].na);
  });
  const manualCount = manualIds.length;

  // Street name and city only: this card is often on a projector in a workshop.
  const countyLabel = geo.county ? `${escHtml(String(geo.county).replace(/ County$/i, ''))} County` : '';
  const placeLine   = [countyLabel, escHtml(geo.stateAbbr || '')].filter(Boolean).join(', ');

  const summaryHead = fromData.length > 0
    ? `<strong>Public data found for ${fromData.length} hazard${fromData.length === 1 ? '' : 's'}.</strong>`
    : `<strong>No public data sources responded.</strong>`;
  const summarySub  = _researchSummarySub(estimated, failed.length, manualCount);

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
      <p class="report-actions-note">Likelihood estimates are added to your assessment. The household checklist sets the impact, and you can change it.</p>
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
      const cat = _findingCategory(f);
      if (!cats[cat]) cats[cat] = [];
      cats[cat].push(f);
    });

    Object.keys(cats).forEach(cat => {
      html += `<div class="report-category-group">
        <div class="report-cat-label">${ic((typeof CATEGORY_ICONS !== 'undefined' && CATEGORY_ICONS[cat]) || 'circle-dashed')} ${escHtml(typeof catLabel === 'function' ? catLabel(cat) : cat)}</div>
      `;
      cats[cat].forEach(f => { html += _buildFindingCard(f); });
      html += `</div>`;
    });
  }

  if (ruledOut.length > 0) {
    html += `<p class="report-ruled-out-note">Not applied because you marked ${ruledOut.length === 1 ? 'it' : 'them'} Does not apply here: ${ruledOut.map(f => escHtml(_findingName(f))).join('; ')}.</p>`;
  }

  // ── FAILED API CALLS ────────────────────────────────────────
  if (failed.length > 0) {
    html += `
      <div class="alert alert-warning report-unavailable">
        ${ic('triangle-alert')}
        <div>
          <p class="alert-title">${failed.length} data source${failed.length > 1 ? 's' : ''} unavailable</p>
          <p>These hazards were not auto-scored.</p>
          <ul>${failed.map(f => `<li>${escHtml(_findingName(f))}</li>`).join('')}</ul>
        </div>
      </div>
    `;
  }

  // ── MANUAL HAZARDS ────────────────────────────────────────
  html += `<h3 class="report-section-heading">${ic('pencil')} Needs your judgment (${manualCount} hazard${manualCount === 1 ? '' : 's'})</h3>
  <p class="report-manual-intro">No public map covers these. You know them better than any database does. Most take a few seconds; skip any that do not apply.</p>
  <div class="report-manual-list">`;

  // Only hazards without a finding that are not ruled out
  manualIds.forEach(numId => {
    const id = numId;
    const reason = MANUAL_REASONS[numId];
    // Pipeline (17) and Nuclear (18) get rich interactive cards
    if (numId === 17 || numId === 18) {
      html += _buildManualLookupCard(numId);
      return;
    }
    const hazard = (typeof HAZARD_DATA !== 'undefined') ? HAZARD_DATA.find(h => h.id === numId) : null;
    const name   = hazard ? (typeof hazardDisplayName === 'function' ? hazardDisplayName(hazard) : hazard.name) : `Hazard #${id}`;
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

/**
 * Second line of the research summary. State rules of thumb are not a
 * source that failed, so they are counted apart from real placeholders.
 */
function _researchSummarySub(estimated, failedCount, manualCount) {
  const rule  = estimated.filter(_isRuleOfThumb).length;
  const other = estimated.length - rule;
  return [
    other > 0 ? `${other} ${other === 1 ? 'is a' : 'are'} rough placeholder${other === 1 ? '' : 's'} because a source did not respond.` : '',
    rule > 0 ? `No address-level source exists yet for ${rule} item${rule === 1 ? '' : 's'}; ${rule === 1 ? 'it uses' : 'they use'} a state rule of thumb.` : '',
    failedCount > 0 ? `${failedCount} could not be scored.` : '',
    `${manualCount} need your judgment.`,
  ].filter(Boolean).join(' ');
}

/** Current hazard name for a finding (saved reports may carry a v2 name). */
function _findingName(f) {
  const h = (typeof HAZARD_DATA !== 'undefined') ? HAZARD_DATA.find(x => x.id === f.hazardId) : null;
  return (h && h.name) || f.hazardName || '';
}
function _findingCategory(f) {
  const h = (typeof HAZARD_DATA !== 'undefined') ? HAZARD_DATA.find(x => x.id === f.hazardId) : null;
  return (h && h.category) || f.category || '';
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
          <span class="finding-name">${escHtml(_findingName(f))}</span>
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
