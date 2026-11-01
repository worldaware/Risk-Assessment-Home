#!/usr/bin/env node
/* =============================================================
   scripts/build-data.js
   Builds the two static data files the app reads for radon (64) and
   long power outages (24):

     data/radon-zones.json       county -> EPA radon zone (1, 2 or 3)
     data/power-reliability.json county -> utilities with their SAIDI

   Run by .github/workflows/data-refresh.yml once a year. Node 20, no
   dependencies. Reading the EIA spreadsheets (.xlsx) needs the "xlsx"
   package, which the workflow installs with `npm install xlsx@0.18.5
   --no-save`; the app itself has no dependencies. CSV input needs nothing.

   Usage:
     node scripts/build-data.js [--out data] [--year 2025]
       [--radon-file <json>]            use a local copy of the EPA file
       [--eia-zip <zip>]...             use local EIA-861 zips (repeatable)
       [--eia-dir <dir>]...             use folders of already-extracted EIA files (repeatable)
       [--fips-file <txt>]              Census county code list (national_county.txt)
       [--history-years 5]              how many EIA-861 years to download and read
       [--only radon|power]
       [--built YYYY-MM-DD]             stamp to use (default today)
       [--min-radon N] [--min-power-counties N]   sanity floors (defaults 3000 and 1500)

   Without --radon-file, --eia-zip and --eia-dir the script downloads the
   sources. With them it never touches the network, which is how
   tests/run.js exercises it on the files in tests/fixtures/.
   ============================================================= */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RADON_URL = 'https://www.epa.gov/system/files/other-files/2024-06/radon-zones-202406.json';
const eiaZipUrl = year => `https://www.eia.gov/electricity/data/eia861/zip/f861${year}.zip`;
const FIPS_URL = 'https://www2.census.gov/geo/docs/reference/codes/files/national_county.txt';
const UA = 'worldaware-data-refresh (https://github.com/worldaware/Risk-Assessment-Home)';
const MAX_SAIDI = 100000;   // minutes a year; anything above is a reporting error (69 days)

/* ---------------------------------------------------------------
   Arguments
--------------------------------------------------------------- */
const REPEATABLE = new Set(['eia-zip', 'eia-dir']);

function parseArgs(argv) {
  const o = { out: 'data', year: 2025, historyYears: 5, only: '', built: '', minRadon: 3000, minPowerCounties: 1500,
              radonFile: '', eiaZip: [], eiaDir: [], fipsFile: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    const name = a.slice(2);
    const val = argv[++i];
    if (val === undefined || val.startsWith('--')) throw new Error(`Missing value for ${a}`);
    switch (name) {
      case 'out': o.out = val; break;
      case 'year': o.year = parseInt(val, 10); break;
      case 'history-years': o.historyYears = parseInt(val, 10); break;
      case 'only': o.only = val; break;
      case 'built': o.built = val; break;
      case 'min-radon': o.minRadon = parseInt(val, 10); break;
      case 'min-power-counties': o.minPowerCounties = parseInt(val, 10); break;
      case 'radon-file': o.radonFile = val; break;
      case 'fips-file': o.fipsFile = val; break;
      default:
        if (REPEATABLE.has(name)) { o[name === 'eia-zip' ? 'eiaZip' : 'eiaDir'].push(val); break; }
        throw new Error(`Unknown option: ${a}`);
    }
  }
  if (!(o.year >= 2013 && o.year <= 2100)) throw new Error('--year must be a four-digit year');
  if (!(o.historyYears >= 1 && o.historyYears <= 15)) throw new Error('--history-years must be 1 to 15');
  if (o.only && o.only !== 'radon' && o.only !== 'power') throw new Error('--only is radon or power');
  if (o.built && !/^\d{4}-\d{2}-\d{2}$/.test(o.built)) throw new Error('--built is YYYY-MM-DD');
  return o;
}

/* ---------------------------------------------------------------
   Small utilities
--------------------------------------------------------------- */
async function download(url, destFile) {
  const resp = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  fs.writeFileSync(destFile, Buffer.from(await resp.arrayBuffer()));
}

/** RFC 4180 style CSV into an array of rows. Handles quotes, CRLF and a leading BOM. */
function parseCsv(text, delim) {
  delim = delim || ',';
  const rows = [];
  let row = [], field = '', inQ = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(x => x !== '')) rows.push(row);
  return rows;
}

/** Every sheet of a spreadsheet or CSV file as arrays of rows. */
function readSheets(file) {
  if (/\.csv$/i.test(file)) return [parseCsv(fs.readFileSync(file, 'utf8'))];
  let XLSX;
  try { XLSX = require('xlsx'); } catch (e) {
    throw new Error(`Reading ${path.basename(file)} needs the xlsx package: npm install xlsx@0.18.5 --no-save`);
  }
  const wb = XLSX.readFile(file);
  return wb.SheetNames.map(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, raw: true }));
}

function walk(dir, out) {
  out = out || [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  });
  return out;
}

/** County name for matching: no punctuation, "Saint" as "St", optionally without County/Parish/Borough. */
function countyKey(name, keepSuffix) {
  let n = String(name || '').toLowerCase().replace(/[.'’]/g, '').replace(/\bsaint\b/g, 'st').replace(/\s+/g, ' ').trim();
  if (!keepSuffix) n = n.replace(/\s+(county|parish|borough|census area|municipality|city and borough)$/, '');
  return n;
}

const median = a => {
  const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round1 = n => Math.round(n * 10) / 10;

/* ---------------------------------------------------------------
   JSON output: header fields inline, maps one entry per line (readable diffs)
--------------------------------------------------------------- */
function stringifyData(obj) {
  const parts = Object.keys(obj).map(k => {
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 0) return `  ${JSON.stringify(k)}: {}`;
      return `  ${JSON.stringify(k)}: {\n${keys.map(kk => `    ${JSON.stringify(kk)}: ${JSON.stringify(v[kk])}`).join(',\n')}\n  }`;
    }
    return `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
  });
  return `{\n${parts.join(',\n')}\n}\n`;
}

/** Write the file, keeping the old "built" date when nothing else changed, so a re-run is not a diff. */
function writeData(file, payload, builtDate) {
  let built = builtDate;
  try {
    const old = JSON.parse(fs.readFileSync(file, 'utf8'));
    const strip = o => JSON.stringify(Object.assign({}, o, { built: '' }));
    if (old && old.built && strip(old) === strip(payload)) built = old.built;
  } catch (e) { /* no earlier file */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stringifyData(Object.assign({}, payload, { built })));
}

/* ---------------------------------------------------------------
   Radon
--------------------------------------------------------------- */

/**
 * EPA radon zones { data: [ { "County,State": "Boulder, CO", Zone: "1", ... } ] }
 * into { built, source, zones: { "Boulder, CO": 1 } }.
 */
function buildRadon(raw, opts) {
  opts = opts || {};
  const rows = raw && Array.isArray(raw.data) ? raw.data : null;
  if (!rows) throw new Error('Radon file has no "data" array');
  const zones = {};
  let skipped = 0;
  rows.forEach(r => {
    const key = String((r && (r['County,State'] || r['County, State'])) || '').replace(/\s+/g, ' ').trim();
    const zone = parseInt(r && r.Zone, 10);
    if (!/^.+, [A-Z]{2}$/.test(key) || ![1, 2, 3].includes(zone)) { skipped++; return; }
    zones[key] = zone;
  });
  const sorted = {};
  Object.keys(zones).sort().forEach(k => { sorted[k] = zones[k]; });
  const n = Object.keys(sorted).length;
  const min = opts.minRadon === undefined ? 3000 : opts.minRadon;
  if (n < min) throw new Error(`Only ${n} radon zone rows were usable (expected at least ${min}); the file layout may have changed`);
  return { payload: { built: '', source: RADON_URL, zones: sorted }, count: n, skipped };
}

/* ---------------------------------------------------------------
   EIA-861 sheets
--------------------------------------------------------------- */

/** Header cells of a sheet as { index of the header row, first data row, column text[] }, or null. */
function findHeader(rows, mustHave) {
  for (let h = 0; h < Math.min(rows.length, 20); h++) {
    const cells = (rows[h] || []).map(c => String(c === null || c === undefined ? '' : c).toLowerCase());
    if (!cells.some(c => /utility\s*(number|id|code)/.test(c))) continue;
    const un = cells.findIndex(c => /utility\s*(number|id|code)/.test(c));
    let d = h + 1;
    while (d < rows.length && !/^\d+$/.test(String((rows[d] || [])[un] === null || (rows[d] || [])[un] === undefined ? '' : rows[d][un]).trim())) d++;
    if (d >= rows.length) continue;
    // Header text of a column joins the rows from two above the "Utility Number" row to the first data row
    const width = Math.max(...rows.slice(Math.max(0, h - 2), d).map(r => (r || []).length));
    const text = [];
    for (let c = 0; c < width; c++) {
      const bits = [];
      for (let r = Math.max(0, h - 2); r < d; r++) {
        const v = (rows[r] || [])[c];
        if (v !== null && v !== undefined && String(v).trim() !== '') bits.push(String(v).replace(/\s+/g, ' ').trim().toLowerCase());
      }
      text.push(bits.join(' | '));
    }
    if (mustHave && !mustHave(text)) continue;
    return { header: h, first: d, text };
  }
  return null;
}

const tokenIs = (t, name) => t.split(' | ').some(x => x === name);

/** Reliability rows: { util, name, state, year, saidi, customers }. SAIDI with major event days, in minutes. */
function parseReliability(rows) {
  const H = findHeader(rows, t => t.some(x => /saidi/.test(x)));
  if (!H) return [];
  const T = H.text;
  const col = test => T.findIndex(test);
  const iUtil = col(t => /utility\s*(number|id|code)/.test(t));
  const iName = col(t => /utility name/.test(t));
  const iState = col(t => tokenIs(t, 'state'));
  const iYear = col(t => tokenIs(t, 'data year') || tokenIs(t, 'year'));
  const iCust = col(t => /customers/.test(t) && !/saifi|caidi|saidi/.test(t));
  // SAIDI including major event days, in sheet order: the IEEE 1366 block comes before the "other standard" block,
  // and a utility fills in one of them
  const ordered = T.map((t, i) => ({ t, i })).filter(({ t }) => /saidi/.test(t) && !/without|w\/o|excl|\bwo\b/.test(t) && /\bwith\b|incl|\bmed\b|major/.test(t));
  if (iUtil < 0 || iState < 0 || iYear < 0 || ordered.length === 0) return [];
  const out = [];
  for (let r = H.first; r < rows.length; r++) {
    const row = rows[r] || [];
    const util = String(row[iUtil] === null || row[iUtil] === undefined ? '' : row[iUtil]).trim();
    const year = parseInt(row[iYear], 10);
    const state = String(row[iState] || '').trim().toUpperCase();
    if (!/^\d+$/.test(util) || !(year >= 2000) || !/^[A-Z]{2}$/.test(state)) continue;
    let saidi = null;
    for (const { i } of ordered) {
      const v = parseFloat(String(row[i] === null || row[i] === undefined ? '' : row[i]).replace(/,/g, ''));
      if (isFinite(v)) { saidi = v; break; }
    }
    if (saidi === null || !(saidi > 0) || saidi >= MAX_SAIDI) continue;
    const customers = iCust >= 0 ? parseFloat(String(row[iCust] === null || row[iCust] === undefined ? '' : row[iCust]).replace(/,/g, '')) : NaN;
    out.push({ util, name: iName >= 0 ? String(row[iName] || '').trim() : '', state, year, saidi, customers: isFinite(customers) ? customers : 0 });
  }
  return out;
}

/** Service territory rows: { util, name, state, county, fips, year }. */
function parseTerritory(rows) {
  const H = findHeader(rows, t => t.some(x => tokenIs(x, 'county')));
  if (!H) return [];
  const T = H.text;
  const col = test => T.findIndex(test);
  const iUtil = col(t => /utility\s*(number|id|code)/.test(t));
  const iName = col(t => /utility name/.test(t));
  const iState = col(t => tokenIs(t, 'state'));
  const iCounty = col(t => tokenIs(t, 'county'));
  const iYear = col(t => tokenIs(t, 'data year') || tokenIs(t, 'year'));
  const iFips = col(t => /fips/.test(t));
  if (iUtil < 0 || iState < 0 || iCounty < 0) return [];
  const out = [];
  for (let r = H.first; r < rows.length; r++) {
    const row = rows[r] || [];
    const util = String(row[iUtil] === null || row[iUtil] === undefined ? '' : row[iUtil]).trim();
    const state = String(row[iState] || '').trim().toUpperCase();
    const county = String(row[iCounty] || '').trim();
    if (!/^\d+$/.test(util) || !/^[A-Z]{2}$/.test(state) || !county) continue;
    let fips = '';
    if (iFips >= 0) {
      const f = String(row[iFips] === null || row[iFips] === undefined ? '' : row[iFips]).replace(/\.0+$/, '').trim();
      if (/^\d{1,5}$/.test(f)) fips = f.padStart(5, '0');
    }
    out.push({ util, name: iName >= 0 ? String(row[iName] || '').trim() : '', state, county, fips, year: iYear >= 0 ? parseInt(row[iYear], 10) || 0 : 0 });
  }
  return out;
}

/** Census county code list (national_county.txt, comma or pipe separated) into a state+name -> 5-digit FIPS lookup. */
function buildCountyIndex(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim());
  const delim = lines[0] && lines[0].includes('|') ? '|' : ',';
  const full = new Map(), stripped = new Map();
  parseCsv(lines.join('\n'), delim).forEach(c => {
    // STATE,STATEFP,COUNTYFP,COUNTYNAME,CLASSFP  or  STATE|STATEFP|COUNTYFP|COUNTYNS|COUNTYNAME|...
    const st = String(c[0] || '').trim().toUpperCase();
    const sfp = String(c[1] || '').trim(), cfp = String(c[2] || '').trim();
    const name = String(delim === '|' ? c[4] : c[3] || '').trim();
    if (!/^[A-Z]{2}$/.test(st) || !/^\d{2}$/.test(sfp) || !/^\d{3}$/.test(cfp) || !name) return;
    const fips = sfp + cfp;
    full.set(`${st}|${countyKey(name, true)}`, fips);
    // "Baltimore" matches Baltimore County; the independent city keeps its "city" and matches only "Baltimore City"
    const k = `${st}|${countyKey(name)}`;
    if (!stripped.has(k)) stripped.set(k, fips);
  });
  return {
    size: full.size,
    lookup(state, county) {
      const f = full.get(`${state}|${countyKey(county, true)}`);
      if (f) return f;
      return stripped.get(`${state}|${countyKey(county)}`) || '';
    },
  };
}

/* ---------------------------------------------------------------
   Power reliability
--------------------------------------------------------------- */

/**
 * reliability: rows from parseReliability, territory: rows from parseTerritory,
 * countyIndex: from buildCountyIndex (used when the territory rows carry no FIPS).
 * Returns { payload, counts }.
 */
function buildPower(reliability, territory, countyIndex, opts) {
  opts = opts || {};
  const history = opts.historyYears || 5;

  // One value per utility, state and year (the first file listed wins on a repeat)
  const byUS = new Map();    // "util|state" -> Map(year -> row)
  reliability.forEach(r => {
    const k = `${r.util}|${r.state}`;
    if (!byUS.has(k)) byUS.set(k, new Map());
    if (!byUS.get(k).has(r.year)) byUS.get(k).set(r.year, r);
  });
  if (byUS.size === 0) throw new Error('No reliability rows with a SAIDI value were found');

  // Median SAIDI over the last `history` reported years for each utility and state
  const stats = new Map();
  byUS.forEach((years, k) => {
    const used = Array.from(years.keys()).sort((a, b) => b - a).slice(0, history).sort((a, b) => a - b);
    const vals = used.map(y => years.get(y).saidi);
    const latest = years.get(used[used.length - 1]);
    stats.set(k, { saidi: round1(median(vals)), years: [used[0], used[used.length - 1]], customers: latest.customers || 0, name: latest.name });
  });
  const byUtil = new Map();   // util -> stat with the most customers, for utilities listed under another state
  stats.forEach((s, k) => {
    const u = k.split('|')[0];
    if (!byUtil.has(u) || s.customers > byUtil.get(u).customers) byUtil.set(u, s);
  });

  // Territory: the latest year in the file only
  const terrYear = Math.max(0, ...territory.map(t => t.year));
  const terr = terrYear ? territory.filter(t => t.year === terrYear) : territory;
  const byCounty = {};
  let unmatched = 0, noSaidi = 0;
  const unmatchedNames = new Set();
  const seen = new Set();
  terr.forEach(t => {
    const fips = t.fips || (countyIndex ? countyIndex.lookup(t.state, t.county) : '');
    if (!fips) { unmatched++; unmatchedNames.add(`${t.county}, ${t.state}`); return; }
    const s = stats.get(`${t.util}|${t.state}`) || byUtil.get(t.util);
    if (!s) { noSaidi++; return; }
    const dedupe = `${fips}|${t.util}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    (byCounty[fips] = byCounty[fips] || []).push({ utility: t.name || s.name || `Utility ${t.util}`, saidi: s.saidi, years: s.years });
  });
  Object.keys(byCounty).forEach(f => byCounty[f].sort((a, b) => b.saidi - a.saidi || a.utility.localeCompare(b.utility)));
  const sortedCounty = {};
  Object.keys(byCounty).sort().forEach(f => { sortedCounty[f] = byCounty[f]; });

  // State figure: mean of the state's utility medians weighted by customers (plain median when no counts)
  const perState = {};
  stats.forEach((s, k) => { const st = k.split('|')[1]; (perState[st] = perState[st] || []).push(s); });
  const byState = {};
  Object.keys(perState).sort().forEach(st => {
    const list = perState[st], weighted = list.filter(s => s.customers > 0);
    byState[st] = weighted.length
      ? round1(weighted.reduce((a, s) => a + s.saidi * s.customers, 0) / weighted.reduce((a, s) => a + s.customers, 0))
      : round1(median(list.map(s => s.saidi)));
  });

  const allYears = [];
  stats.forEach(s => allYears.push(s.years[0], s.years[1]));
  const yearRange = [Math.min(...allYears), Math.max(...allYears)];
  const counties = Object.keys(sortedCounty).length;
  const min = opts.minPowerCounties === undefined ? 1500 : opts.minPowerCounties;
  if (counties < min) throw new Error(`Only ${counties} counties got a utility with a SAIDI value (expected at least ${min}); the file layout may have changed`);
  if (terr.length > 0 && unmatched / terr.length > 0.1) {
    throw new Error(`${unmatched} of ${terr.length} territory rows have no county code (${Array.from(unmatchedNames).slice(0, 5).join('; ')}); the county names may have changed`);
  }
  return {
    payload: {
      built: '', source: opts.source || eiaZipUrl(opts.year || 2025), year: yearRange[1], yearRange,
      stateMethod: 'customer-weighted mean of utility medians; plain median where no customer counts',
      byCounty: sortedCounty, byState,
    },
    counts: { counties, utilities: stats.size, states: Object.keys(byState).length, unmatched, noSaidi, territoryRows: terr.length },
  };
}

/** Reliability and territory rows from every EIA folder. */
function readEia(dirs) {
  const reliability = [], territory = [];
  dirs.forEach(dir => {
    walk(dir).forEach(f => {
      const base = path.basename(f);
      if (base.startsWith('~$') || !/\.(xlsx|xls|csv)$/i.test(base)) return;
      if (/reliab/i.test(base)) readSheets(f).forEach(rows => reliability.push(...parseReliability(rows)));
      else if (/service[_ ]?territory/i.test(base)) readSheets(f).forEach(rows => territory.push(...parseTerritory(rows)));
    });
  });
  return { reliability, territory };
}

/* ---------------------------------------------------------------
   Main
--------------------------------------------------------------- */
function unzipTo(zip, dir) {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('unzip', ['-oq', zip, '-d', dir], { stdio: 'inherit' });
}

async function main(argv) {
  const o = parseArgs(argv);
  const built = o.built || new Date().toISOString().slice(0, 10);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-data-'));
  const failures = [];
  try {
    if (o.only !== 'power') {
      try {
        let raw;
        if (o.radonFile) raw = JSON.parse(fs.readFileSync(o.radonFile, 'utf8'));
        else {
          const f = path.join(tmp, 'radon.json');
          await download(RADON_URL, f);
          raw = JSON.parse(fs.readFileSync(f, 'utf8'));
        }
        const r = buildRadon(raw, { minRadon: o.minRadon });
        writeData(path.join(o.out, 'radon-zones.json'), r.payload, built);
        console.log(`radon-zones.json: ${r.count} counties${r.skipped ? `, ${r.skipped} rows skipped` : ''}`);
      } catch (e) { failures.push(`radon: ${e.message}`); console.error(`radon failed: ${e.message}`); }
    }
    if (o.only !== 'radon') {
      try {
        const dirs = o.eiaDir.slice();
        o.eiaZip.forEach((z, i) => { const d = path.join(tmp, `eia-zip-${i}`); unzipTo(z, d); dirs.push(d); });
        if (dirs.length === 0) {
          // Newest first, so a year repeated in two files keeps the newest figure
          for (let y = o.year; y > o.year - o.historyYears; y--) {
            const z = path.join(tmp, `f861${y}.zip`);
            try { await download(eiaZipUrl(y), z); } catch (e) {
              if (y === o.year) throw e;
              console.warn(`EIA-861 ${y} not downloaded (${e.message}); continuing with the years that are`);
              continue;
            }
            const d = path.join(tmp, `eia-${y}`); unzipTo(z, d); dirs.push(d);
          }
        }
        let countyIndex = null;
        let text = '';
        if (o.fipsFile) text = fs.readFileSync(o.fipsFile, 'utf8');
        const { reliability, territory } = readEia(dirs);
        if (territory.length > 0 && territory.some(t => !t.fips)) {
          if (!text) {
            const f = path.join(tmp, 'national_county.txt');
            await download(FIPS_URL, f);
            text = fs.readFileSync(f, 'utf8');
          }
          countyIndex = buildCountyIndex(text);
        }
        const p = buildPower(reliability, territory, countyIndex,
          { historyYears: o.historyYears, minPowerCounties: o.minPowerCounties, year: o.year });
        writeData(path.join(o.out, 'power-reliability.json'), p.payload, built);
        console.log(`power-reliability.json: ${p.counts.counties} counties, ${p.counts.utilities} utility-state pairs, ${p.counts.states} states, ` +
          `${p.counts.unmatched} territory rows without a county code, ${p.counts.noSaidi} without a SAIDI value`);
      } catch (e) { failures.push(`power: ${e.message}`); console.error(`power failed: ${e.message}`); }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (failures.length > 0) throw new Error(failures.join(' | '));
}

module.exports = {
  parseArgs, parseCsv, countyKey, stringifyData, buildRadon, findHeader, parseReliability, parseTerritory,
  buildCountyIndex, buildPower, readEia, main,
};

if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    // The usage text is the comment at the top of this file
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 28).join('\n'));
    process.exit(0);
  }
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
}
