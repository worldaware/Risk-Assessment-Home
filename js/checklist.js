/* =============================================================
   WORLD AWARE RISK ASSESSMENT — js/checklist.js
   Household checklist (v3.0.0). Twelve yes/no questions about the
   household set the impact of each core hazard, so people rate
   likelihood and only change the impacts that look wrong.

   Loaded before app.js. Nothing here touches the DOM or app state
   at load time, so tests/run.js can run the pure functions in node.
   HAZARD_DATA, state and the row helpers live in app.js and are
   only read when a function is called.
   ============================================================= */

'use strict';

// Hazard ids: 1 wildfire, 2 earthquake, 3 river flood, 4 flash flood, 5 hail,
// 6 tornado, 8 winter storm, 9 extreme heat, 10 drought, 11 landslide,
// 15 chemical spill, 17 gas leak, 22 disease outbreak, 23 smoke, 24 power
// outage, 27 water outage, 36 road closed, 63 high wind.
const CHECKLIST_DATA = [
  { id: 1,  raises: [24, 8, 9, 1, 63],
    text: 'Someone uses a medical device that needs power (oxygen, CPAP, powered wheelchair, refrigerated medicine).' },
  { id: 2,  raises: [1, 4, 3, 15, 17, 36, 11, 6],
    text: 'Someone takes a daily medicine or gets regular treatment (dialysis, infusions) they can\'t skip.' },
  { id: 3,  raises: [1, 4, 15, 17, 36],
    text: 'Someone at home depends on others: young children, or an adult who would need help to leave quickly.' },
  { id: 4,  raises: [1, 4, 36, 23, 22],
    text: 'Pets, horses or livestock.' },
  { id: 5,  raises: [1, 4, 15, 36],
    text: 'No car, or not enough seats to get everyone out in one trip.' },
  { id: 6,  raises: [1, 4, 11, 8, 36],
    text: 'One road in and out of your neighborhood.' },
  { id: 7,  raises: [24, 10, 4, 3],
    text: 'Private well or septic system.' },
  { id: 8,  raises: [24, 8, 17],
    text: 'Heat depends on electricity or delivered fuel (gas furnace with an electric fan, propane, pellets).' },
  { id: 9,  raises: [24, 8, 22, 36],
    text: 'Work or income depends on home internet, or on getting to a workplace.' },
  { id: 10, raises: [1, 4, 15],
    text: 'Your only way to get emergency alerts is a cell phone, or no one in the house is signed up for county alerts.' },
  { id: 11, raises: [24, 27, 8, 22],
    text: 'Less than two weeks of water, food and cash in the house.' },
  { id: 12, raises: [1, 5, 63, 2, 3],
    text: 'You rent, your home is insured for less than a full rebuild, or the house has known structural problems.' },
];

// A household with a powered medical device (item 1) never gets less than
// impact 4 for power outage, winter cold or extreme heat.
const CHECKLIST_MEDICAL_ITEM = 1;
const CHECKLIST_MEDICAL_FLOOR = 4;
const CHECKLIST_MEDICAL_FLOOR_IDS = [24, 8, 9];

const CHECKLIST_HOUSEHOLDS = ['hh1', 'hh2'];

/** Empty checklist state: { hh1: {}, hh2: {} }. */
function emptyChecklist() {
  return { hh1: {}, hh2: {} };
}

/**
 * Clean a checklist read from storage or an import: only ids 1 to 12 that
 * are true are kept, under hh1 and hh2.
 */
function normalizeChecklist(raw) {
  const out = emptyChecklist();
  if (!raw || typeof raw !== 'object') return out;
  CHECKLIST_HOUSEHOLDS.forEach(hh => {
    const src = raw[hh];
    if (!src || typeof src !== 'object') return;
    CHECKLIST_DATA.forEach(item => {
      if (Object.prototype.hasOwnProperty.call(src, String(item.id)) && src[item.id] === true) out[hh][item.id] = true;
    });
  });
  return out;
}

/** The ticked items for one household ('hh1' or 'hh2'). */
function _checklistFor(hh, checklist) {
  const all = checklist || ((typeof state !== 'undefined' && state && state.checklist) || emptyChecklist());
  const key = (hh === 2 || hh === 'hh2') ? 'hh2' : 'hh1';
  return all[key] || {};
}

/** Number of items ticked for one household. */
function checklistCount(hh, checklist) {
  const c = _checklistFor(hh, checklist);
  return CHECKLIST_DATA.filter(item => c[item.id] === true).length;
}

/**
 * Impact for a core hazard from the household checklist:
 * baseImpact plus one for each ticked item that raises it, capped at 5,
 * with a floor of 4 for power, cold and heat when item 1 is ticked.
 * Returns null for less common and custom hazards (rated by hand).
 * @param {number} hazardId
 * @param {'hh1'|'hh2'} hh
 * @param {object} [checklist]  defaults to state.checklist
 */
function computeImpact(hazardId, hh, checklist) {
  const id = parseInt(hazardId, 10);
  const h = (typeof HAZARD_DATA !== 'undefined') ? HAZARD_DATA.find(x => x.id === id) : null;
  if (!h || h.group !== 'core' || !(h.baseImpact > 0)) return null;
  const ticked = _checklistFor(hh, checklist);
  let impact = h.baseImpact;
  CHECKLIST_DATA.forEach(item => {
    if (ticked[item.id] === true && item.raises.indexOf(id) !== -1) impact++;
  });
  impact = Math.min(5, impact);
  if (ticked[CHECKLIST_MEDICAL_ITEM] === true && CHECKLIST_MEDICAL_FLOOR_IDS.indexOf(id) !== -1) {
    impact = Math.max(CHECKLIST_MEDICAL_FLOOR, impact);
  }
  return impact;
}

/**
 * Write checklist impacts into st.scores (default: the app state) for every
 * core hazard and both households, except impacts the user set by hand
 * (iManual for household 1, i2Manual for household 2).
 * Returns the ids whose impact changed.
 */
function applyChecklistImpacts(st) {
  const s = st || (typeof state !== 'undefined' ? state : null);
  if (!s || typeof HAZARD_DATA === 'undefined') return [];
  if (!s.scores) s.scores = {};
  const changed = [];
  HAZARD_DATA.forEach(h => {
    if (h.group !== 'core') return;
    const e = s.scores[h.id] || (s.scores[h.id] = {});
    let moved = false;
    if (e.iManual !== true) {
      const v = computeImpact(h.id, 'hh1', s.checklist);
      if (e.i !== v) { e.i = v; moved = true; }
    }
    if (e.i2Manual !== true) {
      const v = computeImpact(h.id, 'hh2', s.checklist);
      if (e.i2 !== v) { e.i2 = v; moved = true; }
    }
    if (moved) changed.push(h.id);
  });
  return changed;
}

/** True while this impact still comes from the checklist (core hazards only). */
function isImpactFromChecklist(hazardId, field) {
  const h = (typeof HAZARD_DATA !== 'undefined') ? HAZARD_DATA.find(x => x.id === parseInt(hazardId, 10)) : null;
  if (!h || h.group !== 'core') return false;
  const e = (typeof state !== 'undefined' && state.scores && state.scores[h.id]) || {};
  return field === 'i2' ? e.i2Manual !== true : e.iManual !== true;
}

/* ---------------------------------------------------------------
   UI: "About your household" card on the Assess screen
   (called from buildHazardList in app.js)
--------------------------------------------------------------- */

/** Header count, e.g. "3 ticked" or "The Smiths 3, Next door 1". */
function checklistCountText() {
  const n1 = checklistCount('hh1');
  if (state.assessmentType !== 'neighborhood') return n1 ? `${n1} of ${CHECKLIST_DATA.length} ticked` : 'Nothing ticked yet';
  const n2 = checklistCount('hh2');
  return `${state.hh1Name || 'Household 1'} ${n1}, ${state.hh2Name || 'Household 2'} ${n2} ticked`;
}

/** Rows of checkboxes (one column, or two in neighborhood mode). */
function buildChecklistHtml() {
  const isNb = state.assessmentType === 'neighborhood';
  const hhs = isNb ? ['hh1', 'hh2'] : ['hh1'];
  const name = hh => hh === 'hh2' ? (state.hh2Name || 'Household 2') : (state.hh1Name || 'Household 1');
  const head = isNb
    ? `<div class="checklist-head" aria-hidden="true"><span></span>${hhs.map(hh => `<span class="checklist-hh-label" data-hh="${hh}">${escHtml(name(hh))}</span>`).join('')}</div>`
    : '';
  const rows = CHECKLIST_DATA.map(item => {
    const boxes = hhs.map(hh => {
      const id = `chk-${hh}-${item.id}`;
      const on = _checklistFor(hh)[item.id] === true;
      const aria = isNb ? ` aria-label="${escHtml(name(hh))}: ${escHtml(item.text)}"` : '';
      return `<span class="checklist-box"><input type="checkbox" id="${id}" data-hh="${hh}" data-item="${item.id}"${on ? ' checked' : ''}${aria}
        onchange="toggleChecklistItem('${hh}', ${item.id}, this.checked)" /></span>`;
    }).join('');
    const labelFor = isNb ? '' : ` for="chk-hh1-${item.id}"`;
    return `<div class="checklist-row${isNb ? ' is-two' : ''}">
        <label class="checklist-text"${labelFor}>${escHtml(item.text)}</label>${boxes}
      </div>`;
  }).join('');
  return `<p class="group-intro">Tick anything that's true for your household. We use these to set how hard each hazard would hit you, and you can change any of them later.</p>
    <div class="checklist${isNb ? ' is-two' : ''}">${head}${rows}</div>`;
}

/** A checkbox changed: store it, recompute impacts, refresh the core rows. */
function toggleChecklistItem(hh, itemId, checked) {
  const key = hh === 'hh2' ? 'hh2' : 'hh1';
  if (!state.checklist) state.checklist = emptyChecklist();
  if (!state.checklist[key]) state.checklist[key] = {};
  if (checked) state.checklist[key][itemId] = true;
  else delete state.checklist[key][itemId];
  applyChecklistImpacts();
  HAZARD_DATA.forEach(h => { if (h.group === 'core' && typeof updateRowScore === 'function') updateRowScore(h.id); });
  const count = document.getElementById('cat-count-household');
  if (count) count.textContent = checklistCountText();
  if (typeof autoSave === 'function') autoSave();
}

/** Keep the two column labels in step with the household name fields. */
function refreshChecklistLabels() {
  document.querySelectorAll('.checklist-hh-label').forEach(el => {
    el.textContent = el.dataset.hh === 'hh2' ? (state.hh2Name || 'Household 2') : (state.hh1Name || 'Household 1');
  });
  const count = document.getElementById('cat-count-household');
  if (count) count.textContent = checklistCountText();
}
