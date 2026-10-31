/* =============================================================
   WORLD AWARE RISK ASSESSMENT — app.js
   Vanilla JS, no frameworks. All data stored in localStorage.
   ============================================================= */

'use strict';

// Single source of truth for the version shown in About, the JSON export and the console.
// Keep sw.js CACHE_NAME in step with it when shipping.
const APP_VERSION = '3.1.0';

// Where every "Contact us" link goes: the Say Hello form on beworldaware.com.
const BOOKING_URL = 'https://www.beworldaware.com/aboutus';

/* ---------------------------------------------------------------
   CONSTANTS & CONFIGURATION
--------------------------------------------------------------- */

// Bands follow the World Aware risk scale. The keys (CRITICAL, HIGH, MEDIUM, LOW)
// are what saved data and exports use; only `label` is shown to people.
// Colors live in tokens.css (.b-critical, .b-high, .b-medium, .b-low).
const RISK_LEVELS = {
  CRITICAL: { key: 'CRITICAL', min: 15, max: 25, label: 'Critical', action: 'Act now',                       cls: 'critical', steps: 4 },
  HIGH:     { key: 'HIGH',     min: 10, max: 14, label: 'High',     action: 'Write a specific plan',         cls: 'high',     steps: 3 },
  MEDIUM:   { key: 'MEDIUM',   min: 6,  max: 9,  label: 'Moderate', action: 'Cover in general preparedness', cls: 'medium',   steps: 2 },
  LOW:      { key: 'LOW',      min: 1,  max: 5,  label: 'Low',      action: 'Monitor',                       cls: 'low',      steps: 1 },
};

// Categories differ by name and icon only. Color is reserved for risk.
const CATEGORY_ICONS = {
  'Natural Hazards':                   'cloud-lightning',
  'Industrial & CBRN':                 'factory',
  'Outages & Service Interruptions':   'plug-zap',
  'Infrastructure Failures':           'building-2',
  'Supply Chain':                      'truck',
  'Other & Human-Caused':              'users',
  'Home':                              'house',
};
const CATEGORY_LABELS = {
  'Natural Hazards':                   'Natural hazards',
  'Industrial & CBRN':                 'Industrial and CBRN',
  'Outages & Service Interruptions':   'Outages and service interruptions',
  'Infrastructure Failures':           'Infrastructure failures',
  'Supply Chain':                      'Supply chain',
  'Other & Human-Caused':              'Other and human-caused',
  'Home':                              'Home',
};
function catLabel(name) { return CATEGORY_LABELS[name] || name; }

/** Inline Lucide icon from the sprite in index.html. */
function ic(name, cls) {
  return `<svg class="i${cls ? ' ' + cls : ''}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
}

/** Risk badge: band color, word label and a 4-step meter (never color alone). */
function riskBadgeHtml(rl) {
  if (!rl) return '<span class="badge b-unrated">Not rated</span>';
  const meter = [1, 2, 3, 4].map(n => `<i${n <= rl.steps ? ' class="f"' : ''}></i>`).join('');
  return `<span class="badge b-${rl.cls}"><span class="meter" aria-hidden="true">${meter}</span>${rl.label}</span>`;
}

/* ---------------------------------------------------------------
   HAZARD DATA (v3.0.0): 20 core, 8 less common, 3 custom
   Ids are stable from v2 so old exports and research findings still
   line up. `group` sets where a hazard sits on the Assess screen;
   `category` is kept for the report, actions and share text.
   `baseImpact` (core only) is the impact the household checklist
   starts from (js/checklist.js). `naDefault` hazards arrive marked
   "Does not apply here".
   Order here is the order on screen.
--------------------------------------------------------------- */

const HAZARD_DATA = [
  // ── The 20 most likely here ──────────────────────────────────
  { id: 1,  group: 'core', baseImpact: 4, category: 'Natural Hazards',
    name: 'Wildfire',
    description: 'A wildfire comes close enough that you are told to leave, or embers land on your property.' },
  { id: 23, group: 'core', baseImpact: 2, category: 'Natural Hazards',
    name: 'Smoke and bad air days',
    description: 'Smoke or blowing dust makes outdoor air unhealthy enough that you close up the house for a day or more.' },
  { id: 5,  group: 'core', baseImpact: 3, category: 'Natural Hazards',
    name: 'Hail and severe thunderstorms',
    description: 'Hail big enough to damage a roof, windows or car, or lightning and downpours from the same storm, hits your home.' },
  { id: 63, group: 'core', baseImpact: 3, category: 'Natural Hazards',
    name: 'High wind',
    description: 'Wind strong enough to tear shingles, drop trees or power lines on your street, or push a grass fire.' },
  { id: 8,  group: 'core', baseImpact: 3, category: 'Natural Hazards',
    name: 'Winter storm and extreme cold',
    description: 'Snow or ice keeps you home for two days or more, or cold deep enough that pipes freeze or the furnace can\'t keep up.' },
  { id: 24, group: 'core', baseImpact: 3, category: 'Outages & Service Interruptions',
    name: 'Long power outage, including planned safety shutoffs',
    description: 'Power is off at your home for more than a day, from storm damage or because the utility shuts it off to prevent fires.' },
  { id: 4,  group: 'core', baseImpact: 4, category: 'Natural Hazards',
    name: 'Flash flood',
    description: 'Water rushes down a canyon, gulch or street fast enough to reach your home within hours of heavy rain, or after a dam release upstream.' },
  { id: 3,  group: 'core', baseImpact: 4, category: 'Natural Hazards',
    name: 'River and creek flood',
    description: 'A creek or river rises over its banks and water reaches your home or cuts off your street for a day or more.' },
  { id: 10, group: 'core', baseImpact: 2, category: 'Natural Hazards',
    name: 'Drought and watering limits',
    description: 'Your water provider orders mandatory limits, or you have to cut household water use.' },
  { id: 9,  group: 'core', baseImpact: 2, category: 'Natural Hazards',
    name: 'Extreme heat',
    description: 'Several hot days in a row when the house stays unsafe without cooling, worst if the power is also out.' },
  { id: 2,  group: 'core', baseImpact: 3, category: 'Natural Hazards',
    name: 'Earthquake',
    description: 'Shaking strong enough at your home to knock things off shelves and crack walls or chimneys.' },
  { id: 11, group: 'core', baseImpact: 4, category: 'Natural Hazards',
    name: 'Landslide, rockfall and debris flow after fire',
    description: 'Rock, mud or a slope moves onto your home or your road, including mud and debris washing off a burned hillside in a storm.' },
  { id: 64, group: 'core', baseImpact: 3, category: 'Home',
    name: 'Radon',
    description: 'A test of your home shows radon at or above the EPA action level of 4 pCi/L. Haven\'t tested: rate it 3. Tested high: 5. Tested low: 1.' },
  { id: 65, group: 'core', baseImpact: 5, category: 'Home',
    name: 'House fire',
    description: 'A fire starts inside your home from cooking, heating, electrical or a dryer.' },
  { id: 15, group: 'core', baseImpact: 3, category: 'Industrial & CBRN',
    name: 'Chemical spill from road, rail or a nearby plant',
    description: 'A truck, train or nearby plant releases something toxic and you are told to stay inside with windows shut, or to leave.' },
  { id: 17, group: 'core', baseImpact: 4, category: 'Industrial & CBRN',
    name: 'Gas leak or explosion',
    description: 'A gas leak at your home or on your street forces you out, or a nearby gas line fails.' },
  { id: 27, group: 'core', baseImpact: 2, category: 'Outages & Service Interruptions',
    name: 'Water outage or unsafe tap water',
    description: 'Your tap water is off, or under a boil order, for a day or more.' },
  { id: 36, group: 'core', baseImpact: 3, category: 'Outages & Service Interruptions',
    name: 'Road closed when you need to leave',
    description: 'The roads you would use to get out are blocked by fire, flood, snow or a crash at the moment you need them.' },
  { id: 22, group: 'core', baseImpact: 3, category: 'Other & Human-Caused',
    name: 'Serious disease outbreak',
    description: 'A disease outbreak closes schools and workplaces or keeps your household home for weeks.' },
  { id: 6,  group: 'core', baseImpact: 4, category: 'Natural Hazards',
    name: 'Tornado',
    description: 'A tornado touches down close enough to damage your home or blow debris through your street.' },

  // ── Less common here ─────────────────────────────────────────
  { id: 7,  group: 'rare', naDefault: true, category: 'Natural Hazards',
    name: 'Hurricane',
    description: 'A hurricane or tropical storm brings damaging wind, storm surge or flooding rain to your home. They form over warm ocean water and do not reach Colorado as hurricanes.' },
  { id: 12, group: 'rare', naDefault: true, category: 'Natural Hazards',
    name: 'Tsunami',
    description: 'A wave from the ocean floods your home after an undersea earthquake or landslide. Only coastal homes are exposed.' },
  { id: 13, group: 'rare', naDefault: true, category: 'Natural Hazards',
    name: 'Volcanic ash',
    description: 'Ash from an eruption falls on your area and fouls the air, water, roads and engines.' },
  { id: 18, group: 'rare', category: 'Industrial & CBRN',
    name: 'Nuclear or radiological incident',
    description: 'A release from a reactor, a medical or industrial radiation source, or a deliberate attack means you are told to stay inside or to leave.' },
  { id: 20, group: 'rare', category: 'Industrial & CBRN',
    name: 'Old mine collapse or quarry blasting',
    description: 'Ground over old coal or mine workings sinks under your home, or blasting at a nearby quarry shakes or damages it.' },
  { id: 53, group: 'rare', category: 'Other & Human-Caused',
    name: 'Civil unrest',
    description: 'Protests or riots near your home make it unsafe to go out, block your way home, or damage property on your street.' },
  { id: 54, group: 'rare', category: 'Other & Human-Caused',
    name: 'Active threat',
    description: 'A shooting or other violent attack happens nearby and you are told to shelter in place or stay away from the area.' },
  { id: 66, group: 'rare', category: 'Natural Hazards',
    name: 'Shifting or swelling soil under the house',
    description: 'Clay soil under the house swells when wet and shrinks when dry, cracking the foundation, walls or driveway over months or years.' },

  // ── Something we missed? (user-editable) ─────────────────────
  { id: 60, group: 'custom', category: 'Other & Human-Caused', name: '', description: '', isCustom: true, customIndex: 1 },
  { id: 61, group: 'custom', category: 'Other & Human-Caused', name: '', description: '', isCustom: true, customIndex: 2 },
  { id: 62, group: 'custom', category: 'Other & Human-Caused', name: '', description: '', isCustom: true, customIndex: 3 },
];

// v2 hazard ids that were merged into a core hazard or moved to the household
// checklist in v3.0.0. Saved states and imports drop them.
const RETIRED_HAZARD_IDS = [14, 16, 19, 21, 25, 26, 28, 29, 30, 31, 32, 33, 34, 35, 37, 38, 39, 40, 41, 42,
  43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 55, 56, 57, 58, 59];

// For each retired id: its v2 name, and the v3 hazard that takes its notes.
// Merged ids follow the "absorbs" list in the v3 spec. Ids that moved to the
// household checklist have no absorbing hazard, so their notes go to the core
// hazard they were a consequence of (a judgment call; see v3 build report).
const RETIRED_HAZARDS = {
  14: ['Dust Storm / Haboob', 23],
  16: ['Hazmat Transportation Incident', 15],
  19: ['Agricultural Chemical Drift', 15],
  21: ['Wastewater / Sewage Release', 27],
  25: ['Short-Term Power Outage (<3 days)', 24],
  26: ['Natural Gas Service Interruption', 17],
  28: ['Wastewater / Sewer Failure', 4],
  29: ['Internet / Broadband Outage', 24],
  30: ['Cell Network Failure', 24],
  31: ['Landline / VOIP Outage', 24],
  32: ['Emergency Services Overwhelmed', 36],
  33: ['Hospital / Medical Facility Closure', 22],
  34: ['School / Childcare Closure', 22],
  35: ['Public Transit Disruption', 36],
  37: ['Water Main Break', 27],
  38: ['Fuel Supply Disruption', 36],
  39: ['Dam Failure / Reservoir Release', 4],
  40: ['Levee Failure', 3],
  41: ['Electrical Grid Substation Failure', 24],
  42: ['Building / Structural Failure', 2],
  43: ['Stormwater / Drainage System Failure', 4],
  44: ['Cyber Attack on Critical Infrastructure', 24],
  45: ['Food Supply Shortage', 22],
  46: ['Medication / Pharmaceutical Shortage', 22],
  47: ['Medical Equipment Shortage', 24],
  48: ['Fuel / Energy Supply Disruption', 8],
  49: ['Building Materials Shortage', 1],
  50: ['Bottled Water / Purification Supply Shortage', 27],
  51: ['Electronic / Battery Supply Shortage', 24],
  52: ['Cash / Banking System Disruption', 24],
  55: ['Wildland-Urban Interface Encroachment', 1],
  56: ['Economic Shock / Job Loss', 22],
  57: ['Housing Instability / Displacement', 1],
  58: ['Animal / Livestock Disease Outbreak', 22],
  59: ['Extreme Isolation / Evacuation Difficulty', 36],
};

// The three groups on the Assess screen, in order. The household checklist
// card sits above them (js/checklist.js).
const HAZARD_GROUPS = [
  { key: 'core',   icon: 'map-pin',       title: 'The 20 most likely here',
    intro: 'These are the things most likely to happen to a home in Boulder and Denver. For each one, pick how often it could happen at your home, or mark it Does not apply here.' },
  { key: 'rare',   icon: 'circle-dashed', title: 'Less common here (8)',
    intro: 'These happen, but rarely on the Front Range or only in certain spots. Open this if one of them applies to you or worries you.' },
  { key: 'custom', icon: 'plus',          title: 'Something we missed?',
    intro: 'Add anything specific to your home or street.' },
];

function getHazard(id) {
  id = parseInt(id, 10);
  return HAZARD_DATA.find(h => h.id === id) || null;
}

/* ---------------------------------------------------------------
   APP STATE
--------------------------------------------------------------- */

/** Today's date (YYYY-MM-DD) in the user's local time zone, not UTC. */
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _newAssessmentId() {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Scores a fresh assessment starts with: the naDefault hazards ruled out. */
function _defaultScores() {
  const scores = {};
  HAZARD_DATA.forEach(h => { if (h.naDefault) scores[h.id] = { na: true, naAuto: true }; });
  return scores;
}

/**
 * Fresh default state. Used on first load, as the base that saved states
 * are merged onto (so older saved states gain any new fields), and on reset.
 */
function defaultState() {
  return {
    assessmentId:   _newAssessmentId(), // scopes report edits to this assessment
    assessmentType: 'household',   // 'household' | 'neighborhood'
    location: '',
    date: localToday(),
    householdSize: '',
    hh1Name: 'Household 1',
    hh2Name: 'Household 2',
    // { hazardId: { l, i, l2, i2, notes, isAuto, isEstimate,
    //   na: bool (does not apply here), naAuto: bool (pre-marked, research may clear it),
    //   iManual / i2Manual: bool (impact set by hand, so the checklist leaves it alone) } }
    scores: _defaultScores(),
    checklist: { hh1: {}, hh2: {} },   // household checklist: { hh1: { itemId: true }, hh2: {...} }
    customNames: {  // custom hazard names/desc
      60: { name: '', description: '' },
      61: { name: '', description: '' },
      62: { name: '', description: '' },
    },
    // Research My Area — persisted research report
    researchAddress:   '',
    researchReport:    null,   // { geocoded, findings[], timestamp }
    autoScoreOrigins:  {},     // { hazardId: { source, finding, confidence } }
  };
}

/** A fresh state with checklist impacts filled in for the core hazards. */
function freshState() {
  const st = defaultState();
  if (typeof applyChecklistImpacts === 'function') applyChecklistImpacts(st);
  return st;
}

// State object — single source of truth
let state = freshState();

/* ---------------------------------------------------------------
   UTILITY FUNCTIONS
--------------------------------------------------------------- */

/**
 * Get the risk level object for a given score.
 */
function getRiskLevel(score) {
  if (score >= 15) return RISK_LEVELS.CRITICAL;
  if (score >= 10) return RISK_LEVELS.HIGH;
  if (score >= 6)  return RISK_LEVELS.MEDIUM;
  if (score >= 1)  return RISK_LEVELS.LOW;
  return null;
}

/**
 * Calculate the score for a hazard entry in state.
 * In neighborhood mode, returns the higher of HH1 and HH2: averaging hid a
 * Critical for one home behind a Low for the other, and produced scores
 * (7, 11, 13) that no single household can reach on the 5x5 grid.
 */
function calcScore(hazardId) {
  const entry = state.scores[hazardId];
  if (!entry || entry.na) return 0;

  const l = parseInt(entry.l) || 0;
  const i = parseInt(entry.i) || 0;

  if (state.assessmentType === 'neighborhood') {
    const l2 = parseInt(entry.l2) || 0;
    const i2 = parseInt(entry.i2) || 0;
    const s1 = l * i;
    const s2 = l2 * i2;
    // Worst case of the two (only counts households that have data)
    return Math.max(s1, s2);
  }

  return l * i;
}

/**
 * Check if a hazard has been fully scored (both L and I entered).
 */
function isScored(hazardId) {
  const entry = state.scores[hazardId];
  if (!entry || entry.na) return false;
  const l = parseInt(entry.l) || 0;
  const i = parseInt(entry.i) || 0;
  if (l > 0 && i > 0) return true;
  if (state.assessmentType === 'neighborhood') {
    return (parseInt(entry.l2) || 0) > 0 && (parseInt(entry.i2) || 0) > 0;
  }
  return false;
}

/** Marked "Does not apply here" (by the user, or pre-marked). */
function isNA(hazardId) {
  return !!(state.scores[hazardId] && state.scores[hazardId].na);
}

/** Scored or ruled out: fills a progress slot. */
function isDone(hazardId) {
  return isScored(hazardId) || isNA(hazardId);
}

/**
 * Whether a hazard counts toward progress: every core hazard, named custom
 * hazards, and less common hazards the user has rated or ruled out
 * themselves (a pre-marked "Does not apply here" does not count).
 */
function countsTowardProgress(h) {
  if (h.isCustom) return !!state.customNames[h.id]?.name;
  if (h.group !== 'rare') return true;
  const e = state.scores[h.id] || {};
  if (e.na) return !e.naAuto;
  return ['l', 'i', 'l2', 'i2'].some(f => (parseInt(e[f]) || 0) > 0);
}

/**
 * Count hazards that are done (scored or ruled out) among those that count.
 */
function countScored() {
  return HAZARD_DATA.filter(h => countsTowardProgress(h) && isDone(h.id)).length;
}

/**
 * Number of hazards progress is measured against.
 */
function totalActive() {
  return HAZARD_DATA.filter(countsTowardProgress).length;
}

/**
 * Save current state to localStorage (auto-save).
 */
function autoSave() {
  try {
    localStorage.setItem('wa_current_state', JSON.stringify(state));
  } catch (e) {
    console.warn('Could not save state', e);
  }
  updateProgress();
}

// Set by loadCurrentState when an old saved state was folded into the v3 list;
// shown as a toast once the page is up.
let _pendingMigrationNotice = '';

/**
 * Load state from localStorage.
 */
function loadCurrentState() {
  let saved = null;
  try {
    saved = localStorage.getItem('wa_current_state');
  } catch (e) {
    console.warn('localStorage unavailable', e);
  }
  let needsSave = !saved;
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // Pre-v2 states have no assessmentId; the one generated below must be
      // saved right away or report edits keyed to it are lost on reload.
      if (!parsed || !parsed.assessmentId || !parsed.checklist) needsSave = true;
      const info = {};
      state = normalizeState(parsed, info);
      if (typeof applyChecklistImpacts === 'function') applyChecklistImpacts(state);
      if (info.merged > 0) { needsSave = true; _pendingMigrationNotice = migrationNoticeText(info); }
    } catch (e) {
      console.warn('Could not parse saved state', e);
      needsSave = true;
    }
  }
  if (needsSave) {
    try {
      localStorage.setItem('wa_current_state', JSON.stringify(state));
    } catch (e) { /* storage unavailable */ }
  }
  purgeRetiredReportNotes();
}

/**
 * Merge a (possibly older) saved state onto current defaults.
 *
 * Hazards retired in v3.0.0: a user note on one is carried onto the hazard
 * that absorbed it ("From <old name>: ..."), then the entry is dropped, along
 * with its research source and findings.
 *
 * A state from before v3 (no checklist key) is also migrated: impacts already
 * rated on core hazards are kept as set by hand, and hurricane, tsunami and
 * volcanic ash are ruled out unless the user rated them or research placed
 * the address outside Colorado. A research-only likelihood (isAuto) on them
 * does not count as rated.
 *
 * `info`, when given, is filled with { merged, notesCarried } so callers can
 * tell the user. Checklist impacts are not applied here; callers run
 * applyChecklistImpacts().
 */
function normalizeState(parsed, info) {
  info = info || {};
  info.merged = 0;
  info.notesCarried = 0;
  const base = defaultState();
  const preV3 = !!parsed && typeof parsed === 'object' && !Object.prototype.hasOwnProperty.call(parsed, 'checklist');
  const merged = Object.assign(base, parsed || {});
  merged.customNames      = Object.assign(defaultState().customNames, merged.customNames || {});
  if (!merged.assessmentId) merged.assessmentId = _newAssessmentId();
  merged.checklist = (typeof normalizeChecklist === 'function')
    ? normalizeChecklist(merged.checklist)
    : (merged.checklist && typeof merged.checklist === 'object' ? merged.checklist : { hh1: {}, hh2: {} });

  const known = new Set(HAZARD_DATA.map(h => String(h.id)));
  const keepKnown = obj => {
    const out = {};
    if (obj && typeof obj === 'object') Object.keys(obj).forEach(k => { if (known.has(String(k))) out[k] = obj[k]; });
    return out;
  };

  // Carry notes from retired hazards before their entries are dropped
  const oldScores = (merged.scores && typeof merged.scores === 'object') ? merged.scores : {};
  merged.scores = keepKnown(oldScores);
  Object.keys(oldScores).forEach(k => {
    const old = RETIRED_HAZARDS[k];
    const e = oldScores[k];
    if (!old || !e || typeof e !== 'object') return;
    const note = userNotes(e).trim();
    const rated = ['l', 'i', 'l2', 'i2'].some(f => (parseInt(e[f]) || 0) > 0);
    if (rated || note) info.merged++;
    if (!note) return;
    const target = merged.scores[old[1]] || (merged.scores[old[1]] = {});
    const line = `From ${old[0]}: ${note}`;
    const existing = userNotes(target);
    if (existing.includes(line)) return;
    target.notes = existing.trim() ? `${existing.trim()}\n${line}` : line;
    info.notesCarried++;
  });

  merged.autoScoreOrigins = keepKnown(merged.autoScoreOrigins);
  if (merged.researchReport && Array.isArray(merged.researchReport.findings)) {
    merged.researchReport = Object.assign({}, merged.researchReport, {
      findings: merged.researchReport.findings.filter(f => f && known.has(String(f.hazardId))),
    });
  }

  if (preV3) {
    const researched = String(merged.researchReport?.geocoded?.stateAbbr || '').toUpperCase();
    const inColoradoOrUnknown = !researched || researched === 'CO';
    HAZARD_DATA.forEach(h => {
      const e = merged.scores[h.id];
      if (h.group === 'core' && e) {
        if ((parseInt(e.i) || 0) > 0)  e.iManual = true;
        if ((parseInt(e.i2) || 0) > 0) e.i2Manual = true;
      }
      if (h.naDefault && inColoradoOrUnknown) {
        // A likelihood research wrote on its own (isAuto) is not the user's rating
        const rated = !!e && (((parseInt(e.l) || 0) > 0 && !e.isAuto) ||
          ['i', 'l2', 'i2'].some(f => (parseInt(e[f]) || 0) > 0));
        if (rated) return;
        const entry = e || {};
        if (entry.isAuto) {
          entry.l = 0;
          delete entry.isAuto;
          delete entry.isEstimate;
          delete merged.autoScoreOrigins[h.id];
        }
        merged.scores[h.id] = Object.assign(entry, { na: true, naAuto: true });
      }
    });
  }
  return merged;
}

/** Toast text after old ratings were folded into the v3 list, or '' when nothing moved. */
function migrationNoticeText(info) {
  if (!info || !(info.merged > 0)) return '';
  return `Your saved ratings were moved to the new shorter hazard list; ${info.merged} item${info.merged === 1 ? ' was' : 's were'} merged.` +
    (info.notesCarried > 0 ? ' Notes were kept.' : '');
}

/** Report notes keyed by retired hazard ids belong to rows that no longer exist. */
function purgeRetiredReportNotes() {
  if (typeof _readAllReportEdits !== 'function' || typeof _writeAllReportEdits !== 'function') return 0;
  const all = _readAllReportEdits();
  let removed = 0;
  Object.keys(all).forEach(aid => {
    const notes = all[aid] && all[aid].notes;
    if (!notes || typeof notes !== 'object') return;
    Object.keys(notes).forEach(k => { if (RETIRED_HAZARDS[k]) { delete notes[k]; removed++; } });
  });
  if (removed) _writeAllReportEdits(all);
  return removed;
}

/* ---------------------------------------------------------------
   SCREEN NAVIGATION
--------------------------------------------------------------- */

let currentScreen = 'home';

function showScreen(screenId, opts) {
  opts = opts || {};
  // The Research screen was merged into Home (v2.0)
  if (screenId === 'research') screenId = 'home';

  // Hide all screens
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => { n.classList.remove('active'); n.removeAttribute('aria-current'); });

  // Show target
  const target = document.getElementById('screen-' + screenId);
  if (target) target.classList.add('active');

  // Update nav
  const navBtn = document.querySelector(`.nav-item[data-screen="${screenId}"]`);
  if (navBtn) { navBtn.classList.add('active'); navBtn.setAttribute('aria-current', 'page'); }

  currentScreen = screenId;
  document.body.dataset.screen = screenId;

  // Screen-specific initialization
  if (screenId === 'home')       initHomeScreen();
  if (screenId === 'assessment') initAssessmentUI();
  if (screenId === 'results')    renderResults();
  if (screenId === 'report' && typeof renderReportView === 'function') {
    renderReportView();
  }
  // Build the PDF ahead of time so the PDF / Share tap can open the iPhone
  // share sheet instantly (iPhone ignores share requests made after a delay).
  if ((screenId === 'report' || screenId === 'results') && typeof preparePdf === 'function') preparePdf();
  if (screenId === 'about')      renderSavedList();
  if (screenId === 'reference')  buildRiskMatrix();

  // Scroll: restore the saved position when returning to a screen (so a peek
  // at Results does not send the user back to the top of a 30-screen list),
  // otherwise start at the top.
  if (!opts.keepScroll) {
    const saved = _screenScroll[screenId];
    window.scrollTo(0, opts.restoreScroll && saved ? saved : 0);
  }

  // Orientation for screen readers and the browser tab: name the screen and
  // move focus to its heading.
  document.title = `${SCREEN_TITLES[screenId] || 'Risk Assessment'} | World Aware Risk Assessment`;
  if (target && !opts.keepFocus) {
    const heading = target.querySelector('h1, h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      try { heading.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
  }
}

const SCREEN_TITLES = {
  home: 'Home', assessment: 'Assess', results: 'Results',
  report: 'Report', reference: 'Guide', about: 'About',
};

// Last scroll position per screen, captured before leaving it
const _screenScroll = {};
document.addEventListener('scroll', () => {
  _screenScroll[currentScreen] = window.scrollY;
}, { passive: true });

function initHomeScreen() {
  _syncAddressTypePill();
  renderContinueCard();
  if (typeof initResearchScreen === 'function') initResearchScreen();
}

/** Show the "Continue" card on Home when an assessment is already under way. */
function renderContinueCard() {
  const card = document.getElementById('home-continue-card');
  const text = document.getElementById('home-continue-text');
  if (!card || !text) return;
  const scored = countScored();
  if (!_isDirtyAssessment()) {
    card.classList.add('hidden');
    return;
  }
  // Home is the projector screen in a workshop: show street name and city, never the house number
  const name = (state.location || '').replace(/^\s*\d+[A-Za-z-]*\s+/, '').trim() ||
    (state.assessmentType === 'neighborhood' ? 'Neighborhood assessment' : 'Household assessment');
  const when = state.date ? formatReportDate(state.date) : '';
  text.textContent = `Continue: ${name}, ${scored} of ${totalActive()} hazards done` + (when ? `, ${when}` : '');
  card.classList.remove('hidden');
}

function _syncAddressTypePill() {
  const pill = document.getElementById('address-type-pill');
  if (pill) {
    pill.textContent = state.assessmentType === 'neighborhood'
      ? 'Neighborhood assessment' : 'Household assessment';
  }
}

/** Scroll Home to the address card and focus the right control. */
function focusAddressEntry() {
  const card  = document.getElementById('home-address-card');
  const input = document.getElementById('research-address-input');
  const inputVisible = input && input.offsetParent !== null;
  const target = inputVisible ? input : document.getElementById('research-continue-btn');
  if (card) card.scrollIntoView({ block: 'start' });
  // On a phone, focusing the input opens the keyboard at once and hides the
  // Skip button and the privacy note. Let the user tap the field themselves.
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (target && !(coarse && target === input)) {
    try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
  }
}

/** Skip the address lookup and go straight to the assessment. */
function skipResearch() {
  // A lookup still running must not write its results into the assessment later
  if (typeof cancelResearch === 'function') cancelResearch();
  const input = document.getElementById('research-address-input');
  const typed = input ? (input.value || '').trim() : '';
  if (typed) state.location = typed;
  if (!state.date) state.date = localToday();
  autoSave();
  showScreen('assessment');
}

/** From the Assess screen, go back to the research details on Home. */
function showResearchDetails() {
  showScreen('home');
  focusAddressEntry();
}

function goHome() {
  showScreen('home');
}

/* ---------------------------------------------------------------
   ASSESSMENT INITIALIZATION
--------------------------------------------------------------- */

function startAssessment(type) {
  state.assessmentType = type === 'neighborhood' ? 'neighborhood' : 'household';
  // Default date to today if not set
  if (!state.date) {
    state.date = localToday();
  }
  autoSave();
  // v2.0: both start buttons lead to the address entry on Home
  showScreen('home');
  focusAddressEntry();
}

/** True when the assessment on screen holds work worth keeping. */
function _isDirtyAssessment() {
  const ticked = (typeof checklistCount === 'function') ? checklistCount('hh1') + checklistCount('hh2') : 0;
  return countScored() > 0 || ticked > 0 || !!state.location || !!state.researchReport;
}

/**
 * Home start buttons. With work in progress, save it as a copy first and
 * then begin a blank assessment. Without, behave like startAssessment.
 * (startAssessment stays for the ?start= shortcut in the manifest.)
 */
function newAssessment(type) {
  const t = type === 'neighborhood' ? 'neighborhood' : 'household';
  if (!_isDirtyAssessment()) {
    startAssessment(t);
    return;
  }
  showConfirm('Start a new assessment? The one you are working on will be saved as a copy first.', () => {
    if (!_snapshotCurrent()) {
      showToast('Could not save a copy: storage is unavailable or full. Export your work as a backup, then try again.', 6000);
      return;
    }
    state = freshState();
    state.assessmentType = t;
    state.date = localToday();
    _screenScroll.assessment = 0;
    if (typeof resetResearchUI === 'function') resetResearchUI();
    autoSave();
    renderSavedList();
    showScreen('home');
    focusAddressEntry();
    showToast('Your last assessment was saved as a copy under About.');
  }, { confirmLabel: 'Save a copy and start new' });
}

/**
 * Set up the assessment screen UI based on current state.
 */
function initAssessmentUI() {
  // Update type label
  const label = document.getElementById('assessment-type-label');
  label.textContent = state.assessmentType === 'neighborhood'
    ? 'Neighborhood Assessment'
    : 'Household Assessment';

  // Show/hide neighborhood HH names
  const nnDiv = document.getElementById('neighborhood-hh-names');
  if (state.assessmentType === 'neighborhood') {
    nnDiv.classList.remove('hidden');
  } else {
    nnDiv.classList.add('hidden');
  }

  // Restore field values
  document.getElementById('field-location').value = state.location || '';
  document.getElementById('field-date').value = state.date || localToday();
  document.getElementById('field-household-size').value = state.householdSize || '';
  document.getElementById('hh1-name').value = state.hh1Name || 'Household 1';
  document.getElementById('hh2-name').value = state.hh2Name || 'Household 2';

  // Remember which sheets were open so a rebuild doesn't collapse them.
  // First build: the core list is open, and the household checklist is open
  // until something is ticked or scored.
  const existing = [...document.querySelectorAll('#hazard-list .category-section')];
  const openCats = new Set(
    existing
      .filter(sec => !sec.querySelector('.category-rows')?.classList.contains('collapsed'))
      .map(sec => sec.dataset.category)
  );
  if (existing.length === 0) {
    openCats.add('core');
    const ticked = (typeof checklistCount === 'function') ? checklistCount('hh1') + checklistCount('hh2') : 0;
    if (ticked === 0 && countScored() === 0) openCats.add('household');
  }

  // Build hazard list
  buildHazardList();
  updateProgress();

  // Open groups that hold research findings still needing an impact rating
  getResearchFlaggedIds()
    .filter(id => needsImpact(id))
    .forEach(id => { const c = getGroupForHazard(id); if (c) openCats.add(c); });
  document.querySelectorAll('#hazard-list .category-section').forEach(sec => {
    if (openCats.has(sec.dataset.category)) setCategoryOpen(sec, true);
  });

  _syncResearchBanner();
}

/**
 * IDs of hazards whose likelihood came from address research
 * (still auto, or originally researched and since adjusted).
 */
function getResearchFlaggedIds() {
  const ids = new Set();
  Object.keys(state.scores || {}).forEach(k => { if (state.scores[k]?.isAuto) ids.add(parseInt(k)); });
  Object.keys(state.autoScoreOrigins || {}).forEach(k => ids.add(parseInt(k)));
  return [...ids].filter(id => (parseInt(state.scores[id]?.l) || 0) > 0 && !state.scores[id]?.na).sort((a, b) => a - b);
}

/** A research-flagged hazard with a likelihood but no impact yet. */
function needsImpact(hazardId) {
  const e = state.scores[hazardId];
  if (!e || e.na) return false;
  const flagged = !!e.isAuto || !!(state.autoScoreOrigins || {})[hazardId];
  return flagged && (parseInt(e.l) || 0) > 0 && !((parseInt(e.i) || 0) > 0);
}

function _syncResearchBanner() {
  const old = document.getElementById('auto-score-banner');
  if (old) old.remove();
  const legacy = document.getElementById('research-report-link');
  if (legacy) legacy.remove();

  const flagged = getResearchFlaggedIds();
  if (flagged.length === 0) return;
  const unrated = flagged.filter(id => needsImpact(id)).length;

  const banner = document.createElement('div');
  banner.id = 'auto-score-banner';
  banner.className = 'alert alert-info auto-score-banner';
  banner.innerHTML = `
    <div class="auto-score-banner-inner">
      ${ic('info')}
      <span class="auto-score-banner-text">
        Research estimated likelihood for <strong>${flagged.length} hazard${flagged.length === 1 ? '' : 's'}</strong>.
        Check the impact on each one and change any that look wrong for your household.
        <span id="auto-score-banner-remaining" class="auto-score-banner-remaining">${unrated > 0 ? `${unrated} still need an impact rating.` : 'All impacts rated.'}</span>
      </span>
      <button class="btn btn-ghost btn-small" onclick="showResearchDetails()">Research details</button>
      <button class="btn-icon auto-score-banner-close" aria-label="Dismiss" onclick="this.closest('#auto-score-banner').remove()">${ic('x')}</button>
    </div>
  `;
  const header = document.querySelector('.assessment-header');
  if (header) header.insertAdjacentElement('afterend', banner);
}

function _updateResearchBannerCount() {
  const el = document.getElementById('auto-score-banner-remaining');
  if (!el) return;
  const unrated = getResearchFlaggedIds().filter(id => needsImpact(id)).length;
  el.textContent = unrated > 0 ? `${unrated} still need an impact rating.` : 'All impacts rated.';
}

/* ---------------------------------------------------------------
   HAZARD LIST BUILDER
--------------------------------------------------------------- */

/** One collapsible sheet: header button plus a rows container (starts collapsed). */
function _buildSheet(key, icon, title, countText) {
  const section = document.createElement('div');
  section.className = 'category-section';
  section.dataset.category = key;

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'category-header';
  header.setAttribute('aria-expanded', 'false');
  header.setAttribute('aria-controls', `cat-rows-${key}`);
  header.innerHTML = `
      <span class="cat-icon">${ic(icon)}</span>
      <span class="cat-text">
        <span class="cat-name">${escHtml(title)}</span>
        <span class="cat-count" id="cat-count-${key}">${escHtml(countText || '')}</span>
      </span>
      <span class="cat-strip" id="cat-strip-${key}" aria-hidden="true"></span>
      ${ic('chevron-down', 'cat-chevron')}
    `;
  header.addEventListener('click', () => toggleCategory(section));

  const rows = document.createElement('div');
  rows.className = 'category-rows collapsed';
  rows.id = `cat-rows-${key}`;

  section.appendChild(header);
  section.appendChild(rows);
  return { section, rows };
}

/**
 * Build the Assess screen list: the household checklist card, then the
 * three hazard groups (core, less common, custom) in HAZARD_DATA order.
 */
function buildHazardList() {
  const container = document.getElementById('hazard-list');
  container.innerHTML = '';

  // 1. About your household
  if (typeof buildChecklistHtml === 'function') {
    const hh = _buildSheet('household', 'list-checks', 'About your household', checklistCountText());
    hh.section.classList.add('checklist-section');
    hh.rows.innerHTML = buildChecklistHtml();
    container.appendChild(hh.section);
  }

  // 2 to 4. The hazard groups
  HAZARD_GROUPS.forEach(g => {
    const sheet = _buildSheet(g.key, g.icon, g.title, '');
    const intro = document.createElement('p');
    intro.className = 'group-intro';
    intro.textContent = g.intro;
    sheet.rows.appendChild(intro);
    HAZARD_DATA.filter(h => h.group === g.key).forEach(hazard => {
      sheet.rows.appendChild(buildHazardRow(hazard));
    });
    container.appendChild(sheet.section);
  });

  HAZARD_GROUPS.forEach(g => updateCategoryCount(g.key));
}

/**
 * Build a single hazard row element.
 */
function buildHazardRow(hazard) {
  const entry = state.scores[hazard.id] || {};
  const score = calcScore(hazard.id);
  const isNeighborhood = state.assessmentType === 'neighborhood';

  const na = !!entry.na;
  const row = document.createElement('div');
  row.className = 'hazard-row' + (needsImpact(hazard.id) ? ' needs-impact' : '') + (na ? ' is-na' : '');
  row.id = `hazard-row-${hazard.id}`;

  // Custom hazard name/desc inputs (for hazards 60-62)
  let customNameHtml = '';
  if (hazard.isCustom) {
    const cn = state.customNames[hazard.id] || {};
    customNameHtml = `
      <div class="custom-hazard-inputs">
        <div class="field">
          <label class="field-label" for="custom-name-${hazard.id}">Custom hazard ${hazard.customIndex} name</label>
          <input type="text" id="custom-name-${hazard.id}" class="custom-name-input input"
            placeholder="Enter a hazard name"
            value="${escHtml(cn.name || '')}"
            onchange="updateCustomName(${hazard.id}, 'name', this.value)"
            oninput="updateCustomName(${hazard.id}, 'name', this.value)" />
        </div>
        <div class="field">
          <label class="field-label" for="custom-desc-${hazard.id}">Description <span class="opt">(optional)</span></label>
          <input type="text" id="custom-desc-${hazard.id}" class="custom-desc-input input"
            value="${escHtml(cn.description || '')}"
            onchange="updateCustomName(${hazard.id}, 'description', this.value)"
            oninput="updateCustomName(${hazard.id}, 'description', this.value)" />
        </div>
      </div>
    `;
  }

  // Tag shown while the likelihood still comes from address research
  const isAutoScored = !!(state.scores[hazard.id]?.isAuto);
  const autoScoreBadgeHtml =
    `<span class="auto-score-badge${isAutoScored ? '' : ' hidden'}" id="auto-badge-${hazard.id}">Research estimate</span>`;

  // Hazard name display
  const displayName = hazard.isCustom
    ? (state.customNames[hazard.id]?.name || `Custom Hazard ${hazard.customIndex}`)
    : hazard.name;

  const displayDesc = hazard.isCustom
    ? (state.customNames[hazard.id]?.description || 'User-defined custom hazard')
    : hazard.description;

  // Inputs: household vs neighborhood
  let inputsHtml = '';
  if (isNeighborhood) {
    const hh1 = state.hh1Name || 'HH1';
    const hh2 = state.hh2Name || 'HH2';
    const sub = (a, b) => (parseInt(a) || 0) * (parseInt(b) || 0);
    const subHtml = n => n > 0 ? `<span class="mini-score">${n}</span>` : '<span class="mini-score empty">Not rated</span>';
    inputsHtml = `
      <div class="inputs-grid">
        <div class="hh-group">
          <div class="hh-head">
            <div class="input-group-label">${escHtml(hh1)}</div>
            <div class="sub-score" id="sub-score-${hazard.id}-1">${subHtml(sub(entry.l, entry.i))}</div>
          </div>
          <div class="inputs-row">
            ${buildPickerHtml(hazard.id, 'l', parseInt(entry.l) || 0, 'Likelihood')}
            ${buildPickerHtml(hazard.id, 'i', parseInt(entry.i) || 0, 'Impact')}
          </div>
        </div>
        <div class="hh-group">
          <div class="hh-head">
            <div class="input-group-label">${escHtml(hh2)}</div>
            <div class="sub-score" id="sub-score-${hazard.id}-2">${subHtml(sub(entry.l2, entry.i2))}</div>
          </div>
          <div class="inputs-row">
            ${buildPickerHtml(hazard.id, 'l2', parseInt(entry.l2) || 0, 'Likelihood')}
            ${buildPickerHtml(hazard.id, 'i2', parseInt(entry.i2) || 0, 'Impact')}
          </div>
        </div>
      </div>
    `;
  } else {
    inputsHtml = `
      <div class="inputs-row">
        ${buildPickerHtml(hazard.id, 'l', parseInt(entry.l) || 0, 'Likelihood')}
        ${buildPickerHtml(hazard.id, 'i', parseInt(entry.i) || 0, 'Impact')}
      </div>
    `;
  }

  // Ruled out: the pickers give way to a status line with Undo
  if (na) inputsHtml = '';
  const naHtml = na
    ? `<div class="na-status">${ic('circle-check')}<span>Does not apply here.</span>
        <button type="button" class="link-btn na-undo" onclick="undoNotApplicable(${hazard.id})" aria-label="Undo: ${escHtml(displayName)} does apply here">Undo</button></div>`
    : '';
  const naBtnHtml = (!na && !hazard.isCustom)
    ? `<div class="row-foot"><button type="button" class="btn btn-ghost btn-small na-btn" onclick="markNotApplicable(${hazard.id})">Does not apply here</button></div>`
    : '';
  const notesHtml = (na && !userNotes(entry)) ? '' : `
    <div class="notes-row field">
      <label class="field-label" for="notes-${hazard.id}">Notes <span class="opt">(optional)</span></label>
      <textarea class="notes-input input" id="notes-${hazard.id}"
        onchange="updateNotes(${hazard.id}, this.value)"
        oninput="updateNotes(${hazard.id}, this.value)"
        rows="2">${escHtml(userNotes(entry))}</textarea>
    </div>`;

  row.innerHTML = `
    ${customNameHtml}
    <div class="hazard-top">
      <div class="hazard-title">
        <div class="hazard-name-wrap">
          <strong class="hazard-name">${escHtml(displayName)}</strong><button type="button" class="desc-toggle" onclick="toggleDesc(${hazard.id})" aria-label="Toggle description" aria-expanded="false" aria-controls="desc-${hazard.id}">${ic('info', 'desc-icon')}</button>
        </div>
        ${autoScoreBadgeHtml}
        <div class="hazard-desc hidden" id="desc-${hazard.id}">${escHtml(displayDesc)}</div>
      </div>
      <div class="score-block">${na ? RULED_OUT_BADGE : scoreBlockHtml(score)}</div>
    </div>
    ${naHtml}
    <div class="rate-impact-flag" id="rate-impact-${hazard.id}">
      ${ic('info')}
      <span>Research estimated likelihood. <strong>Rate impact</strong> to finish this score.</span>
    </div>
    ${na ? '' : _researchOriginHtml(hazard.id)}
    ${inputsHtml}
    ${notesHtml}
    ${naBtnHtml}
  `;

  return row;
}

const RULED_OUT_BADGE = '<span class="badge b-ruled-out">Ruled out</span>';

/** Big score number with its risk badge (or the Not rated badge). */
function scoreBlockHtml(score) {
  const rl = score > 0 ? getRiskLevel(score) : null;
  return (rl ? `<span class="score-num">${score}</span>` : '') + riskBadgeHtml(rl);
}

/** Notes the user wrote (ignores legacy auto-generated research notes). */
function userNotes(entry) {
  const n = (entry && entry.notes) || '';
  return n.startsWith('[Auto-scored from:') ? '' : n;
}

/** Look up research source info for a hazard, if any. */
function getResearchOrigin(hazardId) {
  const o = (state.autoScoreOrigins || {})[hazardId];
  if (o) return o;
  const f = (state.researchReport?.findings || []).find(x => x.hazardId === hazardId);
  return f ? { source: f.source, finding: f.finding, confidence: f.confidence } : null;
}

function _researchOriginHtml(hazardId) {
  const o = getResearchOrigin(hazardId);
  if (!o || !state.scores[hazardId]?.l) return '';
  return `<div class="research-origin">${ic('map-pin')}<div><span class="research-origin-text">Research: ${escHtml(cleanFindingText(o.finding || ''))}</span>
    <span class="research-origin-meta">${escHtml(o.source || '')}${o.confidence ? '. Confidence: ' + escHtml(o.confidence) : ''}</span></div></div>`;
}

/** Strip emoji / warning glyphs from research finding text. */
function cleanFindingText(t) {
  return String(t || '').replace(/[☀-➿️]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Build a 1 to 5 picker (segmented control) for a likelihood/impact field.
 * Picking the selected value again clears it.
 */
function buildPickerHtml(hazardId, field, currentVal, label) {
  const isLikelihood = field === 'l' || field === 'l2';
  const words = isLikelihood ? LIKELIHOOD_LABELS : IMPACT_LABELS;
  const lid = `pl-${hazardId}-${field}`;
  const btns = [1, 2, 3, 4, 5].map(n => `<button type="button" class="seg${n === currentVal ? ' on' : ''}" data-val="${n}"
        aria-pressed="${n === currentVal}" aria-label="${label} ${n}, ${words[n]}"
        onclick="setScore(${hazardId}, '${field}', ${n})">${n}</button>`).join('');
  return `
    <div class="stepper picker" data-hazard="${hazardId}" data-field="${field}" role="group" aria-labelledby="${lid}">
      <div class="picker-head">
        <span class="stepper-label" id="${lid}">${label}</span>
        <span class="picker-word" id="sl-${hazardId}-${field}">${_pickerWord(hazardId, field, currentVal)}</span>
      </div>
      <div class="seg-row">${btns}</div>
      <div class="picker-caps" aria-hidden="true"><span>${words[1]}</span><span>${words[5]}</span></div>
      ${_isChecklistField(hazardId, field) ? `<div class="impact-source" id="isrc-${hazardId}-${field}">${impactSourceHtml(hazardId, field)}</div>` : ''}
    </div>
  `;
}

/** Impact fields on core hazards are set by the household checklist. */
function _isChecklistField(hazardId, field) {
  if (field !== 'i' && field !== 'i2') return false;
  const h = getHazard(hazardId);
  return !!(h && h.group === 'core');
}

/** "Set by checklist" while automatic; a "Reset to checklist" link once changed by hand. */
function impactSourceHtml(hazardId, field) {
  const e = state.scores[hazardId] || {};
  const manual = field === 'i2' ? e.i2Manual === true : e.iManual === true;
  if (manual) {
    return `<span class="impact-tag is-manual">Changed by you</span>
      <button type="button" class="link-btn impact-reset" onclick="resetImpactToChecklist(${hazardId}, '${field}')">Reset to checklist</button>`;
  }
  return `<span class="impact-tag">Set by checklist</span>`;
}

function _pickerWord(hazardId, field, val) {
  const words = (field === 'l' || field === 'l2') ? LIKELIHOOD_LABELS : IMPACT_LABELS;
  if (val > 0) return words[val];
  if (field === 'i' && needsImpact(hazardId)) return 'Choose 1 to 5';
  return '';
}

/* ---------------------------------------------------------------
   SCORING INTERACTIONS
--------------------------------------------------------------- */

/** Set a likelihood/impact value (0 clears it) and refresh the row. */
function setScore(hazardId, field, value) {
  if (!state.scores[hazardId]) state.scores[hazardId] = {};
  const current = parseInt(state.scores[hazardId][field]) || 0;
  const next = Math.max(0, Math.min(5, value === current ? 0 : value));
  state.scores[hazardId][field] = next;

  // If user manually adjusts the likelihood, clear the auto-score flag
  if ((field === 'l' || field === 'l2') && state.scores[hazardId].isAuto) {
    state.scores[hazardId].isAuto = false;
  }

  // Impact on a core hazard: picking a value takes it off the checklist;
  // clearing the picker hands it back to the checklist.
  if (_isChecklistField(hazardId, field)) {
    const flag = field === 'i2' ? 'i2Manual' : 'iManual';
    if (next > 0) state.scores[hazardId][flag] = true;
    else {
      delete state.scores[hazardId][flag];
      state.scores[hazardId][field] = computeImpact(hazardId, field === 'i2' ? 'hh2' : 'hh1');
    }
  }

  updateRowScore(hazardId);
  autoSave();
}

/** "Reset to checklist": drop the hand-set impact and recompute it. */
function resetImpactToChecklist(hazardId, field) {
  const e = state.scores[hazardId];
  if (!e) return;
  delete e[field === 'i2' ? 'i2Manual' : 'iManual'];
  applyChecklistImpacts();
  updateRowScore(hazardId);
  autoSave();
  // The link that had focus is gone; keep the keyboard on this picker
  const seg = document.querySelector(`#hazard-row-${hazardId} .picker[data-field="${field}"] .seg.on`);
  if (seg) { try { seg.focus({ preventScroll: true }); } catch (err) { /* ignore */ } }
}

/** Rebuild one row in place (after "Does not apply here" or Undo). */
function _rebuildRow(hazardId) {
  const old = document.getElementById(`hazard-row-${hazardId}`);
  const h = getHazard(hazardId);
  if (!old || !h) return;
  old.replaceWith(buildHazardRow(h));
}

/** Rule a hazard out for this place. Shared by both households. */
function markNotApplicable(hazardId) {
  if (!state.scores[hazardId]) state.scores[hazardId] = {};
  state.scores[hazardId].na = true;
  delete state.scores[hazardId].naAuto;
  _rebuildRow(hazardId);
  updateCategoryCount(getGroupForHazard(hazardId));
  _updateResearchBannerCount();
  autoSave();
  const undo = document.querySelector(`#hazard-row-${hazardId} .na-undo`);
  if (undo) { try { undo.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
}

/** Undo "Does not apply here": back to unrated, every other field untouched. */
function undoNotApplicable(hazardId) {
  const e = state.scores[hazardId];
  if (e) { delete e.na; delete e.naAuto; }
  _rebuildRow(hazardId);
  updateCategoryCount(getGroupForHazard(hazardId));
  _updateResearchBannerCount();
  autoSave();
  const btn = document.querySelector(`#hazard-row-${hazardId} .na-btn`);
  if (btn) { try { btn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
}

/** Step a value up or down by one (kept for callers that adjust by delta). */
function stepperChange(hazardId, field, delta) {
  const current = parseInt((state.scores[hazardId] || {})[field]) || 0;
  const next = Math.max(0, Math.min(5, current + delta));
  if (next === current) return;
  if (next === 0) { setScore(hazardId, field, current); return; }   // toggling the selected value clears it
  setScore(hazardId, field, next);
}

/** Sync one picker's pressed state and word label with state. */
function refreshPicker(hazardId, field) {
  const wrap = document.querySelector(`#hazard-row-${hazardId} .picker[data-field="${field}"]`);
  if (!wrap) return;
  const val = parseInt((state.scores[hazardId] || {})[field]) || 0;
  wrap.querySelectorAll('.seg').forEach(b => {
    const on = parseInt(b.dataset.val) === val;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const word = document.getElementById(`sl-${hazardId}-${field}`);
  if (word) word.textContent = _pickerWord(hazardId, field, val);
  const src = document.getElementById(`isrc-${hazardId}-${field}`);
  if (src) src.innerHTML = impactSourceHtml(hazardId, field);
}

/**
 * Update the score badge and sub-scores on a hazard row.
 */
function updateRowScore(hazardId) {
  const row = document.getElementById(`hazard-row-${hazardId}`);
  if (!row) return;

  const score = calcScore(hazardId);

  // Sync auto-score tag visibility
  const autoBadge = document.getElementById(`auto-badge-${hazardId}`);
  if (autoBadge) {
    autoBadge.classList.toggle('hidden', !state.scores[hazardId]?.isAuto);
  }

  ['l', 'i', 'l2', 'i2'].forEach(f => refreshPicker(hazardId, f));

  // Update main score block
  const block = row.querySelector('.score-block');
  if (block) block.innerHTML = isNA(hazardId) ? RULED_OUT_BADGE : scoreBlockHtml(score);

  // Neighborhood sub-scores
  if (state.assessmentType === 'neighborhood') {
    const e = state.scores[hazardId] || {};
    const s1 = (parseInt(e.l)||0) * (parseInt(e.i)||0);
    const s2 = (parseInt(e.l2)||0) * (parseInt(e.i2)||0);
    const sub1 = document.getElementById(`sub-score-${hazardId}-1`);
    const sub2 = document.getElementById(`sub-score-${hazardId}-2`);
    if (sub1) sub1.innerHTML = s1 > 0 ? `<span class="mini-score">${s1}</span>` : '<span class="mini-score empty">Not rated</span>';
    if (sub2) sub2.innerHTML = s2 > 0 ? `<span class="mini-score">${s2}</span>` : '<span class="mini-score empty">Not rated</span>';
  }

  row.classList.toggle('needs-impact', needsImpact(hazardId));
  _updateResearchBannerCount();

  updateProgress();
  updateCategoryCount(getGroupForHazard(hazardId));
}

function getCategoryForHazard(hazardId) {
  const h = getHazard(hazardId);
  return h ? h.category : null;
}

/** Which Assess screen group a hazard sits in: 'core', 'rare' or 'custom'. */
function getGroupForHazard(hazardId) {
  const h = getHazard(hazardId);
  return h ? h.group : null;
}

/**
 * Update notes for a hazard.
 */
function updateNotes(hazardId, val) {
  if (!state.scores[hazardId]) state.scores[hazardId] = {};
  state.scores[hazardId].notes = val;
  autoSave();
}

/**
 * Update custom hazard name or description.
 */
function updateCustomName(hazardId, field, val) {
  if (!state.customNames[hazardId]) state.customNames[hazardId] = {};
  state.customNames[hazardId][field] = val;

  // Update the hazard name display in this row
  const nameEl = document.querySelector(`#hazard-row-${hazardId} .hazard-name`);
  if (nameEl && field === 'name') {
    nameEl.textContent = val || `Custom Hazard ${HAZARD_DATA.find(h=>h.id===hazardId)?.customIndex}`;
  }
  const descEl = document.getElementById(`desc-${hazardId}`);
  if (descEl && field === 'description') {
    descEl.textContent = val || 'User-defined custom hazard';
  }

  autoSave();
  updateProgress();
}

/* ---------------------------------------------------------------
   PROGRESS & CATEGORY COUNTS
--------------------------------------------------------------- */

function updateProgress() {
  const scored = countScored();
  const total = totalActive();
  const el = document.getElementById('progress-indicator');
  if (el) el.textContent = `${scored} of ${total} hazards done`;
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = (total ? Math.round((scored / total) * 100) : 0) + '%';

  // Show float button after 5 scored
  const floatBtn = document.getElementById('float-results-btn');
  if (floatBtn) {
    floatBtn.classList.toggle('hidden', scored < 5);
  }

  // Update all group counts
  HAZARD_GROUPS.forEach(g => updateCategoryCount(g.key));
}

/** Header count for one group ('core', 'rare' or 'custom'). */
function updateCategoryCount(groupKey) {
  if (!groupKey) return;
  const inGroup = HAZARD_DATA.filter(h => h.group === groupKey && !(h.isCustom && !state.customNames[h.id]?.name));
  const done = inGroup.filter(h => isDone(h.id)).length;
  const ruledOut = inGroup.filter(h => isNA(h.id)).length;

  const el = document.getElementById(`cat-count-${groupKey}`);
  if (el) {
    if (groupKey === 'custom' && inGroup.length === 0) el.textContent = 'None added';
    else if (groupKey === 'rare') el.textContent = `${done - ruledOut} rated, ${ruledOut} ruled out`;
    else el.textContent = `${done} of ${inGroup.length} done`;
  }
  updateCategoryStrip(groupKey);
}

/** Distribution strip: one segment per hazard, in band color, highest score first. */
function updateCategoryStrip(groupKey) {
  const el = document.getElementById(`cat-strip-${groupKey}`);
  if (!el) return;
  const segs = HAZARD_DATA
    .filter(h => h.group === groupKey && !(h.isCustom && !state.customNames[h.id]?.name))
    .map(h => isScored(h.id) ? calcScore(h.id) : 0)
    .sort((a, b) => b - a)
    .map(sc => {
      const rl = sc > 0 ? getRiskLevel(sc) : null;
      return `<i${rl ? ` class="b-${rl.cls}"` : ''}></i>`;
    });
  el.innerHTML = segs.join('');
}

/* ---------------------------------------------------------------
   CATEGORY TOGGLE
--------------------------------------------------------------- */

function toggleCategory(section) {
  const rows = section.querySelector('.category-rows');
  setCategoryOpen(section, rows.classList.contains('collapsed'));
}

function setCategoryOpen(section, open) {
  const rows = section.querySelector('.category-rows');
  if (!rows) return;
  rows.classList.toggle('collapsed', !open);
  section.classList.toggle('is-open', open);
  const btn = section.querySelector('.category-header');
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function toggleDesc(hazardId) {
  const el = document.getElementById(`desc-${hazardId}`);
  if (!el) return;
  el.classList.toggle('hidden');
  const btn = document.querySelector(`#hazard-row-${hazardId} .desc-toggle`);
  if (btn) btn.setAttribute('aria-expanded', el.classList.contains('hidden') ? 'false' : 'true');
}

/* ---------------------------------------------------------------
   REPORT DATA — single source for Results, Share, Report view,
   Print and PDF
--------------------------------------------------------------- */

const LIKELIHOOD_LABELS = { 1: 'Extremely unlikely', 2: 'Unlikely', 3: 'Possible', 4: 'Likely', 5: 'Almost certain' };
const IMPACT_LABELS     = { 1: 'Negligible', 2: 'Minor', 3: 'Moderate', 4: 'Major', 5: 'Catastrophic' };
const REPORT_FOOTER     = 'Prepared with the World Aware Risk Assessment Tool, beworldaware.com';

const RISK_BANDS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(k => ({
  key: k, label: RISK_LEVELS[k].label, action: RISK_LEVELS[k].action,
}));

function hazardDisplayName(h) {
  return h.isCustom ? (state.customNames[h.id]?.name || `Custom Hazard ${h.customIndex}`) : h.name;
}

function formatReportDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Plain-text likelihood × impact line for a scored hazard.
 * Neighborhood mode lists each household that rated it; the score is the
 * higher of the two so the more exposed home is never hidden.
 */
function formatLIText(it) {
  if (state.assessmentType !== 'neighborhood') {
    return `Likelihood ${it.l} (${LIKELIHOOD_LABELS[it.l] || ''}) × Impact ${it.i} (${IMPACT_LABELS[it.i] || ''})`;
  }
  const names = [state.hh1Name || 'Household 1', state.hh2Name || 'Household 2'];
  // An impact the checklist filled in is not a rating; only one set by hand
  // (iManual / i2Manual, or any impact on a hazard the checklist does not
  // cover) is worth saying "likelihood not rated" about.
  const pairs = [[it.l, it.i, it.iManual], [it.l2, it.i2, it.i2Manual]];
  const parts = [];
  let full = 0;
  pairs.forEach(([l, i, byHand], idx) => {
    if (l > 0 && i > 0) { parts.push(`${names[idx]}: L${l} × I${i} = ${l * i}`); full++; }
    else if (l > 0)     { parts.push(`${names[idx]}: L${l}, impact not rated`); }
    else if (i > 0 && byHand !== false) { parts.push(`${names[idx]}: I${i}, likelihood not rated`); }
  });
  if (full === 2) parts.push(`higher of the two: ${it.score}`);
  return parts.join('; ');
}

/**
 * Build the complete report model from current state.
 * Everything that displays or exports results reads from this.
 */
function buildReportData() {
  const isNeighborhood = state.assessmentType === 'neighborhood';
  const active = HAZARD_DATA.filter(h => !(h.isCustom && !state.customNames[h.id]?.name));
  const researchIds = new Set(getResearchFlaggedIds());

  const scored = active.filter(h => isScored(h.id)).map(h => {
    const e = state.scores[h.id] || {};
    const score = calcScore(h.id);
    const rl = getRiskLevel(score);
    const origin = researchIds.has(h.id) ? getResearchOrigin(h.id) : null;
    const core = h.group === 'core';
    return {
      id: h.id,
      name: hazardDisplayName(h),
      category: h.category,
      score,
      // Impact set by hand (always true off the checklist's core list)
      iManual:  core ? e.iManual === true : true,
      i2Manual: core ? e.i2Manual === true : true,
      level: rl ? rl.key : '',
      rl,
      l: parseInt(e.l) || 0,
      i: parseInt(e.i) || 0,
      l2: parseInt(e.l2) || 0,
      i2: parseInt(e.i2) || 0,
      notes: userNotes(e),
      isAuto: !!e.isAuto,
      fromResearch: researchIds.has(h.id),
      // A placeholder likelihood (source did not respond) is never "research"
      isEstimate: !!e.isEstimate || origin?.status === 'estimated',
      action: rl ? rl.action : '',
      source: origin?.source || '',
      confidence: origin?.confidence || '',
      finding: origin ? cleanFindingText(origin.finding) : '',
    };
  }).sort((a, b) => b.score - a.score || a.id - b.id);
  scored.forEach(it => { it.liText = formatLIText(it); });

  const unrated = active
    .filter(h => researchIds.has(h.id) && !isScored(h.id) && !isNA(h.id))
    .map(h => {
      const e = state.scores[h.id] || {};
      const origin = getResearchOrigin(h.id) || {};
      const l = parseInt(e.l) || 0;
      return {
        id: h.id,
        name: hazardDisplayName(h),
        category: h.category,
        l,
        likelihoodLabel: LIKELIHOOD_LABELS[l] || '',
        notes: userNotes(e),
        source: origin.source || '',
        confidence: origin.confidence || '',
        finding: cleanFindingText(origin.finding || ''),
      };
    })
    .sort((a, b) => b.l - a.l || a.id - b.id);

  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  scored.forEach(it => { if (it.level) counts[it.level]++; });

  // Research summary
  let research = null;
  const rr = state.researchReport;
  if (rr && Array.isArray(rr.findings)) {
    // Ruled-out hazards were never applied, so they are not counted as research
    const live = rr.findings.filter(f => !isNA(f.hazardId));
    const used = live.filter(f => f.scoreAssigned !== null && f.scoreAssigned !== undefined);
    const conf = { High: 0, Medium: 0, Low: 0 };
    used.forEach(f => { if (conf[f.confidence] !== undefined) conf[f.confidence]++; });
    // Only sources that actually answered are listed as sources
    const sources = [...new Set(used.filter(f => f.status === 'success').map(f => f.source).filter(Boolean))];
    research = {
      address: state.researchAddress || '',
      matchedAddress: rr.geocoded?.displayAddress || '',
      county: rr.geocoded?.county || '',
      stateAbbr: rr.geocoded?.stateAbbr || '',
      timestamp: rr.timestamp || '',
      findingCount: used.length,
      estimatedCount: live.filter(f => f.status === 'estimated').length,
      // State rules of thumb are estimates by design, not a source that failed
      ruleOfThumbCount: live.filter(f => f.status === 'estimated' && /rule of thumb/i.test(String(f.source || ''))).length,
      unavailableCount: live.filter(f => f.status === 'error').length,
      confidence: conf,
      sources,
    };
  }

  const location = state.location || state.researchAddress || rr?.geocoded?.displayAddress || '';

  // "Considered and ruled out": every hazard marked Does not apply here
  const ruledOut = HAZARD_DATA.filter(h => !h.isCustom && isNA(h.id)).map(h => h.name);

  return {
    typeKey: state.assessmentType,
    typeLabel: isNeighborhood ? 'Neighborhood' : 'Household',
    location,
    date: state.date || localToday(),
    dateDisplay: formatReportDate(state.date || localToday()),
    householdSize: state.householdSize || '',
    hhNames: isNeighborhood ? [state.hh1Name || 'Household 1', state.hh2Name || 'Household 2'] : null,
    scored,
    unrated,
    ruledOut,
    counts,
    research,
    footer: REPORT_FOOTER,
  };
}

/** Default plain-language summary paragraph for a report. */
function buildDefaultSummary(data) {
  const parts = [];
  if (data.scored.length) {
    const lv = [];
    if (data.counts.CRITICAL) lv.push(`${data.counts.CRITICAL} critical`);
    if (data.counts.HIGH)     lv.push(`${data.counts.HIGH} high`);
    if (data.counts.MEDIUM)   lv.push(`${data.counts.MEDIUM} moderate`);
    if (data.counts.LOW)      lv.push(`${data.counts.LOW} low`);
    parts.push(`This assessment scored ${data.scored.length} hazard${data.scored.length === 1 ? '' : 's'} (${lv.join(', ')}).`);
    parts.push(`The highest-ranked risk is ${data.scored[0].name} with a score of ${data.scored[0].score} out of 25.`);
  } else {
    parts.push('No hazards have a full risk score yet.');
  }
  if (data.unrated.length) {
    parts.push(`Address research estimated likelihood for ${data.unrated.length} more hazard${data.unrated.length === 1 ? '' : 's'} whose impact has not been rated yet.`);
  }
  return parts.join(' ');
}

/* ---------------------------------------------------------------
   RESULTS SCREEN
--------------------------------------------------------------- */

/** Walk-through card shown under the top Critical or High band on Results. */
function walkthroughCtaHtml(top, rl) {
  return `
      <aside class="cta-card" aria-labelledby="cta-card-title">
        <h3 id="cta-card-title">${escHtml(top.name)} came out ${escHtml(rl.label.toLowerCase())}.</h3>
        <p>The score says what to worry about. It can't see your roof vents, the five feet around your house, or whether your insurance would rebuild at today's prices. A home walk-through can: Henry comes to the property, checks these numbers against what is there, and leaves a written plan in the order to do it. Contact us to schedule a walk-through.</p>
        <div class="cta-card-actions">
          <a class="btn btn-amber" href="${escHtml(BOOKING_URL)}" target="_blank" rel="noopener">${ic('external-link')} Contact us</a>
          <a class="cta-card-ghost" href="${escHtml(BOOKING_URL)}" target="_blank" rel="noopener">Bring a workshop to your HOA</a>
        </div>
      </aside>`;
}

function renderResults() {
  const data = buildReportData();
  const items = data.scored;
  const counts = data.counts;

  const summaryEl = document.getElementById('results-summary');
  const metaBits = [data.typeLabel + ' assessment'];
  if (data.location) metaBits.push(escHtml(data.location));
  if (data.dateDisplay) metaBits.push(escHtml(data.dateDisplay));
  const metaHtml = `<p class="results-meta">${metaBits.join('. ')}</p>`;

  if (items.length === 0 && data.unrated.length === 0) {
    summaryEl.innerHTML = metaHtml + `
      <div class="empty-card">
        <h3>No hazards scored yet</h3>
        <p>Pick a likelihood for the hazards on the Assess screen. Results fill in as you go.</p>
        <button class="btn btn-primary" onclick="showScreen('assessment')">${ic('clipboard-list')} Start assessing</button>
      </div>`;
  } else {
    summaryEl.innerHTML = metaHtml + `
      <div class="count-tiles" role="group" aria-label="Hazards by risk band">
        ${RISK_BANDS.map(b => `<div class="count-tile b-${RISK_LEVELS[b.key].cls}${counts[b.key] ? '' : ' is-zero'}"><span class="count-num">${counts[b.key]}</span><span class="count-label">${b.label}</span></div>`).join('')}
      </div>
      <p class="summary-chips"><span class="chip chip-total">${items.length} total scored</span>${data.unrated.length > 0 ? `<span class="chip chip-unrated">${data.unrated.length} impact not rated</span>` : ''}</p>`;
  }

  const actionsEl = document.getElementById('results-actions');
  if (actionsEl) actionsEl.hidden = items.length === 0;

  const listEl = document.getElementById('results-list');
  let html = '';
  let ctaShown = false;

  RISK_BANDS.forEach(band => {
    const bandItems = items.filter(it => it.level === band.key);
    if (bandItems.length === 0) return;

    const rl = RISK_LEVELS[band.key];
    html += `
      <section class="result-band band-${rl.cls}" aria-label="${rl.label} risks">
        <div class="band-header">
          ${riskBadgeHtml(rl)}
          <span class="band-action">${rl.action}</span>
          <span class="band-count">${bandItems.length} ${bandItems.length === 1 ? 'hazard' : 'hazards'}</span>
        </div>
    `;

    bandItems.forEach(it => {
      const sourceTag = it.fromResearch
        ? (it.isEstimate
            ? `<span class="result-source-tag manual">${ic('triangle-alert')} Rough estimate</span>`
            : `<span class="result-source-tag auto">${ic('map-pin')} From public data</span>`)
        : `<span class="result-source-tag manual">${ic('pencil')} Entered by hand</span>`;
      html += `
        <div class="result-card">
          <div class="result-card-top">
            <div class="result-left">
              <span class="result-name">${escHtml(it.name)}</span>
              <span class="result-meta-line"><span class="result-cat">${escHtml(catLabel(it.category))}</span>${sourceTag}</span>
              <span class="result-li">${escHtml(it.liText)}</span>
            </div>
            <div class="result-score">
              <span class="result-score-num">${it.score}</span>
              ${riskBadgeHtml(it.rl)}
            </div>
          </div>
          ${it.notes ? `<div class="result-notes">${ic('file-text', 'note-icon')}<span>${escHtml(it.notes)}</span></div>` : ''}
        </div>
      `;
    });

    html += `</section>`;

    // One walk-through card per page, right after the first Critical or High band
    if (!ctaShown && (band.key === 'CRITICAL' || band.key === 'HIGH')) {
      html += walkthroughCtaHtml(bandItems[0], rl);
      ctaShown = true;
    }
  });

  if (data.unrated.length > 0) {
    html += `
      <section class="result-band unrated-band">
        <div class="band-header unrated-band-header">
          <h3>Identified by research, impact not yet rated</h3>
        </div>
        <p class="unrated-intro">Research estimated how likely these are at this address. Rate the impact of each on the Assess screen to give it a full risk score.</p>
    `;
    data.unrated.forEach(it => {
      html += `
        <div class="result-card unrated-card">
          <div class="result-card-top">
            <div class="result-left">
              <span class="result-name">${escHtml(it.name)}</span>
              <span class="result-meta-line"><span class="result-cat">${escHtml(catLabel(it.category))}</span></span>
              ${it.finding ? `<span class="unrated-finding">${escHtml(it.finding)}</span>` : ''}
              ${it.source ? `<span class="unrated-source">${escHtml(it.source)}${it.confidence ? '. Confidence: ' + escHtml(it.confidence) : ''}</span>` : ''}
            </div>
            <div class="result-score result-likelihood">
              <span class="result-score-num">L${it.l}</span>
              <span class="result-score-label">${escHtml(it.likelihoodLabel)}</span>
            </div>
          </div>
        </div>
      `;
    });
    html += `
        <div class="unrated-cta">
          <button class="btn btn-primary btn-small" onclick="showScreen('assessment')">Rate impact</button>
        </div>
      </section>`;
  }

  listEl.innerHTML = html;
}

/* ---------------------------------------------------------------
   SHARE / EXPORT
--------------------------------------------------------------- */

function shareResults() {
  const text = buildTextSummary();

  // Try native share API first
  if (navigator.share) {
    navigator.share({
      title: 'World Aware Risk Assessment Results',
      text: text,
    }).catch(err => {
      // User cancelled the share sheet: do nothing
      if (err && err.name === 'AbortError') return;
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Results copied to clipboard.');
    }).catch(() => {
      showTextExportDialog(text);
    });
  } else {
    showTextExportDialog(text);
  }
}

function showTextExportDialog(text) {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay export-overlay';
  overlay.innerHTML = `
    <div class="dialog-box export-box" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <h3 id="export-title">Copy your results</h3>
      <textarea class="input export-text" readonly aria-label="Results text"></textarea>
      <div class="dialog-buttons"><button class="btn btn-primary export-close">Close</button></div>
    </div>`;
  const ta = overlay.querySelector('textarea');
  ta.value = text;
  overlay.querySelector('.export-close').onclick = () => overlay.remove();
  document.body.appendChild(overlay);
  ta.focus(); ta.select();
}

function buildTextSummary() {
  const data = buildReportData();
  const edits = (typeof getReportEdits === 'function') ? getReportEdits() : {};
  return buildShareText(data, edits);
}

/* ---------------------------------------------------------------
   REFERENCE GUIDE — RISK MATRIX
--------------------------------------------------------------- */

function buildRiskMatrix() {
  const tbody = document.getElementById('risk-matrix-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  // Which scored hazards land in which likelihood x impact cell
  const landed = {};
  const addAt = (l, i, name) => {
    if (!(l > 0 && i > 0)) return;
    (landed[l + 'x' + i] = landed[l + 'x' + i] || []).push(name);
  };
  HAZARD_DATA.forEach(h => {
    if (h.isCustom && !state.customNames[h.id]?.name) return;
    const e = state.scores[h.id];
    if (!e || e.na) return;
    const name = hazardDisplayName(h);
    addAt(parseInt(e.l) || 0, parseInt(e.i) || 0, name);
    if (state.assessmentType === 'neighborhood') addAt(parseInt(e.l2) || 0, parseInt(e.i2) || 0, name);
  });

  const readout = document.getElementById('matrix-readout');
  const idle = 'Select a cell to read its score. A dot marks cells that hold hazards you have scored.';

  for (let l = 5; l >= 1; l--) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = l;
    th.scope = 'row';
    th.className = 'matrix-label';
    tr.appendChild(th);

    for (let i = 1; i <= 5; i++) {
      const score = l * i;
      const rl = getRiskLevel(score);
      const names = landed[l + 'x' + i] || [];
      const sentence = `Likelihood ${l} (${LIKELIHOOD_LABELS[l]}) × impact ${i} (${IMPACT_LABELS[i]}) = ${score}, ${rl.label}.` +
        (names.length ? ' ' + names.join(', ') + '.' : '');
      const td = document.createElement('td');
      td.className = `matrix-cell b-${rl.cls}`;
      td.tabIndex = 0;
      td.setAttribute('aria-label', sentence);
      td.innerHTML = `<span class="mc-score">${score}</span>${names.length ? '<span class="mc-dot" aria-hidden="true"></span>' : ''}`;
      const show = () => { if (readout) readout.textContent = sentence; };
      td.addEventListener('focus', show);
      td.addEventListener('mouseenter', show);
      td.addEventListener('click', show);
      td.addEventListener('mouseleave', () => { if (readout && document.activeElement !== td) readout.textContent = idle; });
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

/* ---------------------------------------------------------------
   SAVE / LOAD / EXPORT
--------------------------------------------------------------- */

/**
 * Write a copy of the current assessment to the saved list (no toast, no re-render).
 * Returns the saved summary, or null when storage is unavailable or full.
 */
function _snapshotCurrent() {
  const saves = getSavedAssessments();
  const timestamp = new Date().toISOString();
  // Suffix keeps two copies made in the same millisecond from overwriting each other
  let id = 'wa_save_' + Date.now();
  while (saves[id]) id += 'x';
  const summary = {
    id,
    timestamp,
    type: state.assessmentType,
    location: state.location || 'Unknown location',
    scored: countScored(),
    state: JSON.parse(JSON.stringify(state)),
  };
  saves[id] = summary;
  try {
    localStorage.setItem('wa_saves', JSON.stringify(saves));
  } catch (e) {
    return null;
  }
  return summary;
}

function saveAssessment() {
  const summary = _snapshotCurrent();
  if (!summary) {
    showToast('Could not save: storage is unavailable or full. Export your work as a backup.', 6000);
    return;
  }
  renderSavedList();
  showToast(`Copy saved: ${new Date(summary.timestamp).toLocaleString()}`);
}

function getSavedAssessments() {
  try {
    return JSON.parse(localStorage.getItem('wa_saves') || '{}');
  } catch (e) {
    return {};
  }
}

function loadAssessment(id) {
  const saves = getSavedAssessments();
  const save = saves[id];
  if (!save) return;
  const go = () => {
    const info = {};
    state = normalizeState(save.state, info);
    applyChecklistImpacts(state);
    // Drop any in-memory research from the previous assessment so its address
    // and likelihoods cannot be applied on top of the one just loaded.
    if (typeof resetResearchUI === 'function') resetResearchUI();
    autoSave();
    showScreen('assessment');
    const notice = migrationNoticeText(info);
    if (notice) showToast(notice, 8000);
  };
  if (_isDirtyAssessment()) {
    showConfirm('Load this saved copy? The assessment you are working on now will be replaced. Save a copy first if you want to keep it.', go, { confirmLabel: 'Load and replace' });
  } else {
    go();
  }
}

function deleteAssessment(id) {
  showConfirm('Delete this saved copy? This cannot be undone.', () => {
    const saves = getSavedAssessments();
    delete saves[id];
    try { localStorage.setItem('wa_saves', JSON.stringify(saves)); } catch (e) { /* ignore */ }
    renderSavedList();
  }, { confirmLabel: 'Delete this copy' });
}

/** Hazards done in a saved copy, counted the v3 way (older copies stored a v2 count). */
function _savedDoneCount(save) {
  const prev = state;
  try {
    state = normalizeState(save && save.state);
    applyChecklistImpacts(state);
    return countScored();
  } catch (e) {
    return save && save.scored != null ? save.scored : 0;
  } finally {
    state = prev;
  }
}

function renderSavedList() {
  const container = document.getElementById('saved-assessments-list');
  const saves = getSavedAssessments();
  const keys = Object.keys(saves);

  if (keys.length === 0) {
    container.innerHTML = '<p class="empty-state">No saved assessments yet.</p>';
    const hs = document.getElementById('home-saved-list'); if (hs) hs.classList.add('hidden');
    return;
  }

  // The Home screen is what a workshop room sees on the projector, so saved
  // assessments (which are addresses) are listed under About only.
  const homeSection = document.getElementById('home-saved-list');
  if (homeSection) homeSection.classList.add('hidden');

  let html = '';
  keys.sort((a, b) => b.localeCompare(a)).forEach(k => {
    const s = saves[k];
    const d = new Date(s.timestamp);
    const when = isNaN(d) ? '' : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    html += `
      <div class="saved-item">
        <div class="saved-item-info">
          <strong>${escHtml(s.location || 'No address')}</strong>
          <span class="saved-meta">${s.type === 'neighborhood' ? 'Neighborhood' : 'Household'}. ${escHtml(String(_savedDoneCount(s)))} hazards done. ${escHtml(when)}</span>
        </div>
        <div class="saved-item-actions">
          <button class="btn btn-secondary btn-small" onclick="loadAssessment('${escHtml(k)}')">Load</button>
          <button class="btn btn-danger btn-small" onclick="deleteAssessment('${escHtml(k)}')">Delete</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

/* ---------------------------------------------------------------
   IMPORT FROM JSON  (validation lives in js/importValidator.js)
--------------------------------------------------------------- */

/** Open the file picker. */
function importJSON() {
  const input = document.getElementById('import-json-input');
  if (input) input.click();
}

/** File picked: read it as text and hand it on. */
function handleImportFile(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  const done = () => { try { input.value = ''; } catch (e) { /* ignore */ } };
  if (file.size > IMPORT_MAX_BYTES) {
    showToast('That file is larger than 2 MB, so it is not one of our exports.', 6000);
    done();
    return;
  }
  const reader = new FileReader();
  reader.onload = () => { done(); importAssessmentText(String(reader.result || '')); };
  reader.onerror = () => { done(); showToast('Could not read that file.', 6000); };
  reader.readAsText(file);
}

/** Parse, validate and, after a confirm, apply the text of an exported file. */
function importAssessmentText(text) {
  const parsed = parseImportText(text);
  const res = parsed.ok ? validateImport(parsed.obj) : { ok: false, errors: parsed.errors, warnings: [] };
  if (!res.ok) {
    const more = res.errors.length > 1 ? ` (${res.errors.length - 1} more problem${res.errors.length > 2 ? 's' : ''})` : '';
    showToast(`Could not import: ${res.errors[0]}${more}`, 8000);
    return;
  }
  const msg = _isDirtyAssessment()
    ? 'Import this assessment? Your current work will be saved as a copy first.'
    : 'Import this assessment?';
  showConfirm(msg, () => applyImport(res), { confirmLabel: 'Import' });
}

/** Replace the current assessment with a validated import. */
function applyImport(res) {
  if (_isDirtyAssessment() && !_snapshotCurrent()) {
    showToast('Could not save a copy: storage is unavailable or full. Export your work as a backup, then try again.', 6000);
    return;
  }
  const info = {};
  const next = normalizeState(res.state, info);
  // Never reuse the id of the assessment being replaced: its copy and its report edits stay separate.
  if (!res.state.assessmentId || res.state.assessmentId === state.assessmentId) next.assessmentId = _newAssessmentId();

  const e = res.edits;
  const hasEdits = e && (e.title || e.preparedFor || e.summary || e.actions || Object.keys(e.notes || {}).length);
  if (hasEdits && typeof _readAllReportEdits === 'function' && typeof _writeAllReportEdits === 'function') {
    const all = _readAllReportEdits();
    all[next.assessmentId] = e;
    _writeAllReportEdits(all);
  }

  applyChecklistImpacts(next);
  state = next;
  _screenScroll.assessment = 0;
  if (typeof resetResearchUI === 'function') resetResearchUI();
  autoSave();
  renderSavedList();
  if (res.warnings && res.warnings.length) console.warn('Import adjustments:', res.warnings);
  const notice = migrationNoticeText(info);
  const otherWarnings = (res.warnings || []).filter(w => !/merged or moved|merged in v3/.test(w));
  showToast(`Imported: ${state.location || (state.assessmentType === 'neighborhood' ? 'Neighborhood assessment' : 'Household assessment')}.` +
    (notice ? ' ' + notice : '') +
    (otherWarnings.length ? ' Some values were adjusted.' : ''), notice || otherWarnings.length ? 8000 : 4000);
  showScreen('assessment');
}

/**
 * The object exportJSON() writes. Everything Import from JSON needs sits at
 * the top level; results[] is a human-readable summary the importer ignores.
 */
function buildExportData() {
  const data = {
    exportedAt: new Date().toISOString(),
    tool: 'World Aware Risk Assessment',
    version: APP_VERSION,
    assessmentId: state.assessmentId,
    assessmentType: state.assessmentType,
    location: state.location,
    date: state.date,
    householdSize: state.householdSize,
    hh1Name: state.hh1Name,
    hh2Name: state.hh2Name,
    scores: state.scores,
    checklist: state.checklist,
    customNames: state.customNames,
    researchAddress: state.researchAddress,
    researchReport: state.researchReport,
    autoScoreOrigins: state.autoScoreOrigins,
    reportEdits: (typeof getReportEdits === 'function') ? getReportEdits() : {},
    results: HAZARD_DATA
      .filter(h => {
        if (h.isCustom && !state.customNames[h.id]?.name) return false;
        return isScored(h.id);
      })
      .map(h => ({
        id: h.id,
        name: h.isCustom ? state.customNames[h.id]?.name : h.name,
        category: h.category,
        score: calcScore(h.id),
        riskLevel: getRiskLevel(calcScore(h.id))?.key || '',
        likelihood: state.scores[h.id]?.l || 0,
        impact: state.scores[h.id]?.i || 0,
        notes: state.scores[h.id]?.notes || '',
      }))
      .sort((a, b) => b.score - a.score),
  };
  return data;
}

function exportJSON() {
  const data = buildExportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wa-risk-assessment-${state.date || 'export'}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoking synchronously can cancel the download in some Safari and Firefox builds
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ---------------------------------------------------------------
   CLEAR ALL DATA
--------------------------------------------------------------- */

function clearAllData() {
  showConfirm('Delete everything on this device: the current assessment, every saved copy, and all report edits? This cannot be undone.', () => {
    let ok = true;
    try {
      localStorage.removeItem('wa_current_state');
      localStorage.removeItem('wa_saves');
      localStorage.removeItem('wa_report_edits');
    } catch (e) { ok = false; }
    // Addresses and coordinates may also sit in the service worker's cache
    // from earlier versions; remove any cross-origin entries there too.
    if (typeof caches !== 'undefined' && caches.keys) {
      caches.keys().then(names => names.filter(n => n.startsWith('wa-risk-')).forEach(n => {
        caches.open(n).then(c => c.keys().then(reqs => {
          reqs.forEach(r => { try { if (new URL(r.url).origin !== location.origin) c.delete(r); } catch (e) { /* ignore */ } });
        }));
      })).catch(() => { /* ignore */ });
    }
    // Reset state
    state = freshState();
    if (typeof resetResearchUI === 'function') resetResearchUI();
    renderSavedList();
    showScreen('home');
    showToast(ok ? 'Everything on this device was deleted.' : 'Could not clear storage on this device. Try clearing site data in your browser settings.');
  }, { confirmLabel: 'Delete everything' });
}

/** Small in-page status message instead of a native alert(). */
function showToast(message, ms) {
  let el = document.getElementById('wa-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'wa-toast';
    el.className = 'wa-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('is-visible'), ms || 4000);
}

/* ---------------------------------------------------------------
   CONFIRM DIALOG
--------------------------------------------------------------- */

let _confirmCallback = null;
let _confirmReturnFocus = null;

/**
 * Modal confirm. Focus moves into the dialog, Tab stays inside it, Escape
 * cancels, and focus returns to the control that opened it.
 * opts.confirmLabel names the destructive action ("Delete everything").
 */
function showConfirm(message, onConfirm, opts) {
  opts = opts || {};
  document.getElementById('confirm-message').textContent = message;
  const okBtn = document.getElementById('confirm-ok-btn');
  if (okBtn) okBtn.textContent = opts.confirmLabel || 'Yes, continue';
  _confirmCallback = onConfirm;
  _confirmReturnFocus = document.activeElement;
  const dlg = document.getElementById('confirm-dialog');
  dlg.classList.remove('hidden');
  const shell = document.querySelector('.shell');
  if (shell) shell.setAttribute('inert', '');
  const cancel = document.getElementById('confirm-cancel-btn');
  if (cancel) cancel.focus();
  dlg.addEventListener('keydown', _confirmKeydown);
}

function _confirmKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); cancelAction(); return; }
  if (e.key !== 'Tab') return;
  const focusable = Array.from(document.querySelectorAll('#confirm-dialog button'));
  if (focusable.length === 0) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function _closeConfirm() {
  const dlg = document.getElementById('confirm-dialog');
  dlg.classList.add('hidden');
  dlg.removeEventListener('keydown', _confirmKeydown);
  const shell = document.querySelector('.shell');
  if (shell) shell.removeAttribute('inert');
  const back = _confirmReturnFocus;
  _confirmReturnFocus = null;
  if (back && typeof back.focus === 'function' && document.contains(back)) {
    try { back.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
}

function confirmAction() {
  const cb = _confirmCallback;
  _confirmCallback = null;
  _closeConfirm();
  if (cb) cb();
}

function cancelAction() {
  _confirmCallback = null;
  _closeConfirm();
}

/* ---------------------------------------------------------------
   HEADER FIELD LISTENERS
--------------------------------------------------------------- */

function bindHeaderFields() {
  document.getElementById('field-location').addEventListener('input', e => {
    state.location = e.target.value; autoSave();
  });
  document.getElementById('field-date').addEventListener('change', e => {
    state.date = e.target.value; autoSave();
  });
  document.getElementById('field-household-size').addEventListener('input', e => {
    state.householdSize = e.target.value; autoSave();
  });
  document.getElementById('hh1-name').addEventListener('input', e => {
    state.hh1Name = e.target.value || 'Household 1';
    autoSave();
    rebuildHazardInputLabels();
    if (typeof refreshChecklistLabels === 'function') refreshChecklistLabels();
  });
  document.getElementById('hh2-name').addEventListener('input', e => {
    state.hh2Name = e.target.value || 'Household 2';
    autoSave();
    rebuildHazardInputLabels();
    if (typeof refreshChecklistLabels === 'function') refreshChecklistLabels();
  });
}

/**
 * Update HH name labels in hazard rows (neighborhood mode).
 */
function rebuildHazardInputLabels() {
  document.querySelectorAll('.input-group-label').forEach((el, i) => {
    // Labels alternate HH1/HH2 within each hazard row
    if (i % 2 === 0) el.textContent = state.hh1Name || 'HH1';
    else el.textContent = state.hh2Name || 'HH2';
  });
}

/* ---------------------------------------------------------------
   PWA INSTALL PROMPT
--------------------------------------------------------------- */

let _deferredPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredPrompt = e;
  const banner = document.getElementById('install-banner');
  if (banner) banner.classList.remove('hidden');
});

document.addEventListener('DOMContentLoaded', () => {
  const installBtn = document.getElementById('install-btn');
  const dismissBtn = document.getElementById('install-dismiss');
  if (installBtn) {
    installBtn.addEventListener('click', () => {
      if (_deferredPrompt) {
        _deferredPrompt.prompt();
        _deferredPrompt.userChoice.then(() => {
          _deferredPrompt = null;
          document.getElementById('install-banner').classList.add('hidden');
        });
      }
    });
  }
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      document.getElementById('install-banner').classList.add('hidden');
    });
  }
});

/* ---------------------------------------------------------------
   SERVICE WORKER REGISTRATION
--------------------------------------------------------------- */

if ('serviceWorker' in navigator) {
  // When a new service worker takes over (new version deployed), reload once
  // so the page runs the matching app files instead of a stale mix.
  const hadController = !!navigator.serviceWorker.controller;
  let reloadingForSW = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloadingForSW) return;
    reloadingForSW = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('SW registered:', reg.scope);
        reg.update().catch(() => {});
      })
      .catch(err => console.warn('SW registration failed:', err));
  });
}

/* ---------------------------------------------------------------
   UTILITY: HTML escape
--------------------------------------------------------------- */

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

/** Point every static booking link in index.html (data-booking-link) at BOOKING_URL. */
function applyBookingLinks() {
  document.querySelectorAll('a[data-booking-link]').forEach(a => { a.href = BOOKING_URL; });
}
document.addEventListener('DOMContentLoaded', applyBookingLinks);

/* ---------------------------------------------------------------
   BOOT
--------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', () => {
  // Load persisted state
  loadCurrentState();

  // Bind header fields
  bindHeaderFields();

  // Show home screen
  showScreen('home');

  // Render saved assessments on home screen
  renderSavedList();

  // Set default date field
  const dateField = document.getElementById('field-date');
  if (dateField && !dateField.value) {
    dateField.value = state.date || localToday();
  }

  // Handle URL shortcut parameters (from manifest shortcuts)
  const urlParams = new URLSearchParams(window.location.search);
  const startParam = urlParams.get('start');
  if (startParam === 'household' || startParam === 'neighborhood') {
    startAssessment(startParam);
  }

  // Printing from any screen prints the report document
  window.addEventListener('beforeprint', () => {
    if (typeof renderReportView === 'function') renderReportView();
  });

  if (_pendingMigrationNotice) { showToast(_pendingMigrationNotice, 8000); _pendingMigrationNotice = ''; }

  console.log(`World Aware Risk Assessment v${APP_VERSION} loaded.`);
  console.log(`${HAZARD_DATA.length} hazards loaded.`);
});
