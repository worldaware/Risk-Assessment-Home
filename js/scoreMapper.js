/* =============================================================
   WORLD AWARE RISK ASSESSMENT — js/scoreMapper.js
   Pure functions that convert raw API values to Likelihood
   scores (1–5). No side effects; no DOM access.
   ============================================================= */

'use strict';

/* ---------------------------------------------------------------
   FLOOD ZONE → SCORE  (FEMA NFHL)
--------------------------------------------------------------- */

/**
 * @param {string} zone       e.g. "AE", "X", "C"
 * @param {string} subtype    e.g. "FLOODWAY", ""
 * @returns {{ score:number, finding:string, confidence:string }}
 */
function mapFloodZoneToScore(zone, subtype) {
  const z   = (zone || '').trim().toUpperCase();
  const sub = (subtype || '').trim().toUpperCase();

  // No zone, or a zone that carries no flood information. score:null means
  // "no data" — callers must fall through to the next method, never score it.
  if (!z || z === 'AREA NOT INCLUDED' || z === 'OPEN WATER') {
    return {
      score: null,
      finding: z ? `FEMA: ${z.toLowerCase()} (no flood zone mapped here)` : 'No FEMA flood zone data at this location',
      confidence: 'Low',
    };
  }

  // High-risk A zones (Zone A, AE, AH, AO, AR, A99, A1–A30). Exact match so
  // that other FLD_ZONE values beginning with "A" are not caught.
  if (/^(A|AE|AH|AO|AR|A99|A\d{1,2})$/.test(z)) {
    const subtypeNote = sub ? ` (${sub})` : '';
    return {
      score: 5,
      finding: `FEMA Zone ${z}${subtypeNote} — High Risk Flood Zone (1% annual chance)`,
      confidence: 'High',
    };
  }

  // Coastal V zones are also high risk
  if (/^(V|VE|V\d{1,2})$/.test(z)) {
    return {
      score: 5,
      finding: `FEMA Zone ${z} — High Risk Coastal Flood Zone`,
      confidence: 'High',
    };
  }

  // Moderate risk — Zone B, X500, or Zone X with the 0.2% (500-year) or
  // levee-protected subtype. NFHL spells these out in ZONE_SUBTY, e.g.
  // "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" and "AREA WITH REDUCED FLOOD RISK DUE TO LEVEE".
  if (z === 'B' || z === 'X500' || (z.startsWith('X') && /0\.2 PCT|LEVEE/.test(sub))) {
    const subtypeNote = sub ? ` (${sub})` : '';
    return { score: 3, finding: `FEMA Zone ${z}${subtypeNote} — Moderate Risk Flood Zone`, confidence: 'High' };
  }

  // Minimal risk — Zone C, Zone X
  if (z === 'C' || z === 'X') {
    return { score: 2, finding: `FEMA Zone ${z} — Minimal Flood Risk`, confidence: sub ? 'High' : 'Medium' };
  }

  // Undetermined — Zone D
  if (z === 'D') {
    return { score: 2, finding: `FEMA Zone D — Undetermined Flood Risk`, confidence: 'Low' };
  }

  // Unrecognised zone code: no data rather than a guess
  return { score: null, finding: `FEMA Zone ${z} — not recognised`, confidence: 'Low' };
}


/* ---------------------------------------------------------------
   EARTHQUAKE PGA → SCORE  (USGS NEHRP)
--------------------------------------------------------------- */

/**
 * @param {number} pga  Peak Ground Acceleration in g
 * @returns {{ score:number, finding:string, confidence:string }}
 */
function mapPGAToScore(pga) {
  const p = parseFloat(pga) || 0;

  if (p >= 0.50) return { score: 5, finding: `PGA = ${p.toFixed(3)}g — Very High Seismic Hazard`,    confidence: 'High' };
  if (p >= 0.25) return { score: 4, finding: `PGA = ${p.toFixed(3)}g — High Seismic Hazard`,         confidence: 'High' };
  if (p >= 0.10) return { score: 3, finding: `PGA = ${p.toFixed(3)}g — Moderate Seismic Hazard`,     confidence: 'High' };
  if (p >= 0.04) return { score: 2, finding: `PGA = ${p.toFixed(3)}g — Low-Moderate Seismic Hazard`, confidence: 'High' };
  return           { score: 1, finding: `PGA = ${p.toFixed(3)}g — Low Seismic Hazard`,               confidence: 'High' };
}


/* ---------------------------------------------------------------
   WILDFIRE HAZARD POTENTIAL → SCORE  (USFS WHP)
--------------------------------------------------------------- */

/**
 * WHP 2023 classified pixel values (Dillon 2023, RDS-2015-0047-4):
 * 1 very low, 2 low, 3 moderate, 4 high, 5 very high, 6 non-burnable, 7 water.
 * Classes 1–5 map straight onto Likelihood 1–5; 6 and 7 score 1.
 *
 * @param {string} label     e.g. "Very High", "High", "Moderate" (optional)
 * @param {number|string} cat numeric class 1–7
 * @returns {{ score:number, finding:string, confidence:string }}
 */
function mapWHPToScore(label, cat) {
  const l = (label || '').toLowerCase().trim();
  const c = parseInt(cat) || 0;
  const CLASS_LABELS = { 1: 'Very Low', 2: 'Low', 3: 'Moderate', 4: 'High', 5: 'Very High', 6: 'Non-burnable', 7: 'Water' };

  let score;
  if (l === 'very high' || c === 5) score = 5;
  else if (l === 'high'  || c === 4) score = 4;
  else if (l === 'moderate' || l === 'medium' || c === 3) score = 3;
  else if (l === 'low'   || c === 2) score = 2;
  else if (l === 'very low' || l === 'non-burnable' || l === 'water' || c === 1 || c === 6 || c === 7) score = 1;
  else score = 2; // unknown → treat as minimal

  const displayLabel = label || CLASS_LABELS[c] || (c ? `Category ${c}` : 'unknown');
  const confidence = (l || CLASS_LABELS[c]) ? 'High' : 'Low';

  return {
    score,
    finding: `USFS Wildfire Hazard Potential: ${displayLabel}`,
    confidence,
  };
}


/* ---------------------------------------------------------------
   STATE-BASED WEATHER HEURISTICS
--------------------------------------------------------------- */

const _TORNADO_HIGH  = new Set(['OK','KS','TX','NE','IA','MO','AR','MS','AL','TN','IL','IN','OH','SD','ND','MN','WI','KY','LA','GA']);
const _HURRICANE_HIGH = new Set(['TX','LA','MS','AL','FL']);
const _HURRICANE_MED  = new Set(['GA','SC','NC','VA','MD','DE','NJ','NY','CT','RI','MA','NH','ME']);
const _WINTER_HIGH    = new Set(['MN','WI','MI','ND','SD','MT','WY','ID','WA','OR','NY','VT','NH','ME','CO','IA','NE','KS','MO','IL','IN','OH','PA','MA','CT','RI']);
const _HEAT_HIGH      = new Set(['AZ','NV','NM','TX','FL','CA']);
const _HEAT_MED       = new Set(['UT','OK','LA','MS','AL','GA','SC','AR','TN','KS','MO','VA','NC','HI']);
const _DUST_HIGH      = new Set(['AZ','NM','TX','OK','KS','CO','NV','UT','CA','ID','MT']);

/**
 * Returns Likelihood scores for weather hazards based on state.
 * @param {string} stateAbbr  Two-letter state abbreviation
 * @returns {{ severeThunderstorm, tornado, hurricane, winterStorm, extremeHeat, dustStorm }}
 */
function getStateWeatherScores(stateAbbr) {
  const s = (stateAbbr || '').toUpperCase().trim();

  return {
    severeThunderstorm: 3, // universal baseline
    tornado:      _TORNADO_HIGH.has(s)   ? 4 : 2,
    hurricane:    _HURRICANE_HIGH.has(s) ? 4 : _HURRICANE_MED.has(s) ? 3 : 1,
    winterStorm:  _WINTER_HIGH.has(s)    ? 4 : 2,
    extremeHeat:  _HEAT_HIGH.has(s)      ? 4 : _HEAT_MED.has(s) ? 3 : 2,
    dustStorm:    _DUST_HIGH.has(s)      ? 3 : 1,
  };
}


/* ---------------------------------------------------------------
   DROUGHT MONITOR → SCORE
--------------------------------------------------------------- */

/**
 * @param {{ D0,D1,D2,D3,D4 }} categories  Percent coverage in each drought level
 * @returns {{ score:number, finding:string, confidence:string }}
 */
function mapDroughtToScore(categories) {
  const { D4 = 0, D3 = 0, D2 = 0, D1 = 0, D0 = 0 } = categories || {};

  if (D4 > 0) return { score: 5, finding: `Exceptional Drought (D4) — ${D4.toFixed(1)}% of county`, confidence: 'High' };
  if (D3 > 0) return { score: 4, finding: `Extreme Drought (D3) — ${D3.toFixed(1)}% of county`,     confidence: 'High' };
  if (D2 > 0) return { score: 3, finding: `Severe Drought (D2) — ${D2.toFixed(1)}% of county`,      confidence: 'High' };
  if (D1 > 0) return { score: 2, finding: `Moderate Drought (D1) — ${D1.toFixed(1)}% of county`,    confidence: 'High' };
  if (D0 > 0) return { score: 1, finding: `Abnormally Dry (D0) — ${D0.toFixed(1)}% of county`,      confidence: 'High' };
  return        { score: 1, finding: 'No drought conditions reported by NOAA Drought Monitor',       confidence: 'High' };
}


/* ---------------------------------------------------------------
   EPA TRI → SCORE
--------------------------------------------------------------- */

const _HIGH_HAZARD_SIC_RE = [/^28/, /^29/, /^33/, /^4911/, /^4931/, /^4941/];
const _POTW_SIC_RE        = [/^4952/, /^4953/];

/**
 * Classify a facility by SIC code.
 * @param {string|number} sic
 * @returns {'high-hazard'|'potw'|'other'}
 */
function classifyFacilitySIC(sic) {
  const s = String(sic || '').trim();
  if (_HIGH_HAZARD_SIC_RE.some(re => re.test(s))) return 'high-hazard';
  if (_POTW_SIC_RE.some(re => re.test(s)))        return 'potw';
  // Name-based fallback for POTW
  return 'other';
}

/**
 * @param {number} highHazardCount  High-hazard facilities within radius
 * @param {number} totalCount       All TRI facilities
 * @param {string} zip
 * @returns {{ chemScore:number, finding:string, confidence:string }}
 */
function mapTRIToChemScore(highHazardCount, totalCount, zip) {
  if (highHazardCount >= 3) {
    return {
      chemScore: 4,
      finding: `${highHazardCount} high-hazard industrial facilities (chemicals/petroleum/metals) in ZIP ${zip}`,
      confidence: 'Medium',
    };
  }
  if (highHazardCount >= 1) {
    return {
      chemScore: 3,
      finding: `${highHazardCount} high-hazard industrial facilit${highHazardCount > 1 ? 'ies' : 'y'} in ZIP ${zip}`,
      confidence: 'Medium',
    };
  }
  if (totalCount > 0) {
    return {
      chemScore: 2,
      finding: `${totalCount} industrial facilit${totalCount > 1 ? 'ies' : 'y'} in ZIP ${zip} (no high-hazard SIC codes identified)`,
      confidence: 'Medium',
    };
  }
  return {
    chemScore: 1,
    finding: `No EPA TRI facilities found in ZIP ${zip}`,
    confidence: 'Medium',
  };
}


/* ---------------------------------------------------------------
   LANDSLIDE SUSCEPTIBILITY → SCORE  (USGS)
--------------------------------------------------------------- */

/**
 * @param {string|number} level  e.g. "Very High", "High", 4, 5
 * @returns {{ score:number, finding:string, confidence:string }}
 */
function mapLandslideToScore(level) {
  const l = String(level || '').toLowerCase().trim();
  const n = Number(level); // numeric codes may arrive as strings ("4")

  let score;
  if (/very\s*high/i.test(l) || n === 5) score = 5;
  else if (/^high$/i.test(l) || n === 4) score = 4;
  else if (/moderate/i.test(l) || n === 3) score = 3;
  else if (/^low$/i.test(l) || n === 2) score = 2;
  else if (/very\s*low/i.test(l) || n === 1) score = 1;
  else score = 1;

  const displayLabel = level ? String(level) : 'No susceptibility data';
  return {
    score,
    finding: `USGS Landslide Susceptibility: ${displayLabel}`,
    confidence: l ? 'High' : 'Low',
  };
}
