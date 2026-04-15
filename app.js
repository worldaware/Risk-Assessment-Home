/* =============================================================
   WORLD AWARE RISK ASSESSMENT — app.js
   Vanilla JS, no frameworks. All data stored in localStorage.
   ============================================================= */

'use strict';

/* ---------------------------------------------------------------
   CONSTANTS & CONFIGURATION
--------------------------------------------------------------- */

const RISK_LEVELS = {
  CRITICAL: { min: 15, max: 25, label: 'CRITICAL', bg: '#FADBD8', color: '#C0392B' },
  HIGH:     { min: 10, max: 14, label: 'HIGH',     bg: '#FDEBD0', color: '#E67E22' },
  MEDIUM:   { min: 6,  max: 9,  label: 'MEDIUM',   bg: '#FEF9E7', color: '#9A7D0A' },
  LOW:      { min: 1,  max: 5,  label: 'LOW',      bg: '#D5F5E3', color: '#27AE60' },
};

// Category colors (left border / badge)
const CATEGORY_COLORS = {
  'Natural Hazards':                   '#1B4F72',
  'Industrial & CBRN':                 '#4A235A',
  'Outages & Service Interruptions':   '#1A5276',
  'Infrastructure Failures':           '#145A32',
  'Supply Chain':                      '#784212',
  'Other & Human-Caused':              '#7B241C',
};

/* ---------------------------------------------------------------
   FULL HAZARD DATA — 62 hazards
--------------------------------------------------------------- */

const HAZARD_DATA = [
  // ── Natural Hazards ──────────────────────────────────────────
  {
    id: 1, category: 'Natural Hazards',
    name: 'Wildfire',
    description: 'Fast-moving fire threatening structures, air quality, and evacuation routes',
  },
  {
    id: 2, category: 'Natural Hazards',
    name: 'Earthquake',
    description: 'Ground shaking, structural damage, aftershocks, utility disruption',
  },
  {
    id: 3, category: 'Natural Hazards',
    name: 'Flood (riverine)',
    description: 'River or creek overflow inundating properties and roads',
  },
  {
    id: 4, category: 'Natural Hazards',
    name: 'Flash Flood',
    description: 'Rapid, sudden flooding from heavy rain or dam failure upstream',
  },
  {
    id: 5, category: 'Natural Hazards',
    name: 'Severe Thunderstorm',
    description: 'High winds, hail, lightning, localized flooding, tree damage',
  },
  {
    id: 6, category: 'Natural Hazards',
    name: 'Tornado',
    description: 'Violent rotating winds causing structural damage and debris',
  },
  {
    id: 7, category: 'Natural Hazards',
    name: 'Hurricane / Tropical Storm',
    description: 'Sustained high winds, storm surge, heavy rain, extended power outages',
  },
  {
    id: 8, category: 'Natural Hazards',
    name: 'Winter Storm / Ice Storm',
    description: 'Heavy snow, ice accumulation, road closures, hypothermia risk',
  },
  {
    id: 9, category: 'Natural Hazards',
    name: 'Extreme Heat',
    description: 'Prolonged high temperatures causing heat stroke, crop failure, power spikes',
  },
  {
    id: 10, category: 'Natural Hazards',
    name: 'Drought',
    description: 'Extended water scarcity affecting drinking water, fire risk, food production',
  },
  {
    id: 11, category: 'Natural Hazards',
    name: 'Landslide / Mudslide',
    description: 'Slope failure threatening structures, roads, and utility lines',
  },
  {
    id: 12, category: 'Natural Hazards',
    name: 'Tsunami',
    description: 'Ocean wave inundation following earthquake or submarine landslide',
  },
  {
    id: 13, category: 'Natural Hazards',
    name: 'Volcanic Ash / Eruption',
    description: 'Ash fall disrupting air quality, power, transportation, and water',
  },
  {
    id: 14, category: 'Natural Hazards',
    name: 'Dust Storm / Haboob',
    description: 'Visibility loss, respiratory hazard, equipment damage',
  },

  // ── Industrial & CBRN ────────────────────────────────────────
  {
    id: 15, category: 'Industrial & CBRN',
    name: 'Chemical Plant / Refinery Release',
    description: 'Toxic chemical release from nearby industrial facility',
  },
  {
    id: 16, category: 'Industrial & CBRN',
    name: 'Hazmat Transportation Incident',
    description: 'Truck or rail car carrying hazardous materials derails or crashes nearby',
  },
  {
    id: 17, category: 'Industrial & CBRN',
    name: 'Natural Gas Pipeline Leak / Explosion',
    description: 'Underground or surface pipeline failure causing fire, explosion, or gas exposure',
  },
  {
    id: 18, category: 'Industrial & CBRN',
    name: 'Nuclear / Radiological Incident',
    description: 'Release from power plant, medical facility, or dirty bomb event',
  },
  {
    id: 19, category: 'Industrial & CBRN',
    name: 'Agricultural Chemical Drift',
    description: 'Pesticide or fertilizer spray drift from nearby farms or crop dusting',
  },
  {
    id: 20, category: 'Industrial & CBRN',
    name: 'Mine / Quarry Hazard',
    description: 'Blasting, dust, runoff, or structural failure from nearby mining operations',
  },
  {
    id: 21, category: 'Industrial & CBRN',
    name: 'Wastewater / Sewage Release',
    description: 'Sewage system overflow or treatment plant failure contaminating water sources',
  },
  {
    id: 22, category: 'Industrial & CBRN',
    name: 'Biological Release / Pandemic',
    description: 'Infectious disease outbreak requiring quarantine and healthcare surge',
  },
  {
    id: 23, category: 'Industrial & CBRN',
    name: 'Air Quality Crisis',
    description: 'Persistent poor air quality requiring shelter-in-place and respiratory protection',
  },

  // ── Outages & Service Interruptions ─────────────────────────
  {
    id: 24, category: 'Outages & Service Interruptions',
    name: 'Extended Power Outage (3+ days)',
    description: 'Grid failure from storm, equipment failure, or cyber attack',
  },
  {
    id: 25, category: 'Outages & Service Interruptions',
    name: 'Short-Term Power Outage (<3 days)',
    description: 'Brief grid disruption affecting daily function and medical devices',
  },
  {
    id: 26, category: 'Outages & Service Interruptions',
    name: 'Natural Gas Service Interruption',
    description: 'Loss of gas for heating, cooking, and water heating',
  },
  {
    id: 27, category: 'Outages & Service Interruptions',
    name: 'Municipal Water Outage',
    description: 'Loss of tap water pressure or boil water advisory',
  },
  {
    id: 28, category: 'Outages & Service Interruptions',
    name: 'Wastewater / Sewer Failure',
    description: 'Backup, overflow, or loss of sewage service',
  },
  {
    id: 29, category: 'Outages & Service Interruptions',
    name: 'Internet / Broadband Outage',
    description: 'Loss of internet affecting communications, work, and information access',
  },
  {
    id: 30, category: 'Outages & Service Interruptions',
    name: 'Cell Network Failure',
    description: 'Mobile communications overloaded or offline during emergency',
  },
  {
    id: 31, category: 'Outages & Service Interruptions',
    name: 'Landline / VOIP Outage',
    description: 'Loss of fixed-line phone service',
  },
  {
    id: 32, category: 'Outages & Service Interruptions',
    name: 'Emergency Services Overwhelmed',
    description: 'Fire, police, and EMS unable to respond in normal timeframes',
  },
  {
    id: 33, category: 'Outages & Service Interruptions',
    name: 'Hospital / Medical Facility Closure',
    description: 'Local medical care unavailable due to damage, surge, or evacuation',
  },
  {
    id: 34, category: 'Outages & Service Interruptions',
    name: 'School / Childcare Closure',
    description: 'Disruption to childcare requiring household coverage',
  },
  {
    id: 35, category: 'Outages & Service Interruptions',
    name: 'Public Transit Disruption',
    description: 'Bus, rail, or ride-share services halted',
  },

  // ── Infrastructure Failures ──────────────────────────────────
  {
    id: 36, category: 'Infrastructure Failures',
    name: 'Road / Bridge Closure',
    description: 'Primary evacuation or access routes blocked or damaged',
  },
  {
    id: 37, category: 'Infrastructure Failures',
    name: 'Water Main Break',
    description: 'Loss of municipal water pressure to homes and fire hydrants',
  },
  {
    id: 38, category: 'Infrastructure Failures',
    name: 'Fuel Supply Disruption',
    description: 'Local fuel unavailable for vehicles and generators',
  },
  {
    id: 39, category: 'Infrastructure Failures',
    name: 'Dam Failure / Reservoir Release',
    description: 'Catastrophic downstream flooding from dam breach',
  },
  {
    id: 40, category: 'Infrastructure Failures',
    name: 'Levee Failure',
    description: 'Flood protection infrastructure breach causing inundation',
  },
  {
    id: 41, category: 'Infrastructure Failures',
    name: 'Electrical Grid Substation Failure',
    description: 'Local transformer damage causing extended neighborhood outage',
  },
  {
    id: 42, category: 'Infrastructure Failures',
    name: 'Building / Structural Failure',
    description: 'Collapse or unsafe conditions in residential or commercial structures',
  },
  {
    id: 43, category: 'Infrastructure Failures',
    name: 'Stormwater / Drainage System Failure',
    description: 'Overwhelmed drainage causing localized flooding',
  },
  {
    id: 44, category: 'Infrastructure Failures',
    name: 'Cyber Attack on Critical Infrastructure',
    description: 'Disruption of water, power, or communications via cyber attack',
  },

  // ── Supply Chain ─────────────────────────────────────────────
  {
    id: 45, category: 'Supply Chain',
    name: 'Food Supply Shortage',
    description: 'Regional disruption to food distribution and grocery availability',
  },
  {
    id: 46, category: 'Supply Chain',
    name: 'Medication / Pharmaceutical Shortage',
    description: 'Prescription and OTC medications unavailable or rationed',
  },
  {
    id: 47, category: 'Supply Chain',
    name: 'Medical Equipment Shortage',
    description: 'PPE, DME, or emergency medical supplies unavailable',
  },
  {
    id: 48, category: 'Supply Chain',
    name: 'Fuel / Energy Supply Disruption',
    description: 'Gasoline, propane, or heating oil distribution interrupted',
  },
  {
    id: 49, category: 'Supply Chain',
    name: 'Building Materials Shortage',
    description: 'Lumber, hardware, and repair materials unavailable post-disaster',
  },
  {
    id: 50, category: 'Supply Chain',
    name: 'Bottled Water / Purification Supply Shortage',
    description: 'Commercial water and filtration products sold out',
  },
  {
    id: 51, category: 'Supply Chain',
    name: 'Electronic / Battery Supply Shortage',
    description: 'Batteries, chargers, and powered equipment unavailable',
  },
  {
    id: 52, category: 'Supply Chain',
    name: 'Cash / Banking System Disruption',
    description: 'ATMs offline, payment systems down, or bank access limited',
  },

  // ── Other & Human-Caused ─────────────────────────────────────
  {
    id: 53, category: 'Other & Human-Caused',
    name: 'Civil Unrest / Social Disruption',
    description: 'Protests, riots, or social breakdown affecting safety and movement',
  },
  {
    id: 54, category: 'Other & Human-Caused',
    name: 'Active Threat / Violence Event',
    description: 'Shooting, attack, or armed incident in the community',
  },
  {
    id: 55, category: 'Other & Human-Caused',
    name: 'Wildland-Urban Interface Encroachment',
    description: 'Development in fire-prone areas increasing wildfire exposure',
  },
  {
    id: 56, category: 'Other & Human-Caused',
    name: 'Economic Shock / Job Loss',
    description: 'Sudden income loss reducing capacity to prepare and recover',
  },
  {
    id: 57, category: 'Other & Human-Caused',
    name: 'Housing Instability / Displacement',
    description: 'Loss of housing due to disaster, economic, or policy factors',
  },
  {
    id: 58, category: 'Other & Human-Caused',
    name: 'Animal / Livestock Disease Outbreak',
    description: 'Disease affecting local food production',
  },
  {
    id: 59, category: 'Other & Human-Caused',
    name: 'Extreme Isolation / Evacuation Difficulty',
    description: 'Geographic factors making evacuation slow or impossible',
  },
  // Custom hazards 60-62 (user-editable)
  {
    id: 60, category: 'Other & Human-Caused',
    name: '', // user fills in
    description: '',
    isCustom: true,
    customIndex: 1,
  },
  {
    id: 61, category: 'Other & Human-Caused',
    name: '',
    description: '',
    isCustom: true,
    customIndex: 2,
  },
  {
    id: 62, category: 'Other & Human-Caused',
    name: '',
    description: '',
    isCustom: true,
    customIndex: 3,
  },
];

/* ---------------------------------------------------------------
   APP STATE
--------------------------------------------------------------- */

// State object — single source of truth
let state = {
  assessmentType: 'household',   // 'household' | 'neighborhood'
  location: '',
  date: new Date().toISOString().split('T')[0],
  householdSize: '',
  hh1Name: 'Household 1',
  hh2Name: 'Household 2',
  scores: {},     // { hazardId: { l: 0, i: 0, notes: '', l2: 0, i2: 0, isAuto: bool } }
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
 * In neighborhood mode, returns the average of HH1 and HH2.
 */
function calcScore(hazardId) {
  const entry = state.scores[hazardId];
  if (!entry) return 0;

  const l = parseInt(entry.l) || 0;
  const i = parseInt(entry.i) || 0;

  if (state.assessmentType === 'neighborhood') {
    const l2 = parseInt(entry.l2) || 0;
    const i2 = parseInt(entry.i2) || 0;
    const s1 = l * i;
    const s2 = l2 * i2;
    // Average of both scores (only if both have data)
    if (s1 > 0 && s2 > 0) return Math.round((s1 + s2) / 2);
    if (s1 > 0) return s1;
    if (s2 > 0) return s2;
    return 0;
  }

  return l * i;
}

/**
 * Check if a hazard has been fully scored (both L and I entered).
 */
function isScored(hazardId) {
  const entry = state.scores[hazardId];
  if (!entry) return false;
  const l = parseInt(entry.l) || 0;
  const i = parseInt(entry.i) || 0;
  return l > 0 && i > 0;
}

/**
 * Count total scored hazards.
 */
function countScored() {
  return HAZARD_DATA.filter(h => {
    if (h.isCustom && !state.customNames[h.id]?.name) return false;
    return isScored(h.id);
  }).length;
}

/**
 * Returns total number of active hazards (including named custom ones).
 */
function totalActive() {
  return HAZARD_DATA.filter(h => {
    if (h.isCustom) return !!state.customNames[h.id]?.name;
    return true;
  }).length;
}

/**
 * Save current state to localStorage (auto-save).
 */
function autoSave() {
  localStorage.setItem('wa_current_state', JSON.stringify(state));
  updateProgress();
}

/**
 * Load state from localStorage.
 */
function loadCurrentState() {
  const saved = localStorage.getItem('wa_current_state');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state = Object.assign(state, parsed);
    } catch (e) {
      console.warn('Could not parse saved state', e);
    }
  }
}

/* ---------------------------------------------------------------
   SCREEN NAVIGATION
--------------------------------------------------------------- */

let currentScreen = 'home';

function showScreen(screenId) {
  // Hide all screens
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Show target
  const target = document.getElementById('screen-' + screenId);
  if (target) target.classList.add('active');

  // Update nav
  const navBtn = document.querySelector(`.nav-item[data-screen="${screenId}"]`);
  if (navBtn) navBtn.classList.add('active');

  currentScreen = screenId;

  // Screen-specific initialization
  if (screenId === 'results')   renderResults();
  if (screenId === 'about')     renderSavedList();
  if (screenId === 'reference') buildRiskMatrix();
  if (screenId === 'research' && typeof initResearchScreen === 'function') initResearchScreen();

  // Scroll to top
  window.scrollTo(0, 0);
}

function goHome() {
  showScreen('home');
}

/* ---------------------------------------------------------------
   ASSESSMENT INITIALIZATION
--------------------------------------------------------------- */

function startAssessment(type) {
  state.assessmentType = type;
  // Default date to today if not set
  if (!state.date) {
    state.date = new Date().toISOString().split('T')[0];
  }
  autoSave();
  showScreen('assessment');
  initAssessmentUI();
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
  document.getElementById('field-date').value = state.date || new Date().toISOString().split('T')[0];
  document.getElementById('field-household-size').value = state.householdSize || '';
  document.getElementById('hh1-name').value = state.hh1Name || 'Household 1';
  document.getElementById('hh2-name').value = state.hh2Name || 'Household 2';

  // Build hazard list
  buildHazardList();
  updateProgress();

  // Show/refresh "View Research Report" link if auto-scores exist
  _syncResearchReportLink();
}

function _syncResearchReportLink() {
  const existing = document.getElementById('research-report-link');
  const hasAutoScores = Object.values(state.scores).some(s => s?.isAuto);
  if (!hasAutoScores) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return; // already shown
  const link = document.createElement('div');
  link.id = 'research-report-link';
  link.className = 'research-report-link';
  link.innerHTML = `
    <button class="btn-small btn-ghost" onclick="showScreen('research')">
      🔍 View Research Report
    </button>
    <span>Likelihood scores pre-populated from government data. Set Impact to score.</span>
  `;
  const header = document.querySelector('.assessment-header');
  if (header) header.insertAdjacentElement('afterend', link);
}

/* ---------------------------------------------------------------
   HAZARD LIST BUILDER
--------------------------------------------------------------- */

/**
 * Build the full hazard list grouped by category.
 */
function buildHazardList() {
  const container = document.getElementById('hazard-list');
  container.innerHTML = '';

  // Group hazards by category
  const categories = {};
  HAZARD_DATA.forEach(h => {
    if (!categories[h.category]) categories[h.category] = [];
    categories[h.category].push(h);
  });

  Object.keys(categories).forEach(catName => {
    const hazards = categories[catName];
    const catColor = CATEGORY_COLORS[catName] || '#333';

    // Category section wrapper
    const section = document.createElement('div');
    section.className = 'category-section';
    section.dataset.category = catName;

    // Category header (collapsible)
    const header = document.createElement('div');
    header.className = 'category-header';
    header.style.borderLeftColor = catColor;
    header.innerHTML = `
      <div class="cat-header-inner">
        <span class="cat-badge" style="background:${catColor}">${catName}</span>
        <span class="cat-count" id="cat-count-${slugify(catName)}">0 scored</span>
        <i data-feather="chevron-down" class="cat-chevron"></i>
      </div>
    `;
    header.addEventListener('click', () => toggleCategory(section));

    // Hazard rows container (starts collapsed)
    const rows = document.createElement('div');
    rows.className = 'category-rows collapsed';

    hazards.forEach(hazard => {
      rows.appendChild(buildHazardRow(hazard));
    });

    section.appendChild(header);
    section.appendChild(rows);
    container.appendChild(section);
  });

  // Re-render feather icons
  if (window.feather) feather.replace();
}

/**
 * Build a single hazard row element.
 */
function buildHazardRow(hazard) {
  const entry = state.scores[hazard.id] || {};
  const score = calcScore(hazard.id);
  const rl = score > 0 ? getRiskLevel(score) : null;
  const catColor = CATEGORY_COLORS[hazard.category] || '#333';
  const isNeighborhood = state.assessmentType === 'neighborhood';

  const row = document.createElement('div');
  row.className = 'hazard-row';
  row.id = `hazard-row-${hazard.id}`;
  row.style.borderLeftColor = catColor;

  // Custom hazard name/desc inputs (for hazards 60-62)
  let customNameHtml = '';
  if (hazard.isCustom) {
    const cn = state.customNames[hazard.id] || {};
    customNameHtml = `
      <div class="custom-hazard-inputs">
        <input type="text" class="custom-name-input info-input"
          placeholder="Custom Hazard ${hazard.customIndex} — enter name"
          value="${escHtml(cn.name || '')}"
          onchange="updateCustomName(${hazard.id}, 'name', this.value)"
          oninput="updateCustomName(${hazard.id}, 'name', this.value)" />
        <input type="text" class="custom-desc-input info-input"
          placeholder="Description (optional)"
          value="${escHtml(cn.description || '')}"
          onchange="updateCustomName(${hazard.id}, 'description', this.value)"
          oninput="updateCustomName(${hazard.id}, 'description', this.value)" />
      </div>
    `;
  }

  // Auto-score badge (shown when likelihood was set by Research My Area)
  const isAutoScored = !!(state.scores[hazard.id]?.isAuto);
  const autoScoreBadgeHtml = isAutoScored
    ? `<span class="auto-score-badge" id="auto-badge-${hazard.id}">🔍 Auto</span>`
    : `<span class="auto-score-badge hidden" id="auto-badge-${hazard.id}">🔍 Auto</span>`;

  // Hazard name display
  const displayName = hazard.isCustom
    ? (state.customNames[hazard.id]?.name || `Custom Hazard ${hazard.customIndex}`)
    : hazard.name;

  const displayDesc = hazard.isCustom
    ? (state.customNames[hazard.id]?.description || 'User-defined custom hazard')
    : hazard.description;

  // Score badge
  const scoreBadgeHtml = score > 0
    ? `<span class="score-badge" style="background:${rl.bg};color:${rl.color}">${score} <small>${rl.label}</small></span>`
    : `<span class="score-badge score-empty">—</span>`;

  // Inputs — household vs neighborhood
  let inputsHtml = '';
  if (isNeighborhood) {
    const hh1 = state.hh1Name || 'HH1';
    const hh2 = state.hh2Name || 'HH2';
    inputsHtml = `
      <div class="inputs-grid">
        <div class="input-group-label">${escHtml(hh1)}</div>
        <div class="inputs-row">
          ${buildStepperHtml(hazard.id, 'l', parseInt(entry.l) || 0, 'Likelihood')}
          ${buildStepperHtml(hazard.id, 'i', parseInt(entry.i) || 0, 'Impact')}
          <div class="sub-score" id="sub-score-${hazard.id}-1">
            ${(parseInt(entry.l)||0) * (parseInt(entry.i)||0) > 0
              ? `<span class="mini-score">${(parseInt(entry.l)||0) * (parseInt(entry.i)||0)}</span>`
              : '<span class="mini-score empty">—</span>'}
          </div>
        </div>
        <div class="input-group-label">${escHtml(hh2)}</div>
        <div class="inputs-row">
          ${buildStepperHtml(hazard.id, 'l2', parseInt(entry.l2) || 0, 'Likelihood')}
          ${buildStepperHtml(hazard.id, 'i2', parseInt(entry.i2) || 0, 'Impact')}
          <div class="sub-score" id="sub-score-${hazard.id}-2">
            ${(parseInt(entry.l2)||0) * (parseInt(entry.i2)||0) > 0
              ? `<span class="mini-score">${(parseInt(entry.l2)||0) * (parseInt(entry.i2)||0)}</span>`
              : '<span class="mini-score empty">—</span>'}
          </div>
        </div>
      </div>
    `;
  } else {
    inputsHtml = `
      <div class="inputs-row">
        ${buildStepperHtml(hazard.id, 'l', parseInt(entry.l) || 0, 'Likelihood')}
        ${buildStepperHtml(hazard.id, 'i', parseInt(entry.i) || 0, 'Impact')}
      </div>
    `;
  }

  row.innerHTML = `
    ${customNameHtml}
    <div class="hazard-top">
      <div class="hazard-name-wrap">
        <strong class="hazard-name">${escHtml(displayName)}</strong>
        ${autoScoreBadgeHtml}
        <button class="desc-toggle" onclick="toggleDesc(${hazard.id})" aria-label="Toggle description">
          <i data-feather="info" class="desc-icon"></i>
        </button>
      </div>
      ${scoreBadgeHtml}
    </div>
    <div class="hazard-desc hidden" id="desc-${hazard.id}">
      <em>${escHtml(displayDesc)}</em>
    </div>
    ${inputsHtml}
    <div class="notes-row">
      <textarea class="notes-input" placeholder="Notes (optional)…"
        onchange="updateNotes(${hazard.id}, this.value)"
        oninput="updateNotes(${hazard.id}, this.value)"
        rows="2">${escHtml(entry.notes || '')}</textarea>
    </div>
  `;

  return row;
}

/**
 * Build an inline stepper (−  value  +) for a likelihood/impact field.
 */
function buildStepperHtml(hazardId, field, currentVal, label) {
  return `
    <div class="stepper" data-hazard="${hazardId}" data-field="${field}">
      <label class="stepper-label">${label}</label>
      <div class="stepper-controls">
        <button class="stepper-btn stepper-minus"
          onclick="stepperChange(${hazardId}, '${field}', -1)"
          aria-label="Decrease ${label}">−</button>
        <span class="stepper-value" id="sv-${hazardId}-${field}">${currentVal || '—'}</span>
        <button class="stepper-btn stepper-plus"
          onclick="stepperChange(${hazardId}, '${field}', 1)"
          aria-label="Increase ${label}">+</button>
      </div>
    </div>
  `;
}

/* ---------------------------------------------------------------
   SCORING INTERACTIONS
--------------------------------------------------------------- */

/**
 * Handle stepper button clicks.
 */
function stepperChange(hazardId, field, delta) {
  if (!state.scores[hazardId]) state.scores[hazardId] = {};
  const current = parseInt(state.scores[hazardId][field]) || 0;
  const next = Math.max(0, Math.min(5, current + delta));
  state.scores[hazardId][field] = next;

  // If user manually adjusts the likelihood, clear the auto-score flag
  if ((field === 'l' || field === 'l2') && state.scores[hazardId].isAuto) {
    state.scores[hazardId].isAuto = false;
  }

  // Update the value display
  const sv = document.getElementById(`sv-${hazardId}-${field}`);
  if (sv) sv.textContent = next > 0 ? next : '—';

  // Highlight active stepper value
  updateStepperUI(hazardId, field, next);

  // Recalculate and update row
  updateRowScore(hazardId);
  autoSave();
}

/**
 * Visual feedback on stepper value display.
 */
function updateStepperUI(hazardId, field, val) {
  const sv = document.getElementById(`sv-${hazardId}-${field}`);
  if (!sv) return;
  sv.textContent = val > 0 ? val : '—';
  sv.className = 'stepper-value' + (val > 0 ? ' has-value' : '');
}

/**
 * Update the score badge and sub-scores on a hazard row.
 */
function updateRowScore(hazardId) {
  const row = document.getElementById(`hazard-row-${hazardId}`);
  if (!row) return;

  const score = calcScore(hazardId);
  const rl = score > 0 ? getRiskLevel(score) : null;

  // Sync auto-score badge visibility
  const autoBadge = document.getElementById(`auto-badge-${hazardId}`);
  if (autoBadge) {
    autoBadge.classList.toggle('hidden', !state.scores[hazardId]?.isAuto);
  }

  // Update main score badge
  const badge = row.querySelector('.score-badge');
  if (badge) {
    if (score > 0 && rl) {
      badge.style.background = rl.bg;
      badge.style.color = rl.color;
      badge.innerHTML = `${score} <small>${rl.label}</small>`;
      badge.className = 'score-badge';
    } else {
      badge.style.background = '';
      badge.style.color = '';
      badge.innerHTML = '—';
      badge.className = 'score-badge score-empty';
    }
  }

  // Neighborhood sub-scores
  if (state.assessmentType === 'neighborhood') {
    const e = state.scores[hazardId] || {};
    const s1 = (parseInt(e.l)||0) * (parseInt(e.i)||0);
    const s2 = (parseInt(e.l2)||0) * (parseInt(e.i2)||0);
    const sub1 = document.getElementById(`sub-score-${hazardId}-1`);
    const sub2 = document.getElementById(`sub-score-${hazardId}-2`);
    if (sub1) sub1.innerHTML = s1 > 0 ? `<span class="mini-score">${s1}</span>` : '<span class="mini-score empty">—</span>';
    if (sub2) sub2.innerHTML = s2 > 0 ? `<span class="mini-score">${s2}</span>` : '<span class="mini-score empty">—</span>';
  }

  updateProgress();
  updateCategoryCount(getCategoryForHazard(hazardId));
}

function getCategoryForHazard(hazardId) {
  const h = HAZARD_DATA.find(x => x.id === hazardId);
  return h ? h.category : null;
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
    descEl.innerHTML = `<em>${escHtml(val || 'User-defined custom hazard')}</em>`;
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
  if (el) el.textContent = `${scored} of ${total} hazards scored`;

  // Show float button after 5 scored
  const floatBtn = document.getElementById('float-results-btn');
  if (floatBtn) {
    floatBtn.classList.toggle('hidden', scored < 5);
  }

  // Update all category counts
  const categories = [...new Set(HAZARD_DATA.map(h => h.category))];
  categories.forEach(cat => updateCategoryCount(cat));
}

function updateCategoryCount(catName) {
  if (!catName) return;
  const catHazards = HAZARD_DATA.filter(h => h.category === catName);
  const scored = catHazards.filter(h => {
    if (h.isCustom && !state.customNames[h.id]?.name) return false;
    return isScored(h.id);
  }).length;
  const total = catHazards.filter(h => {
    if (h.isCustom) return !!state.customNames[h.id]?.name;
    return true;
  }).length;

  const el = document.getElementById(`cat-count-${slugify(catName)}`);
  if (el) el.textContent = `${scored} of ${total} scored`;
}

/* ---------------------------------------------------------------
   CATEGORY TOGGLE
--------------------------------------------------------------- */

function toggleCategory(section) {
  const rows = section.querySelector('.category-rows');
  const chevron = section.querySelector('.cat-chevron');
  rows.classList.toggle('collapsed');
  if (chevron) {
    chevron.style.transform = rows.classList.contains('collapsed') ? '' : 'rotate(180deg)';
  }
  if (window.feather) feather.replace();
}

function toggleDesc(hazardId) {
  const el = document.getElementById(`desc-${hazardId}`);
  if (el) el.classList.toggle('hidden');
}

/* ---------------------------------------------------------------
   RESULTS SCREEN
--------------------------------------------------------------- */

function renderResults() {
  // Collect all scored hazards
  const scored = HAZARD_DATA.filter(h => {
    if (h.isCustom && !state.customNames[h.id]?.name) return false;
    return isScored(h.id);
  });

  // Attach score and metadata
  const items = scored.map(h => {
    const score = calcScore(h.id);
    const rl = getRiskLevel(score);
    const displayName = h.isCustom ? (state.customNames[h.id]?.name || `Custom ${h.customIndex}`) : h.name;
    const notes = state.scores[h.id]?.notes || '';
    return { hazard: h, score, rl, displayName, notes };
  });

  // Sort descending
  items.sort((a, b) => b.score - a.score);

  // Summary counts
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  items.forEach(it => { if (it.rl) counts[it.rl.label]++; });

  const summaryEl = document.getElementById('results-summary');
  summaryEl.innerHTML = items.length === 0
    ? '<p class="empty-state">No hazards scored yet. Go to Assessment to begin.</p>'
    : `<div class="summary-chips">
         ${counts.CRITICAL > 0 ? `<span class="chip chip-critical">${counts.CRITICAL} Critical</span>` : ''}
         ${counts.HIGH > 0 ? `<span class="chip chip-high">${counts.HIGH} High</span>` : ''}
         ${counts.MEDIUM > 0 ? `<span class="chip chip-medium">${counts.MEDIUM} Medium</span>` : ''}
         ${counts.LOW > 0 ? `<span class="chip chip-low">${counts.LOW} Low</span>` : ''}
         <span class="chip chip-total">${items.length} total scored</span>
       </div>`;

  // Results list
  const listEl = document.getElementById('results-list');
  if (items.length === 0) {
    listEl.innerHTML = '';
    return;
  }

  const bands = [
    { key: 'CRITICAL', label: 'CRITICAL — Immediate action required', emoji: '🟥' },
    { key: 'HIGH',     label: 'HIGH — Develop a specific action plan', emoji: '🟧' },
    { key: 'MEDIUM',   label: 'MEDIUM — Include in your preparedness planning', emoji: '🟨' },
    { key: 'LOW',      label: 'LOW — Monitor and maintain basic preparedness', emoji: '🟩' },
  ];

  let html = '';
  bands.forEach(band => {
    const bandItems = items.filter(it => it.rl && it.rl.label === band.key);
    if (bandItems.length === 0) return;

    const rl = RISK_LEVELS[band.key];
    html += `
      <div class="result-band" style="border-left:4px solid ${rl.color}">
        <div class="band-header" style="background:${rl.bg};color:${rl.color}">
          ${band.emoji} ${band.label}
        </div>
    `;

    bandItems.forEach(it => {
      const catColor  = CATEGORY_COLORS[it.hazard.category] || '#333';
      const isAuto    = !!(state.scores[it.hazard.id]?.isAuto);
      const sourceTag = isAuto
        ? `<span class="result-source-tag auto">🔍 Auto</span>`
        : `<span class="result-source-tag manual">✏️ Manual</span>`;
      html += `
        <div class="result-card">
          <div class="result-card-top">
            <div class="result-left">
              <span class="result-name">${escHtml(it.displayName)}</span>
              <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;">
                <span class="result-cat-badge" style="background:${catColor}">${escHtml(it.hazard.category)}</span>
                ${sourceTag}
              </div>
            </div>
            <div class="result-score" style="background:${it.rl.bg};color:${it.rl.color}">
              <span class="result-score-num">${it.score}</span>
              <span class="result-score-label">${it.rl.label}</span>
            </div>
          </div>
          ${it.notes ? `<div class="result-notes"><i data-feather="file-text" class="note-icon"></i> ${escHtml(it.notes)}</div>` : ''}
        </div>
      `;
    });

    html += `</div>`;
  });

  listEl.innerHTML = html;
  if (window.feather) feather.replace();
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
    }).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      alert('Results copied to clipboard!');
    }).catch(() => {
      showTextExportDialog(text);
    });
  } else {
    showTextExportDialog(text);
  }
}

function showTextExportDialog(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:10%;left:5%;width:90%;height:70%;z-index:9999;padding:12px;font-size:13px;border:2px solid #E8650A;border-radius:8px;';
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9998;display:flex;align-items:center;justify-content:center;';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Close';
  closeBtn.style.cssText = 'position:fixed;top:6%;right:6%;z-index:10000;background:#E8650A;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:bold;';
  closeBtn.onclick = () => { overlay.remove(); ta.remove(); closeBtn.remove(); };
  document.body.appendChild(overlay);
  document.body.appendChild(ta);
  document.body.appendChild(closeBtn);
  ta.select();
}

function buildTextSummary() {
  const date = state.date || new Date().toISOString().split('T')[0];
  const loc = state.location || 'Not specified';
  const type = state.assessmentType === 'neighborhood' ? 'Neighborhood' : 'Household';

  let out = `WORLD AWARE RISK ASSESSMENT RESULTS\n`;
  out += `beworldaware.com\n`;
  out += `${'='.repeat(40)}\n`;
  out += `Type: ${type}\n`;
  out += `Location: ${loc}\n`;
  out += `Date: ${date}\n`;
  out += `${'='.repeat(40)}\n\n`;

  const scored = HAZARD_DATA.filter(h => {
    if (h.isCustom && !state.customNames[h.id]?.name) return false;
    return isScored(h.id);
  });
  const items = scored.map(h => {
    const score = calcScore(h.id);
    return {
      name: h.isCustom ? (state.customNames[h.id]?.name || '') : h.name,
      score,
      rl: getRiskLevel(score),
      notes: state.scores[h.id]?.notes || '',
      cat: h.category,
    };
  }).sort((a, b) => b.score - a.score);

  const bands = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  bands.forEach(band => {
    const bandItems = items.filter(it => it.rl && it.rl.label === band);
    if (bandItems.length === 0) return;
    out += `\n── ${band} ──\n`;
    bandItems.forEach(it => {
      out += `  [${it.score}] ${it.name}  (${it.cat})\n`;
      if (it.notes) out += `       Notes: ${it.notes}\n`;
    });
  });

  out += `\n${'='.repeat(40)}\n`;
  out += `Generated by World Aware Risk Assessment Tool\n`;
  out += `beworldaware.com\n`;
  return out;
}

/* ---------------------------------------------------------------
   REFERENCE GUIDE — RISK MATRIX
--------------------------------------------------------------- */

function buildRiskMatrix() {
  const tbody = document.getElementById('risk-matrix-body');
  if (!tbody || tbody.children.length > 0) return; // already built

  for (let l = 5; l >= 1; l--) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = l;
    th.className = 'matrix-label';
    tr.appendChild(th);

    for (let i = 1; i <= 5; i++) {
      const score = l * i;
      const rl = getRiskLevel(score);
      const td = document.createElement('td');
      td.textContent = score;
      td.style.background = rl ? rl.bg : '#fff';
      td.style.color = rl ? rl.color : '#333';
      td.className = 'matrix-cell';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

/* ---------------------------------------------------------------
   SAVE / LOAD / EXPORT
--------------------------------------------------------------- */

function saveAssessment() {
  const saves = getSavedAssessments();
  const timestamp = new Date().toISOString();
  const id = 'wa_save_' + Date.now();
  const summary = {
    id,
    timestamp,
    type: state.assessmentType,
    location: state.location || 'Unknown location',
    scored: countScored(),
    state: JSON.parse(JSON.stringify(state)),
  };
  saves[id] = summary;
  localStorage.setItem('wa_saves', JSON.stringify(saves));
  renderSavedList();
  alert(`Assessment saved: ${new Date(timestamp).toLocaleString()}`);
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
  state = save.state;
  autoSave();
  initAssessmentUI();
  showScreen('assessment');
}

function deleteAssessment(id) {
  showConfirm('Delete this saved assessment? This cannot be undone.', () => {
    const saves = getSavedAssessments();
    delete saves[id];
    localStorage.setItem('wa_saves', JSON.stringify(saves));
    renderSavedList();
  });
}

function renderSavedList() {
  const container = document.getElementById('saved-assessments-list');
  const saves = getSavedAssessments();
  const keys = Object.keys(saves);

  if (keys.length === 0) {
    container.innerHTML = '<p class="empty-state">No saved assessments yet.</p>';
    return;
  }

  // Also update home screen saved list
  const homeContainer = document.getElementById('home-saved-items');
  const homeSection = document.getElementById('home-saved-list');

  let html = '';
  keys.sort((a, b) => b.localeCompare(a)).forEach(k => {
    const s = saves[k];
    const d = new Date(s.timestamp);
    html += `
      <div class="saved-item">
        <div class="saved-item-info">
          <strong>${escHtml(s.location)}</strong>
          <span class="saved-meta">${s.type === 'neighborhood' ? 'Neighborhood' : 'Household'} · ${s.scored} hazards · ${d.toLocaleDateString()}</span>
        </div>
        <div class="saved-item-actions">
          <button class="btn-small btn-primary" onclick="loadAssessment('${k}')">Load</button>
          <button class="btn-small btn-danger" onclick="deleteAssessment('${k}')">Delete</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  if (homeContainer && homeSection) {
    homeContainer.innerHTML = html;
    homeSection.classList.toggle('hidden', keys.length === 0);
  }
}

function exportJSON() {
  const data = {
    exportedAt: new Date().toISOString(),
    tool: 'World Aware Risk Assessment',
    version: '1.0',
    assessmentType: state.assessmentType,
    location: state.location,
    date: state.date,
    householdSize: state.householdSize,
    hh1Name: state.hh1Name,
    hh2Name: state.hh2Name,
    scores: state.scores,
    customNames: state.customNames,
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
        riskLevel: getRiskLevel(calcScore(h.id))?.label || '',
        likelihood: state.scores[h.id]?.l || 0,
        impact: state.scores[h.id]?.i || 0,
        notes: state.scores[h.id]?.notes || '',
      }))
      .sort((a, b) => b.score - a.score),
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wa-risk-assessment-${state.date || 'export'}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------
   CLEAR ALL DATA
--------------------------------------------------------------- */

function clearAllData() {
  showConfirm('Clear ALL assessment data and saved assessments? This cannot be undone.', () => {
    localStorage.removeItem('wa_current_state');
    localStorage.removeItem('wa_saves');
    // Reset state
    state = {
      assessmentType: 'household',
      location: '',
      date: new Date().toISOString().split('T')[0],
      householdSize: '',
      hh1Name: 'Household 1',
      hh2Name: 'Household 2',
      scores: {},
      customNames: { 60: { name: '', description: '' }, 61: { name: '', description: '' }, 62: { name: '', description: '' } },
      researchAddress:  '',
      researchReport:   null,
      autoScoreOrigins: {},
    };
    renderSavedList();
    showScreen('home');
    alert('All data cleared.');
  });
}

/* ---------------------------------------------------------------
   CONFIRM DIALOG
--------------------------------------------------------------- */

let _confirmCallback = null;

function showConfirm(message, onConfirm) {
  document.getElementById('confirm-message').textContent = message;
  _confirmCallback = onConfirm;
  document.getElementById('confirm-dialog').classList.remove('hidden');
}

function confirmAction() {
  document.getElementById('confirm-dialog').classList.add('hidden');
  if (_confirmCallback) _confirmCallback();
  _confirmCallback = null;
}

function cancelAction() {
  document.getElementById('confirm-dialog').classList.add('hidden');
  _confirmCallback = null;
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
  });
  document.getElementById('hh2-name').addEventListener('input', e => {
    state.hh2Name = e.target.value || 'Household 2';
    autoSave();
    rebuildHazardInputLabels();
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
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('SW registered:', reg.scope))
      .catch(err => console.warn('SW registration failed:', err));
  });
}

/* ---------------------------------------------------------------
   UTILITY: HTML escape
--------------------------------------------------------------- */

function escHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

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

  // Initialize Feather icons
  if (window.feather) feather.replace();

  // Set default date field
  const dateField = document.getElementById('field-date');
  if (dateField && !dateField.value) {
    dateField.value = state.date || new Date().toISOString().split('T')[0];
  }

  // Handle URL shortcut parameters (from manifest shortcuts)
  const urlParams = new URLSearchParams(window.location.search);
  const startParam = urlParams.get('start');
  if (startParam === 'household' || startParam === 'neighborhood') {
    startAssessment(startParam);
  }

  console.log('World Aware Risk Assessment v1.0 loaded.');
  console.log(`${HAZARD_DATA.length} hazards loaded.`);
});
