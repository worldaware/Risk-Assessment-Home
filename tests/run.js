#!/usr/bin/env node
/* =============================================================
   Minimal test harness for the pure functions in js/scoreMapper.js
   and a few helpers in js/research.js. No dependencies.
   Run:  node tests/run.js
   ============================================================= */
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');

/** Load browser-style scripts into one sandbox and return its globals. */
function loadSandbox(files) {
  const ctx = {
    console,
    window: {}, document: { getElementById: () => null, querySelector: () => null, addEventListener: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    setTimeout, clearTimeout, URL, Number, String, Math, Date, Array, Object, JSON, RegExp, Error, Promise,
    fetch: () => Promise.reject(new Error('no network in tests')),
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else      { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const g = loadSandbox(['js/apiConfig.js', 'js/scoreMapper.js', 'js/research.js']);

console.log('mapFloodZoneToScore');
{
  const f = g.mapFloodZoneToScore;
  check('Zone AE scores 5', f('AE', '').score === 5);
  check('Zone A scores 5', f('A', '').score === 5);
  check('Zone A12 scores 5', f('A12', '').score === 5);
  check('Zone VE scores 5', f('VE', '').score === 5);
  check('Zone X with 0.2 PCT subtype scores 3 (500-year floodplain)', f('X', '0.2 PCT ANNUAL CHANCE FLOOD HAZARD').score === 3);
  check('Zone X with levee subtype scores 3', f('X', 'AREA WITH REDUCED FLOOD RISK DUE TO LEVEE').score === 3);
  check('Zone X minimal scores 2', f('X', 'AREA OF MINIMAL FLOOD HAZARD').score === 2);
  check('Zone X with no subtype scores 2', f('X', '').score === 2);
  check('Zone C scores 2', f('C', '').score === 2);
  check('Zone D scores 2', f('D', '').score === 2);
  check('AREA NOT INCLUDED is no-data, not score 5', f('AREA NOT INCLUDED', '').score === null, JSON.stringify(f('AREA NOT INCLUDED', '')));
  check('OPEN WATER is no-data', f('OPEN WATER', '').score === null);
  check('Empty zone is no-data', f('', '').score === null);
  check('Unknown zone is no-data', f('ZZ', '').score === null);
}

console.log('mapLandslideToScore');
{
  const f = g.mapLandslideToScore;
  check('numeric 4 scores 4', f(4).score === 4);
  check('string "4" scores 4', f('4').score === 4, JSON.stringify(f('4')));
  check('"High" scores 4', f('High').score === 4);
  check('"Very High" scores 5', f('Very High').score === 5);
}

console.log('mapPGAToScore');
{
  const f = g.mapPGAToScore;
  check('Boulder pgam 0.14 maps to 3', f(0.14).score === 3, JSON.stringify(f(0.14)));
}

console.log('_mostRecentTuesdayStr (local dates, published-Thursday rule)');
{
  const f = g._mostRecentTuesdayStr;
  // Saturday 2026-10-24 20:00 local: last published Tuesday is 2026-10-20
  check('Saturday evening -> previous Tuesday', f(new Date(2026, 9, 24, 20, 0)) === '2026-10-20', f(new Date(2026, 9, 24, 20, 0)));
  // Tuesday 2026-10-20 evening: this week\'s map is not out yet -> 2026-10-13
  check('Tuesday evening -> Tuesday one week back', f(new Date(2026, 9, 20, 20, 0)) === '2026-10-13', f(new Date(2026, 9, 20, 20, 0)));
  // Wednesday: still not published -> previous week
  check('Wednesday -> Tuesday one week back', f(new Date(2026, 9, 21, 9, 0)) === '2026-10-13', f(new Date(2026, 9, 21, 9, 0)));
  // Thursday: published -> this week\'s Tuesday
  check('Thursday -> this week Tuesday', f(new Date(2026, 9, 22, 9, 0)) === '2026-10-20', f(new Date(2026, 9, 22, 9, 0)));
}

console.log('_coarse');
{
  check('rounds to 4 decimals', g._coarse(39.9999701) === 40 && g._coarse(-105.283278) === -105.2833);
}

console.log('Nominatim state key');
{
  const src = fs.readFileSync(path.join(ROOT, 'js/research.js'), 'utf8');
  check('reads ISO3166-2-lvl4 (hyphens)', src.includes("['ISO3166-2-lvl4']"));
  check('does not read ISO3166_2_lvl4 (underscores)', !src.includes('ISO3166_2_lvl4'));
  check('earthquake reads pgam', src.includes('pgam'));
  check('flood requests ZONE_SUBTY', src.includes('outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF'));
  check('no "Colorado default applied" path', !src.includes('Colorado default applied'));
  check('no custom User-Agent header', !src.includes("'User-Agent'"));
  const cfg = fs.readFileSync(path.join(ROOT, 'js/apiConfig.js'), 'utf8');
  check('EPA query uses the zip_code column', cfg.includes('TRI_FACILITY/zip_code') && !cfg.includes('TRI_FACILITY/FACILITY_ZIP'));
}

console.log('Service worker');
{
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  check('does not cache cross-origin responses', /if \(url\.origin !== self\.location\.origin\) return;/.test(sw));
  check('only deletes wa-risk-* caches', sw.includes("name.startsWith('wa-risk-')"));
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const appVer = (app.match(/const APP_VERSION = '([^']+)'/) || [])[1];
  const swVer  = (sw.match(/const CACHE_NAME = 'wa-risk-v([^']+)'/) || [])[1];
  check(`APP_VERSION (${appVer}) matches CACHE_NAME (${swVer})`, appVer && appVer === swVer);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('About shows the same version', html.includes(`Risk Assessment v${appVer}`));
}

console.log('buildDefaultActions');
{
  const a = loadSandbox(['js/actions.js']);
  const hz = (id, name, level, score) => ({ id, name, level, score });
  const boulder = {
    location: '1234 Sunshine Canyon Dr, Boulder, CO 80302', householdSize: '3',
    scored: [hz(1, 'Wildfire', 'CRITICAL', 20)],
  };
  const bl = a.buildDefaultActions(boulder);
  check('Boulder: has a BOCO Alert line', bl.some(l => l.includes('BOCO Alert') && l.includes('www.BOCOAlert.org')), bl.join(' / '));
  check('Boulder: has a Wildfire Partners line', bl.some(l => l.includes('Wildfire Partners')));
  check('Boulder: mentions Genasys Protect', bl.some(l => l.includes('Genasys Protect')));
  check('Boulder: starts with this week', /^This week:/.test(bl[0]));
  check('Boulder: insurance line mentions the Marshall Fire', bl.some(l => /^Before your insurance renews:/.test(l) && l.includes('Marshall Fire')));

  const researched = {
    location: '', scored: [hz(1, 'Wildfire', 'HIGH', 12)],
    research: { county: 'Boulder County', stateAbbr: 'CO', timestamp: '2026-10-20T15:00:00Z' },
  };
  check('Boulder County from research data', a.buildDefaultActions(researched).some(l => l.includes('BOCO Alert')));

  const denver = { location: '100 Main St, Denver, CO 80202', scored: [hz(1, 'Wildfire', 'CRITICAL', 20)] };
  const dl = a.buildDefaultActions(denver);
  check('Non-Boulder: generic alert line', dl.some(l => /^This week: sign up for your county's emergency alert system/.test(l)), dl.join(' / '));
  check('Non-Boulder: no BOCO Alert, Genasys or Wildfire Partners', !dl.some(l => /BOCO|Genasys|Wildfire Partners|Xcel/.test(l)));
  check('Boulder City NV is not Boulder County', !a.buildDefaultActions({ location: 'Boulder City, NV 89005', scored: [] }).some(l => l.includes('BOCO')));

  const many = { location: 'Boulder, CO', scored: [1, 2, 3, 5, 8, 9, 10, 15, 44, 24].map((id, i) => hz(id, 'Hazard ' + id, 'CRITICAL', 25 - i)) };
  const ml = a.buildDefaultActions(many);
  check('Cap of 10 lines holds with many Critical hazards', ml.length === 10, String(ml.length));
  check('Highest-scoring hazard gets the first hazard line', ml[5] && ml[5].startsWith('Hazard 1:'), ml[5]);
  check('Low and Moderate hazards add no lines', a.buildDefaultActions({ location: 'Denver, CO', scored: [hz(1, 'Wildfire', 'MEDIUM', 8), hz(2, 'Earthquake', 'LOW', 3)] }).length === 5);
  check('Nothing scored still gives the base steps', a.buildDefaultActions({ scored: [] }).length === 5);

  const all = [bl, dl, ml, a.buildDefaultActions(researched)].reduce((x, y) => x.concat(y), []);
  check('No line contains "!"', !all.some(l => l.includes('!')));
  check('No em-dash asides', !all.some(l => l.includes('—') || / -- /.test(l)));
  check('Hazard lines keep proper nouns capitalized', !all.some(l => /: (xcel|fema|boco)/.test(l)));
  check('Every line is a non-empty string', all.every(l => typeof l === 'string' && l.trim().length > 0));
}

console.log('Walk-through CTA and booking link');
{
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  check('BOOKING_URL is defined', /const BOOKING_URL = 'https:\/\/[^']+';/.test(app));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('actions.js loads before report.js', html.indexOf('js/actions.js') > -1 && html.indexOf('js/actions.js') < html.indexOf('js/report.js'));
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  check('actions.js is in the app shell', sw.includes("'./js/actions.js'"));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
