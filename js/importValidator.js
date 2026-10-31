/* =============================================================
   WORLD AWARE RISK ASSESSMENT — js/importValidator.js
   Strict validator for JSON files picked on About > Import from JSON.
   No DOM access, so it runs in node tests too (tests/run.js).

   Rules
   - Only the shape exportJSON() writes is accepted. Every key is read
     through an own-property check and copied into a fresh object, so
     unknown keys (including __proto__) are dropped and prototypes are
     never touched.
   - Numbers l, i, l2, i2 must be whole numbers 0 to 5 (or a digit string
     of one). Anything else, such as 9, -1, 2.5 or "x", becomes 0
     (unscored) and is counted in warnings. It is never capped to 5,
     because that would invent a high rating.
   - Strings are trimmed to 500 characters. Hazard notes keep up to 2000
     and report text up to 5000, so a round trip does not cut real work.
   - Anything that is an array or object where a string is expected
     rejects the whole file.
   - The whole file may not exceed 2 MB.
   - results[] in the file is a human-readable summary and is ignored.
   - v3.0.0: score entries may carry na, naAuto, iManual and i2Manual
     (booleans), and the file may carry checklist { hh1: { 1..12: bool },
     hh2: {...} }. Score entries for hazard ids retired in v3
     (RETIRED_HAZARD_IDS in app.js) keep only ratings and notes, so
     normalizeState() can carry the notes onto the hazard that absorbed them
     before dropping the entry. Research findings for retired ids are
     skipped. Both produce a warning, so a v2 export still imports.
   - naAuto is kept only with na on a hazard that arrives ruled out
     (naDefault); na is dropped on custom hazards.
   - A file whose version is 3 or later and has no checklist gets an empty
     one, so it is never migrated as a v2 file.
   ============================================================= */

'use strict';

const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
const IMPORT_STR_MAX   = 500;
const IMPORT_NOTE_MAX  = 2000;
const IMPORT_REPORT_TEXT_MAX = 5000;
const IMPORT_TOOL_NAME = 'World Aware Risk Assessment';

function _impHas(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

function _impIsPlain(v) {
  return Object.prototype.toString.call(v) === '[object Object]';
}

/** Hazard ids the importer accepts: from HAZARD_DATA when loaded, else an explicit list. */
function _impHazardIds(opts) {
  if (opts && Array.isArray(opts.hazardIds)) return opts.hazardIds.map(String);
  if (typeof HAZARD_DATA !== 'undefined' && Array.isArray(HAZARD_DATA)) return HAZARD_DATA.map(h => String(h.id));
  return [];
}

/** Hazard ids that arrive ruled out (naDefault): from HAZARD_DATA when loaded, else an explicit list. */
function _impNaDefaultIds(opts) {
  if (opts && Array.isArray(opts.naDefaultIds)) return opts.naDefaultIds.map(String);
  if (typeof HAZARD_DATA !== 'undefined' && Array.isArray(HAZARD_DATA)) return HAZARD_DATA.filter(h => h.naDefault).map(h => String(h.id));
  return [];
}

/** v2 hazard ids retired in v3: from RETIRED_HAZARD_IDS when loaded, else an explicit list. */
function _impRetiredIds(opts) {
  if (opts && Array.isArray(opts.retiredIds)) return opts.retiredIds.map(String);
  if (typeof RETIRED_HAZARD_IDS !== 'undefined' && Array.isArray(RETIRED_HAZARD_IDS)) return RETIRED_HAZARD_IDS.map(String);
  return [];
}

const IMPORT_CHECKLIST_IDS = 12;

function _impCustomIds(opts) {
  if (opts && Array.isArray(opts.customIds)) return opts.customIds.map(String);
  if (typeof HAZARD_DATA !== 'undefined' && Array.isArray(HAZARD_DATA)) {
    return HAZARD_DATA.filter(h => h.isCustom).map(h => String(h.id));
  }
  return [];
}

/**
 * Parse the text of a picked file. Returns { ok, obj, errors[] }.
 * Rejects anything over 2 MB before parsing.
 */
function parseImportText(text) {
  if (typeof text !== 'string') return { ok: false, obj: null, errors: ['The file could not be read.'] };
  if (text.length > IMPORT_MAX_BYTES) {
    return { ok: false, obj: null, errors: ['This file is larger than 2 MB, so it is not one of our exports.'] };
  }
  try {
    return { ok: true, obj: JSON.parse(text), errors: [] };
  } catch (e) {
    return { ok: false, obj: null, errors: ['This file is not valid JSON.'] };
  }
}

/**
 * Validate a parsed export. Returns
 *   { ok, state, edits, errors[], warnings[] }
 * state is a whitelisted partial state (the app merges it with normalizeState);
 * edits is the report-edits object for state.assessmentId, or null.
 */
function validateImport(obj, opts) {
  const errors = [];
  const warnings = [];
  const fail = () => ({ ok: false, state: null, edits: null, errors, warnings });

  // Size: measure the data itself, so a giant string anywhere is caught.
  let size = 0;
  try { size = JSON.stringify(obj).length; } catch (e) { errors.push('This file could not be read.'); return fail(); }
  if (size > IMPORT_MAX_BYTES) { errors.push('This file is larger than 2 MB, so it is not one of our exports.'); return fail(); }

  if (!_impIsPlain(obj)) { errors.push('This file is not a World Aware assessment export.'); return fail(); }
  if (!_impHas(obj, 'tool') || obj.tool !== IMPORT_TOOL_NAME) {
    errors.push('This file is not a World Aware assessment export.');
    return fail();
  }

  const hazardIds = new Set(_impHazardIds(opts));
  const customIds = new Set(_impCustomIds(opts));
  const retiredIds = new Set(_impRetiredIds(opts));
  const naDefaultIds = new Set(_impNaDefaultIds(opts));
  const idOk = k => /^\d{1,2}$/.test(k) && hazardIds.has(String(parseInt(k, 10))) && String(parseInt(k, 10)) === k;

  /** Read an optional string field. Returns undefined when absent. */
  function str(src, key, label, max) {
    if (!_impHas(src, key) || src[key] === null || src[key] === undefined) return undefined;
    const v = src[key];
    if (typeof v !== 'string') { errors.push(`"${label}" must be text.`); return undefined; }
    const limit = max || IMPORT_STR_MAX;
    if (v.length > limit) { warnings.push(`"${label}" was shortened to ${limit} characters.`); return v.slice(0, limit); }
    return v;
  }

  function bool(src, key, label) {
    if (!_impHas(src, key) || src[key] === null || src[key] === undefined) return undefined;
    if (typeof src[key] !== 'boolean') { errors.push(`"${label}" must be true or false.`); return undefined; }
    return src[key];
  }

  let badNumbers = 0;
  function rating(v) {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 5) return v;
    if (typeof v === 'string' && /^[0-5]$/.test(v)) return parseInt(v, 10);
    badNumbers++;
    return 0;
  }

  const st = {};

  // assessmentType (required)
  if (obj.assessmentType !== 'household' && obj.assessmentType !== 'neighborhood') {
    errors.push('The assessment type must be household or neighborhood.');
  } else {
    st.assessmentType = obj.assessmentType;
  }

  // assessmentId (optional; older exports do not have one)
  if (_impHas(obj, 'assessmentId') && obj.assessmentId !== null && obj.assessmentId !== undefined) {
    if (typeof obj.assessmentId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(obj.assessmentId)) {
      st.assessmentId = obj.assessmentId;
    } else {
      errors.push('The assessment id is not valid.');
    }
  }

  // Plain header fields
  ['location', 'householdSize', 'hh1Name', 'hh2Name'].forEach(k => {
    const v = str(obj, k, k);
    if (v !== undefined) st[k] = v;
  });
  const date = str(obj, 'date', 'date');
  if (date !== undefined) {
    if (date === '' || /^\d{4}-\d{2}-\d{2}$/.test(date)) st.date = date;
    else errors.push('The date must look like 2026-10-26.');
  }

  // scores (required)
  if (!_impHas(obj, 'scores') || !_impIsPlain(obj.scores)) {
    errors.push('"scores" is missing or is not the right shape.');
  } else {
    st.scores = {};
    let dropped = 0, retired = 0, flagsDropped = 0;
    Object.keys(obj.scores).forEach(k => {
      const isRetired = retiredIds.has(k);
      if (!isRetired && !idOk(k)) { dropped++; return; }
      const e = obj.scores[k];
      if (!_impIsPlain(e)) { errors.push(`The score for hazard ${k} is not the right shape.`); return; }
      const out = {};
      ['l', 'i', 'l2', 'i2'].forEach(f => { if (_impHas(e, f)) out[f] = rating(e[f]); });
      const notes = str(e, 'notes', `notes for hazard ${k}`, IMPORT_NOTE_MAX);
      if (notes !== undefined) out.notes = notes;
      if (isRetired) { retired++; st.scores[k] = out; return; }   // normalizeState carries the notes, then drops it
      ['isAuto', 'isEstimate', 'na', 'naAuto', 'iManual', 'i2Manual'].forEach(f => {
        const b = bool(e, f, `${f} for hazard ${k}`);
        if (b !== undefined) out[f] = b;
      });
      if ('na' in out && customIds.has(k)) { delete out.na; delete out.naAuto; flagsDropped++; }
      if ('naAuto' in out && !(out.naAuto === true && out.na === true && naDefaultIds.has(k))) { delete out.naAuto; flagsDropped++; }
      st.scores[k] = out;
    });
    if (dropped) warnings.push(`${dropped} unknown hazard entr${dropped === 1 ? 'y was' : 'ies were'} skipped.`);
    if (retired) warnings.push(`${retired} hazard entr${retired === 1 ? 'y was' : 'ies were'} for hazards merged or moved to the household checklist in v3. Their notes move to the hazard that absorbed them.`);
    if (flagsDropped) warnings.push(`${flagsDropped} "Does not apply here" mark${flagsDropped === 1 ? ' was' : 's were'} removed because ${flagsDropped === 1 ? 'it does' : 'they do'} not fit that hazard.`);
  }

  // checklist (v3.0.0, optional): { hh1: { "1".."12": true|false }, hh2: {...} }
  if (_impHas(obj, 'checklist') && obj.checklist !== null && obj.checklist !== undefined) {
    const cl = obj.checklist;
    if (!_impIsPlain(cl)) {
      errors.push('"checklist" is not the right shape.');
    } else {
      const out = { hh1: {}, hh2: {} };
      const extra = Object.keys(cl).filter(k => k !== 'hh1' && k !== 'hh2');
      if (extra.length) warnings.push(`The checklist had ${extra.length} unknown part${extra.length === 1 ? '' : 's'}, which ${extra.length === 1 ? 'was' : 'were'} skipped.`);
      ['hh1', 'hh2'].forEach(hh => {
        if (!_impHas(cl, hh) || cl[hh] === null || cl[hh] === undefined) return;
        if (!_impIsPlain(cl[hh])) { errors.push(`The checklist for ${hh} is not the right shape.`); return; }
        Object.keys(cl[hh]).forEach(k => {
          const n = parseInt(k, 10);
          if (!/^\d{1,2}$/.test(k) || String(n) !== k || n < 1 || n > IMPORT_CHECKLIST_IDS) {
            errors.push(`The checklist has an unknown item "${k.slice(0, 20)}".`);
            return;
          }
          if (typeof cl[hh][k] !== 'boolean') { errors.push(`Checklist item ${k} must be true or false.`); return; }
          if (cl[hh][k]) out[hh][k] = true;
        });
      });
      st.checklist = out;
    }
  } else if (_impHas(obj, 'version') && typeof obj.version === 'string' && parseInt(obj.version, 10) >= 3) {
    // A v3 (or later) file without a checklist is not a v2 file: no migration
    st.checklist = { hh1: {}, hh2: {} };
  }

  // customNames
  if (_impHas(obj, 'customNames') && obj.customNames !== null && obj.customNames !== undefined) {
    if (!_impIsPlain(obj.customNames)) {
      errors.push('"customNames" is not the right shape.');
    } else {
      st.customNames = {};
      Object.keys(obj.customNames).forEach(k => {
        if (!customIds.has(k)) return;
        const c = obj.customNames[k];
        if (!_impIsPlain(c)) { errors.push(`The custom hazard ${k} is not the right shape.`); return; }
        const out = {};
        const n = str(c, 'name', `custom hazard ${k} name`);
        const d = str(c, 'description', `custom hazard ${k} description`);
        out.name = n === undefined ? '' : n;
        out.description = d === undefined ? '' : d;
        st.customNames[k] = out;
      });
    }
  }

  // researchAddress
  const ra = str(obj, 'researchAddress', 'researchAddress');
  if (ra !== undefined) st.researchAddress = ra;

  // researchReport: null or { geocoded, findings[], timestamp }
  if (_impHas(obj, 'researchReport')) {
    const rr = obj.researchReport;
    if (rr === null || rr === undefined) {
      st.researchReport = null;
    } else if (!_impIsPlain(rr) || !_impIsPlain(rr.geocoded) || !Array.isArray(rr.findings)) {
      errors.push('The research report is not the right shape.');
    } else if (rr.findings.length > 100) {
      errors.push('The research report has too many findings.');
    } else {
      const g = rr.geocoded;
      const geo = {};
      ['lat', 'lng'].forEach(k => {
        if (!_impHas(g, k) || g[k] === null || g[k] === undefined) return;
        const lim = k === 'lat' ? 90 : 180;
        if (typeof g[k] === 'number' && isFinite(g[k]) && Math.abs(g[k]) <= lim) geo[k] = g[k];
        else errors.push(`The research location "${k}" is not a valid coordinate.`);
      });
      const digits = (k, re) => {
        const v = str(g, k, `research ${k}`);
        if (v === undefined) return;
        if (re.test(v)) geo[k] = v; else errors.push(`The research "${k}" is not valid.`);
      };
      digits('zip', /^\d{0,5}$/);
      digits('stateAbbr', /^[A-Za-z]{0,2}$/);
      digits('stateFips', /^\d{0,2}$/);
      digits('countyFips', /^\d{0,3}$/);
      digits('fips5', /^\d{0,5}$/);
      ['county', 'city', 'displayAddress'].forEach(k => {
        const v = str(g, k, `research ${k}`);
        if (v !== undefined) geo[k] = v;
      });

      const findings = [];
      let retiredFindings = 0;
      rr.findings.forEach((f, idx) => {
        if (!_impIsPlain(f)) { errors.push(`Research finding ${idx + 1} is not the right shape.`); return; }
        const hid = _impHas(f, 'hazardId') ? f.hazardId : null;
        if (typeof hid === 'number' && Number.isInteger(hid) && retiredIds.has(String(hid))) { retiredFindings++; return; }
        if (typeof hid !== 'number' || !Number.isInteger(hid) || !idOk(String(hid))) {
          errors.push(`Research finding ${idx + 1} points to an unknown hazard.`);
          return;
        }
        const out = { hazardId: hid };
        ['hazardName', 'category', 'source', 'finding', 'confidence'].forEach(k => {
          const v = str(f, k, `research finding ${idx + 1} ${k}`);
          if (v !== undefined) out[k] = v;
        });
        if (_impHas(f, 'scoreAssigned')) {
          const s = f.scoreAssigned;
          out.scoreAssigned = (s === null || s === undefined) ? null : rating(s);
        }
        if (_impHas(f, 'status')) {
          if (f.status === 'success' || f.status === 'estimated' || f.status === 'error') out.status = f.status;
          else errors.push(`Research finding ${idx + 1} has an unknown status.`);
        }
        const ov = bool(f, 'isOverridden', `isOverridden for finding ${idx + 1}`);
        if (ov !== undefined) out.isOverridden = ov;
        // This value becomes a link on screen, so only the FEMA map site is allowed.
        if (_impHas(f, 'femaMapUrl') && f.femaMapUrl !== null && f.femaMapUrl !== undefined) {
          if (typeof f.femaMapUrl === 'string' && f.femaMapUrl.length <= IMPORT_STR_MAX &&
              /^https:\/\/msc\.fema\.gov\/[^\s"'<>]*$/.test(f.femaMapUrl)) {
            out.femaMapUrl = f.femaMapUrl;
          } else {
            out.femaMapUrl = null;
            warnings.push('A FEMA map link was removed because it did not look right.');
          }
        } else if (_impHas(f, 'femaMapUrl')) {
          out.femaMapUrl = null;
        }
        findings.push(out);
      });

      if (retiredFindings) warnings.push(`${retiredFindings} research finding${retiredFindings === 1 ? ' was' : 's were'} for hazards merged in v3 and ${retiredFindings === 1 ? 'was' : 'were'} skipped.`);
      const report = { geocoded: geo, findings };
      const ts = str(rr, 'timestamp', 'research timestamp');
      if (ts !== undefined) report.timestamp = ts;
      st.researchReport = report;
    }
  }

  // autoScoreOrigins: { hazardId: { source, finding, confidence, status } }
  if (_impHas(obj, 'autoScoreOrigins') && obj.autoScoreOrigins !== null && obj.autoScoreOrigins !== undefined) {
    if (!_impIsPlain(obj.autoScoreOrigins)) {
      errors.push('"autoScoreOrigins" is not the right shape.');
    } else {
      st.autoScoreOrigins = {};
      Object.keys(obj.autoScoreOrigins).forEach(k => {
        if (!idOk(k)) return;
        const o = obj.autoScoreOrigins[k];
        if (!_impIsPlain(o)) { errors.push(`The research source for hazard ${k} is not the right shape.`); return; }
        const out = {};
        ['source', 'finding', 'confidence'].forEach(f => {
          const v = str(o, f, `research ${f} for hazard ${k}`);
          if (v !== undefined) out[f] = v;
        });
        if (_impHas(o, 'status')) {
          if (o.status === 'success' || o.status === 'estimated' || o.status === 'error') out.status = o.status;
          else errors.push(`The research status for hazard ${k} is not valid.`);
        }
        st.autoScoreOrigins[k] = out;
      });
    }
  }

  // reportEdits: { title, preparedFor, summary, actions, notes: { hazardId: text } }
  let edits = null;
  if (_impHas(obj, 'reportEdits') && obj.reportEdits !== null && obj.reportEdits !== undefined) {
    const re = obj.reportEdits;
    if (!_impIsPlain(re)) {
      errors.push('"reportEdits" is not the right shape.');
    } else {
      const out = {};
      [['title', IMPORT_STR_MAX], ['preparedFor', IMPORT_STR_MAX],
       ['summary', IMPORT_REPORT_TEXT_MAX], ['actions', IMPORT_REPORT_TEXT_MAX]].forEach(([k, max]) => {
        const v = str(re, k, `report ${k}`, max);
        if (v !== undefined) out[k] = v;
      });
      out.notes = {};
      if (_impHas(re, 'notes') && re.notes !== null && re.notes !== undefined) {
        if (!_impIsPlain(re.notes)) {
          errors.push('The report notes are not the right shape.');
        } else {
          Object.keys(re.notes).forEach(k => {
            if (!idOk(k)) return;
            const v = re.notes[k];
            if (typeof v !== 'string') { errors.push(`The report note for hazard ${k} must be text.`); return; }
            out.notes[k] = v.length > IMPORT_REPORT_TEXT_MAX ? v.slice(0, IMPORT_REPORT_TEXT_MAX) : v;
          });
        }
      }
      edits = out;
    }
  }

  if (badNumbers) warnings.push(`${badNumbers} rating${badNumbers === 1 ? ' was' : 's were'} outside 0 to 5 and set to unscored.`);

  if (errors.length) return fail();
  return { ok: true, state: st, edits, errors, warnings };
}
