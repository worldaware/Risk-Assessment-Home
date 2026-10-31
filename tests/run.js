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
    bl[0] === 'Our household: hazard check, Pearl St, Boulder (October 26, 2026)', bl[0]);
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
  check('non-Boulder: location street and city', lines(other)[0] === 'Our household: hazard check, Main Street, Fort Collins (October 26, 2026)', lines(other)[0]);
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
  // v3.1.0: the call also passes the shared NRI promise, so match the FIPS argument only
  check('flood gets the 5-digit FIPS', /_callFloodAPI\(lat, lng, fips5\b/.test(src));
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
  ['js/importValidator.js', 'js/checklist.js', 'app.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
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

console.log('v3.0.0 hazard cut');
{
  // Full app in one sandbox: research, actions, report, validator, checklist, app.
  const noop = () => {};
  const store = {};
  const ctx = {
    console: { log: noop, warn: noop, error: console.error },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: noop },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    setTimeout, clearTimeout, URL, Number, String, Math, Date, Array, Object, JSON, RegExp, Error, Promise, Set,
    fetch: () => Promise.reject(new Error('no network in tests')),
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.addEventListener = noop; ctx.navigator = {};
  vm.createContext(ctx);
  ['js/apiConfig.js', 'js/scoreMapper.js', 'js/research.js', 'js/actions.js', 'js/report.js',
   'js/importValidator.js', 'js/checklist.js', 'app.js']
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  const ev = code => vm.runInContext(code, ctx);
  const HD = ev('HAZARD_DATA');
  const REMOVED = [14, 16, 19, 21, 25, 26, 28, 29, 30, 31, 32, 33, 34, 35, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 55, 56, 57, 58, 59];
  const CORE = [1, 23, 5, 63, 8, 24, 4, 3, 10, 9, 2, 11, 64, 65, 15, 17, 27, 36, 22, 6];
  const RARE = [7, 12, 13, 18, 20, 53, 54, 66];
  const ids = g => HD.filter(h => h.group === g).map(h => h.id);
  const fresh = () => ev('state = freshState(); state');
  const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x))
    ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x);

  // HAZARD_DATA shape
  check('HAZARD_DATA: 20 core in screen order', JSON.stringify(ids('core')) === JSON.stringify(CORE), JSON.stringify(ids('core')));
  check('HAZARD_DATA: 8 rare in screen order', JSON.stringify(ids('rare')) === JSON.stringify(RARE), JSON.stringify(ids('rare')));
  check('HAZARD_DATA: 3 custom (60, 61, 62)', JSON.stringify(ids('custom')) === '[60,61,62]');
  check('HAZARD_DATA: 31 entries, no other groups', HD.length === 31);
  check('HAZARD_DATA: no removed ids', !HD.some(h => REMOVED.includes(h.id)));
  check('RETIRED_HAZARD_IDS lists the 35 removed ids', JSON.stringify([...ev('RETIRED_HAZARD_IDS')].sort((a, b) => a - b)) === JSON.stringify(REMOVED));
  check('every core hazard has baseImpact 1 to 5', HD.filter(h => h.group === 'core').every(h => Number.isInteger(h.baseImpact) && h.baseImpact >= 1 && h.baseImpact <= 5));
  check('rare and custom hazards have no baseImpact', HD.filter(h => h.group !== 'core').every(h => h.baseImpact === undefined));
  check('naDefault on 7, 12, 13 only', JSON.stringify(HD.filter(h => h.naDefault).map(h => h.id)) === '[7,12,13]');
  check('every hazard keeps a category string', HD.every(h => typeof h.category === 'string' && h.category.length > 0));
  check('Tornado is core', HD.find(h => h.id === 6).group === 'core');
  const copy = HD.map(h => h.name + ' ' + h.description).concat(ev('CHECKLIST_DATA').map(c => c.text)).concat(ev('HAZARD_GROUPS').map(g => g.title + ' ' + g.intro));
  check('hazard, checklist and group copy: no em dash or exclamation point', !copy.some(t => /[—!]/.test(t)), copy.filter(t => /[—!]/.test(t)).join(' | '));

  // Checklist
  const CL = ev('CHECKLIST_DATA');
  check('CHECKLIST_DATA: 12 items, ids 1 to 12', CL.length === 12 && CL.every((c, i) => c.id === i + 1));
  check('checklist raises only core hazard ids', CL.every(c => c.raises.every(id => CORE.includes(id))));
  check('item 2 raises the hazards that force you out', JSON.stringify(CL[1].raises.slice().sort((a, b) => a - b)) === '[1,3,4,6,11,15,17,36]');
  const ci = (id, hh1) => ctx.computeImpact(id, 'hh1', { hh1: hh1 || {}, hh2: {} });
  check('computeImpact: empty checklist gives baseImpact', HD.filter(h => h.group === 'core').every(h => ci(h.id) === h.baseImpact));
  check('computeImpact: item 1 ticked -> power outage (24) impact >= 4', ci(24, { 1: true }) >= 4, String(ci(24, { 1: true })));
  check('computeImpact: item 1 ticked -> extreme heat (9) floors at 4 (base 2 + 1 = 3)', ci(9, { 1: true }) === 4, String(ci(9, { 1: true })));
  check('computeImpact: item 1 ticked -> winter storm (8) is 4', ci(8, { 1: true }) === 4);
  check('computeImpact: no floor without item 1 (heat with item 11 is not raised, stays 2)', ci(9, { 11: true }) === 2);
  check('computeImpact: items 3, 5, 6 ticked -> wildfire 4 + 3 capped at 5', ci(1, { 3: true, 5: true, 6: true }) === 5);
  check('computeImpact: item 7 ticked -> drought 2 + 1 = 3', ci(10, { 7: true }) === 3);
  check('computeImpact: items 9 and 11 -> power outage 3 + 2 = 5', ci(24, { 9: true, 11: true }) === 5);
  check('computeImpact: radon and house fire are not raised by the checklist', ci(64, Object.fromEntries(CL.map(c => [c.id, true]))) === 3 && ci(65, {}) === 5);
  check('computeImpact: null for rare and custom hazards', ci(7) === null && ci(66) === null && ci(60) === null && ci(14) === null);
  check('computeImpact: household 2 reads its own column', ctx.computeImpact(9, 'hh2', { hh1: {}, hh2: { 1: true } }) === 4 && ctx.computeImpact(9, 'hh1', { hh1: {}, hh2: { 1: true } }) === 2);
  check('normalizeChecklist keeps only ids 1 to 12 set to true', canon(ctx.normalizeChecklist({ hh1: { 1: true, 2: false, 13: true, x: true }, hh2: { 12: true }, hh3: { 1: true } })) === canon({ hh1: { 1: true }, hh2: { 12: true } }));

  // applyChecklistImpacts
  {
    const st = fresh();
    check('fresh state: every core hazard has impact from the checklist', CORE.every(id => st.scores[id].i === HD.find(h => h.id === id).baseImpact && st.scores[id].i2 === st.scores[id].i));
    check('fresh state: no likelihoods set', CORE.every(id => !st.scores[id].l));
    ev('state.checklist.hh1[1] = true; state.scores[9].iManual = true; state.scores[9].i = 1; state.checklist.hh2[3] = true; state.scores[1].i2Manual = true; state.scores[1].i2 = 2; applyChecklistImpacts();');
    const s2 = ev('state');
    check('applyChecklistImpacts: iManual keeps a hand-set impact', s2.scores[9].i === 1);
    check('applyChecklistImpacts: i2 is still computed when only iManual is set', s2.scores[9].i2 === 2);
    check('applyChecklistImpacts: other hazards follow the checklist', s2.scores[24].i === 4 && s2.scores[8].i === 4);
    check('applyChecklistImpacts: i2Manual keeps household 2 hand-set impact', s2.scores[1].i2 === 2 && s2.scores[1].i === 5);
    check('applyChecklistImpacts: rare hazards untouched', !('i' in s2.scores[7]) && s2.scores[18] === undefined);
  }

  // Does not apply here, scoring and progress
  {
    fresh();
    check('fresh state: 7, 12, 13 marked na and naAuto', [7, 12, 13].every(id => ev(`state.scores[${id}].na === true && state.scores[${id}].naAuto === true`)));
    check('fresh state: progress is 0 of 20 (pre-marked hazards do not count)', ev('countScored()') === 0 && ev('totalActive()') === 20);
    check('fresh state: not a dirty assessment', ev('_isDirtyAssessment()') === false);
    ev('state.scores[1].l = 4;');
    check('likelihood on a core hazard scores it with checklist impact', ev('isScored(1)') && ev('calcScore(1)') === 16 && ev('countScored()') === 1);
    ev('state.scores[1].na = true;');
    check('na: calcScore returns 0 and the hazard is not scored', ev('calcScore(1)') === 0 && ev('isScored(1)') === false);
    check('na on a core hazard fills its progress slot', ev('countScored()') === 1 && ev('totalActive()') === 20);
    ev('state.scores[18] = { na: true };');
    check('na set by the user on a rare hazard adds it to progress, done', ev('totalActive()') === 21 && ev('countScored()') === 2);
    ev('state.scores[53] = { l: 2 };');
    check('a rare hazard with only a likelihood counts but is not done', ev('totalActive()') === 22 && ev('countScored()') === 2);
    ev('state.scores[53].i = 3;');
    check('rating its impact finishes it', ev('countScored()') === 3);
    ev('state.customNames[60].name = "Rockfall"; state.scores[60] = { l: 2, i: 2 };');
    check('named custom hazards count', ev('totalActive()') === 23 && ev('countScored()') === 4);
    const rd = ev('buildReportData()');
    check('report data: na hazards not ranked', !rd.scored.some(it => it.id === 1 || it.id === 18));
    check('report data: ruledOut lists every na hazard by name, in screen order', JSON.stringify(rd.ruledOut) === JSON.stringify(['Wildfire', 'Hurricane', 'Tsunami', 'Volcanic ash', 'Nuclear or radiological incident']), JSON.stringify(rd.ruledOut));
    check('export carries the checklist and na flags', (() => { const x = ev('buildExportData()'); return x.checklist && x.checklist.hh1 && x.scores[7].na === true && x.version === ev('APP_VERSION'); })());
  }

  // normalizeState: v2 saved state
  {
    const v2 = {
      assessmentId: 'v2state', assessmentType: 'household',
      scores: { 1: { l: 4, i: 3 }, 2: { l: 2, i: 0 }, 14: { l: 3, i: 3 }, 55: { l: 4, i: 4 }, 59: { l: 1, i: 1 }, 7: { l: 1, i: 1 }, 18: { l: 1, i: 2 } },
      autoScoreOrigins: { 1: { source: 'x' }, 55: { source: 'y' } },
      researchReport: { geocoded: { stateAbbr: 'CO' }, findings: [{ hazardId: 1 }, { hazardId: 55 }, { hazardId: 14 }, { hazardId: 21 }], timestamp: 't' },
      customNames: { 60: { name: '', description: '' } },
    };
    const n = ev(`normalizeState(${JSON.stringify(v2)})`);
    check('normalizeState drops score entries for removed ids', ['14', '55', '59'].every(k => !(k in n.scores)), Object.keys(n.scores).join());
    check('normalizeState keeps kept ids', n.scores[1].l === 4 && n.scores[2].l === 2 && n.scores[18].i === 2);
    check('normalizeState drops research sources and findings for removed ids',
      Object.keys(n.autoScoreOrigins).join() === '1' && n.researchReport.findings.map(f => f.hazardId).join() === '1');
    check('v2 migration: an impact rated on a core hazard becomes hand-set', n.scores[1].iManual === true && n.scores[2].iManual === undefined);
    check('v2 migration: unrated 12 and 13 are ruled out, rated 7 is not', n.scores[12].na === true && n.scores[13].naAuto === true && !n.scores[7].na);
    check('v2 migration: gets an empty checklist', canon(n.checklist) === canon({ hh1: {}, hh2: {} }));
    ev(`state = normalizeState(${JSON.stringify(v2)}); applyChecklistImpacts();`);
    check('v2 migration: checklist leaves the old impact alone and fills the rest', ev('state.scores[1].i') === 3 && ev('state.scores[2].i') === 3 && ev('state.scores[24].i') === 3);
    const v3 = ev('normalizeState(JSON.parse(JSON.stringify(state)))');
    check('a v3 state normalizes to itself', canon(v3) === canon(ev('state')));
    check('a v3 state with an undone pre-mark stays undone', (() => {
      const o = JSON.parse(JSON.stringify(ev('state'))); delete o.scores[12]; return !ev('normalizeState')(o).scores[12];
    })());
  }

  // Import: v3 round trip and v2 exports
  {
    ev(`state = freshState(); state.assessmentId = 'v3rt'; state.assessmentType = 'neighborhood';
        state.checklist.hh1[1] = true; state.checklist.hh2[12] = true; applyChecklistImpacts();
        state.scores[1].l = 4; state.scores[1].l2 = 3; state.scores[9].i = 5; state.scores[9].iManual = true;
        state.scores[18] = { na: true }; delete state.scores[12].na; delete state.scores[12].naAuto;
        function getReportEdits() { return { notes: {} }; }`);
    const exported = JSON.parse(JSON.stringify(ev('buildExportData()')));
    const res = ctx.validateImport(exported);
    check('v3 export validates with no warnings', res.ok && res.warnings.length === 0, JSON.stringify(res.errors.concat(res.warnings)));
    check('v3 round trip keeps checklist, na, naAuto, iManual and i2', (() => {
      const n = ev('normalizeState')(res.state); ev('applyChecklistImpacts')(n);
      return canon(n) === canon(ev('state'));
    })());
    const v2 = { tool: 'World Aware Risk Assessment', version: '2.4.0', assessmentType: 'household',
      scores: { 1: { l: 4, i: 3 }, 25: { l: 2, i: 2 }, 55: { l: 4, i: 4 }, 44: { l: 1, i: 1 } },
      researchReport: { geocoded: { stateAbbr: 'CO' }, findings: [
        { hazardId: 1, scoreAssigned: 4, status: 'success' }, { hazardId: 55, scoreAssigned: 4, status: 'success' },
        { hazardId: 14, scoreAssigned: 2, status: 'estimated' }, { hazardId: 21, scoreAssigned: 1, status: 'success' }] },
      autoScoreOrigins: { 1: { source: 'USFS' }, 55: { source: 'USFS' } } };
    const r2 = ctx.validateImport(JSON.parse(JSON.stringify(v2)));
    check('v2 export with removed ids still imports', r2.ok, JSON.stringify(r2.errors));
    check('v2 removed score ids pass to normalizeState with a warning, which drops them', r2.warnings.some(w => /merged or moved/.test(w)) &&
      Object.keys(ev('normalizeState')(r2.state).scores).every(k => !REMOVED.includes(Number(k))), JSON.stringify(r2.warnings));
    check('v2 research findings for removed ids are skipped with a warning', r2.state.researchReport.findings.map(f => f.hazardId).join() === '1' && r2.warnings.some(w => /research finding/.test(w)));
    check('v2 import gets migrated by normalizeState', (() => { const n = ev('normalizeState')(r2.state); return n.scores[1].iManual === true && n.scores[7].na === true; })());
    const bad = o => ctx.validateImport(Object.assign({ tool: 'World Aware Risk Assessment', assessmentType: 'household', scores: {} }, o));
    check('checklist item 13 is rejected', !bad({ checklist: { hh1: { 13: true } } }).ok);
    check('checklist value that is not a boolean is rejected', !bad({ checklist: { hh1: { 1: 'yes' } } }).ok);
    check('checklist as an array is rejected', !bad({ checklist: [1, 2] }).ok);
    check('na as a string is rejected', !bad({ scores: { 7: { na: 'true' } } }).ok);
    check('iManual and i2Manual booleans are kept', (() => { const r = bad({ scores: { 9: { i: 4, iManual: true, i2Manual: false } } }); return r.ok && r.state.scores[9].iManual === true && r.state.scores[9].i2Manual === false; })());
    check('an id that was never a hazard still rejects a finding', !bad({ researchReport: { geocoded: {}, findings: [{ hazardId: 99 }] } }).ok);
  }

  // Research findings
  {
    const geo = { lat: 40.015, lng: -105.27, zip: '80302', stateAbbr: 'CO', county: 'Boulder County' };
    const ok = { score: 3, finding: 'x', confidence: 'High' };
    const full = { flood: ok, earthquake: ok, wildfire: ok, weather: { stateAbbr: 'CO' }, drought: ok,
      epa: { chemScore: 2, finding: '2 facilities', confidence: 'Medium', highHazardCount: 1, potwCount: 1 }, landslide: ok };
    const none = { flood: null, earthquake: null, wildfire: null, weather: null, drought: null, epa: null, landslide: null };
    const names = Object.fromEntries(HD.map(h => [h.id, h.name]));
    fresh();
    const runs = [ctx._compileFindings(full, geo), ctx._compileFindings(none, geo), ctx._compileFindings(none, { stateAbbr: 'FL' })];
    const all = runs.reduce((a, b) => a.concat(b), []);
    check('findings never reference removed ids', all.every(f => !REMOVED.includes(f.hazardId)), all.map(f => f.hazardId).join());
    check('every finding points at a hazard in HAZARD_DATA', all.every(f => names[f.hazardId] !== undefined));
    check('finding names match HAZARD_DATA names', all.every(f => f.hazardName === names[f.hazardId]), all.filter(f => f.hazardName !== names[f.hazardId]).map(f => f.hazardName).join(' | '));
    check('finding categories match HAZARD_DATA', all.every(f => f.category === HD.find(h => h.id === f.hazardId).category));
    check('no dust storm, wastewater or WUI finding', !all.some(f => [14, 21, 55].includes(f.hazardId)));
    check('Colorado: Hurricane is ruled out, so no estimate', !runs[0].some(f => f.hazardId === 7) && !runs[1].some(f => f.hazardId === 7));
    check('outside Colorado: pre-marked Hurricane still gets an estimate', runs[2].some(f => f.hazardId === 7));
    check('chemical finding mentions rail and freight routes', runs[0].find(f => f.hazardId === 15).finding.includes('Rail lines and freight highways'));
    ev('state.scores[7] = { na: true };');
    check('outside Colorado: a Hurricane the user ruled out gets no estimate', !ctx._compileFindings(none, { stateAbbr: 'FL' }).some(f => f.hazardId === 7));
    const manual = Object.keys(ev('MANUAL_REASONS')).map(Number);
    check('MANUAL_REASONS only lists hazards in HAZARD_DATA', manual.every(id => names[id] !== undefined), manual.filter(id => names[id] === undefined).join());
    check('MANUAL_REASONS covers 63, 64, 65, 66', [63, 64, 65, 66].every(id => manual.includes(id)));
    check('MANUAL_REASONS text has no em dash', !Object.values(ev('MANUAL_REASONS')).some(t => t.includes('—')));
    check('H_ID has no removed ids', Object.values(ev('H_ID')).every(id => !REMOVED.includes(id)));
    fresh();
    ev('state.scores[12].naAuto = true; clearAutoNotApplicable();');
    check('clearAutoNotApplicable removes only pre-marks', !ev('state.scores[7].na') && !ev('state.scores[12].na') && !ev('state.scores[13].na'));
  }

  // Actions
  {
    const grp = id => ctx._actionGroupFor(id);
    const loc = { boulderCounty: true, inColorado: true };
    check('actions: every core id has lines', CORE.every(id => grp(id) && grp(id).lines(loc).length >= 1), CORE.filter(id => !grp(id)).join());
    check('actions: 63, 64, 65, 66 have two lines each', [63, 64, 65, 66].every(id => grp(id) && grp(id).lines(loc).length === 2));
    check('actions: no group lists a removed id', !ev('ACTION_GROUPS').some(g => g.ids.some(id => REMOVED.includes(id))));
    const lines = ev('ACTION_GROUPS').reduce((a, g) => a.concat(g.lines(loc), g.lines({ boulderCounty: false, inColorado: false })), []);
    check('actions: no "!" or em dash in any hazard line', !lines.some(l => /[!—]/.test(l)));
    const out = ctx.buildDefaultActions({ location: 'Boulder, CO', scored: [{ id: 65, name: 'House fire', level: 'CRITICAL', score: 20 }, { id: 64, name: 'Radon', level: 'HIGH', score: 12 }] });
    check('actions: house fire and radon get report lines', out.some(l => l.startsWith('House fire: put a smoke alarm')) && out.some(l => l.startsWith('Radon: test the lowest')), out.join(' / '));
  }

  // Report
  {
    fresh();
    ev('state.scores[1].l = 4; state.scores[12].na = false; delete state.scores[7].na; delete state.scores[13].na;');
    const noNa = ev('buildReportViewHtml(buildResolvedReport())');
    check('report HTML has no ruled-out line when nothing is ruled out', !noNa.includes('Considered and ruled out'));
    fresh();
    ev('state.scores[1].l = 4;');
    const withNa = ev('buildReportViewHtml(buildResolvedReport())');
    check('report HTML lists the ruled-out hazards, joined with semicolons', withNa.includes('Considered and ruled out: Hurricane; Tsunami; Volcanic ash.'));
    check('ruled-out line sits after the ranked list and before the methodology',
      withNa.indexOf('rd-list') < withNa.indexOf('Considered and ruled out') && withNa.indexOf('Considered and ruled out') < withNa.indexOf('How to read these scores'));
    check('methodology mentions the household checklist', withNa.includes('Impact starts from a scenario for each hazard and rises with the household checklist; any impact you changed by hand is kept.'));
    const pdfSrc = fs.readFileSync(path.join(ROOT, 'js/report.js'), 'utf8');
    check('PDF prints the ruled-out line and the shared methodology text', /ruledOutLine\(d\)\) para\(ruledOutLine\(d\)/.test(pdfSrc) && pdfSrc.includes('para(REPORT_METHOD_TEXT'));
  }

  // Review fixes (B1, B2, S1, S2, S7, N1 to N12)
  {
    // B1: formatLIText
    fresh();
    ev(`state.assessmentType = 'household'; state.scores[1].l = 4;`);
    let it = ev('buildReportData()').scored.find(x => x.id === 1);
    check('formatLIText household: likelihood and impact words', it.liText === 'Likelihood 4 (Likely) × Impact 4 (Major)', it.liText);
    ev(`state.assessmentType = 'neighborhood'; state.hh1Name = 'Smiths'; state.hh2Name = 'Next door';`);
    it = ev('buildReportData()').scored.find(x => x.id === 1);
    check('formatLIText neighborhood: checklist impact on the unrated household is not reported', it.liText === 'Smiths: L4 × I4 = 16', it.liText);
    ev('state.scores[1].l = 0; state.scores[1].l2 = 3;');
    it = ev('buildReportData()').scored.find(x => x.id === 1);
    check('formatLIText neighborhood: only household 2 rated', it.liText === 'Next door: L3 × I4 = 12', it.liText);
    ev('state.scores[1].l = 4;');
    it = ev('buildReportData()').scored.find(x => x.id === 1);
    check('formatLIText neighborhood: both rated shows the higher', it.liText === 'Smiths: L4 × I4 = 16; Next door: L3 × I4 = 12; higher of the two: 16', it.liText);
    ev('state.scores[24].l = 4; state.scores[24].i2 = 5; state.scores[24].i2Manual = true;');
    it = ev('buildReportData()').scored.find(x => x.id === 24);
    check('formatLIText neighborhood: an impact set by hand without likelihood is still reported', it.liText === 'Smiths: L4 × I3 = 12; Next door: I5, likelihood not rated', it.liText);
    ev('state.scores[53] = { l: 2, i: 3, i2: 4 };');
    it = ev('buildReportData()').scored.find(x => x.id === 53);
    check('formatLIText neighborhood: rare hazard impact is always by hand', /Next door: I4, likelihood not rated/.test(it.liText), it.liText);
    check('report HTML (neighborhood) has no stray "likelihood not rated" from the checklist',
      !/Smiths: I\d, likelihood not rated/.test(ev('buildReportViewHtml(buildResolvedReport())')));

    // B2 and S2: pre-v3 migration of research-only naDefault likelihoods
    const v2co = {
      assessmentId: 'v2co', assessmentType: 'household',
      scores: { 1: { l: 4, isAuto: true }, 7: { l: 1, isAuto: true, isEstimate: true } },
      autoScoreOrigins: { 1: { source: 'USFS' }, 7: { source: 'rule of thumb', status: 'estimated' } },
      researchReport: { geocoded: { stateAbbr: 'CO' }, findings: [{ hazardId: 1, status: 'success', scoreAssigned: 4 }, { hazardId: 7, status: 'estimated', scoreAssigned: 1 }] },
    };
    let n = ev(`normalizeState(${JSON.stringify(v2co)})`);
    check('B2: research-only Hurricane in CO is ruled out', n.scores[7].na === true && n.scores[7].naAuto === true);
    check('B2: its auto likelihood and research source are removed', !n.scores[7].l && !n.scores[7].isAuto && !n.scores[7].isEstimate && !('7' in n.autoScoreOrigins));
    check('B2: other research likelihoods are kept', n.scores[1].l === 4 && n.scores[1].isAuto === true && '1' in n.autoScoreOrigins);
    ev(`state = normalizeState(${JSON.stringify(v2co)}); applyChecklistImpacts();`);
    check('B2: Hurricane is not flagged for impact or added to progress', !ev('getResearchFlaggedIds()').includes(7) && ev('totalActive()') === 20);
    check('B2: report rules out Hurricane, Tsunami and Volcanic ash', JSON.stringify(ev('buildReportData()').ruledOut) === '["Hurricane","Tsunami","Volcanic ash"]');
    const noResearch = { assessmentType: 'household', scores: { 7: { l: 1, isAuto: true } } };
    check('B2: no research report counts as Colorado', ev(`normalizeState(${JSON.stringify(noResearch)})`).scores[7].na === true);
    const v2fl = JSON.parse(JSON.stringify(v2co)); v2fl.researchReport.geocoded.stateAbbr = 'FL';
    n = ev(`normalizeState(${JSON.stringify(v2fl)})`);
    check('S2: researched outside Colorado, nothing is pre-marked', !n.scores[7].na && n.scores[7].l === 1 && !n.scores[12] && !n.scores[13]);
    const handRated = { assessmentType: 'household', scores: { 7: { l: 1 } } };
    check('B2: a likelihood the user set (not isAuto) still counts as rated', !ev(`normalizeState(${JSON.stringify(handRated)})`).scores[7].na);

    // S1: notes from retired hazards
    const v2notes = {
      assessmentType: 'household',
      scores: {
        1: { l: 4, i: 4, notes: 'Creek behind the house' },
        55: { l: 4, i: 5, notes: 'WUI note' },
        29: { l: 4, i: 3, notes: 'internet matters for work' },
        14: { l: 3, i: 2 },
        45: { l: 2, i: 2, notes: '[Auto-scored from: old research]' },
        59: { notes: '' },
      },
    };
    const info = {};
    n = ctx.normalizeState(JSON.parse(JSON.stringify(v2notes)), info);
    check('S1: a retired note is carried onto the absorbing hazard with the old name',
      n.scores[1].notes === 'Creek behind the house\nFrom Wildland-Urban Interface Encroachment: WUI note', JSON.stringify(n.scores[1].notes));
    check('S1: a checklist-moved note lands on its mapped core hazard', n.scores[24].notes === 'From Internet / Broadband Outage: internet matters for work', JSON.stringify(n.scores[24]));
    check('S1: retired scores are dropped, ratings are not carried', ['55', '29', '14', '45', '59'].every(k => !(k in n.scores)) && n.scores[1].i === 4 && !n.scores[24].l);
    check('S1: legacy auto notes are not carried', !Object.values(n.scores).some(e => /Auto-scored/.test(e.notes || '')));
    check('S1: info counts merged items and carried notes', info.merged === 4 && info.notesCarried === 2, JSON.stringify(info));
    check('S1: toast text', ev('migrationNoticeText')(info) === 'Your saved ratings were moved to the new shorter hazard list; 4 items were merged. Notes were kept.', ev('migrationNoticeText')(info));
    check('S1: no toast when nothing was merged', ev('migrationNoticeText')({ merged: 0 }) === '');
    const again = {};
    const n2 = ctx.normalizeState(JSON.parse(JSON.stringify(Object.assign({}, v2notes, { scores: Object.assign({}, n.scores, { 55: { notes: 'WUI note' } }) }))), again);
    check('S1: carrying the same note twice does not duplicate it', (n2.scores[1].notes.match(/WUI note/g) || []).length === 1);
    check('RETIRED_HAZARDS covers every removed id and targets a core hazard', REMOVED.every(id => {
      const r = ev('RETIRED_HAZARDS')[id]; return r && typeof r[0] === 'string' && CORE.includes(r[1]);
    }));
    const imp = ctx.validateImport({ tool: 'World Aware Risk Assessment', version: '2.4.0', assessmentType: 'household',
      scores: { 1: { l: 4, i: 4 }, 55: { l: 4, i: 5, notes: 'WUI note', isAuto: 'junk' } } });
    const impInfo = {};
    const impState = imp.ok ? ctx.normalizeState(imp.state, impInfo) : null;
    check('S1: an imported v2 note is carried too', imp.ok && impState.scores[1].notes === 'From Wildland-Urban Interface Encroachment: WUI note' && impInfo.merged === 1, JSON.stringify(imp.errors));

    // S7: ruled-out hazards out of research counts
    fresh();
    ev(`state.researchReport = { geocoded: { stateAbbr: 'CO' }, timestamp: 't', findings: [
          { hazardId: 1, status: 'success', scoreAssigned: 4, source: 'USFS' },
          { hazardId: 5, status: 'estimated', scoreAssigned: 3, source: 'rule' },
          { hazardId: 2, status: 'estimated', scoreAssigned: 2, source: 'rule' } ] };
        state.scores[1].l = 4; state.scores[1].isAuto = true; state.scores[5].l = 3; state.scores[5].isAuto = true;
        state.scores[2].l = 2; state.scores[2].isAuto = true; state.scores[2].na = true;
        state.autoScoreOrigins = { 1: { source: 'USFS', status: 'success' }, 5: { source: 'rule', status: 'estimated' }, 2: { source: 'rule', status: 'estimated' } };`);
    const rs = ev('buildReportData()').research;
    check('S7: ruled-out hazard left out of report research counts', rs.findingCount === 2 && rs.estimatedCount === 1, JSON.stringify(rs));
    check('S7: ruled-out hazard left out of the flagged ids (banner)', JSON.stringify(ev('getResearchFlaggedIds()')) === '[1,5]');

    // UI handlers in the node sandbox (DOM stub returns null)
    fresh();
    const changed = ev(`toggleChecklistItem('hh1', 1, true)`);
    check('toggleChecklistItem stores the tick and raises impacts', ev('state.checklist.hh1[1]') === true && ev('state.scores[9].i') === 4 && ev('state.scores[24].i') === 4);
    check('toggleChecklistItem returns the hazards it changed', JSON.stringify([...changed].sort((a, b) => a - b)) === '[1,8,9,24,63]', JSON.stringify(changed));
    check('checklistChangeText', ev('checklistChangeText(5)') === 'Impact updated for 5 hazards.' && ev('checklistChangeText(1)') === 'Impact updated for 1 hazard.' && ev('checklistChangeText(0)') === 'No impacts changed.');
    ev(`toggleChecklistItem('hh1', 1, false)`);
    check('toggleChecklistItem off removes the tick and lowers impacts', !('1' in ev('state.checklist.hh1')) && ev('state.scores[9].i') === 2);
    ev(`setScore(9, 'i', 5)`);
    check('setScore on core impact marks it set by hand', ev('state.scores[9].i') === 5 && ev('state.scores[9].iManual') === true);
    ev(`setScore(9, 'i', 5)`);
    check('setScore clearing a core impact hands it back to the checklist', ev('state.scores[9].i') === 2 && ev('state.scores[9].iManual') === undefined);
    ev(`setScore(9, 'i', 1); toggleChecklistItem('hh1', 1, true)`);
    check('hand-set impact survives a checklist change', ev('state.scores[9].i') === 1);
    ev(`resetImpactToChecklist(9, 'i')`);
    check('resetImpactToChecklist recomputes and clears the flag', ev('state.scores[9].i') === 4 && ev('state.scores[9].iManual') === undefined);
    ev(`setScore(9, 'i2', 3)`);
    check('setScore on i2 sets i2Manual only', ev('state.scores[9].i2Manual') === true && ev('state.scores[9].iManual') === undefined);
    ev(`setScore(53, 'i', 3)`);
    check('setScore on a rare impact sets no manual flag', ev('state.scores[53].i') === 3 && ev('state.scores[53].iManual') === undefined);
    ev(`state.scores[5].l = 3; state.scores[5].notes = 'old roof'; markNotApplicable(5)`);
    check('markNotApplicable sets na and zeroes the score', ev('state.scores[5].na') === true && ev('calcScore(5)') === 0);
    ev(`markNotApplicable(7)`);
    check('markNotApplicable on a pre-marked hazard makes it the user\'s own', ev('state.scores[7].na') === true && ev('state.scores[7].naAuto') === undefined && ev('totalActive()') === 22);
    ev(`undoNotApplicable(5)`);
    check('undoNotApplicable clears na and keeps every other field', ev('state.scores[5].na') === undefined && ev('state.scores[5].l') === 3 && ev('state.scores[5].notes') === 'old roof' && ev('calcScore(5)') === 9);

    // N4, N5: validator
    const imp3 = ctx.validateImport({ tool: 'World Aware Risk Assessment', version: '3.0.0', assessmentType: 'household', scores: { 1: { l: 4, i: 4 } } });
    check('N4: a v3 file without a checklist is not migrated as v2', imp3.ok && imp3.state.checklist && ctx.normalizeState(imp3.state).scores[1].iManual === undefined);
    const imp2 = ctx.validateImport({ tool: 'World Aware Risk Assessment', version: '2.4.0', assessmentType: 'household', scores: { 1: { l: 4, i: 4 } } });
    check('N4: a v2 file is still migrated', imp2.ok && ctx.normalizeState(imp2.state).scores[1].iManual === true);
    const imp5 = ctx.validateImport({ tool: 'World Aware Risk Assessment', assessmentType: 'household',
      scores: { 1: { na: true, naAuto: true }, 12: { naAuto: true }, 13: { na: true, naAuto: true }, 60: { na: true, l: 2 } },
      checklist: { hh1: {}, hh2: {}, hh3: { 1: true } } });
    check('N5: naAuto kept only with na on a naDefault hazard', imp5.ok && imp5.state.scores[13].naAuto === true && imp5.state.scores[1].na === true &&
      imp5.state.scores[1].naAuto === undefined && imp5.state.scores[12].naAuto === undefined, JSON.stringify(imp5.state && imp5.state.scores));
    check('N5: na is dropped on custom hazards', imp5.state.scores[60].na === undefined && imp5.state.scores[60].l === 2);
    check('N5: unknown checklist parts warn', imp5.warnings.some(w => /checklist had 1 unknown part/.test(w)) && !('hh3' in imp5.state.checklist));

    // N8: report notes for retired ids are purged
    store.wa_report_edits = JSON.stringify({ a1: { title: 'T', notes: { 55: 'gone', 1: 'kept' } }, a2: { notes: { 29: 'gone' } } });
    check('N8: purgeRetiredReportNotes removes notes on retired ids only', ev('purgeRetiredReportNotes()') === 2 &&
      canon(JSON.parse(store.wa_report_edits)) === canon({ a1: { title: 'T', notes: { 1: 'kept' } }, a2: { notes: {} } }));

    // N3: saved copies count the v3 way
    check('N3: saved copy count is recomputed from its state', ev(`_savedDoneCount({ scored: 14, state: ${JSON.stringify(v2notes)} })`) === 1);

    // N12: nuclear has its own lines
    const nuc = ctx._actionGroupFor(18);
    check('N12: nuclear has two lines of its own, with potassium iodide only if told to', nuc && nuc.key === 'nuclear' && nuc.lines().length === 2 &&
      /potassium iodide only if/.test(nuc.lines()[1]) && !nuc.lines().some(l => /rail/.test(l)));

    // S6: stale copy
    const homeHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const resSrc = fs.readFileSync(path.join(ROOT, 'js/research.js'), 'utf8');
    check('S6: no "You rate the impact" copy left', !/You (then )?rate the impact/.test(homeHtml + resSrc));
    // N9
    check('N9: isImpactFromChecklist removed', typeof ctx.isImpactFromChecklist === 'undefined');
  }

  // Files and wiring
  {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    check('sw.js APP_SHELL lists js/checklist.js', /const APP_SHELL = \[[\s\S]*'\.\/js\/checklist\.js'[\s\S]*\];/.test(sw));
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    check('checklist.js loads before app.js', html.indexOf('js/checklist.js') > 0 && html.indexOf('js/checklist.js') < html.indexOf('src="app.js"'));
    check('checklist.js loads in a sandbox with no DOM', (() => {
      const c = { console }; c.window = c; vm.createContext(c);
      try { vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/checklist.js'), 'utf8'), c); return typeof c.computeImpact === 'function'; } catch (e) { return false; }
    })());
  }
}


/* ---------------------------------------------------------------
   v3.1.0 NRI and landslide
   Values are the live rows captured from Henry's browser on 2026-10-31
   (downtown 40.0150,-105.2705; foothills 40.0394,-105.3320; Boulder County),
   plus four out-of-state tracts read the same day.
--------------------------------------------------------------- */
const NRI_FX = {
  downtown:  { COUNTY: 'Boulder', TRACTFIPS: '08013012206', CWAV_AFREQ: 1.1052631578947372, HAIL_AFREQ: 6.274038864769396, HWAV_AFREQ: 0.7894736842105264,
               LNDS_AFREQ: 0.00000630059, LTNG_AFREQ: 47.188475999999994, SWND_AFREQ: 1.1794377543572774, TRND_AFREQ: 0.00035723177862237,
               WFIR_RISKR: 'Very Low', WNTW_AFREQ: 14.526315789473687 },
  foothills: { COUNTY: 'Boulder', TRACTFIPS: '08013013704', CWAV_AFREQ: 0.3840218010347142, HAIL_AFREQ: 5.099036394701887, HWAV_AFREQ: 0.15308426333004188,
               LNDS_AFREQ: 0.0190610275, LTNG_AFREQ: 49.298451129552625, SWND_AFREQ: 0.9102506690207331, TRND_AFREQ: 0.01719642911618637,
               WFIR_RISKR: 'Very High', WNTW_AFREQ: 16.47790895127154 },
  county:    { AREA: 747.9461882100001, COUNTY: 'Boulder', STCOFIPS: '08013', CWAV_AFREQ: 0.5918800291218647, HAIL_AFREQ: 5.479481243434043,
               HWAV_AFREQ: 0.30520413564463056, LNDS_AFREQ: 0.26682081889, SWND_AFREQ: 0.9974086441717701, TRND_AFREQ: 0.5238448942072822,
               WNTW_AFREQ: 21.4001613081911,
               IFLD_AFREQ: 4.2 /* test value only: the live Boulder IFLD_AFREQ was not captured */ },
  houston:     { HAIL_AFREQ: 2.33, SWND_AFREQ: 1.49, WNTW_AFREQ: 1.11, CWAV_AFREQ: 0.47, HWAV_AFREQ: 14.58, LNDS_AFREQ: 0.00011 },
  phoenix:     { HAIL_AFREQ: 0.34, SWND_AFREQ: 1.84, WNTW_AFREQ: 0.16, CWAV_AFREQ: 0, HWAV_AFREQ: 23.42 },
  minneapolis: { HAIL_AFREQ: 6.51, SWND_AFREQ: 4.83, WNTW_AFREQ: 16.58, CWAV_AFREQ: 8.95, HWAV_AFREQ: 6.68 },
  seattle:     { HAIL_AFREQ: 0.01, SWND_AFREQ: 0.01, WNTW_AFREQ: 5.16, CWAV_AFREQ: 0, HWAV_AFREQ: 5.05 },
};

async function v31Checks() {
  console.log('v3.1.0 NRI and landslide');
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: console.error },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: noop },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    setTimeout, clearTimeout, URL, Number, String, Math, Date, Array, Object, JSON, RegExp, Error, Promise, Set, Map,
    fetch: () => Promise.reject(new Error('no network in tests')),
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.addEventListener = noop; ctx.navigator = {};
  vm.createContext(ctx);
  ['js/apiConfig.js', 'js/scoreMapper.js', 'js/research.js', 'js/actions.js', 'js/report.js',
   'js/importValidator.js', 'js/checklist.js', 'app.js']
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  const ev = code => vm.runInContext(code, ctx);
  const cfg = ev('API_CONFIG');
  const HD = ev('HAZARD_DATA');
  const names = Object.fromEntries(HD.map(h => [h.id, h.name]));
  const REMOVED = [14, 16, 19, 21, 25, 26, 28, 29, 30, 31, 32, 33, 34, 35, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 55, 56, 57, 58, 59];

  // Config
  check('apiConfig: NRI_TRACT and NRI_COUNTY are the FEMA ArcGIS Online layers',
    /XG15cJAlne2vxtgt\/arcgis\/rest\/services\/National_Risk_Index_Census_Tracts\/FeatureServer\/0\/query$/.test(cfg.NRI_TRACT) &&
    /XG15cJAlne2vxtgt\/arcgis\/rest\/services\/National_Risk_Index_Counties\/FeatureServer\/0\/query$/.test(cfg.NRI_COUNTY));
  check('apiConfig: FEMA_NRI_COUNTY kept as relay fallback', cfg.FEMA_NRI_COUNTY === 'https://hazards.fema.gov/nri/api/county');
  check('apiConfig: landslide tile service, inventory layer 11 and post-fire layer 4',
    cfg.USGS_LANDSLIDE === 'https://tiles.arcgis.com/tiles/v01gqwM5QqNysAAi/arcgis/rest/services/US_Landslide_Susceptibility/MapServer' &&
    /US_Landslide_point_v2\/FeatureServer\/11\/query$/.test(cfg.USGS_LANDSLIDE_INVENTORY) &&
    /USGS_Post_Fire_Hazard_Assessment_Data\/FeatureServer\/4\/query$/.test(cfg.USGS_POSTFIRE));
  check('apiConfig: OpenFEMA declarations', cfg.OPENFEMA_DECLARATIONS === 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries');

  // outFields: only fields confirmed on the December 2025 layers
  const CONFIRMED = ['HAIL_AFREQ', 'TRND_AFREQ', 'SWND_AFREQ', 'WNTW_AFREQ', 'CWAV_AFREQ', 'HWAV_AFREQ', 'LNDS_AFREQ', 'LTNG_AFREQ', 'IFLD_AFREQ', 'WFIR_RISKR'];
  const outFields = url => (decodeURIComponent(url).match(/[?&]outFields=([^&]*)/) || [])[1] || '';
  const tf = outFields(ctx._nriTractUrl(40.015, -105.2705)).split(',');
  const cf = outFields(ctx._nriCountyUrl('08013')).split(',');
  check('NRI tract outFields: only confirmed fields', tf.length > 3 && tf.every(f => CONFIRMED.concat(['TRACTFIPS', 'COUNTY']).includes(f)), tf.join());
  check('NRI county outFields: only confirmed fields', cf.length > 3 && cf.every(f => CONFIRMED.concat(['COUNTY', 'AREA', 'STCOFIPS']).includes(f)), cf.join());
  check('no NRI request names RFLD', !/RFLD/.test(ctx._nriTractUrl(40, -105) + ctx._nriCountyUrl('08013')));
  check('NRI tract query uses the JSON point geometry form',
    decodeURIComponent(ctx._nriTractUrl(40.015, -105.2705)).includes('geometry={"x":-105.2705,"y":40.015,"spatialReference":{"wkid":4326}}'));
  check('NRI county query is by 5-digit STCOFIPS', decodeURIComponent(ctx._nriCountyUrl('08013')).includes("where=STCOFIPS='08013'"));

  // Mappings, Boulder fixtures
  const hail = v => ctx._mapNRIHail(v).score, wind = v => ctx._mapNRIWind(v).score;
  const winter = (w, c) => ctx._mapNRIWinter(w, c).score;
  check('hail: downtown 6.27 = 5', hail(NRI_FX.downtown.HAIL_AFREQ) === 5);
  check('hail: finding says events a year near this tract', /^About 6\.3 hail events a year recorded near this tract \(FEMA NRI\)$/.test(ctx._mapNRIHail(6.274).finding), ctx._mapNRIHail(6.274).finding);
  check('hail: cut points 0.99/1/2/3.5/5', hail(0.99) === 1 && hail(1) === 2 && hail(2) === 3 && hail(3.5) === 4 && hail(5) === 5);
  check('wind: downtown SWND 1.18 = 2, Medium, thunderstorm wind only', wind(NRI_FX.downtown.SWND_AFREQ) === 2 &&
    ctx._mapNRIWind(1.18).confidence === 'Medium' && ctx._mapNRIWind(1.18).finding.includes('Thunderstorm wind only; downslope windstorms are not counted'));
  check('winter: downtown WNTW 14.5 = 4, CWAV 1.1 (< 2) adds nothing', winter(NRI_FX.downtown.WNTW_AFREQ, NRI_FX.downtown.CWAV_AFREQ) === 4);
  check('winter: foothills WNTW 16.5 = 5', winter(NRI_FX.foothills.WNTW_AFREQ, NRI_FX.foothills.CWAV_AFREQ) === 5);
  check('winter: CWAV 2 or more adds one (14.5 -> 5), capped at 5', winter(14.5, 2) === 5 && winter(7, 2.5) === 4 && winter(20, 9) === 5);
  const trn = ctx._mapNRITornado(NRI_FX.county.TRND_AFREQ, NRI_FX.county.AREA, 'Boulder County');
  check('tornado: Boulder County 0.5238 / 747.9 sq mi = 0.70 per 1,000 sq mi = 3', trn.score === 3 && Math.abs(trn.density - 0.70) < 0.005, JSON.stringify(trn));
  check('tornado: finding names the county, Medium confidence', trn.finding.includes('Boulder County') && trn.confidence === 'Medium');
  check('tornado: density cut points', [[0.19, 1], [0.2, 2], [0.5, 3], [0.8, 4], [1.0, 5]].every(([d, s]) => ctx._mapNRITornado(d, 1000, '').score === s));
  check('tornado: zero area is no data', ctx._mapNRITornado(0.5, 0, '') === null);
  check('landslide fallback: foothills LNDS 0.019 = 3, Low, tract-level', ctx._mapNRILandslide(NRI_FX.foothills.LNDS_AFREQ).score === 3 &&
    ctx._mapNRILandslide(0.019).confidence === 'Low' && ctx._mapNRILandslide(0.019).finding.includes('tract-level, FEMA NRI'));
  check('landslide fallback: downtown LNDS 0.0000063 = 1; cut points', ctx._mapNRILandslide(NRI_FX.downtown.LNDS_AFREQ).score === 1 &&
    [[0.0009, 1], [0.001, 2], [0.01, 3], [0.05, 4], [0.2, 5]].every(([v, s]) => ctx._mapNRILandslide(v).score === s));
  check('missing NRI values are no data', ctx._mapNRIHail(null) === null && ctx._mapNRIWind(undefined) === null &&
    ctx._mapNRIWinter('', 3) === null && ctx._mapNRILandslide(null) === null);

  // Out-of-state tracts (live values, 2026-10-31)
  const X = NRI_FX;
  check('hail: Houston 3, Phoenix 1, Minneapolis 5, Seattle 1',
    [hail(X.houston.HAIL_AFREQ), hail(X.phoenix.HAIL_AFREQ), hail(X.minneapolis.HAIL_AFREQ), hail(X.seattle.HAIL_AFREQ)].join() === '3,1,5,1');
  check('winter: Houston 1, Phoenix 1, Minneapolis 5, Seattle 3',
    [X.houston, X.phoenix, X.minneapolis, X.seattle].map(r => winter(r.WNTW_AFREQ, r.CWAV_AFREQ)).join() === '1,1,5,3',
    [X.houston, X.phoenix, X.minneapolis, X.seattle].map(r => winter(r.WNTW_AFREQ, r.CWAV_AFREQ)).join());
  check('wind: Minneapolis 4, Seattle 1', wind(X.minneapolis.SWND_AFREQ) === 4 && wind(X.seattle.SWND_AFREQ) === 1);

  // Landslide tile math and colours
  const t1 = ctx._lsTileFor(40.0150, -105.2705), t2 = ctx._lsTileFor(40.0394, -105.3320);
  check('tile math: downtown 12/1550/850 px 130,223', [t1.level, t1.row, t1.col, t1.px, t1.py].join() === '12,1550,850,130,223', JSON.stringify(t1));
  check('tile math: foothills 12/1550/849 px 284,38', [t2.level, t2.row, t2.col, t2.px, t2.py].join() === '12,1550,849,284,38', JSON.stringify(t2));
  const LEG = ev('LS_LEGEND_FALLBACK');
  const m = (rgba, tol) => ctx._lsMatchClass(rgba, LEG, tol);
  check('colour: 231,33,36 alpha 191 = class 4', m([231, 33, 36, 191]) === 4);
  check('colour: 0,0,0,0 = negligible (0)', m([0, 0, 0, 0]) === 0);
  check('colour: near a legend colour matches within tolerance', m([245, 40, 30, 255]) === 4 && m([120, 20, 18, 200]) === 5 && m([250, 210, 120, 191]) === 1);
  check('colour: far from every legend colour is no match', m([0, 128, 255, 255]) === null && m([231, 33, 36, 191], 0) === 4 && m([235, 33, 36, 191], 2) === null);
  check('colour: built-in legend table matches the fixture',
    JSON.stringify(LEG) === JSON.stringify({ 1: [251, 213, 117], 2: [247, 168, 20], 3: [241, 129, 129], 4: [231, 33, 36], 5: [114, 16, 15] }));
  const px = (...cols) => cols.reduce((a, c) => a.concat(c), []);
  const red = [231, 33, 36, 191], clear = [0, 0, 0, 0];
  check('3x3 mode: majority colour wins', ctx._lsModeColor(px(red, red, red, red, red, clear, clear, clear, clear)).join() === '231,33,36,191');
  check('3x3 mode: mostly transparent reads as no colour', ctx._lsModeColor(px(red, red, clear, clear, clear, clear, clear, red, clear)).join() === '0,0,0,0');
  const lr = (c, i, p) => ctx._landslideResult(c, i, p);
  check('landslide classes: negligible 1, class 1 2, 2 3, 3 4, 4 5, 5 5',
    [0, 1, 2, 3, 4, 5].map(c => lr(c, 0, 0).score).join() === '1,2,3,4,5,5');
  check('landslide confidence: High for negligible and 4 to 5, Medium for 1 to 3',
    [0, 1, 2, 3, 4, 5].map(c => lr(c, 0, 0).confidence).join() === 'High,Medium,Medium,Medium,High,High');
  check('landslide finding: "Susceptibility class 4 of 5 at this point"', lr(4, 0, 0).finding.startsWith('Susceptibility class 4 of 5 at this point'));
  check('landslide modifier: inventory within 1 km adds one and says so', lr(2, 1, 0).score === 4 && /landslide inventory/.test(lr(2, 1, 0).finding));
  check('landslide modifier: post-fire basin adds one and says so', lr(0, 0, 2).score === 2 && /post-fire debris-flow basin/.test(lr(0, 0, 2).finding));
  check('landslide modifier: both add one only, capped at 5', lr(2, 3, 1).score === 4 && lr(5, 1, 1).score === 5);
  check('landslide modifier: an unchecked layer is named', /Not checked: landslide inventory/.test(lr(1, null, 0).finding) && lr(1, null, null).score === 2);

  // OpenFEMA counts and floors
  const rows = [
    ...Array.from({ length: 9 }, (_, i) => ({ disasterNumber: 5000 + i, incidentType: 'Fire', declarationDate: '2010-09-07T00:00:00.000Z', fipsCountyCode: '013' })),
    ...Array.from({ length: 5 }, (_, i) => ({ disasterNumber: 4000 + i, incidentType: 'Flood', declarationDate: '2013-09-14T00:00:00.000Z', fipsCountyCode: '013' })),
    { disasterNumber: 3000, incidentType: 'Snowstorm', declarationDate: '2003-03-20T00:00:00.000Z', fipsCountyCode: '013' },
    { disasterNumber: 3001, incidentType: 'Snowstorm', declarationDate: '2007-01-05T00:00:00.000Z', fipsCountyCode: '013' },
    { disasterNumber: 2000, incidentType: 'Coastal Storm', declarationDate: '2005-09-02T00:00:00.000Z', fipsCountyCode: '000' },
    { disasterNumber: 1000, incidentType: 'Tornado', declarationDate: '1995-06-01T00:00:00.000Z', fipsCountyCode: '013' },
    { disasterNumber: 5000, incidentType: 'Fire', declarationDate: '2010-09-07T00:00:00.000Z', fipsCountyCode: '013' },
  ];
  const counts = ctx._countDeclarations(rows, 2000);
  check('declarations: county 000 rows ignored, pre-2000 ignored, repeats counted once',
    JSON.stringify(counts) === JSON.stringify({ Fire: 9, Flood: 5, Snowstorm: 2 }), JSON.stringify(counts));
  ev('state = freshState();');
  const mk = (id, score, status) => ({ hazardId: id, hazardName: names[id], category: 'Natural Hazards', scoreAssigned: score, source: 'S', finding: 'F', confidence: 'High', status: status || 'success', isOverridden: false });
  let fs1 = [mk(1, 1), mk(3, 2), mk(4, 5), mk(8, 4), mk(6, 1)];
  const changed = ctx._applyDeclarationFloors(fs1, counts, 'Boulder County', 'CO');
  check('floor: Boulder 9 fire raises wildfire 1 to 4', fs1[0].scoreAssigned === 4 &&
    fs1[0].finding === 'F. FEMA has declared 9 fire disasters in Boulder County since 2000.' && fs1[0].source === 'S', fs1[0].finding);
  check('floor: 5 floods raise river flood 2 to 3, never lower flash flood 5', fs1[1].scoreAssigned === 3 && fs1[2].scoreAssigned === 5 && fs1[2].finding === 'F');
  check('floor: winter already 4 stays 4, tornado with no declarations stays 1', fs1[3].scoreAssigned === 4 && fs1[4].scoreAssigned === 1);
  check('floor: returns the changed ids', JSON.stringify(changed) === '[1,3]', JSON.stringify(changed));
  const fs2 = [mk(1, 2)];
  ctx._applyDeclarationFloors(fs2, { Fire: 4, Snowstorm: 1, 'Severe Ice Storm': 1, Tornado: 2 }, 'X County', 'CO');
  check('floor: 3 to 5 fires raise wildfire to 3; no finding is created for winter or tornado', fs2.length === 1 && fs2[0].scoreAssigned === 3);
  const fs3 = [mk(8, 2), mk(6, 2), mk(7, 1, 'estimated')];
  ev('state.scores[7] = {};');
  ctx._applyDeclarationFloors(fs3, { Snowstorm: 1, 'Severe Ice Storm': 1, Tornado: 2, Hurricane: 1, Typhoon: 1 }, 'X County', 'FL');
  check('floor: snowstorm plus ice storm, tornado, hurricane plus typhoon each raise to 3', fs3.every(f => f.scoreAssigned === 3) && fs3[2].status === 'estimated');
  ev('state = freshState();');
  const fs4 = [mk(7, 1, 'estimated')];
  ctx._applyDeclarationFloors(fs4, { Hurricane: 3 }, 'X County', 'CO');
  check('floor: hurricane ruled out (na) is not raised', fs4[0].scoreAssigned === 1);
  check('floor: no counts changes nothing', ctx._applyDeclarationFloors([mk(1, 1)], null, '', 'CO').length === 0);

  // _compileFindings with NRI
  ev('state = freshState();');
  const geo = { lat: 40.015, lng: -105.2705, zip: '80302', stateAbbr: 'CO', county: 'Boulder County', fips5: '08013' };
  const ok = { score: 3, finding: 'x', confidence: 'High' };
  const base = { flood: ok, earthquake: ok, wildfire: ok, weather: { stateAbbr: 'CO' }, drought: ok,
    epa: { chemScore: 2, finding: '2 facilities', confidence: 'Medium', highHazardCount: 1, potwCount: 1 } };
  const by = (fs, id) => fs.find(f => f.hazardId === id);
  const withNri = ctx._compileFindings(Object.assign({}, base, { landslide: null, nri: { tract: NRI_FX.downtown, county: NRI_FX.county } }), geo);
  check('NRI: hail 5, wind 2, winter 4, tornado 3, all public data',
    [5, 63, 8, 6].map(id => by(withNri, id) && by(withNri, id).scoreAssigned).join() === '5,2,4,3' &&
    [5, 63, 8, 6].every(id => by(withNri, id).status === 'success'), [5, 63, 8, 6].map(id => JSON.stringify(by(withNri, id))).join(' | '));
  check('NRI: tract source label and confidence', by(withNri, 5).source === 'FEMA National Risk Index (census tract), December 2025 release' &&
    by(withNri, 5).confidence === 'High' && by(withNri, 8).confidence === 'High' && by(withNri, 63).confidence === 'Medium');
  check('NRI: tornado uses the county label and names Boulder County', by(withNri, 6).source === 'FEMA National Risk Index (county), December 2025 release' &&
    by(withNri, 6).finding.includes('Boulder County'));
  check('NRI: extreme heat stays on the state rule of thumb', by(withNri, 9).status === 'estimated' && /rule of thumb/.test(by(withNri, 9).source));
  check('NRI: landslide falls back to tract LNDS when the tile fails (downtown = 1, Low)', by(withNri, 11).scoreAssigned === 1 && by(withNri, 11).confidence === 'Low' &&
    by(withNri, 11).status === 'success');
  const foot = ctx._compileFindings(Object.assign({}, base, { landslide: null, nri: { tract: NRI_FX.foothills, county: NRI_FX.county } }), geo);
  check('NRI: foothills winter 5, landslide fallback 3', by(foot, 8).scoreAssigned === 5 && by(foot, 11).scoreAssigned === 3);
  const usgs = Object.assign(ctx._landslideResult(4, 0, 0), { source: ev('LS_SRC') });
  const withTile = ctx._compileFindings(Object.assign({}, base, { landslide: usgs, nri: { tract: NRI_FX.foothills, county: NRI_FX.county } }), geo);
  check('landslide: USGS tile class 4 = 5 with the 2024 source label', by(withTile, 11).scoreAssigned === 5 &&
    by(withTile, 11).source === 'USGS landslide susceptibility 2024 (90 m)' && by(withTile, 11).confidence === 'High');
  const noNri = ctx._compileFindings(Object.assign({}, base, { landslide: null, nri: null }), geo);
  check('no NRI: hail, winter and tornado use the state rule of thumb', [5, 8, 6].every(id => by(noNri, id).status === 'estimated' && /rule of thumb/.test(by(noNri, id).source)));
  check('no NRI: no high wind finding (stays on the judgment list)', !by(noNri, 63));
  check('no NRI and no tile: no landslide finding (judgment list)', !by(noNri, 11));
  const decl = ctx._compileFindings(Object.assign({}, base, { wildfire: { score: 1, finding: 'USFS Wildfire Hazard Potential: Very Low', confidence: 'High' },
    landslide: null, nri: { tract: NRI_FX.downtown, county: NRI_FX.county }, declarations: { Fire: 9, Flood: 5, Snowstorm: 2 } }), geo);
  const declNone = ctx._compileFindings(Object.assign({}, base, { wildfire: { score: 1, finding: 'USFS Wildfire Hazard Potential: Very Low', confidence: 'High' },
    landslide: null, nri: { tract: NRI_FX.downtown, county: NRI_FX.county } }), geo);
  check('compile: declaration floor raises wildfire 1 to 4, after the smoke estimate (smoke unchanged)', by(decl, 1).scoreAssigned === 4 &&
    by(declNone, 1).scoreAssigned === 1 && by(decl, 1).finding.endsWith('FEMA has declared 9 fire disasters in Boulder County since 2000.') &&
    by(decl, 23).scoreAssigned === by(declNone, 23).scoreAssigned, by(decl, 1).finding);
  const partial = ctx._compileFindings(Object.assign({}, base, { landslide: null, nri: { tract: null, county: NRI_FX.county } }), geo);
  check('NRI county only: tornado from NRI, hail and winter on the rule of thumb', by(partial, 6).status === 'success' &&
    by(partial, 5).status === 'estimated' && by(partial, 8).status === 'estimated' && !by(partial, 63));
  const outside = ctx._compileFindings(Object.assign({}, base, { landslide: null, nri: { tract: Object.assign({ COUNTY: 'Hennepin' }, NRI_FX.minneapolis), county: null } }), { stateAbbr: 'MN' });
  check('Minneapolis tract: hail 5, wind 4, winter 5', [5, 63, 8].map(id => by(outside, id).scoreAssigned).join() === '5,4,5');

  const all = [withNri, foot, withTile, noNri, decl, partial, outside].reduce((a, b) => a.concat(b), []);
  check('v3.1 findings never reference removed ids', all.every(f => !REMOVED.includes(f.hazardId)));
  check('v3.1 finding names match HAZARD_DATA', all.every(f => f.hazardName === names[f.hazardId]), all.filter(f => f.hazardName !== names[f.hazardId]).map(f => f.hazardId).join());
  check('v3.1 findings keep the shape', all.every(f => ['hazardId', 'hazardName', 'category', 'scoreAssigned', 'source', 'finding', 'confidence', 'status'].every(k => k in f)));
  // New copy only (older USFS and flood source strings still carry em dashes, out of scope here)
  const copy = all.filter(f => /National Risk Index|USGS landslide/.test(f.source)).map(f => f.source + ' ' + f.finding)
    .concat(all.map(f => (String(f.finding).match(/FEMA has declared[^]*$/) || [])[0]).filter(Boolean))
    .concat([ev('MANUAL_REASONS')[11], ev('MANUAL_REASONS')[63]]);
  check('v3.1 copy: no em dash or exclamation point', copy.length > 0 && !copy.some(t => /[—!]/.test(t)), copy.filter(t => /[—!]/.test(t)).join(' | '));

  // Summary wording
  const est = (n, src) => Array.from({ length: n }, () => ({ status: 'estimated', source: src }));
  const RULE = ev('WEATHER_RULE_SRC');
  check('summary: rule of thumb items get their own sentence',
    ctx._researchSummarySub(est(1, RULE), 0, 3) === 'No address-level source exists yet for 1 item; it uses a state rule of thumb. 3 need your judgment.',
    ctx._researchSummarySub(est(1, RULE), 0, 3));
  check('summary: two rule of thumb items, plural',
    ctx._researchSummarySub(est(2, RULE), 0, 3) === 'No address-level source exists yet for 2 items; they use a state rule of thumb. 3 need your judgment.');
  check('summary: real placeholders still say a source did not respond',
    ctx._researchSummarySub(est(2, 'World Aware placeholder (x did not respond)').concat(est(1, RULE)), 1, 4) ===
    '2 are rough placeholders because a source did not respond. No address-level source exists yet for 1 item; it uses a state rule of thumb. 1 could not be scored. 4 need your judgment.');
  check('research with NRI in Colorado: only extreme heat is on the rule of thumb', withNri.filter(f => ctx._isRuleOfThumb(f)).map(f => f.hazardId).join() === '9');
  check('report sentence splits rule of thumb from placeholders',
    ctx._sourcesSentence({ findingCount: 12, estimatedCount: 2, ruleOfThumbCount: 1 }) ===
    'Public data supplied the likelihood for 10 hazards; 1 is a rough placeholder because a source did not respond; no address-level source exists yet for 1 item; it uses a state rule of thumb.',
    ctx._sourcesSentence({ findingCount: 12, estimatedCount: 2, ruleOfThumbCount: 1 }));
  check('report sentence for an old saved report reads as before', ctx._sourcesSentence({ findingCount: 3, estimatedCount: 1 }) ===
    'Public data supplied the likelihood for 2 hazards; 1 is a rough placeholder because a source did not respond.');
  check('MANUAL_REASONS: landslide points to the USGS map, no "no source"', /https:\/\/www\.usgs\.gov\/tools\/us-landslide-inventory-and-susceptibility-map/.test(ev('MANUAL_REASONS')[11]));
  const steps = ev('STEPS');
  check('steps: nri and declarations steps with the spec labels',
    steps.some(s => s.id === 'nri' && s.label === 'Checking FEMA National Risk Index for your census tract') &&
    steps.some(s => s.id === 'declarations' && s.label === 'Checking FEMA disaster declarations for your county'));

  // Network paths with mocked fetch (no network in tests)
  const json = body => Promise.resolve({ ok: true, status: 200, json: async () => body });
  const seen = [];
  const route = handler => { seen.length = 0; ctx.fetch = (url) => { seen.push(String(url)); return handler(String(url)); }; };

  route(url => url.includes('Census_Tracts') ? json({ features: [{ attributes: NRI_FX.downtown }] })
    : url.includes('National_Risk_Index_Counties') ? json({ features: [{ attributes: NRI_FX.county }] })
    : Promise.reject(new Error('unexpected ' + url)));
  const nri = await ctx._callNRIAPI(40.015, -105.2705, '08013');
  check('_callNRIAPI: tract and county rows, both direct, in parallel', nri.tract.TRACTFIPS === '08013012206' && nri.county.COUNTY === 'Boulder' &&
    seen.length === 2 && seen.every(u => u.startsWith('https://services.arcgis.com/XG15cJAlne2vxtgt/')));
  route(url => url.includes('Census_Tracts') ? json({ error: { code: 400, message: "'outFields' parameter is invalid" } })
    : json({ features: [{ attributes: NRI_FX.county }] }));
  const half = await ctx._callNRIAPI(40.015, -105.2705, '08013');
  check('_callNRIAPI: an ArcGIS error on one layer keeps the other', half.tract === null && half.county.AREA > 700);
  route(() => Promise.reject(new Error('down')));
  let nriErr = null; try { await ctx._callNRIAPI(40, -105, '08013'); } catch (e) { nriErr = e; }
  check('_callNRIAPI: throws when both fail', !!nriErr);

  // Flood Method D from the shared NRI result, with the relay off
  const savedRelay = cfg.RELAY_URL;
  cfg.RELAY_URL = '';
  route(url => url.includes('USA_Flood_Hazard_Areas') ? Promise.reject(new Error('down')) : Promise.reject(new Error('unexpected ' + url)));
  const fl = await ctx._callFloodAPI(40.015, -105.2705, '08013', Promise.resolve({ tract: NRI_FX.downtown, county: NRI_FX.county }));
  check('flood Method D: county IFLD_AFREQ 4.2 = 3, county-wide, without the relay', fl.score === 3 && /county-wide/.test(fl.finding) && /Boulder County/.test(fl.finding), JSON.stringify(fl));
  route(url => url.includes('National_Risk_Index_Counties') ? json({ features: [{ attributes: { COUNTY: 'Boulder', AREA: 747.9 } }] }) : Promise.reject(new Error('down')));
  let flErr = null; try { await ctx._callFloodAPI(40.015, -105.2705, '08013', Promise.resolve(null)); } catch (e) { flErr = e; }
  check('flood Method D: missing IFLD_AFREQ is handled; relay off still says so', flErr && flErr.code === 'RELAY_NOT_CONFIGURED');
  cfg.RELAY_URL = savedRelay;

  // OpenFEMA call
  route(url => json({ DisasterDeclarationsSummaries: rows }));
  const dc = await ctx._callDeclarationsAPI('08', '013');
  const durl = decodeURIComponent(seen[0] || '');
  check('_callDeclarationsAPI: direct, state and county filter, select and top', durl.startsWith('https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?') &&
    durl.includes("$filter=fipsStateCode eq '08' and fipsCountyCode eq '013'") && durl.includes('$select=disasterNumber,incidentType,declarationDate,fipsCountyCode') &&
    durl.includes('$top=1000') && dc.Fire === 9, durl);
  let dErr = null; try { await ctx._callDeclarationsAPI('', ''); } catch (e) { dErr = e; }
  check('_callDeclarationsAPI: no FIPS throws (step fails quietly)', !!dErr);

  // Landslide call with the tile reader stubbed (no canvas in node)
  route(url => url.includes('returnCountOnly=true') ? json({ count: url.includes('US_Landslide_point_v2') ? 1 : 0 }) : Promise.reject(new Error('unexpected ' + url)));
  ev('_lsLegendTable = () => Promise.resolve({ table: LS_LEGEND_FALLBACK, fromService: false });');
  let tileAsked = null;
  ctx._lsSample = async (u, x, y) => { tileAsked = [u, x, y]; return [241, 129, 129, 191]; };
  const ls = await ctx._callLandslideAPI(40.0394, -105.3320);
  check('_callLandslideAPI: reads tile 12/1550/849 at 284,38', tileAsked && tileAsked[0] === cfg.USGS_LANDSLIDE + '/tile/12/1550/849' && tileAsked[1] === 284 && tileAsked[2] === 38, JSON.stringify(tileAsked));
  check('_callLandslideAPI: class 3 plus an inventory landslide within 1 km = 5', ls.score === 5 && /class 3 of 5/.test(ls.finding) && /landslide inventory/.test(ls.finding) && ls.source === 'USGS landslide susceptibility 2024 (90 m)', JSON.stringify(ls));
  check('_callLandslideAPI: modifier queries are count-only within 1,000 m', seen.length === 2 && seen.every(u => u.includes('distance=1000') && u.includes('units=esriSRUnit_Meter') && u.includes('returnCountOnly=true')));
  ctx._lsSample = async () => { throw new Error('Landslide tile could not be read: tainted'); };
  let lsErr = null; try { await ctx._callLandslideAPI(40.0394, -105.3320); } catch (e) { lsErr = e; }
  check('_callLandslideAPI: a tainted canvas is a failure (NRI fallback takes over)', lsErr && /tainted/.test(lsErr.message));
  check('_lsReadPixels throws without a canvas (node)', (() => { try { ctx._lsReadPixels({}, 0, 0, 1, 1); return false; } catch (e) { return true; } })());
  ctx.fetch = () => Promise.reject(new Error('no network in tests'));

  // Wiring
  const src = fs.readFileSync(path.join(ROOT, 'js/research.js'), 'utf8');
  check('runner: one NRI promise shared with flood', /const nriP = _tracked\('nri', _callNRIAPI\(lat, lng, fips5\)\)/.test(src) && src.includes('_callFloodAPI(lat, lng, fips5, nriP)'));
  check('landslide tile image uses crossOrigin anonymous', /img\.crossOrigin = 'anonymous'/.test(src));
  check('extreme heat comment explains why NRI HWAV is not used', /HWAV_AFREQ\s*\/\/\s*rates Boulder "Very Low"/.test(src));
}

asyncChecks().then(v31Checks).catch(e => { failed++; console.log('  FAIL async checks threw — ' + e.message + '\n' + e.stack); }).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});