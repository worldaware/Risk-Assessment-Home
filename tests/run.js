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

console.log('buildShareText');
{
  const gs = loadSandbox(['js/shareText.js']);
  const f = gs.buildShareText;
  const item = (name, score, level) => ({ name, score, level });
  const base = {
    typeKey: 'household', location: '1234 Pearl St, Boulder, CO 80302', dateDisplay: 'October 26, 2026',
    research: { county: 'Boulder County' },
    scored: [item('Wildfire', 20, 'CRITICAL'), item('Flood', 16, 'CRITICAL'), item('Winter storm', 12, 'HIGH'), item('Power outage', 8, 'MEDIUM')],
  };
  const lines = t => t.split('\n');
  const boulder = f(base, {});
  const bl = lines(boulder);
  check('Boulder: first line has name, street, city and date, no house number',
    bl[0] === 'Our household: hazard check, Pearl St, Boulder, (October 26, 2026)', bl[0]);
  check('Boulder: scoring explanation on line 2', bl[1].startsWith('Each hazard is scored out of 25'));
  check('Boulder: critical line lists names and scores', bl[2] === 'Act on these in the next 30 days: Wildfire, score 20; Flood, score 16.', bl[2]);
  check('Boulder: high line', bl[3] === 'Write down a plan for these this season: Winter storm, score 12.', bl[3]);
  check('Boulder: BOCO Alert line', boulder.includes('bocoalert.org') && boulder.includes('Genasys Protect'));
  check('Boulder: moderate hazards are not listed', !boulder.includes('Power outage'));
  check('Boulder: ends with the beworldaware.com line', bl[bl.length - 1].endsWith('beworldaware.com'));
  check('line count <= 8 (full case)', bl.length <= 8, String(bl.length));
  check('no box-drawing characters', !/[═─]/.test(boulder) && !/[─-╿]/.test(boulder));
  check('no ALL CAPS banner lines', bl.every(l => !/^[^a-z]*[A-Z]{4,}[^a-z]*$/.test(l)));

  const other = f({ ...base, location: '88 Main Street, Fort Collins, CO', research: { county: 'Larimer County' } }, {});
  check('non-Boulder: generic alerts line', other.includes("sign up for your county's emergency alerts and learn two ways out") && !other.includes('bocoalert'));
  check('non-Boulder: location street and city', lines(other)[0] === 'Our household: hazard check, Main Street, Fort Collins, (October 26, 2026)', lines(other)[0]);
  const countyOnly = f({ ...base, location: '5 Elm Rd, Lyons', research: { county: 'Boulder County' } }, {});
  check('Boulder county alone triggers the BOCO line', countyOnly.includes('bocoalert.org'));

  const nb = f({ ...base, typeKey: 'neighborhood' }, {});
  check('neighborhood default name', nb.startsWith('Our neighborhood: hazard check'));
  const named = f(base, { preparedFor: 'The Rivera family' });
  check('prepared-for name replaces the default', named.startsWith('The Rivera family: hazard check'));

  const mid = f({ ...base, scored: [item('Heat wave', 8, 'MEDIUM'), item('Drought', 4, 'LOW')] }, {});
  check('no high/critical: highest line', mid.includes('Nothing scored high or critical. Highest: Heat wave, score 8 out of 25.'), mid);
  check('no high/critical: no action lines', !mid.includes('Act on these') && !mid.includes('Write down a plan'));

  const empty = f({ typeKey: 'household', location: '', dateDisplay: '', research: null, scored: [] }, {});
  check('empty: says no hazards scored yet', lines(empty).includes('No hazards scored yet.'));
  check('empty: first line has no stray commas', lines(empty)[0] === 'Our household: hazard check', lines(empty)[0]);
  check('empty: line count <= 8', lines(empty).length <= 8);
  check('empty: no crash on missing input', typeof f(undefined, undefined) === 'string');

  const strip = gs.stripHouseNumber;
  check('strips 1234', strip('1234 Pearl St') === 'Pearl St');
  check('strips 12B', strip('12B Oak Ave') === 'Oak Ave');
  check('strips 1234 with extra spaces', strip('  1234   Pearl St') === 'Pearl St');
  check('strips 12-14', strip('12-14 Oak Ave') === 'Oak Ave');
  check('keeps street names that start with a word', strip('Pearl St') === 'Pearl St');
  check('keeps ordinal street names', strip('4th Street') === '4th Street' && strip('12th St') === '12th St', strip('4th Street'));

  const many = Array.from({ length: 12 }, (_, i) => item('Hazard ' + i, 20 - i % 3, 'CRITICAL'));
  const long = f({ ...base, scored: many }, {});
  check('long lists are capped and say how many more', long.includes('; and 7 more.'), long);
  check('line count <= 8 (long list)', lines(long).length <= 8);
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
