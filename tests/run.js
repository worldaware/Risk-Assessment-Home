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

console.log('mapWHPToScore (WHP 2023 classes)');
{
  const f = g.mapWHPToScore;
  check('class 5 scores 5 (Very High)', f('', 5).score === 5 && /Very High/.test(f('', 5).finding));
  check('class "4" scores 4', f('', '4').score === 4);
  check('class 1 scores 1', f('', 1).score === 1);
  check('class 6 non-burnable scores 1', f('', 6).score === 1 && /Non-burnable/.test(f('', 6).finding));
  check('class 7 water scores 1', f('', 7).score === 1 && /Water/.test(f('', 7).finding));
}

console.log('NRI county flood frequency');
{
  const f = g._mapNRIFloodFrequency;
  check('frequent flooding capped at 3, Low confidence', f(12.5, 'Boulder').score === 3 && f(12.5, 'Boulder').confidence === 'Low');
  check('finding says county-wide', /county-wide/.test(f(0.5, '').finding));
  check('rare flooding scores 1', f(0.01, '').score === 1);
  check('missing value is null', f(undefined, '') === null);
  check('reads IFLD or RFLD in either case', g._pickField({ rfld_afreq: 2 }, ['IFLD_AFREQ', 'RFLD_AFREQ']) === 2 &&
                                            g._pickField({ IFLD_AFREQ: 3, RFLD_AFREQ: 1 }, ['IFLD_AFREQ', 'RFLD_AFREQ']) === 3);
}

console.log('Relay wiring');
{
  const cfg = fs.readFileSync(path.join(ROOT, 'js/apiConfig.js'), 'utf8');
  check('apiConfig defines RELAY_URL', typeof vm.runInContext('API_CONFIG.RELAY_URL', g) === 'string');
  check('apiConfig has no CORS_PROXIES', !cfg.includes('CORS_PROXIES'));
  const jsDir = path.join(ROOT, 'js');
  const offenders = fs.readdirSync(jsDir).filter(n => n.endsWith('.js'))
    .filter(n => /allorigins|corsproxy|codetabs/i.test(fs.readFileSync(path.join(jsDir, n), 'utf8')));
  check('no allorigins/corsproxy/codetabs left in js/', offenders.length === 0, offenders.join(', '));
  const src = fs.readFileSync(path.join(ROOT, 'js/research.js'), 'utf8');
  check('relayFetch exists and proxyFetch is an alias', /async function relayFetch\(/.test(src) && /return relayFetch\(url\)/.test(src));
  check('relay keeps referrerPolicy no-referrer', /referrerPolicy: 'no-referrer'/.test(src));
  check('flood Method C (envelope) removed', !src.includes('esriGeometryEnvelope'));
  check('flood gets the 5-digit FIPS', src.includes("_callFloodAPI(lat, lng, fips5)"));
  check('wildfire uses WHP 2023 classified image service (GeoPlatform copy)', cfg.includes('imagery.geoplatform.gov/iipp/rest/services/Fire_Aviation/USFS_EDW_RMRS_WildfireHazardPotentialClassified/ImageServer/identify'));
  check('flood tries the Esri NFHL copy first, direct', cfg.includes('USA_Flood_Hazard_Areas_view/FeatureServer/0/query') && src.includes('Method 0'));
  check('flood: Esri spelling "0.2 Percent" scores moderate', g.mapFloodZoneToScore('X', '0.2 Percent Annual Chance Flood Hazard').score === 3);
  check('drought uses usdmdataservices county statistics', cfg.includes('usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent'));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('privacy text names no third-party relays', !/allorigins|corsproxy|codetabs/i.test(html));
}

async function asyncChecks() {
  console.log('relayFetch with RELAY_URL empty');
  {
    let err = null;
    const cfg = vm.runInContext('API_CONFIG', g);
    const saved = cfg.RELAY_URL;
    cfg.RELAY_URL = '';
    try { await g.relayFetch('https://earthquake.usgs.gov/x'); } catch (e) { err = e; }
    cfg.RELAY_URL = saved;
    check('throws RELAY_NOT_CONFIGURED', err && err.code === 'RELAY_NOT_CONFIGURED' && /Relay not configured/.test(err.message));
  }

  console.log('relay/worker.js');
  {
    const { execFileSync } = require('child_process');
    let ok = true;
    try { execFileSync(process.execPath, ['--check', path.join(ROOT, 'relay/worker.js')], { stdio: 'pipe' }); } catch (_) { ok = false; }
    check('node --check relay/worker.js', ok);

    const w = await import(require('url').pathToFileURL(path.join(ROOT, 'relay/worker.js')).href);
    const t = w.isAllowedTarget;
    check('allows USGS designmaps', t('https://earthquake.usgs.gov/ws/designmaps/nehrp-2020.json?latitude=40&longitude=-105'));
    check('allows FEMA NFHL', t('https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query'));
    check('allows USFS WHP image service', t('https://apps.fs.usda.gov/fsgisx01/rest/services/RDW_Wildfire/RMRS_WildfireHazardPotential_Classified_2023/ImageServer/identify'));
    check('allows Drought Monitor API', t('https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent?aoi=08013'));
    check('rejects other hosts', !t('https://example.com/'));
    check('rejects look-alike suffix host', !t('https://earthquake.usgs.gov.evil.example/'));
    check('rejects subdomain of allowed host', !t('https://x.hazards.fema.gov/'));
    check('rejects http', !t('http://earthquake.usgs.gov/'));
    check('rejects credentials in URL', !t('https://user:pw@earthquake.usgs.gov/'));
    check('rejects odd port', !t('https://earthquake.usgs.gov:8443/'));
    check('rejects garbage', !t('not a url') && !t(''));

    const o = w.isAllowedOrigin;
    check('origin: GitHub Pages allowed', o('https://worldaware.github.io'));
    check('origin: risk.beworldaware.com allowed', o('https://risk.beworldaware.com'));
    check('origin: Netlify deploy preview allowed', o('https://deploy-preview-12--illustrious-capybara-0ad110.netlify.app'));
    check('origin: other Netlify site rejected', !o('https://deploy-preview-12--someone-else.netlify.app'));
    check('origin: other site rejected', !o('https://evil.example'));

    // Request handling with a stubbed upstream fetch
    const realFetch = globalThis.fetch;
    let seen = null;
    globalThis.fetch = async (url, init) => {
      seen = { url, init };
      return new Response('{"ok":1}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      const target = 'https://earthquake.usgs.gov/ws/designmaps/nehrp-2020.json?latitude=40';
      const req = (u, init) => new Request('https://relay.test/?url=' + encodeURIComponent(u), init);
      const ORIGIN = 'https://worldaware.github.io';

      let r = await w.handleRequest(req(target, { headers: { Origin: ORIGIN, Referer: 'https://worldaware.github.io/x' } }));
      check('GET allowed target: 200 with ACAO for our origin', r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === ORIGIN);
      check('passes upstream body and content type', (await r.text()) === '{"ok":1}' && /application\/json/.test(r.headers.get('Content-Type')));
      check('Cache-Control public, max-age=3600', r.headers.get('Cache-Control') === 'public, max-age=3600');
      check('upstream Accept prefers application/json', seen && /^application\/json/.test(seen.init.headers.Accept));
      check('upstream gets the relay User-Agent', seen && /WorldAwareRiskRelay/.test(seen.init.headers['User-Agent'] || ''));
      check('upstream gets no Referer', seen && !('Referer' in seen.init.headers) && !('referer' in seen.init.headers));
      check('upstream URL is the decoded target', seen && seen.url === target);

      seen = null;
      r = await w.handleRequest(req('https://example.com/', { headers: { Origin: ORIGIN } }));
      check('disallowed target: 403, no upstream call', r.status === 403 && seen === null);

      r = await w.handleRequest(req(target, { headers: { Origin: 'https://evil.example' } }));
      check('disallowed origin: 403', r.status === 403);

      r = await w.handleRequest(req(target, { method: 'OPTIONS', headers: { Origin: ORIGIN } }));
      check('OPTIONS preflight: 204 with ACAO', r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === ORIGIN);

      r = await w.handleRequest(req(target, { method: 'POST', headers: { Origin: ORIGIN }, body: 'x' }));
      check('POST: 405', r.status === 405);

      r = await w.handleRequest(new Request('https://relay.test/'));
      check('missing url: 400', r.status === 400);

      globalThis.fetch = async () => new Response('', { status: 302, headers: { Location: 'https://example.com/' } });
      r = await w.handleRequest(req(target, { headers: { Origin: ORIGIN } }));
      check('redirect to a disallowed host: 403', r.status === 403);

      check('rate limit trips after 60 a minute', (() => {
        let tripped = false;
        for (let i = 0; i < 61; i++) tripped = w.overRateLimit('203.0.113.9', 1000);
        return tripped && !w.overRateLimit('203.0.113.9', 1000 + 60000);
      })());

      const ws = fs.readFileSync(path.join(ROOT, 'relay/worker.js'), 'utf8');
      check('worker has no console logging', !/console\.(log|info|warn|error|debug)/.test(ws));
    } finally {
      globalThis.fetch = realFetch;
    }
  }
}

console.log('Import from JSON (js/importValidator.js)');
{
  // app.js is loaded for HAZARD_DATA, defaultState, normalizeState and buildExportData.
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: console.error },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: noop },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    setTimeout, clearTimeout, URL, Number, String, Math, Date, Array, Object, JSON, RegExp, Error, Promise,
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.addEventListener = noop; ctx.navigator = {};
  vm.createContext(ctx);
  ['js/importValidator.js', 'app.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  const ev = code => vm.runInContext(code, ctx);

  // Same keys in the same order, so objects from different realms compare by value.
  const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x))
    ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x);
  const base = () => ({ tool: 'World Aware Risk Assessment', assessmentType: 'household', scores: {} });
  const run = o => ctx.validateImport(JSON.parse(JSON.stringify(o)));

  // Round trip: build a full state, export, import, compare
  ev(`state = normalizeState(${JSON.stringify({
    assessmentId: 'abc123',
    assessmentType: 'neighborhood',
    location: '123 Main Street, Boulder CO 80302',
    date: '2026-10-26',
    householdSize: '4',
    hh1Name: 'The Smiths',
    hh2Name: 'Next door',
    scores: {
      1:  { l: 4, i: 3, notes: 'Creek is close', isAuto: true, isEstimate: false, l2: 2, i2: 5 },
      12: { l: 2, i: 2, notes: '' },
      60: { l: 3, i: 4, notes: 'Custom one' },
    },
    customNames: { 60: { name: 'Rockfall', description: 'Cliff above the road' }, 61: { name: '', description: '' }, 62: { name: '', description: '' } },
    researchAddress: '123 Main Street, Boulder CO 80302',
    researchReport: {
      geocoded: { lat: 40.015, lng: -105.2705, zip: '80302', stateAbbr: 'CO', county: 'Boulder County', city: 'Boulder',
                  stateFips: '08', countyFips: '013', fips5: '08013', displayAddress: '123 Main Street, Boulder, CO 80302' },
      findings: [
        { hazardId: 1, hazardName: 'Flood (riverine)', category: 'Natural Hazards', scoreAssigned: 4,
          source: 'FEMA', finding: 'Zone AE', confidence: 'High', status: 'success', isOverridden: false,
          femaMapUrl: 'https://msc.fema.gov/portal/search#40.015%2C-105.2705' },
        { hazardId: 3, hazardName: 'Tornado', category: 'Natural Hazards', scoreAssigned: null,
          source: 'x', finding: 'Data temporarily unavailable', confidence: 'N/A', status: 'error', isOverridden: false },
      ],
      timestamp: '2026-10-26T12:00:00.000Z',
    },
    autoScoreOrigins: { 1: { source: 'FEMA', finding: 'Zone AE', confidence: 'High', status: 'success' } },
  })});`);
  ev(`function getReportEdits() { return { title: 'My report', preparedFor: 'Pat', summary: 'Line one.\\nLine two.', actions: 'Buy a radio', notes: { '1': 'Move the car' } }; }`);
  const exported = JSON.parse(JSON.stringify(ev('buildExportData()')));
  check('export carries assessmentId, research data and report edits',
    exported.assessmentId === 'abc123' && exported.researchReport && exported.autoScoreOrigins && exported.reportEdits.title === 'My report');
  check('export keeps the old fields', exported.tool && exported.version && Array.isArray(exported.results) && exported.scores && exported.customNames);
  const text = JSON.stringify(exported, null, 2);
  const parsed = ctx.parseImportText(text);
  check('parseImportText accepts an export', parsed.ok);
  const res = ctx.validateImport(parsed.obj);
  check('a valid export validates', res.ok && res.errors.length === 0, JSON.stringify(res.errors));
  check('round trip gives an identical normalized state',
    canon(ev('normalizeState')(res.state)) === canon(ev('state')),
    canon(ev('normalizeState')(res.state)));
  check('round trip gives identical report edits', canon(res.edits) === canon(ev('getReportEdits()')));
  check('an export from before v2.3 (no research fields) still imports', (() => {
    const old = JSON.parse(text);
    ['assessmentId', 'researchAddress', 'researchReport', 'autoScoreOrigins', 'reportEdits'].forEach(k => delete old[k]);
    const r = ctx.validateImport(old);
    return r.ok && r.edits === null && r.state.assessmentId === undefined;
  })());

  // Hostile and broken input
  const evil = ctx.validateImport(JSON.parse(
    '{"tool":"World Aware Risk Assessment","assessmentType":"household","__proto__":{"polluted":true,"assessmentType":"neighborhood"},' +
    '"scores":{"__proto__":{"l":5,"i":5},"1":{"l":2,"i":3,"__proto__":{"x":1},"constructor":"y"},"constructor":{"l":1}}}'));
  check('__proto__ keys are ignored', evil.ok && Object.keys(evil.state.scores).join() === '1' &&
    evil.state.scores['1'].x === undefined && Object.keys(evil.state.scores['1']).sort().join() === 'i,l');
  check('__proto__ does not pollute Object', ({}).polluted === undefined && ev('({}).polluted') === undefined && evil.state.polluted === undefined);
  check('unknown top-level keys are dropped', (() => {
    const o = base(); o.extra = 'x'; o.results = [{ id: 1 }]; o.exportedAt = 'now';
    const r = run(o);
    return r.ok && !('extra' in r.state) && !('results' in r.state) && !('exportedAt' in r.state);
  })());

  const bad = (name, mutate) => {
    const o = base(); mutate(o);
    const r = run(o);
    check(name, !r.ok && r.errors.length > 0 && r.state === null, JSON.stringify(r.errors));
  };
  bad('scores as a string is rejected', o => { o.scores = 'hello'; });
  bad('scores as an array is rejected', o => { o.scores = [1, 2]; });
  bad('missing scores is rejected', o => { delete o.scores; });
  bad('a score entry that is not an object is rejected', o => { o.scores = { 1: 'high' }; });
  bad('location as an object is rejected', o => { o.location = { a: 1 }; });
  bad('location as an array is rejected', o => { o.location = ['x']; });
  bad('notes as an array is rejected', o => { o.scores = { 1: { l: 1, i: 1, notes: ['a'] } }; });
  bad('unknown assessmentType is rejected', o => { o.assessmentType = 'business'; });
  bad('wrong tool name is rejected', o => { o.tool = 'Something else'; });
  bad('bad date is rejected', o => { o.date = 'yesterday'; });
  bad('bad assessmentId is rejected', o => { o.assessmentId = '<script>'; });
  bad('research report with the wrong shape is rejected', o => { o.researchReport = { geocoded: 'x', findings: 'y' }; });
  bad('a finding for an unknown hazard is rejected', o => { o.researchReport = { geocoded: {}, findings: [{ hazardId: 99 }] }; });
  check('arrays and null at the root are rejected',
    !ctx.validateImport([]).ok && !ctx.validateImport(null).ok && !ctx.validateImport('hello').ok && !ctx.validateImport(42).ok);

  // Ratings: whole numbers 0 to 5 are kept; anything else becomes 0 (unscored) with a warning
  {
    const o = base();
    o.scores = { 1: { l: 9, i: 5, l2: -1, i2: 2.5 }, 2: { l: '3', i: 'x' }, 3: { l: null, i: [4] } };
    const r = run(o);
    const s = r.state && r.state.scores;
    check('l=9 becomes 0 (unscored), not 5', r.ok && s[1].l === 0 && s[1].i === 5);
    check('negative and fractional ratings become 0', s[1].l2 === 0 && s[1].i2 === 0);
    check('digit string "3" is accepted, "x" becomes 0', s[2].l === 3 && s[2].i === 0);
    check('null and array ratings become 0', s[3].l === 0 && s[3].i === 0);
    check('out-of-range ratings produce a warning', r.warnings.some(w => /outside 0 to 5/.test(w)));
  }

  // Hazard ids
  {
    const o = base();
    o.scores = { 1: { l: 1, i: 1 }, 999: { l: 1, i: 1 }, abc: { l: 1, i: 1 }, '01': { l: 1, i: 1 }, '-1': { l: 1, i: 1 } };
    o.customNames = { 60: { name: 'A', description: 'B' }, 5: { name: 'not custom' }, 999: { name: 'nope' } };
    const r = run(o);
    check('unknown hazard ids are dropped', r.ok && Object.keys(r.state.scores).join() === '1', JSON.stringify(r.errors));
    check('only the custom hazard ids keep names', Object.keys(r.state.customNames).join() === '60');
  }

  // Strings and size
  {
    const o = base(); o.location = 'x'.repeat(900); o.scores = { 1: { l: 1, i: 1, notes: 'n'.repeat(2500) } };
    const r = run(o);
    check('long strings are cut to 500 characters', r.ok && r.state.location.length === 500);
    check('hazard notes keep up to 2000 characters', r.state.scores[1].notes.length === 2000);
    check('shortened text produces a warning', r.warnings.length >= 2);
  }
  {
    const o = base(); o.scores = { 1: { l: 1, i: 1, notes: 'z'.repeat(3 * 1024 * 1024) } };
    const r = ctx.validateImport(o);
    check('a 3 MB string is rejected', !r.ok && /2 MB/.test(r.errors[0]), JSON.stringify(r.errors));
    const t = ctx.parseImportText(JSON.stringify(o));
    check('a 3 MB file is rejected before parsing', !t.ok && /2 MB/.test(t.errors[0]));
    check('a 1 MB note is cut, not accepted whole', (() => {
      const p = base(); p.scores = { 1: { l: 1, i: 1, notes: 'z'.repeat(1024 * 1024) } };
      const q = ctx.validateImport(p);
      return q.ok && q.state.scores[1].notes.length === 2000;
    })());
  }
  check('text that is not JSON is rejected', !ctx.parseImportText('{not json').ok && !ctx.parseImportText('').ok);

  // Links inside imported research
  {
    const o = base();
    o.researchReport = { geocoded: { lat: 40, lng: -105 }, findings: [
      { hazardId: 1, scoreAssigned: 3, femaMapUrl: 'javascript:alert(1)' },
      { hazardId: 2, scoreAssigned: 9, femaMapUrl: 'https://evil.example/x', status: 'success' },
    ] };
    const r = run(o);
    check('only msc.fema.gov links survive', r.ok && r.state.researchReport.findings.every(f => f.femaMapUrl === null));
    check('finding scores are 0 to 5 or null', r.state.researchReport.findings[1].scoreAssigned === 0);
  }

  // Files and wiring
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sw   = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  check('importValidator.js is cached by the service worker', sw.includes("'./js/importValidator.js'"));
  check('importValidator.js loads before app.js',
    html.indexOf('js/importValidator.js') > 0 && html.indexOf('js/importValidator.js') < html.indexOf('src="app.js"'));
  check('importValidator.js touches no DOM', !/\b(document|window|localStorage|navigator)\b/.test(fs.readFileSync(path.join(ROOT, 'js/importValidator.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')));
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

asyncChecks().catch(e => { failed++; console.log('  FAIL async checks threw — ' + e.message); }).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});