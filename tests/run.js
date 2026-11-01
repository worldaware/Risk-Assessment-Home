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
  // v3.2.0 Stage B: without normals, heat falls back to NRI HWAV (was the rule of thumb in v3.1)
  check('NRI, no normals: extreme heat falls back to NRI HWAV (downtown 0.79 = 1, Low, data)', by(withNri, 9).status === 'success' &&
    by(withNri, 9).scoreAssigned === 1 && by(withNri, 9).confidence === 'Low' && by(withNri, 9).finding.includes('based on recorded heat events (FEMA NRI)'));
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
  check('research with NRI in Colorado: nothing is on the rule of thumb (heat now has NRI HWAV, hurricane ruled out)', withNri.filter(f => ctx._isRuleOfThumb(f)).length === 0,
    withNri.filter(f => ctx._isRuleOfThumb(f)).map(f => f.hazardId).join());
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
  check('extreme heat comment explains why NRI HWAV is only the fallback', /NRI HWAV_AFREQ is only the fallback/.test(src) && /0\.79 heat wave days a year/.test(src));
}

console.log('Privacy statement placement (Henry, 2026-10-31)');
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const home  = html.slice(html.indexOf('id="screen-home"'), html.indexOf('id="screen-assessment"'));
  const about = html.slice(html.indexOf('id="screen-about"'), html.indexOf('id="screen-report"'));
  const SHORT = 'Nothing leaves your device until you tap Research. World Aware does not store your address.';
  const LONG  = 'your street address goes to OpenStreetMap';
  const homeNote = home.indexOf('class="alert alert-info research-privacy home-privacy"');
  check('Home has the short privacy note', homeNote > -1 && home.replace(/\s+/g, ' ').includes(SHORT + ' Your results stay in this browser.'));
  check('Home note sits below the address card and the saved list', homeNote > home.indexOf('id="home-address-card"') && homeNote > home.indexOf('id="home-saved-list"'));
  check('Home no longer carries the full statement', !home.includes(LONG));
  const aboutNote = about.indexOf('id="about-privacy"');
  check('About has the full privacy statement', aboutNote > -1 && about.includes(LONG) && about.includes('ask for your PDF, then ask them to clear it'));
  check('About statement sits at the bottom, below the version line', aboutNote > about.indexOf('class="about-version"'));
}

/* ---------------------------------------------------------------
   v3.2.0 Stage A: water (27) and soil (66)
   Fixture values are the live answers captured from Henry's browser on
   2026-10-31 (fixtures-v32.json). The Boulder violation rows are rebuilt
   from the capture note (7 rows, 2 health-based beginning 2017-04-01 and
   2017-07-01, no Tier 1); their rtc_date values were not captured, so the
   dates below are test values.
--------------------------------------------------------------- */
const WATER_FX = {
  downtown: { PWSID: 'CO0107152', PWS_Name: 'BOULDER CITY OF', Population_Served_Count: 166080, Service_Area_Type: 'Residential Area' },
  violations: [
    { violation_code: '01', violation_category_code: 'MCL', is_health_based_ind: 'Y', compl_per_begin_date: '2017-04-01 00:00:00', public_notification_tier: 2, rtc_date: '2017-09-30 00:00:00' },
    { violation_code: '01', violation_category_code: 'MCL', is_health_based_ind: 'Y', compl_per_begin_date: '2017-07-01 00:00:00', public_notification_tier: 2, rtc_date: '2017-12-31 00:00:00' },
    { violation_code: '75', violation_category_code: 'RPT', is_health_based_ind: 'N', compl_per_begin_date: '2019-01-01 00:00:00', public_notification_tier: 3, rtc_date: '2019-03-01 00:00:00' },
    { violation_code: '36', violation_category_code: 'MR',  is_health_based_ind: 'N', compl_per_begin_date: '2020-04-01 00:00:00', public_notification_tier: 3, rtc_date: '2020-06-01 00:00:00' },
    { violation_code: '36', violation_category_code: 'MR',  is_health_based_ind: 'N', compl_per_begin_date: '2021-10-01 00:00:00', public_notification_tier: 3, rtc_date: '2021-12-01 00:00:00' },
    { violation_code: '75', violation_category_code: 'RPT', is_health_based_ind: 'N', compl_per_begin_date: '2023-01-01 00:00:00', public_notification_tier: 3, rtc_date: '2023-02-01 00:00:00' },
    { violation_code: '36', violation_category_code: 'MR',  is_health_based_ind: 'N', compl_per_begin_date: '2024-07-01 00:00:00', public_notification_tier: 3, rtc_date: null },
  ],
};
const SDA_FX = {
  downtown:  { Table: [['compname', 'comppct_r', 'hzdept_r', 'hzdepb_r', 'lep_r'], ['Niwot', '85', '0', '36', '2.4'], ['Niwot', '85', '36', '48', '4.1'], ['Niwot', '85', '48', '152', '0.3']] },
  foothills: { Table: [['compname', 'comppct_r', 'hzdept_r', 'hzdepb_r', 'lep_r'], ['Lefthand', '60', '0', '6', '0.6'], ['Lefthand', '60', '6', '27', '0.6'], ['Lefthand', '60', '27', '51', '0.4'], ['Lefthand', '60', '51', '81', '0.2'], ['Lefthand', '60', '81', '150', null]] },
};
const SDA_SQL_DOWNTOWN = "SELECT c.compname, c.comppct_r, ch.hzdept_r, ch.hzdepb_r, ch.lep_r FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(-105.2705 40.015)') AS k JOIN component c ON c.mukey = k.mukey JOIN chorizon ch ON ch.cokey = c.cokey WHERE c.majcompflag = 'Yes' AND ch.hzdept_r < 150 ORDER BY c.comppct_r DESC, ch.hzdept_r";

async function v32StageAChecks() {
  console.log('v3.2.0 Stage A: water and soil');
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
  const cats = Object.fromEntries(HD.map(h => [h.id, h.category]));
  const json = body => Promise.resolve({ ok: true, status: 200, json: async () => body });
  const seen = [];
  const route = handler => { seen.length = 0; ctx.fetch = (url, opts) => { seen.push({ url: String(url), opts: opts || {} }); return handler(String(url), opts || {}); }; };
  const NOW = new Date(2026, 9, 31);   // 2026-10-31

  // Config and ids
  check('Stage A config: water boundaries, SDWIS violations and SDA endpoints',
    cfg.EPA_WATER_BOUNDARIES === 'https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Water_System_Boundaries/FeatureServer/0/query' &&
    cfg.EPA_SDWIS_VIOLATIONS === 'https://data.epa.gov/efservice/VIOLATION/PWSID' &&
    cfg.USDA_SDA === 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest');
  check('Stage A names match HAZARD_DATA exactly (27 and 66)', ev('H_NAME')[27] === names[27] && ev('H_NAME')[66] === names[66] &&
    names[27] === 'Water outage or unsafe tap water' && names[66] === 'Shifting or swelling soil under the house');
  check('Stage A categories: 27 Outages & Service Interruptions, 66 Natural Hazards', ev('_hCat')(27) === cats[27] && ev('_hCat')(66) === cats[66]);
  const steps = ev('STEPS');
  check('Stage A steps: water and soil with the spec labels, after declarations',
    steps.findIndex(s => s.id === 'water' && s.label === 'Checking your drinking-water system (EPA)') === steps.findIndex(s => s.id === 'declarations') + 1 &&
    steps.some(s => s.id === 'soil' && s.label === 'Checking soil shrink-swell (USDA)'));

  // ── Soil mapping at the boundaries ──
  const sc = v => ctx._soilScore(v);
  check('soil score: 2.99 = 1, 3 = 2', sc(2.99) === 1 && sc(3) === 2);
  check('soil score: 4.49 = 2, 4.5 = 3', sc(4.49) === 2 && sc(4.5) === 3);
  check('soil score: 5.99 = 3, 6 = 4', sc(5.99) === 3 && sc(6) === 4);
  check('soil score: 8.99 = 4, 9 = 5, 25 = 5', sc(8.99) === 4 && sc(9) === 5 && sc(25) === 5);
  check('soil score: 0 = 1', sc(0) === 1);
  check('soil class words: low under 3, moderate 3 to 6, high 6 to 9, very high 9 and up',
    [2.9, 3, 5.9, 6, 8.9, 9].map(ctx._soilClass).join() === 'low,moderate,moderate,high,high,very high');

  // ── Soil fixtures ──
  const sd = ctx._mapSoilTable(SDA_FX.downtown), sf = ctx._mapSoilTable(SDA_FX.foothills);
  check('soil fixture: downtown max 4.1 = 2, Medium, SSURGO source', sd.score === 2 && sd.confidence === 'Medium' &&
    sd.source === 'USDA NRCS Soil Data Access (SSURGO), linear extensibility', JSON.stringify(sd));
  check('soil fixture: downtown names the component, value, layer and class',
    sd.finding.startsWith('Niwot: shrink-swell (LEP) up to 4.1 percent in a layer at 36 to 48 cm; moderate.'), sd.finding);
  check('soil fixture: foothills max 0.6 = 1 (null horizon counts as 0), low',
    sf.score === 1 && sf.finding.startsWith('Lefthand: shrink-swell (LEP) up to 0.6 percent in a layer at 0 to 6 cm; low.'), sf.finding);
  check('soil: a horizon starting at 150 cm or deeper is ignored',
    ctx._mapSoilTable({ Table: [['compname', 'hzdept_r', 'hzdepb_r', 'lep_r'], ['A', '0', '50', '2'], ['A', '150', '200', '12']] }).score === 1);
  check('soil: the largest value across components wins and names its component',
    (() => { const r = ctx._mapSoilTable({ Table: [['compname', 'comppct_r', 'hzdept_r', 'hzdepb_r', 'lep_r'], ['A', '60', '0', '30', '3.2'], ['B', '30', '10', '40', '9.4']] });
      return r.score === 5 && r.finding.startsWith('B: shrink-swell (LEP) up to 9.4 percent in a layer at 10 to 40 cm; very high.'); })());
  check('soil: column order is read from the header, not assumed',
    ctx._mapSoilTable({ Table: [['lep_r', 'hzdepb_r', 'hzdept_r', 'compname'], ['6.0', '20', '0', 'Reorder']] }).score === 4);
  check('soil: every lep_r null is no data, not a low score',
    ctx._mapSoilTable({ Table: [['compname', 'hzdept_r', 'hzdepb_r', 'lep_r'], ['Rock outcrop', '0', '20', null]] }) === null);
  check('soil: header only, no table, or no lep column is no data',
    ctx._mapSoilTable({ Table: [['compname', 'lep_r']] }) === null && ctx._mapSoilTable({}) === null && ctx._mapSoilTable(null) === null &&
    ctx._mapSoilTable({ Table: [['compname'], ['A']] }) === null);

  // ── Soil call: SQL and the POST ──
  check('soil SQL for downtown matches the captured query exactly', ctx._soilSql(40.015, -105.2705) === SDA_SQL_DOWNTOWN, ctx._soilSql(40.015, -105.2705));
  check('soil SQL rounds to 4 decimals and writes longitude first', ctx._soilSql(40.039412, -105.33201).includes("point(-105.332 40.0394)"));
  route(() => json(SDA_FX.downtown));
  const soilCall = await ctx._callSoilAPI(40.015, -105.2705);
  const post = seen[0];
  const bodyFields = Object.fromEntries(String(post.opts.body).split('&').map(kv => kv.split('=').map(decodeURIComponent)));
  check('soil call: one POST to the SDA endpoint, form-encoded, no preflight header',
    seen.length === 1 && post.url === cfg.USDA_SDA && post.opts.method === 'POST' &&
    post.opts.headers['Content-Type'] === 'application/x-www-form-urlencoded' && Object.keys(post.opts.headers).length === 1, JSON.stringify(post.opts));
  check('soil call: body carries the SQL and JSON+COLUMNNAME (the plus is encoded)',
    bodyFields.query === SDA_SQL_DOWNTOWN && bodyFields.format === 'JSON+COLUMNNAME' && String(post.opts.body).includes('format=JSON%2BCOLUMNNAME'), post.opts.body);
  check('soil call: downtown result is 2', soilCall.score === 2);
  route(() => json(SDA_FX.foothills));
  check('soil call: foothills result is 1', (await ctx._callSoilAPI(40.0394, -105.332)).score === 1);
  route(() => json({ Table: [['compname', 'lep_r']] }));
  let e1 = null; try { await ctx._callSoilAPI(40, -105); } catch (e) { e1 = e; }
  check('soil call: no rows throws (Needs your judgment)', !!e1);
  route(() => Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } }));
  e1 = null; try { await ctx._callSoilAPI(40, -105); } catch (e) { e1 = e; }
  check('soil call: an empty body (water or unmapped point) throws', !!e1);
  route(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) }));
  e1 = null; try { await ctx._callSoilAPI(40, -105); } catch (e) { e1 = e; }
  check('soil call: HTTP 500 throws', !!e1 && /HTTP 500/.test(e1.message));
  route(() => Promise.reject(new Error('down')));
  e1 = null; try { await ctx._callSoilAPI(40, -105); } catch (e) { e1 = e; }
  check('soil call: network failure throws', !!e1);

  // ── Water: system choice ──
  const pick = ctx._pickWaterSystem;
  const feat = (id, name, pop, type) => ({ attributes: { PWSID: id, PWS_Name: name, Population_Served_Count: pop, Service_Area_Type: type } });
  check('water pick: the fixture polygon', (() => { const r = pick([{ attributes: WATER_FX.downtown }]); return r.pwsid === 'CO0107152' && r.name === 'BOULDER CITY OF' && r.population === 166080; })());
  check('water pick: no features or an unusable PWSID is no system', pick([]) === null && pick(null) === null && pick([feat('bad id', 'X', 5, 'Residential Area')]) === null);
  check('water pick: overlapping polygons prefer residential, then the smaller system',
    pick([feat('CO0000001', 'BIG', 500000, 'Residential Area'), feat('CO0000002', 'DISTRICT', 8000, 'Residential Area'), feat('CO0000003', 'PARK', 50, 'Mobile Home Park')]).pwsid === 'CO0000002');
  check('water pick: markup characters are stripped from the name', pick([feat('CO0000001', 'A<b>&"B', 10, 'Residential Area')]).name === 'AbB');

  // ── Water: score rules at their boundaries (now = 2026-10-31) ──
  const sys = pop => ({ pwsid: 'CO0107152', name: 'TEST WATER', population: pop });
  const hb = (begin, extra) => Object.assign({ is_health_based_ind: 'Y', compl_per_begin_date: begin, public_notification_tier: 2, rtc_date: '2030-01-01 00:00:00' }, extra || {});
  const nh = (begin, extra) => Object.assign({ is_health_based_ind: 'N', compl_per_begin_date: begin, public_notification_tier: 3, rtc_date: '2030-01-01 00:00:00' }, extra || {});
  const ws = (pop, rows) => ctx._mapWaterSystem(sys(pop), rows, NOW).score;
  check('water: no violations, large system = 1', ws(166080, []) === 1);
  check('water: population 3,300 adds nothing, 3,299 adds one', ws(3300, []) === 1 && ws(3299, []) === 2 && ws(0, []) === 2);
  check('water: unknown population adds nothing', ctx._mapWaterSystem({ pwsid: 'CO0107152', name: 'X', population: null }, [], NOW).score === 1);
  check('water: health-based violation that began exactly 5 years ago counts, a day earlier does not',
    ws(50000, [hb('2021-10-31 00:00:00')]) === 2 && ws(50000, [hb('2021-10-30 00:00:00')]) === 1);
  check('water: a recent violation that is not health-based adds nothing', ws(50000, [nh('2026-01-01 00:00:00')]) === 1);
  check('water: Tier 1 began exactly 10 years ago counts, a day earlier does not',
    ws(50000, [nh('2016-10-31 00:00:00', { public_notification_tier: 1 })]) === 2 && ws(50000, [nh('2016-10-30 00:00:00', { public_notification_tier: 1 })]) === 1);
  check('water: Tier 1 given as the string "1" counts', ws(50000, [nh('2020-01-01 00:00:00', { public_notification_tier: '1' })]) === 2);
  check('water: a health-based violation with no rtc_date adds one (null, missing and empty)',
    ws(50000, [hb('2010-01-01 00:00:00', { rtc_date: null })]) === 2 && ws(50000, [hb('2010-01-01 00:00:00', { rtc_date: undefined })]) === 2 &&
    ws(50000, [hb('2010-01-01 00:00:00', { rtc_date: '' })]) === 2);
  check('water: a non-health-based violation with no rtc_date adds nothing', ws(50000, [nh('2010-01-01 00:00:00', { rtc_date: null })]) === 1);
  check('water: all four rules together reach the cap of 5',
    ws(900, [hb('2025-06-01 00:00:00', { public_notification_tier: 1, rtc_date: null })]) === 5);
  check('water: upper-case field names from another envelope also read',
    ws(50000, [{ IS_HEALTH_BASED_IND: 'Y', COMPL_PER_BEGIN_DATE: '2025-06-01T00:00:00', PUBLIC_NOTIFICATION_TIER: 2, RTC_DATE: '2025-08-01' }]) === 2);

  // ── Water: Boulder fixture ──
  const wd = ctx._mapWaterSystem(pick([{ attributes: WATER_FX.downtown }]), WATER_FX.violations, NOW);
  check('water fixture: downtown = 1, High, source names the dataset and year',
    wd.score === 1 && wd.confidence === 'High' && wd.source === 'EPA drinking-water system boundaries v3 and SDWIS violations, 2026', JSON.stringify(wd));
  check('water fixture: finding names system, id, population, counts and years',
    wd.finding.startsWith('On BOULDER CITY OF (CO0107152, 166,080 people). 2 health-based violations, last in 2017; none in the last 5 years; no acute (Tier 1) violations in the last 10 years.'), wd.finding);
  const rows2 = WATER_FX.violations.map(r => Object.assign({}, r));
  rows2[1].rtc_date = null;
  const wd2 = ctx._mapWaterSystem(pick([{ attributes: WATER_FX.downtown }]), rows2, NOW);
  check('water fixture: if one 2017 violation had no rtc_date the score would be 2 and the finding says so',
    wd2.score === 2 && /1 health-based violation has no recorded return to compliance/.test(wd2.finding), wd2.finding);
  const wRecent = ctx._mapWaterSystem(sys(2000), [hb('2025-01-01 00:00:00', { public_notification_tier: 1 }), hb('2024-01-01 00:00:00')], NOW);
  check('water finding: recent and acute counts and the small-system note',
    wRecent.finding.includes('2 health-based violations, last in 2025; 2 began in the last 5 years; 1 acute (Tier 1) violation in the last 10 years') &&
    /fewer than 3,300 people score one level higher/.test(wRecent.finding), wRecent.finding);
  check('water finding: no health-based violations on record reads plainly', ctx._mapWaterSystem(sys(5000), [nh('2020-01-01 00:00:00')], NOW).finding.includes('No health-based violations on record; no acute (Tier 1) violations in the last 10 years.'));
  // violations unreadable
  const wLow = ctx._mapWaterSystem(sys(166080), null, NOW), wLowSmall = ctx._mapWaterSystem(sys(2000), null, NOW);
  check('water: violations unreadable scores from population only (1 or 2), Low, and says so',
    wLow.score === 1 && wLowSmall.score === 2 && wLow.confidence === 'Low' && /violation history could not be read/.test(wLow.finding) &&
    wLow.source === 'EPA drinking-water system boundaries v3, 2026');

  // ── Water call, mocked fetch ──
  const waterRoute = (violations) => route(url => {
    if (url.startsWith(cfg.EPA_WATER_BOUNDARIES)) return json({ features: [{ attributes: WATER_FX.downtown }] });
    if (url.startsWith(cfg.EPA_SDWIS_VIOLATIONS)) return violations();
    return Promise.reject(new Error('unexpected ' + url));
  });
  waterRoute(() => json(WATER_FX.violations));
  const wc = await ctx._callWaterAPI(40.015, -105.2705);
  const bu = decodeURIComponent(seen[0].url);
  check('water call: boundaries point query, then violations for the PWSID, both direct GETs',
    wc.kind === 'system' && seen.length === 2 && bu.includes('geometry={"x":-105.2705,"y":40.015,"spatialReference":{"wkid":4326}}') &&
    bu.includes('outFields=PWSID,PWS_Name,Population_Served_Count,Service_Area_Type') && bu.includes('returnGeometry=false') &&
    seen[1].url === 'https://data.epa.gov/efservice/VIOLATION/PWSID/CO0107152/JSON' && !seen[0].opts.method && !seen[1].opts.method, seen.map(x => x.url).join(' | '));
  check('water call: downtown scores 1 (with today\'s date: 2017 violations are older than 5 years)', wc.score === 1);
  waterRoute(() => Promise.reject(new Error('timeout')));
  const wcLow = await ctx._callWaterAPI(40.015, -105.2705);
  check('water call: violations call fails with a polygon: population-only score, Low', wcLow.kind === 'system' && wcLow.confidence === 'Low' && wcLow.score === 1);
  waterRoute(() => json({ nope: true }));
  check('water call: violations reply that is not a list is treated as unreadable', (await ctx._callWaterAPI(40.015, -105.2705)).confidence === 'Low');
  waterRoute(() => json([]));
  check('water call: an empty violation list is a valid clean record (High)', (await ctx._callWaterAPI(40.015, -105.2705)).confidence === 'High');
  route(() => json({ features: [] }));
  const well = await ctx._callWaterAPI(40.0394, -105.332);
  check('water call: foothills (no polygon) is the private-well path with one request', well.kind === 'well' && seen.length === 1);
  route(() => Promise.reject(new Error('down')));
  e1 = null; try { await ctx._callWaterAPI(40, -105); } catch (e) { e1 = e; }
  check('water call: boundaries failure throws (Needs your judgment)', !!e1);
  route(() => json({ error: { code: 400, message: 'bad geometry' } }));
  e1 = null; try { await ctx._callWaterAPI(40, -105); } catch (e) { e1 = e; }
  check('water call: an ArcGIS error inside HTTP 200 throws', !!e1);
  route(() => json({ unexpected: 1 }));
  e1 = null; try { await ctx._callWaterAPI(40, -105); } catch (e) { e1 = e; }
  check('water call: a reply without features throws', !!e1);

  // ── Private well, with and without a flood or drought finding of 4+ ──
  const mk = (id, score) => ({ hazardId: id, scoreAssigned: score, status: 'success' });
  const wellOf = fs => ctx._mapWaterWell(fs);
  check('well: base is 3, Medium, with the spec sentence', (() => { const w = wellOf([mk(3, 2), mk(4, 3), mk(10, 3)]);
    return w.score === 3 && w.confidence === 'Medium' && w.finding === 'No public water system is mapped at this address, which usually means a private well. Wells depend on your pump, your power and your groundwater.'; })());
  check('well: river flood 4 raises to 4 and names it', (() => { const w = wellOf([mk(3, 4), mk(4, 2), mk(10, 2)]); return w.score === 4 && w.finding.endsWith('Raised one level because river and creek flood is rated 4 or more here.'); })());
  check('well: flash flood 4 raises to 4', wellOf([mk(3, 2), mk(4, 4), mk(10, 2)]).score === 4);
  check('well: drought 4 raises to 4 and names it', (() => { const w = wellOf([mk(3, 3), mk(4, 3), mk(10, 5)]); return w.score === 4 && /Raised one level because drought and watering limits is rated 4 or more here\.$/.test(w.finding); })());
  check('well: 3 on every hazard does not raise (boundary)', wellOf([mk(3, 3), mk(4, 3), mk(10, 3)]).score === 3);
  check('well: several high findings raise once and name each', (() => { const w = wellOf([mk(3, 5), mk(4, 4), mk(10, 4)]);
    return w.score === 4 && w.finding.endsWith('Raised one level because river and creek flood, flash flood and drought and watering limits are rated 4 or more here.'); })());
  check('well: missing or error findings do not raise', wellOf([]).score === 3 && wellOf([{ hazardId: 3, scoreAssigned: null, status: 'error' }]).score === 3);
  check('well: source says no system mapped here', wellOf([]).source === 'EPA drinking-water system boundaries v3, 2026 (no system mapped here)');

  // ── _compileFindings ──
  ev('state = freshState();');
  const geo = { lat: 40.015, lng: -105.2705, zip: '80302', stateAbbr: 'CO', county: 'Boulder County', fips5: '08013' };
  const okf = (score) => ({ score, finding: 'x', confidence: 'High' });
  const mkBase = (flood, drought) => ({ flood: okf(flood), earthquake: okf(3), wildfire: okf(3), weather: { stateAbbr: 'CO' }, drought: okf(drought),
    epa: { chemScore: 2, finding: '2 facilities', confidence: 'Medium', highHazardCount: 1, potwCount: 1 }, landslide: null, nri: null });
  const by = (fs, id) => fs.find(f => f.hazardId === id);
  const downtown = ctx._compileFindings(Object.assign(mkBase(3, 2), { water: wd, soil: sd }), geo);
  check('compile downtown: water 1 and soil 2, status success, with source and confidence',
    by(downtown, 27).scoreAssigned === 1 && by(downtown, 27).status === 'success' && by(downtown, 27).confidence === 'High' &&
    by(downtown, 66).scoreAssigned === 2 && by(downtown, 66).status === 'success' && by(downtown, 66).confidence === 'Medium');
  check('compile: water and soil use the exact HAZARD_DATA names and categories',
    by(downtown, 27).hazardName === names[27] && by(downtown, 27).category === cats[27] && by(downtown, 66).hazardName === names[66] && by(downtown, 66).category === cats[66]);
  check('compile: both findings keep the standard shape', [27, 66].every(id => ['hazardId', 'hazardName', 'category', 'scoreAssigned', 'source', 'finding', 'confidence', 'status', 'isOverridden'].every(k => k in by(downtown, id))));
  const foot = ctx._compileFindings(Object.assign(mkBase(2, 3), { water: { kind: 'well' }, soil: sf }), geo);
  check('compile foothills: private well = 3 estimated, Medium; soil 1',
    by(foot, 27).scoreAssigned === 3 && by(foot, 27).status === 'estimated' && by(foot, 27).confidence === 'Medium' && by(foot, 66).scoreAssigned === 1);
  check('compile foothills: the well estimate is not a rule of thumb and is an answered estimate', !ctx._isRuleOfThumb(by(foot, 27)) && ctx._isAnsweredEstimate(by(foot, 27)));
  const footFlood = ctx._compileFindings(Object.assign(mkBase(4, 3), { water: { kind: 'well' }, soil: sf }), geo);
  check('compile well + flood 4: raised to 4 and the finding says river and creek flood',
    by(footFlood, 27).scoreAssigned === 4 && /river and creek flood and flash flood are rated 4 or more here\.$/.test(by(footFlood, 27).finding), by(footFlood, 27).finding);
  const footDrought = ctx._compileFindings(Object.assign(mkBase(2, 4), { water: { kind: 'well' }, soil: sf }), geo);
  check('compile well + drought 4: raised to 4 and the finding says drought', by(footDrought, 27).scoreAssigned === 4 && /drought and watering limits is rated 4 or more/.test(by(footDrought, 27).finding));
  const footFloodFallback = ctx._compileFindings(Object.assign(mkBase(2, 2), { flood: null, drought: null, water: { kind: 'well' } }), geo);
  check('compile well: placeholder flood and drought (score 2) do not raise', by(footFloodFallback, 27).scoreAssigned === 3);
  check('compile well with a mapped system: flood 5 does not change a system score', by(ctx._compileFindings(Object.assign(mkBase(5, 5), { water: wd }), geo), 27).scoreAssigned === 1);
  const failed = ctx._compileFindings(Object.assign(mkBase(3, 2), { water: null, soil: null }), geo);
  check('compile: failed water and soil lookups add no finding (Needs your judgment)', !by(failed, 27) && !by(failed, 66));
  check('judgment list: 27 and 66 carry the EPA map and Web Soil Survey links',
    ev('MANUAL_REASONS')[27].includes('https://www.epa.gov/ground-water-and-drinking-water/community-water-system-service-area-boundaries') &&
    ev('MANUAL_REASONS')[66].includes('https://websoilsurvey.nrcs.usda.gov/'));
  check('compile: omitting water and soil (older callers) still works', !by(ctx._compileFindings(mkBase(3, 2), geo), 27));
  ev('state.scores[66] = { na: true }; state.scores[27] = { na: true };');
  const ruled = ctx._compileFindings(Object.assign(mkBase(3, 2), { water: wd, soil: sd }), geo);
  check('compile: soil and water are skipped when marked Does not apply here', !by(ruled, 27) && !by(ruled, 66));
  ev('state = freshState();');

  // Hazards sit in the right place for the report and Assess screen
  check('soil (66) is in the Less common here group; research lists it by category like Hurricane',
    HD.find(h => h.id === 66).group === 'rare' && HD.find(h => h.id === 7).group === 'rare' && HD.find(h => h.id === 66).category === HD.find(h => h.id === 7).category);
  ev(`state = freshState(); _research.geocoded = ${JSON.stringify(geo)}; _research.findings = ${JSON.stringify(foot)}; _research.hasResults = true;`);
  const html = [];
  ctx.document.getElementById = id => id === 'research-report-content' ? { set innerHTML(v) { html.push(v); } } : null;
  ctx._renderReport();
  const page = html.join('');
  const order = ['Natural hazards', 'Shifting or swelling soil under the house', 'Industrial and CBRN', 'Outages and service interruptions', 'Water outage or unsafe tap water'].map(t => page.indexOf(t));
  check('report: the soil card lists under Natural hazards (like Hurricane), the water card under Outages and service interruptions',
    order.every(i => i > -1) && order.every((v, i) => i === 0 || v > order[i - 1]), order.join());
  check('report: the soil and water cards carry their finding and source text', page.includes('Lefthand: shrink-swell (LEP) up to 0.6 percent') &&
    page.includes('EPA drinking-water system boundaries v3, 2026 (no system mapped here)') && page.includes('Rough estimate'));
  ctx.document.getElementById = () => null;

  // ── Summary wording ──
  const est = (n, src) => Array.from({ length: n }, () => ({ status: 'estimated', source: src }));
  const WELL = 'EPA drinking-water system boundaries v3, 2026 (no system mapped here)';
  check('summary: a private-well estimate is not called a placeholder or a rule of thumb',
    ctx._researchSummarySub(est(1, WELL), 0, 3) === '1 is an estimate where the source answered but holds no record for this address. 3 need your judgment.', ctx._researchSummarySub(est(1, WELL), 0, 3));
  check('summary: well estimate, rule of thumb and a real placeholder each get their own clause',
    ctx._researchSummarySub(est(1, WELL).concat(est(1, ev('WEATHER_RULE_SRC')), est(1, 'World Aware placeholder (x did not respond)')), 0, 2) ===
    '1 is an estimate where the source answered but holds no record for this address. 1 is a rough placeholder because a source did not respond. No address-level source exists yet for 1 item; it uses a state rule of thumb. 2 need your judgment.');
  check('report sentence: well estimate is its own clause',
    ctx._sourcesSentence({ findingCount: 10, estimatedCount: 2, ruleOfThumbCount: 0, answeredEstimateCount: 1 }) ===
    'Public data supplied the likelihood for 8 hazards; 1 is an estimate where the source answered but holds no record for this address; 1 is a rough placeholder because a source did not respond.',
    ctx._sourcesSentence({ findingCount: 10, estimatedCount: 2, ruleOfThumbCount: 0, answeredEstimateCount: 1 }));
  check('report sentence: older saved reports (no answeredEstimateCount) read as before',
    ctx._sourcesSentence({ findingCount: 12, estimatedCount: 2, ruleOfThumbCount: 1 }) === 'Public data supplied the likelihood for 10 hazards; 1 is a rough placeholder because a source did not respond; no address-level source exists yet for 1 item; it uses a state rule of thumb.');
  ev(`state = freshState(); state.researchReport = { geocoded: ${JSON.stringify(geo)}, findings: ${JSON.stringify(foot)}, timestamp: 't' }; state.researchAddress = 'x';`);
  const rdata = ev('buildReportData()').research;
  check('buildReportData counts the private-well estimate apart from placeholders and rules of thumb',
    rdata.estimatedCount === 5 && rdata.ruleOfThumbCount === 4 && rdata.answeredEstimateCount === 1, JSON.stringify([rdata.estimatedCount, rdata.ruleOfThumbCount, rdata.answeredEstimateCount]));
  ev('state = freshState();');

  // ── Copy rules on every new string ──
  const newCopy = [wd.finding, wd2.finding, wRecent.finding, wLow.finding, wLowSmall.finding, by(foot, 27).finding, by(footFlood, 27).finding,
    by(footDrought, 27).finding, sd.finding, sf.finding, sd.source, wd.source, WELL, ev('MANUAL_REASONS')[27], ev('MANUAL_REASONS')[66],
    'Checking your drinking-water system (EPA)', 'Checking soil shrink-swell (USDA)'];
  check('Stage A copy: no em dash, no exclamation point', !newCopy.some(t => /[—!]/.test(t)), newCopy.filter(t => /[—!]/.test(t)).join(' | '));
  check('Stage A copy: no "not X but Y" and no AI-style transitions', !newCopy.some(t => /\bnot (just )?[^.;]{1,40}\bbut\b|moreover|furthermore/i.test(t)), newCopy.filter(t => /\bnot (just )?[^.;]{1,40}\bbut\b|moreover|furthermore/i.test(t)).join(' | '));
  check('Stage A copy: findings read as sentences (no placeholder syntax)', !newCopy.some(t => /\[[A-Z ]+\]|\{\w+\}|undefined|NaN|null/.test(t)));

  // ── Wiring ──
  const src = fs.readFileSync(path.join(ROOT, 'js/research.js'), 'utf8');
  check('runner: water and soil run in the parallel set and reach _compileFindings',
    src.includes("_tracked('water',      _callWaterAPI(lat, lng))") && src.includes("_tracked('soil',       _callSoilAPI(lat, lng))") &&
    /\['nri'[^\]]*'water','soil'[,\]]/.test(src) && /declarations, water, soil,?\s*\n?\s*(warnings, normals, airdays(, radon, power)? )?\},\s*\n\s*geocoded/.test(src));
  check('soil uses the one POST helper, and no relay (it is GET-only)', src.includes('directPostForm(API_CONFIG.USDA_SDA') && !/proxyFetch\(API_CONFIG\.USDA_SDA|relayFetch\(API_CONFIG\.USDA_SDA/.test(src));
  check('water calls are direct, not through the relay', !/proxyFetch\([^)]*(WATER|SDWIS)|relayFetch\([^)]*(WATER|SDWIS)/.test(src));
  ctx.fetch = () => Promise.reject(new Error('no network in tests'));
}

/* ---------------------------------------------------------------
   v3.2.0 Stage B: high wind (63), extreme heat (9), winter cold (8),
   smoke (23) and the relay cache.
   From fixtures-v32.json (captured 2026-10-31): IEM shape and expected
   rates (downtown COZ039 24 High Wind Warnings 2015 to 2024 after dedupe =
   2.4 a year; foothills COZ035 6.3 a year), the NCEI search and data
   replies for BOULDER, CO US, the geopub URL and the 2023 Boulder monthly
   percentages. The IEM event lists below are built from those counts (the
   raw 315-event reply was not captured): each warning appears once for the
   forecast zone and once for the county, as IEM returns it.
--------------------------------------------------------------- */
function iemEvents(perYearCounts, opts) {
  const o = Object.assign({ wfo: 'BOU', zone: 'COZ039', county: 'COC013', phen: 'HW', sig: 'W' }, opts || {});
  const out = [];
  Object.keys(perYearCounts).forEach(y => {
    for (let i = 1; i <= perYearCounts[y]; i++) {
      [o.zone, o.county].forEach(ugc => out.push({
        url: 'x', issue: `${y}-0${1 + (i % 9)}-1${i % 9}T06:00:00Z`, expire: `${y}-01-02T06:00:00Z`, eventid: i, phenomena: o.phen,
        hvtec_nwsli: '', significance: o.sig, wfo: o.wfo, name: '', ph_name: '', sig_name: '', ugc,
      }));
    }
  });
  return out;
}
const spread = (total, years) => Object.fromEntries(years.map((y, i) => [y, Math.floor(total / years.length) + (i < total % years.length ? 1 : 0)]));
const Y10 = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
const IEM_FX = {
  downtown: [].concat(
    iemEvents(spread(24, Y10)),                                  // 24 HW.W
    iemEvents(spread(42, Y10), { phen: 'WS' }),                  // 42 WS.W
    iemEvents({ 2016: 1, 2021: 1 }, { phen: 'BZ' }),             // 2 BZ.W
    iemEvents(spread(30, Y10), { phen: 'WI', sig: 'Y' }),        // wind advisories: not counted
    iemEvents({ 2019: 2 }, { phen: 'HW', sig: 'A' }),            // high wind watches: not counted
    iemEvents({ 2022: 1 }, { phen: 'EH' }),
    iemEvents({ 2021: 1 }, { phen: 'WC' })),
  foothills: iemEvents(spread(63, Y10), { zone: 'COZ035' }),
};
const NCEI_FX = {
  search: { count: 2, results: [{ id: 'us-climate-normals_1991-2020_v1.0.1_annualseasonal_multivariate_by-station_c20230404.tar.gz:USC00050848.csv', name: 'USC00050848.csv', stations: [{ id: 'USC00050848', name: 'BOULDER, CO US' }] }] },
  data: [{ 'ANN-TMAX-AVGNDS-GRTH090': '    33.1', 'ANN-TMAX-AVGNDS-GRTH100': '     0.6', 'ANN-TMIN-AVGNDS-LSTH000': '     3.9', STATION: 'USC00050848' }],
  searchUrl: 'https://www.ncei.noaa.gov/access/services/search/v1/data?dataset=normals-annualseasonal-1991-2020&bbox=40.15,-105.45,39.90,-105.10&dataTypes=ANN-TMAX-AVGNDS-GRTH090&limit=5',
  dataUrl: 'https://www.ncei.noaa.gov/access/services/data/v1?dataset=normals-annualseasonal-1991-2020&stations=USC00050848&dataTypes=ANN-TMAX-AVGNDS-GRTH090,ANN-TMAX-AVGNDS-GRTH100,ANN-TMIN-AVGNDS-LSTH000&format=json',
};
const GEOPUB_URL = 'https://geopub.epa.gov/ArcGIS/rest/services/myenv/aqi/MapServer/0/query?where=CTFIPS%3D%2708013%27&outFields=YEAR,MONTH_NUMBER,Unhealthy_for_Sensitive_Group,Unhealthy,Very_Unhealthy,Hazardous&returnGeometry=false&f=json';
const BOULDER_2023_PCT = [0, 0, 0, 0, 6.5, 0, 0, 9.7, 3.3, 0, 0, 0];
/** Monthly rows as geopub returns them: USG carries the percent, the other three are null or string fields. */
function geopubRows(year, pctByMonth) {
  return pctByMonth.map((p, i) => ({ attributes: { YEAR: String(year), MONTH_NUMBER: i + 1, Unhealthy_for_Sensitive_Group: p, Unhealthy: null, Very_Unhealthy: null, Hazardous: null } }));
}

async function v32StageBChecks() {
  console.log('v3.2.0 Stage B: high wind, heat and cold, smoke, relay');
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
  const json = body => Promise.resolve({ ok: true, status: 200, json: async () => body });
  const seen = [];
  const route = handler => { seen.length = 0; ctx.fetch = (url, opts) => { seen.push({ url: String(url), opts: opts || {} }); return handler(String(url), opts || {}); }; };
  const NOW25 = new Date(2025, 5, 1);    // period 2015 to 2024, as in the fixture
  const NOW26 = new Date(2026, 9, 31);   // period 2015 to 2025
  const by = (fs, id) => fs.find(f => f.hazardId === id);
  let e1;

  // ── Config, names, steps ──
  check('Stage B config: IEM, NCEI search and data, EPA geopub AQI endpoints',
    cfg.IEM_VTEC_BYPOINT === 'https://mesonet.agron.iastate.edu/json/vtec_events_bypoint.py' &&
    cfg.NCEI_SEARCH === 'https://www.ncei.noaa.gov/access/services/search/v1/data' &&
    cfg.NCEI_DATA === 'https://www.ncei.noaa.gov/access/services/data/v1' &&
    cfg.EPA_AQI_COUNTY === 'https://geopub.epa.gov/ArcGIS/rest/services/myenv/aqi/MapServer/0/query');
  check('Stage B names match HAZARD_DATA exactly (63, 9, 8, 23)', [63, 9, 8, 23].every(id => ev('H_NAME')[id] === names[id]) &&
    names[63] === 'High wind' && names[9] === 'Extreme heat' && names[8] === 'Winter storm and extreme cold' && names[23] === 'Smoke and bad air days');
  const steps = ev('STEPS');
  const si = id => steps.findIndex(s => s.id === id);
  check('Stage B steps: warnings, normals, airdays with the spec labels, after soil',
    si('warnings') === si('soil') + 1 && si('normals') === si('warnings') + 1 && si('airdays') === si('normals') + 1 &&
    steps[si('warnings')].label === 'Counting NWS warnings over this point (Iowa Environmental Mesonet)' &&
    steps[si('normals')].label === 'Checking NOAA climate normals for the nearest station' &&
    steps[si('airdays')].label === 'Counting bad-air days for your county (EPA)');

  // ── IEM: period, URL, rounding ──
  const p26 = ctx._iemPeriod(NOW26);
  check('IEM period on 2026-10-31: 2015 to 2025, 11 years, edate 2026-01-01',
    p26.firstYear === 2015 && p26.lastYear === 2025 && p26.years === 11 && p26.sdate === '2015-01-01' && p26.edate === '2026-01-01');
  const u1 = ctx._iemUrl(40.0121, -105.2711, NOW26), u2 = ctx._iemUrl(40.0139, -105.2749, NOW26);
  check('IEM URL: lat/lon rounded to 2 decimals, sdate 2015-01-01, edate 1 January this year',
    u1 === 'https://mesonet.agron.iastate.edu/json/vtec_events_bypoint.py?lat=40.01&lon=-105.27&sdate=2015-01-01&edate=2026-01-01', u1);
  check('IEM URL: neighbours a few hundred metres apart share one URL (one cache entry)', u1 === u2, u2);

  // ── IEM: dedupe and counts ──
  const dt = ctx._countIemEvents(IEM_FX.downtown, NOW25);
  check('IEM dedupe: 48 zone and county rows are 24 High Wind Warnings = 2.4 a year over 10 years',
    IEM_FX.downtown.filter(e => e.phenomena === 'HW' && e.significance === 'W').length === 48 &&
    dt.counts.highWind === 24 && dt.years === 10 && Math.abs(dt.perYear.highWind - 2.4) < 1e-9, JSON.stringify(dt.counts));
  check('IEM: watches (HW.A) and wind advisories (WI.Y) are not counted', dt.counts.highWind === 24);
  check('IEM: winter storm plus blizzard warnings counted together (42 + 2)', dt.counts.winter === 44 && Math.abs(dt.perYear.winter - 4.4) < 1e-9);
  check('IEM: heat and cold warnings counted and stored per year', dt.counts.heat === 1 && dt.counts.cold === 1 &&
    dt.byYear[2022].heat === 1 && dt.byYear[2021].cold === 1 && dt.byYear[2015].highWind === 3, JSON.stringify(dt.byYear[2015]));
  const ft = ctx._countIemEvents(IEM_FX.foothills, NOW25);
  check('IEM foothills fixture: 63 warnings = 6.3 a year', ft.counts.highWind === 63 && Math.abs(ft.perYear.highWind - 6.3) < 1e-9);
  const ev1 = (wfo, eventid, issue, ugc, phen, sig) => ({ wfo, eventid, issue, ugc, phenomena: phen || 'HW', significance: sig || 'W' });
  const dd = ctx._countIemEvents([
    ev1('BOU', 7, '2020-03-01T00:00:00Z', 'COZ039'), ev1('BOU', 7, '2020-03-01T00:00:00Z', 'COC013'), ev1('BOU', 7, '2020-03-01T06:00:00Z', 'COZ040'),
    ev1('BOU', 7, '2021-03-01T00:00:00Z', 'COZ039'),     // event numbers restart each year
    ev1('PUB', 7, '2020-03-01T00:00:00Z', 'COZ058'),     // another office
  ], NOW25);
  check('IEM dedupe: same office, product and number in one year is one warning across zones and counties; a new year or another office is another',
    dd.counts.highWind === 3, JSON.stringify(dd.counts));
  const edge = ctx._countIemEvents([ev1('BOU', 1, '2014-12-31T23:00:00Z', 'COZ039'), ev1('BOU', 2, '2015-01-01T00:00:00Z', 'COZ039'),
    ev1('BOU', 3, '2024-12-31T23:59:00Z', 'COZ039'), ev1('BOU', 4, '2025-01-01T00:00:00Z', 'COZ039'), ev1('BOU', 5, null, 'COZ039'), null], NOW25);
  check('IEM: events before 2015, from the current year, or without an issue time are left out', edge.counts.highWind === 2, JSON.stringify(edge.counts));
  const ren = ctx._countIemEvents([
    ev1('BOU', 1, '2023-01-10T00:00:00Z', 'COZ039', 'WC'), ev1('BOU', 1, '2025-01-10T00:00:00Z', 'COZ039', 'EC'), ev1('BOU', 1, '2025-01-10T00:00:00Z', 'COC013', 'EC'),
    ev1('BOU', 2, '2024-07-10T00:00:00Z', 'COZ039', 'EH'), ev1('BOU', 2, '2025-07-10T00:00:00Z', 'COZ039', 'XH'),
    ev1('BOU', 3, '2025-07-11T00:00:00Z', 'COZ039', 'HT', 'Y'), ev1('BOU', 4, '2025-01-11T00:00:00Z', 'COZ039', 'CW', 'Y'),
    ev1('bou', 5, '2025-01-12T00:00:00Z', 'COZ039', 'ec', 'w'),
  ], NOW26);
  check('IEM product renames: WC.W and EC.W count together, EH.W and XH.W count together; advisories do not',
    ren.counts.cold === 3 && ren.counts.heat === 2 && ren.counts.highWind === 0, JSON.stringify(ren.counts));
  check('IEM: no events is a zero count, not missing', ctx._countIemEvents([], NOW26).counts.highWind === 0 && ctx._countIemEvents([], NOW26).perYear.highWind === 0);

  // ── High wind mapping ──
  const ws = ctx._windWarningScore;
  check('HW.W a year: 0.24 = 1, 0.25 = 2', ws(0.24) === 1 && ws(0.25) === 2);
  check('HW.W a year: 0.99 = 2, 1 = 3', ws(0.99) === 2 && ws(1) === 3);
  check('HW.W a year: 2.99 = 3, 3 = 4', ws(2.99) === 3 && ws(3) === 4);
  check('HW.W a year: 5.99 = 4, 6 = 5, 0 = 1', ws(5.99) === 4 && ws(6) === 5 && ws(0) === 1);
  const wd = ctx._mapWindWarnings(dt, NRI_FX.downtown.SWND_AFREQ);
  check('wind downtown: 2.4 a year = 3, NRI 1.18 = 2, max 3, High', wd.score === 3 && wd.iemScore === 3 && wd.confidence === 'High', JSON.stringify(wd));
  check('wind downtown finding says both counts',
    wd.finding === '2.4 High Wind Warnings a year here (NWS, 2015 to 2024) and 1.2 thunderstorm wind events a year (FEMA NRI)', wd.finding);
  check('wind source names IEM, the years and NRI', wd.source === 'NWS warnings via Iowa Environmental Mesonet, 2015 to 2024, and FEMA NRI', wd.source);
  check('wind foothills: 6.3 a year = 5 (NRI 0.91 = 1)', ctx._mapWindWarnings(ft, NRI_FX.foothills.SWND_AFREQ).score === 5);
  const few = ctx._countIemEvents([ev1('MPX', 1, '2020-03-01T00:00:00Z', 'MNZ060')], NOW26);
  const wMax = ctx._mapWindWarnings(few, NRI_FX.minneapolis.SWND_AFREQ);
  check('wind max with NRI: 0.09 warnings a year (1) and Minneapolis NRI 4.83 (4) = 4', wMax.score === 4 && wMax.iemScore === 1, JSON.stringify(wMax));
  const wNoNri = ctx._mapWindWarnings(dt, null);
  check('wind with IEM only: IEM score, source without NRI, no NRI clause', wNoNri.score === 3 &&
    wNoNri.source === 'NWS warnings via Iowa Environmental Mesonet, 2015 to 2024' && !/FEMA/.test(wNoNri.finding));
  const wZero = ctx._mapWindWarnings(ctx._countIemEvents([], NOW26), 0);
  check('wind with no warnings and NRI 0: 1, says no warnings', wZero.score === 1 && wZero.finding.startsWith('No High Wind Warnings here (NWS, 2015 to 2025) and 0 thunderstorm'), wZero.finding);
  check('wind: no IEM result maps to null (NRI-only path)', ctx._mapWindWarnings(null, 1.2) === null);

  // ── IEM call: relay first, then direct ──
  const iemReply = { events: IEM_FX.downtown, generated_at: '2026-10-31T00:00:00Z' };
  const savedRelay = cfg.RELAY_URL;
  cfg.RELAY_URL = 'https://relay.test';
  route(url => url.startsWith('https://relay.test/') ? json(iemReply) : Promise.reject(new Error('direct should not be called')));
  let wc = await ctx._callWarningsAPI(40.015, -105.2705);
  const relayed = decodeURIComponent((seen[0].url.split('?url=')[1]) || '');
  check('IEM call with the relay set: one call through the relay carrying the rounded IEM URL',
    seen.length === 1 && seen[0].url.startsWith('https://relay.test/?url=') && relayed.startsWith(cfg.IEM_VTEC_BYPOINT + '?lat=40.0') &&
    /&lon=-105\.27&sdate=2015-01-01&edate=\d{4}-01-01$/.test(relayed) && seen[0].opts.referrerPolicy === 'no-referrer', relayed);
  check('IEM call result carries counts and per-year rates', wc.counts.highWind === 24 && wc.years === new Date().getFullYear() - 2015 && typeof wc.perYear.winter === 'number');
  route(url => url.startsWith('https://relay.test/') ? Promise.resolve({ ok: false, status: 403, json: async () => ({}) }) : json(iemReply));
  wc = await ctx._callWarningsAPI(40.015, -105.2705);
  check('IEM call: relay refuses (403, Worker not redeployed yet), then a direct call answers',
    seen.length === 2 && seen[1].url.startsWith(cfg.IEM_VTEC_BYPOINT + '?lat=') && wc.counts.highWind === 24);
  route(url => url.startsWith('https://relay.test/') ? Promise.reject(new Error('relay down')) : json(iemReply));
  check('IEM call: relay network failure falls back to direct', (await ctx._callWarningsAPI(40.015, -105.2705)).counts.highWind === 24 && seen.length === 2);
  cfg.RELAY_URL = '';
  route(url => json(iemReply));
  await ctx._callWarningsAPI(40.015, -105.2705);
  check('IEM call with no relay configured: direct only', seen.length === 1 && seen[0].url.startsWith(cfg.IEM_VTEC_BYPOINT));
  cfg.RELAY_URL = 'https://relay.test';
  route(() => Promise.reject(new Error('down')));
  e1 = null; try { await ctx._callWarningsAPI(40, -105); } catch (e) { e1 = e; }
  check('IEM call: relay and direct both fail throws (NRI-only finding)', !!e1 && seen.length === 2);
  route(() => json({ nope: 1 }));
  e1 = null; try { await ctx._callWarningsAPI(40, -105); } catch (e) { e1 = e; }
  check('IEM call: a reply without an events list throws', !!e1);
  cfg.RELAY_URL = savedRelay;

  // ── NCEI normals: URLs and station choice ──
  check('normals search URL: bbox north,west,south,east at 0.25 degrees, 90 F type, limit 5',
    ctx._normalsSearchUrl(40.015, -105.2705) === 'https://www.ncei.noaa.gov/access/services/search/v1/data?dataset=normals-annualseasonal-1991-2020&bbox=40.265,-105.5205,39.765,-105.0205&dataTypes=ANN-TMAX-AVGNDS-GRTH090&limit=5',
    ctx._normalsSearchUrl(40.015, -105.2705));
  check('normals data URL matches the captured request', ctx._normalsDataUrl('USC00050848') === NCEI_FX.dataUrl, ctx._normalsDataUrl('USC00050848'));
  const st = ctx._pickNormalsStation(NCEI_FX.search, 40.015, -105.2705);
  check('station pick without coordinates: the first listed, BOULDER, CO US', st.id === 'USC00050848' && st.name === 'BOULDER, CO US' && st.km === null, JSON.stringify(st));
  const twoSt = (a, b) => ({ results: [{ stations: [a] }, { stations: [b] }] });
  const far = { id: 'USC00051234', name: 'FAR AWAY', latitude: 40.2, longitude: -105.0 };
  const near = { id: 'USC00050848', name: 'BOULDER, CO US', latitude: 39.9919, longitude: -105.2667 };
  check('station pick with lat/lon fields: the nearest, whatever the order',
    ctx._pickNormalsStation(twoSt(far, near), 40.015, -105.2705).id === 'USC00050848' && ctx._pickNormalsStation(twoSt(near, far), 40.015, -105.2705).id === 'USC00050848' &&
    Math.abs(ctx._pickNormalsStation(twoSt(far, near), 40.015, -105.2705).km - 2.6) < 0.2);
  check('station pick reads a GeoJSON location (lon, lat) and a {lat, lon} location',
    ctx._pickNormalsStation(twoSt({ id: 'USC00051234', name: 'FAR', location: { type: 'Point', coordinates: [-105.0, 40.2] } },
      { id: 'USC00050848', name: 'B', location: { coordinates: [[-105.2667, 39.9919]] } }), 40.015, -105.2705).id === 'USC00050848' &&
    ctx._pickNormalsStation(twoSt({ id: 'USC00051234', name: 'FAR', location: { lat: 40.2, lon: -105.0 } },
      { id: 'USC00050848', name: 'B', location: '39.9919,-105.2667' }), 40.015, -105.2705).id === 'USC00050848');
  check('station pick: when only some stations carry coordinates, the nearest located one',
    ctx._pickNormalsStation(twoSt({ id: 'USC00099999', name: 'NO COORDS' }, far), 40.015, -105.2705).id === 'USC00051234');
  check('station pick: no stations or unusable ids is no station', ctx._pickNormalsStation({ count: 0, results: [] }, 40, -105) === null &&
    ctx._pickNormalsStation(null, 40, -105) === null && ctx._pickNormalsStation({ results: [{ stations: [{ id: 'bad id!', name: 'X' }] }] }, 40, -105) === null);

  // ── NCEI normals: values ──
  const nv = ctx._parseNormals(NCEI_FX.data, 'USC00050848');
  check('normals fixture: 33.1, 0.6 and 3.9 parsed from padded strings', nv.d90 === 33.1 && nv.d100 === 0.6 && nv.d0 === 3.9, JSON.stringify(nv));
  check('normals: a -9999 sentinel, a blank or a missing value is missing',
    (() => { const r = ctx._parseNormals([{ STATION: 'X', 'ANN-TMAX-AVGNDS-GRTH090': '  12.0', 'ANN-TMAX-AVGNDS-GRTH100': ' -9999', 'ANN-TMIN-AVGNDS-LSTH000': '   ' }], 'X');
      return r.d90 === 12 && r.d100 === null && r.d0 === null; })());
  check('normals: a reply with none of the values is no data', ctx._parseNormals([{ STATION: 'X', 'ANN-TMAX-AVGNDS-GRTH090': '-9999' }], 'X') === null &&
    ctx._parseNormals([], 'X') === null && ctx._parseNormals(null, 'X') === null);
  check('normals: the row for the asked station is used when several come back',
    ctx._parseNormals([{ STATION: 'OTHER', 'ANN-TMAX-AVGNDS-GRTH090': '99' }, NCEI_FX.data[0]], 'USC00050848').d90 === 33.1);

  // ── Heat mapping ──
  const hs = (d90, d100) => ctx._heatDaysScore(d90, d100 === undefined ? 0 : d100);
  check('heat: 4.9 = 1, 5 = 2, 14.9 = 2, 15 = 3', hs(4.9) === 1 && hs(5) === 2 && hs(14.9) === 2 && hs(15) === 3);
  check('heat: 44.9 = 3, 45 = 4, 89.9 = 4, 90 = 5', hs(44.9) === 3 && hs(45) === 4 && hs(89.9) === 4 && hs(90) === 5);
  check('heat: Boulder 33.1 = 3; Phoenix-style 150 days = 5', hs(33.1, 0.6) === 3 && hs(150, 60) === 5);
  check('heat 100 F rule: 9.9 days adds nothing, 10 adds one, capped at 5', hs(50, 9.9) === 4 && hs(50, 10) === 5 && hs(33.1, 10) === 4 && hs(95, 40) === 5 && hs(33.1, null) === 3);
  const normalsBoulder = Object.assign({ station: st }, nv);
  const hb = ctx._mapNormalsHeat(normalsBoulder);
  check('heat Boulder finding, source and confidence',
    hb.score === 3 && hb.confidence === 'High' && hb.source === 'NOAA 1991 to 2020 climate normals, BOULDER, CO US' &&
    hb.finding === '33 days a year at or above 90 F and 0.6 at or above 100 F at BOULDER, CO US (NOAA normals 1991 to 2020)', JSON.stringify(hb));
  check('heat finding says when the 100 F rule adds a level', /Ten or more days at or above 100 F add one level$/.test(ctx._mapNormalsHeat({ station: st, d90: 107.4, d100: 15.2, d0: 0 }).finding));
  check('heat: a station without a 90 F count gives no heat result', ctx._mapNormalsHeat({ station: st, d90: null, d100: null, d0: 4 }) === null);
  const nh = v => ctx._mapNRIHeat(v).score;
  check('heat fallback NRI HWAV: 1.99 = 1, 2 = 2, 4 = 3, 8 = 4, 15 = 5', nh(1.99) === 1 && nh(2) === 2 && nh(3.99) === 2 && nh(4) === 3 && nh(8) === 4 && nh(14.9) === 4 && nh(15) === 5);
  check('heat fallback NRI HWAV: Phoenix 23.4 = 5, Houston 14.6 = 4, Boulder 0.79 = 1, Low, labelled',
    nh(NRI_FX.phoenix.HWAV_AFREQ) === 5 && nh(NRI_FX.houston.HWAV_AFREQ) === 4 && nh(NRI_FX.downtown.HWAV_AFREQ) === 1 &&
    ctx._mapNRIHeat(0.79).confidence === 'Low' && ctx._mapNRIHeat(0.79).finding.includes('based on recorded heat events (FEMA NRI)'));

  // ── Normals call ──
  route(url => url.startsWith(cfg.NCEI_SEARCH) ? json(NCEI_FX.search) : url.startsWith(cfg.NCEI_DATA) ? json(NCEI_FX.data) : Promise.reject(new Error(url)));
  const nc = await ctx._callNormalsAPI(40.015, -105.2705);
  check('normals call: search then data, both direct GETs, Boulder values',
    seen.length === 2 && seen[0].url === ctx._normalsSearchUrl(40.015, -105.2705) && seen[1].url === NCEI_FX.dataUrl && !seen[0].opts.method &&
    nc.station.id === 'USC00050848' && nc.d90 === 33.1 && nc.d0 === 3.9);
  route(url => url.startsWith(cfg.NCEI_SEARCH) ? json({ count: 0, results: [] }) : json(NCEI_FX.data));
  e1 = null; try { await ctx._callNormalsAPI(40, -105); } catch (e) { e1 = e; }
  check('normals call: no station in the box throws (NRI fallback)', !!e1 && seen.length === 1);
  route(url => url.startsWith(cfg.NCEI_SEARCH) ? json(NCEI_FX.search) : json([{ STATION: 'USC00050848', 'ANN-TMAX-AVGNDS-GRTH090': '-9999' }]));
  e1 = null; try { await ctx._callNormalsAPI(40, -105); } catch (e) { e1 = e; }
  check('normals call: a station with no values throws', !!e1);
  route(() => Promise.resolve({ ok: false, status: 503, json: async () => ({}) }));
  e1 = null; try { await ctx._callNormalsAPI(40, -105); } catch (e) { e1 = e; }
  check('normals call: service failure throws', !!e1 && /HTTP 503/.test(e1.message));

  // ── Cold: winter + 1 at 5 nights ──
  const wn = (d0, cwav) => ctx._mapNRIWinter(14.526, cwav === undefined ? 1.1 : cwav, d0 === undefined ? null : { station: st, d90: 33.1, d100: 0.6, d0 });
  check('cold: Boulder 3.9 nights at or below 0 F does not add (winter stays 4)', wn(3.9).score === 4 && !/nights/.test(wn(3.9).finding));
  check('cold: 5 nights adds one (4 to 5) and the finding says so', wn(5).score === 5 &&
    wn(5).finding === 'About 15 winter weather days a year recorded for this tract (FEMA NRI); 5 nights a year at or below 0 F at BOULDER, CO US (NOAA normals 1991 to 2020) add one level', wn(5).finding);
  check('cold: 4.99 does not add; the level is capped at 5', wn(4.99).score === 4 && ctx._mapNRIWinter(16.5, 0, { station: st, d0: 30 }).score === 5);
  check('cold: with normals, the NRI cold wave rule is replaced (CWAV 2.5 and 3.9 nights = 4)', wn(3.9, 2.5).score === 4);
  check('cold: without normals, the NRI cold wave rule still applies (CWAV 2.5 = 5)', wn(undefined, 2.5).score === 5 && /cold wave days/.test(wn(undefined, 2.5).finding));
  check('cold: normals without a 0 F value fall back to the cold wave rule', ctx._mapNRIWinter(14.5, 2.5, { station: st, d90: 33, d100: 0, d0: null }).score === 5);

  // ── EPA AQI days (geopub) ──
  check('geopub URL matches the captured request exactly', ctx._airDaysUrl('08013') === GEOPUB_URL, ctx._airDaysUrl('08013'));
  check('days in month: February 2020 is 29, February 2023 is 28, August 31',
    ctx._daysInMonth(2020, 2) === 29 && ctx._daysInMonth(2023, 2) === 28 && ctx._daysInMonth(2023, 8) === 31 && ctx._daysInMonth(2023, 9) === 30);
  const b23 = ctx._airDaysFromRows(geopubRows(2023, BOULDER_2023_PCT));
  check('Boulder 2023 months: about 6 bad-air days (31 x 6.5% + 31 x 9.7% + 30 x 3.3%)',
    Math.abs(b23.days - 6.012) < 1e-9 && b23.firstYear === 2023 && b23.lastYear === 2023 && b23.yearCount === 1, JSON.stringify(b23));
  const mixed = geopubRows(2022, [0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0]).concat([
    { attributes: { YEAR: 2021, MONTH_NUMBER: '2', Unhealthy_for_Sensitive_Group: null, Unhealthy: '50', Very_Unhealthy: '25', Hazardous: null } },
    { attributes: { YEAR: '2021', MONTH_NUMBER: 3, Unhealthy_for_Sensitive_Group: null, Unhealthy: null, Very_Unhealthy: null, Hazardous: null } }]);
  const mx = ctx._airDaysFromRows(mixed);
  check('geopub averaging: categories add, nulls are 0, string values parse, average over the years returned',
    Math.abs(mx.byYear[2022] - 3.1) < 1e-9 && Math.abs(mx.byYear[2021] - 21) < 1e-9 && Math.abs(mx.days - 12.05) < 1e-9 && mx.firstYear === 2021 && mx.lastYear === 2022, JSON.stringify(mx));
  check('geopub: rows without a usable year or month are skipped; none usable is no data',
    ctx._airDaysFromRows([{ attributes: { YEAR: null, MONTH_NUMBER: 1, Unhealthy: 5 } }, { attributes: { YEAR: 2020, MONTH_NUMBER: 13, Unhealthy: 5 } }]) === null &&
    ctx._airDaysFromRows([]) === null && ctx._airDaysFromRows(null) === null);
  const fiveYr = [].concat(geopubRows(2019, [0, 0, 0, 0, 0, 0, 3.2, 3.2, 0, 0, 0, 0]), geopubRows(2020, [0, 0, 0, 0, 0, 6.7, 19.4, 22.6, 30, 35.5, 0, 0]),
    geopubRows(2021, [0, 0, 0, 0, 0, 10, 32.3, 25.8, 3.3, 0, 0, 0]), geopubRows(2022, [0, 0, 0, 0, 3.2, 6.7, 9.7, 3.2, 0, 0, 0, 0]), geopubRows(2023, BOULDER_2023_PCT));
  const b5 = ctx._airDaysFromRows(fiveYr);
  check('five Boulder-like years (2020 and 2021 smoke summers) average about 15 days', b5.yearCount === 5 && b5.days > 13 && b5.days < 17 && b5.firstYear === 2019 && b5.lastYear === 2023, String(b5.days));
  const as = ctx._airDaysScore;
  check('bad-air days: 0.99 = 1, 1 = 2, 3.99 = 2, 4 = 3', as(0.99) === 1 && as(1) === 2 && as(3.99) === 2 && as(4) === 3);
  check('bad-air days: 9.99 = 3, 10 = 4, 24.99 = 4, 25 = 5', as(9.99) === 3 && as(10) === 4 && as(24.99) === 4 && as(25) === 5);
  const sm23 = ctx._mapAirDays(b23, 'Boulder County'), sm5 = ctx._mapAirDays(b5, 'Boulder County');
  check('smoke mapping: Boulder 2023 alone about 6 days = 3; the five-year average = 4', sm23.score === 3 && sm5.score === 4);
  check('smoke finding: days, county, years, and the ozone note',
    sm5.finding.startsWith(`About ${Math.round(b5.days)} days a year with air quality worse than moderate in Boulder County (EPA, 2019 to 2023). `) &&
    /includes ozone days, since this source does not separate smoke/.test(sm5.finding) && sm23.finding.startsWith('About 6 days a year') && /\(EPA, 2023\)/.test(sm23.finding), sm5.finding);
  check('smoke source and confidence', sm5.source === 'EPA Air Quality Index days by county, 2019 to 2023' && sm5.confidence === 'Medium');
  check('smoke: one day reads singular; less than a tenth reads plainly',
    ctx._mapAirDays({ days: 1, firstYear: 2020, lastYear: 2021, yearCount: 2 }, 'X County').finding.startsWith('About 1 day a year') &&
    ctx._mapAirDays({ days: 0.02, firstYear: 2020, lastYear: 2021, yearCount: 2 }, 'X County').finding.startsWith('About less than 0.1 days a year'));
  route(() => json({ features: fiveYr }));
  const ac = await ctx._callAirDaysAPI('08013');
  check('airdays call: one direct GET of the captured URL', seen.length === 1 && seen[0].url === GEOPUB_URL && !seen[0].opts.method && ac.yearCount === 5);
  route(() => json({ features: [] }));
  e1 = null; try { await ctx._callAirDaysAPI('08013'); } catch (e) { e1 = e; }
  check('airdays call: a county with no monitor (no rows) throws (derived fallback)', !!e1);
  route(() => json({ error: { code: 400, message: 'Invalid query' } }));
  e1 = null; try { await ctx._callAirDaysAPI('08013'); } catch (e) { e1 = e; }
  check('airdays call: an ArcGIS error inside HTTP 200 throws', !!e1);
  e1 = null; try { await ctx._callAirDaysAPI(''); } catch (e) { e1 = e; }
  check('airdays call: no county FIPS throws before any request', !!e1 && seen.length === 1);

  // ── _compileFindings: each source and each fallback ──
  ev('state = freshState();');
  const geo = { lat: 40.015, lng: -105.2705, zip: '80302', stateAbbr: 'CO', county: 'Boulder County', fips5: '08013' };
  const ok = (score) => ({ score, finding: 'x', confidence: 'High' });
  const nriD = { tract: NRI_FX.downtown, county: NRI_FX.county }, nriF = { tract: NRI_FX.foothills, county: NRI_FX.county };
  const base = { flood: ok(2), earthquake: ok(3), wildfire: ok(3), weather: { stateAbbr: 'CO' }, drought: ok(2),
    epa: { chemScore: 2, finding: '2 facilities', confidence: 'Medium', highHazardCount: 1, potwCount: 1 }, landslide: null };
  const nB = normalsBoulder;
  const full = ctx._compileFindings(Object.assign({}, base, { nri: nriD, warnings: dt, normals: nB, airdays: b5 }), geo);
  check('compile downtown: wind 3 from IEM and NRI, High', by(full, 63).scoreAssigned === 3 && by(full, 63).confidence === 'High' &&
    by(full, 63).source === 'NWS warnings via Iowa Environmental Mesonet, 2015 to 2024, and FEMA NRI' && by(full, 63).status === 'success');
  check('compile foothills: wind 5', by(ctx._compileFindings(Object.assign({}, base, { nri: nriF, warnings: ft }), geo), 63).scoreAssigned === 5);
  check('compile downtown: heat 3 from normals, High, success', by(full, 9).scoreAssigned === 3 && by(full, 9).status === 'success' &&
    by(full, 9).confidence === 'High' && by(full, 9).source === 'NOAA 1991 to 2020 climate normals, BOULDER, CO US');
  check('compile downtown: winter 4 (3.9 nights does not add), source NRI only', by(full, 8).scoreAssigned === 4 &&
    by(full, 8).source === 'FEMA National Risk Index (census tract), December 2025 release');
  const cold5 = ctx._compileFindings(Object.assign({}, base, { nri: nriD, normals: Object.assign({}, nB, { d0: 5 }) }), geo);
  check('compile: 5 nights at or below 0 F raises winter 4 to 5 and the source names both datasets', by(cold5, 8).scoreAssigned === 5 &&
    by(cold5, 8).source === 'FEMA National Risk Index (census tract), December 2025 release; NOAA 1991 to 2020 climate normals, BOULDER, CO US' &&
    /5 nights a year at or below 0 F at BOULDER, CO US/.test(by(cold5, 8).finding));
  check('compile downtown: smoke 4 from the EPA county record, Medium, success', by(full, 23).scoreAssigned === 4 && by(full, 23).status === 'success' &&
    by(full, 23).source === 'EPA Air Quality Index days by county, 2019 to 2023' && by(full, 23).finding.includes('in Boulder County'));
  check('compile: exactly one smoke finding when the EPA record answers', full.filter(f => f.hazardId === 23).length === 1);
  // fallbacks
  const noIem = ctx._compileFindings(Object.assign({}, base, { nri: nriD, warnings: null }), geo);
  check('fallback wind: IEM failed keeps the v3.1 NRI-only finding (2, Medium, thunderstorm wind only)', by(noIem, 63).scoreAssigned === 2 &&
    by(noIem, 63).confidence === 'Medium' && by(noIem, 63).source === 'FEMA National Risk Index (census tract), December 2025 release' &&
    by(noIem, 63).finding.includes('Thunderstorm wind only'));
  const iemOnly = ctx._compileFindings(Object.assign({}, base, { nri: null, warnings: dt }), geo);
  check('fallback wind: NRI failed, IEM answered: IEM score alone, High', by(iemOnly, 63).scoreAssigned === 3 && by(iemOnly, 63).confidence === 'High');
  check('fallback wind: both failed: no finding (Needs your judgment, which names both sources)',
    !by(ctx._compileFindings(Object.assign({}, base, { nri: null, warnings: null }), geo), 63) && /NWS warning records and FEMA wind records/.test(ev('MANUAL_REASONS')[63]));
  const heatNri = ctx._compileFindings(Object.assign({}, base, { nri: { tract: NRI_FX.phoenix, county: null }, normals: null }), { stateAbbr: 'AZ' });
  check('fallback heat: normals failed uses NRI HWAV (Phoenix 23.4 = 5), Low, success, NRI tract source', by(heatNri, 9).scoreAssigned === 5 &&
    by(heatNri, 9).confidence === 'Low' && by(heatNri, 9).status === 'success' && by(heatNri, 9).source === 'FEMA National Risk Index (census tract), December 2025 release');
  const heatCounty = ctx._compileFindings(Object.assign({}, base, { nri: { tract: null, county: NRI_FX.county }, normals: null }), geo);
  check('fallback heat: no tract row uses the county HWAV with the county source', by(heatCounty, 9).status === 'success' &&
    by(heatCounty, 9).source === 'FEMA National Risk Index (county), December 2025 release');
  const heatNoD90 = ctx._compileFindings(Object.assign({}, base, { nri: nriD, normals: Object.assign({}, nB, { d90: null }) }), geo);
  check('fallback heat: a station with no 90 F count falls to NRI HWAV', by(heatNoD90, 9).confidence === 'Low' && /FEMA NRI/.test(by(heatNoD90, 9).finding));
  const heatRule = ctx._compileFindings(Object.assign({}, base, { nri: null, normals: null }), geo);
  check('fallback heat: normals and NRI both failed: the state rule of thumb', ctx._isRuleOfThumb(by(heatRule, 9)));
  const ruleCold = ctx._compileFindings(Object.assign({}, base, { nri: null, normals: Object.assign({}, nB, { d0: 12 }) }), geo);
  const ruleNoCold = ctx._compileFindings(Object.assign({}, base, { nri: null, normals: null }), geo);
  check('fallback winter: rule of thumb still takes the cold-night level from normals, and stays a rule of thumb',
    by(ruleCold, 8).scoreAssigned === Math.min(5, by(ruleNoCold, 8).scoreAssigned + 1) && ctx._isRuleOfThumb(by(ruleCold, 8)) &&
    /12 nights a year at or below 0 F/.test(by(ruleCold, 8).finding));
  check('fallback heat with normals: the rule of thumb is not used for heat', !ctx._isRuleOfThumb(by(ruleCold, 9)));
  const smokeDerived = ctx._compileFindings(Object.assign({}, base, { nri: nriD, airdays: null }), geo);
  check('fallback smoke: no EPA AQI record keeps the derived score with its existing label',
    by(smokeDerived, 23).source === 'Derived from USFS wildfire hazard and EPA TRI industrial proximity' && by(smokeDerived, 23).status === 'success');
  const smokeHolder = ctx._compileFindings(Object.assign({}, base, { wildfire: null, nri: nriD, airdays: null }), geo);
  check('fallback smoke: derived placeholder when wildfire failed too', by(smokeHolder, 23).status === 'estimated');
  const smokeEpaNoFire = ctx._compileFindings(Object.assign({}, base, { wildfire: null, nri: nriD, airdays: b23 }), geo);
  check('smoke from EPA does not depend on the wildfire lookup', by(smokeEpaNoFire, 23).status === 'success' && by(smokeEpaNoFire, 23).scoreAssigned === 3);
  ev('state.scores[63] = { na: true };');
  check('high wind marked Does not apply here: no finding', !by(ctx._compileFindings(Object.assign({}, base, { nri: nriD, warnings: dt }), geo), 63));
  ev('state = freshState();');

  const allB = [full, cold5, noIem, iemOnly, heatNri, heatCounty, heatNoD90, heatRule, ruleCold, smokeDerived, smokeHolder, smokeEpaNoFire].reduce((a, b) => a.concat(b), []);
  check('Stage B findings keep the shape and HAZARD_DATA names', allB.every(f => ['hazardId', 'hazardName', 'category', 'scoreAssigned', 'source', 'finding', 'confidence', 'status', 'isOverridden'].every(k => k in f)) &&
    allB.every(f => f.hazardName === names[f.hazardId]));

  // ── Summary line: 0 rule-of-thumb items for a Colorado point when all sources answer ──
  ev('state = freshState();');
  const water = ctx._mapWaterSystem(ctx._pickWaterSystem([{ attributes: WATER_FX.downtown }]), WATER_FX.violations, new Date(2026, 9, 31));
  const all = ctx._compileFindings(Object.assign({}, base, {
    landslide: Object.assign(ctx._landslideResult(1, 0, 0), { source: ev('LS_SRC') }), nri: nriD,
    declarations: { Fire: 9, Flood: 5, Snowstorm: 2 }, water, soil: ctx._mapSoilTable(SDA_FX.downtown), warnings: dt, normals: nB, airdays: b5,
  }), geo);
  check('all sources answering in Colorado: no finding on the state rule of thumb (hurricane ruled out)', all.filter(f => ctx._isRuleOfThumb(f)).length === 0 &&
    !by(all, 7), all.filter(f => ctx._isRuleOfThumb(f)).map(f => f.hazardId).join());
  ev(`state = freshState(); _research.geocoded = ${JSON.stringify(geo)}; _research.findings = ${JSON.stringify(all)}; _research.hasResults = true; _research.failCodes = {};`);
  const html = [];
  ctx.document.getElementById = id => id === 'research-report-content' ? { set innerHTML(v) { html.push(v); } } : null;
  ctx._renderReport();
  const page = html.join('');
  const sub = (page.match(/<span class="report-summary-sub">([^<]*)<\/span>/) || [])[1] || '';
  check('summary line: no rule-of-thumb clause and no placeholder clause when every source answers', sub.length > 0 && !/rule of thumb|placeholder/.test(sub) && /need your judgment\.$/.test(sub), sub);
  check('report: every finding in the Colorado run is "From public data"', !page.includes('Rough estimate'));
  ev(`state = freshState(); state.researchReport = { geocoded: ${JSON.stringify(geo)}, findings: ${JSON.stringify(all)}, timestamp: 't' }; state.researchAddress = 'x';`);
  const rd = ev('buildReportData()').research;
  check('saved report data: 0 rule-of-thumb items and 0 estimates', rd.ruleOfThumbCount === 0 && rd.estimatedCount === 0, JSON.stringify([rd.ruleOfThumbCount, rd.estimatedCount]));
  const est = ctx._compileFindings(Object.assign({}, base, { nri: null, normals: null }), geo).filter(f => f.status === 'estimated');
  check('summary wording stays generic: with NRI and normals down, the rule-of-thumb count reflects what fell back',
    ctx._researchSummarySub(est, 0, 2).includes(`No address-level source exists yet for ${est.filter(f => ctx._isRuleOfThumb(f)).length} items; they use a state rule of thumb.`), ctx._researchSummarySub(est, 0, 2));
  ctx.document.getElementById = () => null;
  ev('state = freshState();');

  // ── Copy rules ──
  const newCopy = [wd.finding, wd.source, wNoNri.finding, wZero.finding, wMax.finding, hb.finding, hb.source, ctx._mapNRIHeat(0.79).finding,
    ctx._mapNormalsHeat({ station: st, d90: 107.4, d100: 15.2, d0: 0 }).finding, wn(5).finding, by(cold5, 8).source, by(ruleCold, 8).finding,
    sm5.finding, sm5.source, sm23.finding, ev('MANUAL_REASONS')[63],
    'Counting NWS warnings over this point (Iowa Environmental Mesonet)', 'Checking NOAA climate normals for the nearest station', 'Counting bad-air days for your county (EPA)'];
  check('Stage B copy: no em dash, no exclamation point', !newCopy.some(t => /[—!]/.test(t)), newCopy.filter(t => /[—!]/.test(t)).join(' | '));
  check('Stage B copy: no "not X but Y" and no AI-style transitions', !newCopy.some(t => /\bnot (just )?[^.;]{1,40}\bbut\b|moreover|furthermore/i.test(t)));
  check('Stage B copy: no placeholder syntax or bad numbers', !newCopy.some(t => /\[[A-Z ]+\]|\{\w+\}|undefined|NaN|null|Infinity/.test(t)), newCopy.filter(t => /undefined|NaN|null/.test(t)).join(' | '));

  // ── Wiring ──
  const src = fs.readFileSync(path.join(ROOT, 'js/research.js'), 'utf8');
  check('runner: warnings, normals and airdays run in the parallel set and reach _compileFindings',
    src.includes("_tracked('warnings',   _callWarningsAPI(lat, lng))") && src.includes("_tracked('normals',    _callNormalsAPI(lat, lng))") &&
    src.includes("_tracked('airdays',    _callAirDaysAPI(fips5))") && /'warnings','normals','airdays'(,'radon','power')?\]/.test(src) &&
    /warnings, normals, airdays(, radon, power)? \},\s*\n\s*geocoded/.test(src));
  check('IEM goes relay-first; normals and AQI days are direct', /relayThenDirect\(_iemUrl\(/.test(src) && /directFetch\(_normalsSearchUrl\(/.test(src) &&
    /directFetch\(_normalsDataUrl\(/.test(src) && /directFetch\(_airDaysUrl\(/.test(src));
  check('relay budget plus a direct retry fits inside the _tracked cap', ev('RELAY_FIRST_BUDGET_MS') + cfg.TIMEOUT_MS < cfg.TIMEOUT_MS + cfg.PROXY_EXTRA_MS + 3000);
  const html2 = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('privacy statement names the new recipients (NOAA climate data, USDA, Iowa State)', /NOAA's climate data center/.test(html2) && /the USDA and Iowa State University's weather archive/.test(html2));
  // ── End to end: startResearch with every host mocked (downtown Boulder) ──
  console.log('v3.2.0 Stage B: full research run with mocked hosts');
  {
    const RELAY = 'https://relay.test';
    cfg.RELAY_URL = RELAY;
    const target = url => url.startsWith(RELAY + '/?url=') ? decodeURIComponent(url.slice((RELAY + '/?url=').length)) : null;
    const hosts = [];
    ctx.fetch = (url, opts) => {
      url = String(url);
      const t = target(url);
      const u = t || url;
      hosts.push((t ? 'relay:' : '') + new URL(u).hostname);
      if (u.startsWith('https://nominatim.openstreetmap.org/')) return json([{ lat: '40.015', lon: '-105.2705', display_name: 'Pearl Street, Boulder, Colorado',
        address: { postcode: '80302', 'ISO3166-2-lvl4': 'US-CO', county: 'Boulder County', city: 'Boulder' } }]);
      if (u.startsWith('https://geo.fcc.gov/')) return json({ County: { FIPS: '08013', name: 'Boulder' }, State: { code: 'CO' } });
      if (u.startsWith(cfg.NRI_TRACT)) return json({ features: [{ attributes: NRI_FX.downtown }] });
      if (u.startsWith(cfg.NRI_COUNTY)) return json({ features: [{ attributes: NRI_FX.county }] });
      if (u.startsWith(cfg.ESRI_FLOOD_HAZARD)) return json({ features: [] });
      if (u.startsWith(cfg.USGS_SEISMIC)) return json({ response: { data: { pgam: 0.14 } } });
      if (u.startsWith(cfg.USFS_WILDFIRE)) return json({ value: '2' });
      if (u.startsWith(cfg.NWS_POINTS)) return json({ properties: { relativeLocation: { properties: { state: 'CO' } }, county: 'https://api.weather.gov/zones/county/COC013' } });
      if (u.startsWith(cfg.DROUGHT_MONITOR)) return json([{ MapDate: '20261027', D0: 40, D1: 0, D2: 0, D3: 0, D4: 0 }]);
      if (u.startsWith(cfg.EPA_TRI_ZIP)) return json([]);
      if (u.startsWith(cfg.OPENFEMA_DECLARATIONS)) return json({ DisasterDeclarationsSummaries: [] });
      if (u.startsWith(cfg.EPA_WATER_BOUNDARIES)) return json({ features: [{ attributes: WATER_FX.downtown }] });
      if (u.startsWith(cfg.EPA_SDWIS_VIOLATIONS)) return json(WATER_FX.violations);
      if (u.startsWith(cfg.USDA_SDA)) return json(SDA_FX.downtown);
      if (u.startsWith(cfg.IEM_VTEC_BYPOINT)) return t ? json({ events: IEM_FX.downtown }) : Promise.reject(new Error('IEM should go through the relay'));
      if (u.startsWith(cfg.NCEI_SEARCH)) return json(NCEI_FX.search);
      if (u.startsWith(cfg.NCEI_DATA)) return json(NCEI_FX.data);
      if (u.startsWith(cfg.EPA_AQI_COUNTY)) return json({ features: fiveYr });
      return Promise.reject(new Error('unrouted ' + u));   // landslide tiles and inventory: the tile cannot load here, NRI fallback
    };
    const page2 = [];
    ctx.document.getElementById = id => id === 'research-address-input' ? { value: '1234 Pearl St, Boulder, CO 80302' }
      : id === 'research-report-content' ? { set innerHTML(v) { page2.push(v); } } : null;
    ev('state = freshState(); _research.isRunning = false; _research.hasResults = false;');
    await ctx.startResearch();
    const fsE = ev('_research.findings');
    const stE = ev('_research.stepStatuses');
    check('full run: the three new steps succeed and the smoke step reads as data', ['warnings', 'normals', 'airdays', 'airquality'].every(s => stE[s] === 'success'), JSON.stringify(stE));
    check('full run: wind 3 (IEM), heat 3 (normals), winter 4, smoke 4 (EPA), water 1, soil 2',
      [63, 9, 8, 23, 27, 66].map(id => by(fsE, id) && by(fsE, id).scoreAssigned).join() === '3,3,4,4,1,2', [63, 9, 8, 23, 27, 66].map(id => by(fsE, id) && by(fsE, id).scoreAssigned).join());
    check('full run: IEM went through the relay; NCEI and geopub went direct', hosts.includes('relay:mesonet.agron.iastate.edu') && !hosts.includes('mesonet.agron.iastate.edu') &&
      hosts.includes('www.ncei.noaa.gov') && hosts.includes('geopub.epa.gov'));
    const subE = ((page2.join('').match(/<span class="report-summary-sub">([^<]*)<\/span>/) || [])[1]) || '';
    check('full run, Colorado: 0 items on the state rule of thumb in the summary line', fsE.filter(f => ctx._isRuleOfThumb(f)).length === 0 && subE && !/rule of thumb/.test(subE), subE);
    cfg.RELAY_URL = savedRelay;
    ctx.document.getElementById = () => null;
    ctx.fetch = () => Promise.reject(new Error('no network in tests'));
    ev('state = freshState();');
  }
  ctx.fetch = () => Promise.reject(new Error('no network in tests'));

  // ── Relay: allow-list and the IEM cache ──
  console.log('relay/worker.js: IEM and cache');
  const w = await import(require('url').pathToFileURL(path.join(ROOT, 'relay/worker.js')).href);
  const IEM = 'https://mesonet.agron.iastate.edu/json/vtec_events_bypoint.py?lat=40.01&lon=-105.27&sdate=2015-01-01&edate=2026-01-01';
  const IEM2 = 'https://mesonet.agron.iastate.edu/json/vtec_events_bypoint.py?lat=40.04&lon=-105.33&sdate=2015-01-01&edate=2026-01-01';
  const USGS = 'https://earthquake.usgs.gov/ws/designmaps/nehrp-2020.json?latitude=40';
  check('relay allows mesonet.agron.iastate.edu', w.isAllowedTarget(IEM) && w.ALLOWED_HOSTS.has('mesonet.agron.iastate.edu'));
  check('relay still rejects hosts the spec did not add (NCEI, geopub) and IEM look-alikes',
    !w.isAllowedTarget('https://www.ncei.noaa.gov/access/services/data/v1') && !w.isAllowedTarget('https://geopub.epa.gov/ArcGIS/rest/services') &&
    !w.isAllowedTarget('https://mesonet.agron.iastate.edu.evil.example/') && !w.isAllowedTarget('http://mesonet.agron.iastate.edu/json/'));
  check('cache lifetime: IEM 30 days, everything else none', w.cacheTtlFor(IEM) === 2592000 && w.cacheTtlFor(USGS) === 0 && w.cacheTtlFor('nope') === 0);
  check('cache key is the relay origin plus the full target URL', w.cacheKeyFor('https://relay.test/?url=x&junk=1', IEM) === 'https://relay.test/?url=' + encodeURIComponent(IEM));

  const realFetch = globalThis.fetch, realCaches = globalThis.caches;
  const store = new Map();
  let puts = 0, upstream = [];
  const fakeCache = {
    match: async req => { const r = store.get(req.url); return r ? r.clone() : undefined; },
    put: async (req, resp) => { puts++; if (req.method && req.method !== 'GET') throw new Error('GET only'); store.set(req.url, resp.clone()); },
  };
  const ORIGIN = 'https://worldaware.github.io';
  const req = u => new Request('https://relay.test/?url=' + encodeURIComponent(u), { headers: { Origin: ORIGIN } });
  const upOk = body => async (url, init) => { upstream.push({ url, init }); return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'a=b' } }); };
  try {
    globalThis.caches = { default: fakeCache };
    globalThis.fetch = upOk('{"events":[1]}');
    let r = await w.handleRequest(req(IEM));
    check('IEM first request: MISS, upstream called once, 200 with ACAO and the body', r.status === 200 && r.headers.get('X-Relay-Cache') === 'MISS' &&
      upstream.length === 1 && r.headers.get('Access-Control-Allow-Origin') === ORIGIN && (await r.text()) === '{"events":[1]}');
    const stored = store.get('https://relay.test/?url=' + encodeURIComponent(IEM));
    check('IEM answer stored under the full target URL with a 30-day lifetime and no CORS or cookie headers',
      puts === 1 && !!stored && stored.headers.get('Cache-Control') === 'public, max-age=2592000' && !stored.headers.get('Access-Control-Allow-Origin') &&
      !stored.headers.get('Set-Cookie') && stored.headers.get('Content-Type') === 'application/json');
    check('IEM upstream fetch asks Cloudflare for a 30-day edge lifetime too', upstream[0].init.cf.cacheTtlByStatus['200-299'] === 2592000);
    r = await w.handleRequest(req(IEM));
    check('IEM second request: HIT, no upstream call, same body, ACAO for the caller', r.status === 200 && r.headers.get('X-Relay-Cache') === 'HIT' &&
      upstream.length === 1 && (await r.text()) === '{"events":[1]}' && r.headers.get('Access-Control-Allow-Origin') === ORIGIN &&
      r.headers.get('Cache-Control') === 'public, max-age=2592000');
    r = await w.handleRequest(req(IEM2));
    check('a different IEM URL is its own entry (upstream called again)', r.headers.get('X-Relay-Cache') === 'MISS' && upstream.length === 2 && store.size === 2);
    r = await w.handleRequest(req(USGS));
    check('non-IEM hosts are never cached', r.status === 200 && !r.headers.get('X-Relay-Cache') && puts === 2 && r.headers.get('Cache-Control') === 'public, max-age=3600' &&
      upstream[2].init.cf.cacheTtlByStatus['200-299'] === 3600);
    store.clear(); puts = 0;
    globalThis.fetch = async () => new Response('busy', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    r = await w.handleRequest(req(IEM));
    check('an IEM error answer passes through and is not cached', r.status === 503 && puts === 0 && store.size === 0 && r.headers.get('Cache-Control') === 'no-store');
    let waited = null;
    globalThis.fetch = upOk('{"events":[]}');
    r = await w.handleRequest(req(IEM), {}, { waitUntil: p => { waited = p; } });
    check('with an execution context, the cache write goes to waitUntil', r.status === 200 && waited && typeof waited.then === 'function');
    await waited;
    check('waitUntil write lands in the cache', store.size === 1);
    globalThis.caches = { default: { match: async () => { throw new Error('cache down'); }, put: async () => { throw new Error('cache down'); } } };
    upstream = []; globalThis.fetch = upOk('{"events":[2]}');
    r = await w.handleRequest(req(IEM));
    check('cache errors fall through: upstream answers and the response still arrives', r.status === 200 && upstream.length === 1 && (await r.text()) === '{"events":[2]}');
    delete globalThis.caches;
    upstream = [];
    r = await w.handleRequest(req(IEM));
    check('no Cache API (node, previews): IEM still relays normally', r.status === 200 && upstream.length === 1 && !r.headers.get('X-Relay-Cache') && (await r.text()) === '{"events":[2]}');
    globalThis.caches = { default: {} };
    r = await w.handleRequest(req(IEM));
    check('a caches.default without match and put is treated as no cache', r.status === 200 && !r.headers.get('X-Relay-Cache'));
    globalThis.caches = { default: fakeCache };
    r = await w.handleRequest(new Request('https://relay.test/?url=' + encodeURIComponent(IEM), { headers: { Origin: 'https://evil.example' } }));
    check('a cached host still refuses other origins', r.status === 403);
    const ws = fs.readFileSync(path.join(ROOT, 'relay/worker.js'), 'utf8');
    check('worker still has no console logging', !/console\.(log|info|warn|error|debug)/.test(ws));
    const readme = fs.readFileSync(path.join(ROOT, 'relay/README.md'), 'utf8');
    check('README lists IEM and explains the cache and the custom-domain requirement', readme.includes('mesonet.agron.iastate.edu') &&
      /30 days/.test(readme) && /custom domain/.test(readme) && /workers\.dev/.test(readme));
  } finally {
    globalThis.fetch = realFetch;
    if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches;
  }
}

/* ---------------------------------------------------------------
   v3.2.0 Stage C: radon (64) and long power outage (24) from static data
   files, the build script, the data-refresh workflow, version pins.
   The data files the app reads in these checks are built by running
   scripts/build-data.js on tests/fixtures/ (synthetic inputs in the EPA and
   EIA-861 layouts), so the script and the app are tested end to end.
--------------------------------------------------------------- */
async function v32StageCChecks() {
  console.log('v3.2.0 Stage C: radon, power history, build script');
  const os = require('os');
  const { spawnSync } = require('child_process');
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
  const cats = Object.fromEntries(HD.map(h => [h.id, h.category]));
  const json = body => Promise.resolve({ ok: true, status: 200, json: async () => body });
  const seen = [];
  const route = handler => { seen.length = 0; ctx.fetch = (url, opts) => { seen.push({ url: String(url), opts: opts || {} }); return handler(String(url), opts || {}); }; };
  const by = (fs_, id) => fs_.find(f => f.hazardId === id);
  const NOW = new Date(2026, 9, 31);
  const FX = path.join(ROOT, 'tests', 'fixtures');
  const SCRIPT = path.join(ROOT, 'scripts', 'build-data.js');
  const bd = require(SCRIPT);
  let e1;

  // ── Build script on the local fixtures ──
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stagec-'));
  const run = (args, extra) => spawnSync(process.execPath, [SCRIPT].concat(args), Object.assign({ encoding: 'utf8' }, extra || {}));
  const baseArgs = out => ['--out', out, '--radon-file', path.join(FX, 'radon-zones-sample.json'),
    '--eia-dir', path.join(FX, 'eia861-2025'), '--eia-dir', path.join(FX, 'eia861-2024'), '--fips-file', path.join(FX, 'national_county-sample.txt'),
    '--min-radon', '5', '--min-power-counties', '3', '--built', '2026-10-31'];
  let radonFile, powerFile;
  try {
    const out1 = path.join(tmp, 'data');
    const r1 = run(baseArgs(out1));
    check('build script: runs on local fixtures with no network and exits 0', r1.status === 0, r1.stderr);
    radonFile = JSON.parse(fs.readFileSync(path.join(out1, 'radon-zones.json'), 'utf8'));
    powerFile = JSON.parse(fs.readFileSync(path.join(out1, 'power-reliability.json'), 'utf8'));
    check('build script radon: { built, source, zones } with numeric zones keyed "County, ST"',
      radonFile.built === '2026-10-31' && radonFile.source === 'https://www.epa.gov/system/files/other-files/2024-06/radon-zones-202406.json' &&
      radonFile.zones['Boulder, CO'] === 1 && radonFile.zones['Cook, IL'] === 2 && radonFile.zones['Miami-Dade, FL'] === 3 && radonFile.zones['St. Louis, MO'] === 2,
      JSON.stringify(radonFile).slice(0, 200));
    check('build script radon: rows with no zone or a zone outside 1 to 3 are skipped', !('Bad Row, CO' in radonFile.zones) && !('Unzoned, CO' in radonFile.zones) &&
      Object.keys(radonFile.zones).length === 10 && r1.stdout.includes('2 rows skipped'), r1.stdout);
    check('build script radon: keys sorted', Object.keys(radonFile.zones).join('|') === Object.keys(radonFile.zones).slice().sort().join('|'));
    check('build script power: { built, source, year, byCounty, byState }',
      powerFile.built === '2026-10-31' && powerFile.source === 'https://www.eia.gov/electricity/data/eia861/zip/f8612025.zip' && powerFile.year === 2025 &&
      powerFile.byCounty && powerFile.byState, Object.keys(powerFile).join());
    const bou = powerFile.byCounty['08013'];
    check('build script power: Boulder County lists its three utilities, highest first, as { utility, saidi, years }',
      bou.length === 3 && bou[0].utility === 'Public Service Co of Colorado' && bou[1].utility === 'United Power, Inc.' && bou[2].utility === 'Longmont Power & Communications' &&
      bou.every(u => typeof u.saidi === 'number' && Array.isArray(u.years) && u.years.length === 2), JSON.stringify(bou));
    check('build script power: median over the last 5 reported years (900, 900 in 2019 and 2020 are left out; 240, 200, 269.9, 255.1, 300 -> 255.1)',
      bou[0].saidi === 255.1 && JSON.stringify(bou[0].years) === '[2021,2025]', JSON.stringify(bou[0]));
    check('build script power: a year repeated in two folders keeps the first folder listed (PSCo 2024 is 255.1 in the median, not 999)', bou[0].saidi === 255.1);
    check('build script power: fewer than 5 years uses what is reported (Longmont 2020, 2023, 2024, 2025: median of 5000, 80, 95, 85 = 90)',
      bou[2].saidi === 90 && JSON.stringify(bou[2].years) === '[2020,2025]', JSON.stringify(bou[2]));
    check('build script power: values in the "other standard" columns are used when the IEEE columns are empty (Alaska 1500)',
      powerFile.byCounty['02013'][0].saidi === 1500);
    check('build script power: implausible SAIDI (150000 minutes) and utilities with no SAIDI add no row',
      !bou.some(u => /Absurd|Tiny/.test(u.utility)) && !powerFile.byCounty['08069']);
    check('build script power: county names turn into 5-digit FIPS; "Baltimore" is the county and "Baltimore City" the city',
      powerFile.byCounty['24005'] && powerFile.byCounty['24510'] && powerFile.byCounty['27053'] && powerFile.byCounty['08123'].length === 1);
    check('build script power: a repeated territory row lists the utility once; an earlier territory year is ignored; an unknown county is counted, not guessed',
      bou.filter(u => /Public Service/.test(u.utility)).length === 1 && !bou.some(u => /Old Co/.test(u.utility)) && /1 territory rows without a county code/.test(r1.stdout), r1.stdout);
    const wmean = (255.1 * 1500000 + 240 * 100000 + 90 * 50000) / 1650000;
    check('build script power: state figure is the customer-weighted mean of utility medians (CO), a plain value for MN',
      Math.abs(powerFile.byState.CO - Math.round(wmean * 10) / 10) < 1e-9 && powerFile.byState.MN === 160 && powerFile.byState.AK === 1500 && /customer-weighted/.test(powerFile.stateMethod), JSON.stringify(powerFile.byState));
    check('build script power: yearRange covers the years used', JSON.stringify(powerFile.yearRange) === '[2020,2025]');

    // Same inputs again: nothing changes, including the built date
    const again = run(baseArgs(out1).map(a => (a === '2026-10-31' ? '2027-01-02' : a)));
    const radonText = fs.readFileSync(path.join(out1, 'radon-zones.json'), 'utf8');
    check('build script: a re-run on unchanged data keeps the old built date (no diff)', again.status === 0 && JSON.parse(radonText).built === '2026-10-31' &&
      JSON.parse(fs.readFileSync(path.join(out1, 'power-reliability.json'), 'utf8')).built === '2026-10-31');
    const out2 = path.join(tmp, 'data2');
    run(baseArgs(out2).concat(['--only', 'radon']));
    check('build script: --only radon writes just the radon file', fs.existsSync(path.join(out2, 'radon-zones.json')) && !fs.existsSync(path.join(out2, 'power-reliability.json')));
    check('build script: the file is JSON that reads one county per line', radonText.split('\n').length === 17 && /\n    "Boulder, CO": 1,\n/.test(radonText));

    // Failures: nothing is written for the failed source, exit code 1
    const out3 = path.join(tmp, 'data3');
    const low = run(['--out', out3, '--radon-file', path.join(FX, 'radon-zones-sample.json'), '--only', 'radon']);
    check('build script: a radon file with far fewer counties than expected fails, writes nothing, exits 1',
      low.status === 1 && /Only 10 radon zone rows/.test(low.stderr) && !fs.existsSync(path.join(out3, 'radon-zones.json')), low.stderr);
    fs.writeFileSync(path.join(tmp, 'bad.json'), '{"rows":[]}');
    const bad = run(['--out', out3, '--radon-file', path.join(tmp, 'bad.json'), '--only', 'radon']);
    check('build script: a radon file without a "data" array fails', bad.status === 1 && /no "data" array/.test(bad.stderr));
    const empty = path.join(tmp, 'empty-eia'); fs.mkdirSync(empty);
    const noRel = run(['--out', out3, '--eia-dir', empty, '--fips-file', path.join(FX, 'national_county-sample.txt'), '--only', 'power']);
    check('build script: an EIA folder with no reliability rows fails with a clear message', noRel.status === 1 && /No reliability rows/.test(noRel.stderr), noRel.stderr);
    const partial = run(baseArgs(path.join(tmp, 'data4')).map(a => (a === path.join(FX, 'radon-zones-sample.json') ? path.join(tmp, 'bad.json') : a)));
    check('build script: one source failing still writes the other, and the run exits 1 so the workflow stops',
      partial.status === 1 && fs.existsSync(path.join(tmp, 'data4', 'power-reliability.json')) && !fs.existsSync(path.join(tmp, 'data4', 'radon-zones.json')));
    check('build script: unknown option and bad year are refused', run(['--nope', 'x']).status === 1 && run(['--year', 'abc']).status === 1 && run(['--only', 'water']).status === 1);

    // Unit level
    check('csv parser: quotes, embedded commas and quotes, CRLF, BOM', JSON.stringify(bd.parseCsv('﻿a,"b,c","d ""e"""\r\n1,2,3\r\n')) === '[["a","b,c","d \\"e\\""],["1","2","3"]]');
    const idx = bd.buildCountyIndex(fs.readFileSync(path.join(FX, 'national_county-sample.txt'), 'utf8'));
    check('county index: with and without the County/Borough word, case, periods and "Saint"',
      idx.lookup('CO', 'Boulder') === '08013' && idx.lookup('CO', 'BOULDER COUNTY') === '08013' && idx.lookup('AK', 'Aleutians East') === '02013' &&
      idx.lookup('MD', 'Baltimore') === '24005' && idx.lookup('MD', 'Baltimore City') === '24510' && idx.lookup('CO', 'Atlantis') === '' && idx.lookup('MN', 'Hennepin') === '27053');
    const pipe = bd.buildCountyIndex('STATE|STATEFP|COUNTYFP|COUNTYNS|COUNTYNAME|CLASSFP|FUNCSTAT\nCO|08|013|00198122|Boulder County|H1|A\n');
    check('county index: also reads the pipe-separated Census layout', pipe.lookup('CO', 'Boulder') === '08013');
    const mkTerr = (n, miss) => Array.from({ length: n }, (_, i) => ({ util: '1', name: 'U', state: 'CO', county: i < miss ? 'Nowhere' + i : 'Boulder', fips: '', year: 2025 }));
    const rel1 = [{ util: '1', name: 'U', state: 'CO', year: 2025, saidi: 100, customers: 0 }];
    e1 = null; try { bd.buildPower(rel1, mkTerr(20, 2), idx, { minPowerCounties: 1 }); } catch (e) { e1 = e; }
    check('build script: up to 10 percent of territory rows may be unmatched', !e1);
    e1 = null; try { bd.buildPower(rel1, mkTerr(20, 3), idx, { minPowerCounties: 1 }); } catch (e) { e1 = e; }
    check('build script: more than 10 percent unmatched stops the build (county names may have changed)', !!e1 && /3 of 20 territory rows/.test(e1.message), e1 && e1.message);
    check('build script: territory rows that carry their own FIPS need no county list', (() => {
      const p = bd.buildPower(rel1, [{ util: '1', name: 'U', state: 'CO', county: 'Boulder', fips: '08013', year: 2025 }], null, { minPowerCounties: 1 });
      return p.payload.byCounty['08013'][0].saidi === 100 && p.payload.byState.CO === 100;
    })());
    check('build script: a utility listed under a state it did not report for falls back to its own figure', (() => {
      const p = bd.buildPower(rel1, [{ util: '1', name: 'U', state: 'WY', county: 'X', fips: '56001', year: 2025 }], null, { minPowerCounties: 1 });
      return p.payload.byCounty['56001'][0].saidi === 100;
    })());
    const hdr = bd.findHeader([['Title'], ['', 'IEEE'], ['Data Year', 'Utility Number', 'State', 'SAIDI With MED'], [2025, 7, 'CO', 5]], t => t.some(x => /saidi/.test(x)));
    check('sheet reader: finds the header under title and group rows, and joins the rows above it', hdr && hdr.first === 3 && hdr.text[3] === 'saidi with med');
    check('sheet reader: xlsx without the xlsx package says how to install it', (() => {
      try { require.resolve('xlsx'); return true; } catch (e) { /* not installed: the CI check job does not install it */ }
      try { bd.readEia([(() => { const d = path.join(tmp, 'x'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'Reliability_2025.xlsx'), 'x'); return d; })()]); return false; }
      catch (e) { return /npm install xlsx@0\.18\.5 --no-save/.test(e.message); }
    })());
    const scriptSrc = fs.readFileSync(SCRIPT, 'utf8');
    check('build script: no dependencies at load (xlsx only inside readSheets, only for .xlsx files)', !/^const .*require\('xlsx'\)/m.test(scriptSrc) && (scriptSrc.match(/require\('xlsx'\)/g) || []).length === 1 &&
      (scriptSrc.match(/require\('([^'.][^']*)'\)/g) || []).every(m => /'(fs|os|path|child_process|xlsx)'/.test(m)));
    check('build script: sends an identifying User-Agent on downloads and defaults to the spec sources',
      /User-Agent': UA/.test(scriptSrc) && scriptSrc.includes('radon-zones-202406.json') && scriptSrc.includes('f861${year}.zip') && /year: 2025/.test(scriptSrc));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ── Workflow ──
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'data-refresh.yml'), 'utf8');
  check('workflow: manual run and a yearly schedule in the first week of July', /workflow_dispatch:/.test(wf) && /cron: '\d+ \d+ [1-7] 7 \*'/.test(wf));
  check('workflow: installs xlsx@0.18.5 without saving, then runs the script', wf.includes('npm install xlsx@0.18.5 --no-save') && wf.includes('node scripts/build-data.js'));
  check('workflow: opens a pull request on branch data/refresh with the spec title, and only the data files',
    wf.includes('peter-evans/create-pull-request@v6') && /branch: data\/refresh/.test(wf) && wf.includes("title: 'Data refresh: radon zones and power reliability'") &&
    /add-paths: \|?\s*\n?\s*data\/\*\.json/.test(wf));
  check('workflow: never pushes to main', !/git push|push:|branches:\s*\[?\s*main/.test(wf) && /permissions:\s*\n\s+contents: write\s*\n\s+pull-requests: write/.test(wf));
  check('workflow: matches the check workflow (checkout v4, setup-node v4, node 20)', wf.includes('actions/checkout@v4') && wf.includes('actions/setup-node@v4') && /node-version: '20'/.test(wf));
  check('workflow: the year input goes through an env variable, not straight into the shell', /EIA_YEAR: \$\{\{ inputs\.eia_year/.test(wf) && /--year "\$EIA_YEAR"/.test(wf));
  const chk = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'check.yml'), 'utf8');
  check('check workflow also syntax-checks scripts/*.js', /for f in app\.js sw\.js js\/\*\.js scripts\/\*\.js; do node --check/.test(chk));

  // ── Config, names, steps ──
  check('Stage C config: relative data file paths', cfg.DATA_RADON === 'data/radon-zones.json' && cfg.DATA_POWER === 'data/power-reliability.json');
  check('Stage C names and categories match HAZARD_DATA exactly (24 and 64)', ev('H_NAME')[24] === names[24] && ev('H_NAME')[64] === names[64] &&
    names[64] === 'Radon' && names[24] === 'Long power outage, including planned safety shutoffs' && ev('_hCat')(24) === cats[24] && ev('_hCat')(64) === cats[64] &&
    cats[24] === 'Outages & Service Interruptions' && cats[64] === 'Home');
  const steps = ev('STEPS');
  check('Stage C steps: radon and power after airdays', steps.findIndex(s => s.id === 'radon') === steps.findIndex(s => s.id === 'airdays') + 1 &&
    steps.findIndex(s => s.id === 'power') === steps.findIndex(s => s.id === 'radon') + 1);

  // ── Radon mapping and name lookup ──
  const rm = (z, st) => ctx._mapRadonZone({ zone: z }, 'Boulder County', st || 'CO');
  check('radon zones: 1 = 4, 2 = 3, 3 = 2', rm(1).score === 4 && rm(2).score === 3 && rm(3).score === 2);
  check('radon zone outside 1 to 3 gives nothing', rm(0) === null && rm(4) === null && ctx._mapRadonZone(null, 'X', 'CO') === null);
  check('radon Boulder finding is the spec sentence, Low confidence, county source',
    rm(1).finding === 'Boulder County is in EPA radon zone 1 (highest). About half of Colorado homes test above the action level. Only a test answers it for your house.' &&
    rm(1).confidence === 'Low' && rm(1).source === 'EPA Map of Radon Zones (county), 2024', rm(1).finding);
  check('radon outside Colorado does not borrow the Colorado statistic; it states EPA\'s zone meaning',
    rm(1, 'MN').finding === 'Boulder County is in EPA radon zone 1 (highest). EPA predicts an average indoor level above 4 pCi/L, its action level, in zone 1 counties. Only a test answers it for your house.' &&
    /between 2 and 4 pCi\/L/.test(rm(2).finding) && /below 2 pCi\/L/.test(rm(3).finding) && !/Colorado/.test(rm(2).finding));
  const Z = radonFile.zones;
  const rl = (c, s) => { const h = ctx._radonLookup(Z, c, s); return h && h.zone; };
  check('radon lookup: "Boulder County" and "Boulder" both find "Boulder, CO"', rl('Boulder County', 'CO') === 1 && rl('Boulder', 'CO') === 1 && rl('boulder county', 'co') === 1);
  check('radon lookup: the state must match (Boulder, MN is not in the file)', rl('Boulder County', 'MN') === null && rl('Hennepin County', 'MN') === 1);
  check('radon lookup: St. Louis, Saint Louis, Anchorage Municipality, Miami-Dade',
    rl('St. Louis County', 'MO') === 2 && rl('Saint Louis County', 'MO') === 2 && rl('Anchorage Municipality', 'AK') === 3 && rl('Miami-Dade County', 'FL') === 3);
  check('radon lookup: unknown county, empty name, no state, bad zone value, string zone',
    rl('Atlantis County', 'CO') === null && rl('', 'CO') === null && rl('Boulder', '') === null && rl('Boulder', 'CO') === 1 &&
    ctx._radonLookup({ 'Boulder, CO': 7 }, 'Boulder', 'CO') === null && ctx._radonLookup({ 'Boulder, CO': '2' }, 'Boulder', 'CO').zone === 2 && ctx._radonLookup(null, 'Boulder', 'CO') === null);

  // ── Radon file call: absent, present ──
  route(() => json(radonFile));
  const rc = await ctx._callRadonAPI('Boulder County', 'CO');
  check('radon call: one GET of the relative data path, no relay, zone 1', seen.length === 1 && seen[0].url === 'data/radon-zones.json' && !seen[0].opts.method && rc.zone === 1);
  route(() => Promise.resolve({ ok: false, status: 404, json: async () => ({}) }));
  e1 = null; try { await ctx._callRadonAPI('Boulder County', 'CO'); } catch (e) { e1 = e; }
  check('radon call: file absent (404) throws a NO_DATA_FILE error, so the hazard stays on "Needs your judgment"', !!e1 && e1.code === 'NO_DATA_FILE' && /not published yet/.test(e1.message));
  route(() => Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }));
  e1 = null; try { await ctx._callRadonAPI('Boulder County', 'CO'); } catch (e) { e1 = e; }
  check('radon call: an HTML page served for the missing file (not JSON) throws', !!e1);
  route(() => json(radonFile));
  e1 = null; try { await ctx._callRadonAPI('Atlantis County', 'CO'); } catch (e) { e1 = e; }
  check('radon call: a county that is not in the file throws', !!e1 && /not in the radon zone file/.test(e1.message));
  route(() => json([1, 2]));
  e1 = null; try { await ctx._callRadonAPI('Boulder County', 'CO'); } catch (e) { e1 = e; }
  check('radon call: a file that is not an object throws', !!e1);

  // ── Power mapping ──
  const ps = m => ctx._powerScore(m);
  check('power SAIDI: 89.9 = 1, 90 = 2, 179.9 = 2, 180 = 3', ps(89.9) === 1 && ps(90) === 2 && ps(179.9) === 2 && ps(180) === 3);
  check('power SAIDI: 359.9 = 3, 360 = 4, 720 = 4 (over 720 is 5), 720.1 = 5', ps(359.9) === 3 && ps(360) === 4 && ps(720) === 4 && ps(720.1) === 5);
  check('power SAIDI: 0 = 1, 5000 = 5', ps(0) === 1 && ps(5000) === 5);
  const pl = (fips, st) => ctx._powerLookup(powerFile, fips, st);
  const pb = pl('08013', 'CO');
  check('power lookup: the highest SAIDI among the county\'s utilities, with its name, years and the utility count',
    pb.level === 'county' && pb.saidi === 255.1 && pb.utility === 'Public Service Co of Colorado' && pb.utilityCount === 3 && JSON.stringify(pb.years) === '[2021,2025]', JSON.stringify(pb));
  const unordered = { byCounty: { '08013': [{ utility: 'A', saidi: 100, years: [2021, 2025] }, { utility: 'B', saidi: 300, years: [2021, 2025] }, { utility: 'C', saidi: 200, years: [2021, 2025] }] }, byState: {} };
  check('power lookup: takes the maximum whatever the order in the file', ctx._powerLookup(unordered, '08013', 'CO').utility === 'B');
  const ps2 = pl('08069', 'CO');
  check('power lookup: a county missing from the file uses the state value', ps2.level === 'state' && ps2.saidi === powerFile.byState.CO && JSON.stringify(ps2.years) === '[2020,2025]', JSON.stringify(ps2));
  check('power lookup: no county and no state value gives nothing', pl('99999', 'ZZ') === null && ctx._powerLookup(null, '08013', 'CO') === null && ctx._powerLookup({}, '08013', 'CO') === null);
  check('power lookup: entries without a usable SAIDI are ignored', ctx._powerLookup({ byCounty: { '08013': [{ utility: 'A', saidi: 'n/a' }, { utility: 'B', saidi: 0 }] }, byState: { CO: 200 }, year: 2025 }, '08013', 'CO').level === 'state');
  const pf = ctx._mapPowerReliability(pb, 'Boulder County', 'CO');
  check('power Boulder: 255.1 minutes = 3, Low, source names the median years',
    pf.score === 3 && pf.confidence === 'Low' && pf.source === 'EIA-861 reliability, median 2021 to 2025', JSON.stringify(pf));
  check('power finding: utility, minutes, years, planned shutoffs note (spec sentence)',
    pf.finding.startsWith('Customers of Public Service Co of Colorado averaged 255 minutes without power a year including major events (EIA-861, 2021 to 2025).') &&
    pf.finding.endsWith('Planned safety shutoffs are extra: check your utility\'s wildfire-safety page.'), pf.finding);
  check('power finding: several utilities in the county says it is the highest and yours may be lower',
    pf.finding.includes('This is the highest of the 3 utilities listed for Boulder County; the one that serves you may be lower.') &&
    !ctx._mapPowerReliability(pl('27053', 'MN'), 'Hennepin County', 'MN').finding.includes('highest of'));
  const pst = ctx._mapPowerReliability(ps2, 'Larimer County', 'CO');
  check('power state fallback: says no utility is listed for the county and gives the state figure',
    pst.finding.startsWith('No utility is listed for Larimer County, so this is the CO figure: utilities there averaged 249 minutes without power a year including major events (EIA-861, 2020 to 2025).') &&
    pst.score === 3 && pst.source === 'EIA-861 reliability, median 2020 to 2025');
  check('power: thousands get a comma, one year reads as one year', ctx._mapPowerReliability({ level: 'county', saidi: 1500, utility: 'Remote Coop Alaska', years: [2025, 2025], utilityCount: 1 }, 'X Borough', 'AK').finding.startsWith('Customers of Remote Coop Alaska averaged 1,500 minutes') &&
    ctx._mapPowerReliability({ level: 'county', saidi: 1500, utility: 'R', years: [2025, 2025], utilityCount: 1 }, 'X', 'AK').source === 'EIA-861 reliability, median 2025');
  check('power: no usable value gives nothing', ctx._mapPowerReliability(null, 'X', 'CO') === null && ctx._mapPowerReliability({ level: 'county', saidi: 0 }, 'X', 'CO') === null);

  // ── Power file call ──
  route(() => json(powerFile));
  const pc = await ctx._callPowerAPI('08013', 'CO');
  check('power call: one GET of the relative data path, highest SAIDI returned', seen.length === 1 && seen[0].url === 'data/power-reliability.json' && pc.saidi === 255.1);
  route(() => Promise.resolve({ ok: false, status: 404, json: async () => ({}) }));
  e1 = null; try { await ctx._callPowerAPI('08013', 'CO'); } catch (e) { e1 = e; }
  check('power call: file absent (404) throws a NO_DATA_FILE error', !!e1 && e1.code === 'NO_DATA_FILE');
  route(() => json(powerFile));
  e1 = null; try { await ctx._callPowerAPI('99999', 'ZZ'); } catch (e) { e1 = e; }
  check('power call: no record for the county or the state throws', !!e1);
  e1 = null; try { await ctx._callPowerAPI('', ''); } catch (e) { e1 = e; }
  check('power call: no FIPS and no state throws', !!e1);

  // ── _compileFindings ──
  ev('state = freshState();');
  const geo = { lat: 40.015, lng: -105.2705, zip: '80302', stateAbbr: 'CO', county: 'Boulder County', fips5: '08013' };
  const ok = (score) => ({ score, finding: 'x', confidence: 'High' });
  const nriD = { tract: NRI_FX.downtown, county: NRI_FX.county };
  const base = { flood: ok(2), earthquake: ok(3), wildfire: ok(3), weather: { stateAbbr: 'CO' }, drought: ok(2),
    epa: { chemScore: 2, finding: '2 facilities', confidence: 'Medium', highHazardCount: 1, potwCount: 1 }, landslide: null, nri: nriD };
  const comp = extra => ctx._compileFindings(Object.assign({}, base, extra || {}), geo);
  const withBoth = comp({ radon: rc, power: pc });
  const fr = by(withBoth, 64), fp = by(withBoth, 24);
  check('compile: radon 64 is 4, Low, estimated, county source, Home category, HAZARD_DATA name',
    fr.scoreAssigned === 4 && fr.confidence === 'Low' && fr.status === 'estimated' && fr.source === 'EPA Map of Radon Zones (county), 2024' &&
    fr.hazardName === 'Radon' && fr.category === 'Home' && fr.isOverridden === false, JSON.stringify(fr));
  check('compile: radon finding names the county from the research', fr.finding.startsWith('Boulder County is in EPA radon zone 1 (highest).'));
  check('compile: power 24 is 3, Low, estimated, EIA source, Outages category, HAZARD_DATA name',
    fp.scoreAssigned === 3 && fp.confidence === 'Low' && fp.status === 'estimated' && fp.source === 'EIA-861 reliability, median 2021 to 2025' &&
    fp.hazardName === names[24] && fp.category === 'Outages & Service Interruptions', JSON.stringify(fp));
  check('compile: files absent or county missing means no finding for 64 and 24 (they stay on the judgment list)',
    !by(comp(), 64) && !by(comp(), 24) && !by(comp({ radon: null, power: null }), 64));
  const lists = comp({ radon: rc, power: pc });
  check('compile: exactly one finding each for 64 and 24', lists.filter(f => f.hazardId === 64).length === 1 && lists.filter(f => f.hazardId === 24).length === 1);
  ev('state.scores[64] = { na: true }; state.scores[24] = { na: true };');
  check('compile: radon or power marked Does not apply here: no finding', !by(comp({ radon: rc, power: pc }), 64) && !by(comp({ radon: rc, power: pc }), 24));
  ev('state = freshState();');
  const mnGeo = { lat: 44.98, lng: -93.27, zip: '55401', stateAbbr: 'MN', county: 'Hennepin County', fips5: '27053' };
  const mnR = await (async () => { route(() => json(radonFile)); return ctx._callRadonAPI('Hennepin County', 'MN'); })();
  const mnP = await (async () => { route(() => json(powerFile)); return ctx._callPowerAPI('27053', 'MN'); })();
  const mn = ctx._compileFindings(Object.assign({}, base, { radon: mnR, power: mnP, nri: { tract: Object.assign({ COUNTY: 'Hennepin' }, NRI_FX.minneapolis), county: null } }), mnGeo);
  check('compile Minneapolis: radon zone 1 = 4 with the generic EPA sentence, power 160 minutes = 2, county named',
    by(mn, 64).scoreAssigned === 4 && !/Colorado/.test(by(mn, 64).finding) && /Hennepin County is in EPA radon zone 1/.test(by(mn, 64).finding) &&
    by(mn, 24).scoreAssigned === 2 && /Northern States Power Co - Minnesota averaged 160 minutes/.test(by(mn, 24).finding));
  check('Stage C findings keep the shape and HAZARD_DATA names', [withBoth, mn].every(L => L.every(f => ['hazardId', 'hazardName', 'category', 'scoreAssigned', 'source', 'finding', 'confidence', 'status'].every(k => k in f) && f.hazardName === names[f.hazardId])));

  // ── County estimates are counted as such, not as failed sources ──
  check('county estimate test: radon and power findings are county estimates; placeholders and the rule of thumb are not',
    ctx._isCountyEstimate(fr) && ctx._isCountyEstimate(fp) && !ctx._isCountyEstimate({ status: 'estimated', source: 'World Aware placeholder (EPA TRI did not respond)' }) &&
    !ctx._isCountyEstimate({ status: 'success', source: fr.source }) && !ctx._isRuleOfThumb(fr) && !ctx._isAnsweredEstimate(fr));
  const subC = ctx._researchSummarySub([fr, fp], 0, 3);
  check('summary line: two county estimates read as such and add no placeholder or rule-of-thumb clause',
    subC === '2 are county-level estimates from a published table. 3 need your judgment.', subC);
  check('summary line: one county estimate is singular', ctx._researchSummarySub([fr], 0, 3).startsWith('1 is a county-level estimate from a published table.'));
  check('summary line: a real placeholder beside county estimates is still counted as a placeholder',
    ctx._researchSummarySub([fr, fp, { status: 'estimated', source: 'World Aware placeholder (x did not respond)' }], 0, 0) ===
    '2 are county-level estimates from a published table. 1 is a rough placeholder because a source did not respond. 0 need your judgment.');
  ev(`state = freshState(); state.researchReport = { geocoded: ${JSON.stringify(geo)}, findings: ${JSON.stringify(withBoth)}, timestamp: 't' }; state.researchAddress = 'x';`);
  const rd = ev('buildReportData()').research;
  check('saved report data: countyEstimateCount counts radon and power, and they are not rule-of-thumb items',
    rd.countyEstimateCount === 2 && rd.ruleOfThumbCount === 0 && rd.answeredEstimateCount === 0, JSON.stringify([rd.countyEstimateCount, rd.ruleOfThumbCount, rd.answeredEstimateCount]));
  check('report sentence: county estimates are not "rough placeholders because a source did not respond"',
    ctx._sourcesSentence({ findingCount: 10, estimatedCount: 2, ruleOfThumbCount: 0, countyEstimateCount: 2 }) === 'Public data supplied the likelihood for 8 hazards; 2 are county-level estimates from a published table.' &&
    ctx._sourcesSentence({ findingCount: 10, estimatedCount: 3, ruleOfThumbCount: 1, answeredEstimateCount: 0, countyEstimateCount: 2 }).includes('2 are county-level estimates from a published table; no address-level source exists yet for 1 item'));
  check('report sentence: saved reports without countyEstimateCount read as before',
    ctx._sourcesSentence({ findingCount: 12, estimatedCount: 2, ruleOfThumbCount: 1 }) === 'Public data supplied the likelihood for 10 hazards; 1 is a rough placeholder because a source did not respond; no address-level source exists yet for 1 item; it uses a state rule of thumb.');
  check('report items: county estimates say so in the on-screen note and the PDF prefix', (() => {
    const rsrc = fs.readFileSync(path.join(ROOT, 'js/report.js'), 'utf8');
    return rsrc.includes("' Likelihood is a county-level estimate from a published table.'") && rsrc.includes("'County-level estimate: '") && ctx._isCountyEstimateItem({ source: fr.source }) && !ctx._isCountyEstimateItem({ source: 'EPA TRI' });
  })());
  ev('state = freshState();');

  // ── Override rules: research never overwrites a likelihood the user set ──
  const realShow = ctx.showScreen, realSave = ctx.autoSave;
  ctx.showScreen = noop; ctx.autoSave = noop;
  try {
    const setup = (scores) => {
      ev(`state = freshState(); _research.geocoded = ${JSON.stringify(geo)}; _research.address = 'x'; _research.findings = ${JSON.stringify(withBoth)}; _research.hasResults = true;`);
      Object.keys(scores).forEach(id => { ev(`state.scores[${id}] = Object.assign(state.scores[${id}] || {}, ${JSON.stringify(scores[id])});`); });
    };
    setup({});
    ctx.applyResearchScores();
    const s0 = ev('state.scores');
    check('apply: untouched radon and power get the researched likelihood, flagged auto and as estimates', s0[64].l === 4 && s0[64].isAuto === true && s0[64].isEstimate === true &&
      s0[24].l === 3 && s0[24].isAuto === true && s0[24].isEstimate === true);
    check('apply: research never invents an impact for radon or power', (s0[64].iManual !== true) && ev('state.autoScoreOrigins[64].source') === 'EPA Map of Radon Zones (county), 2024');
    setup({ 64: { l: 2, i: 5, iManual: true }, 24: { l: 5, i: 2, iManual: true } });
    ctx.applyResearchScores();
    const s1 = ev('state.scores');
    check('apply: a radon and a power likelihood the user set by hand (with a hand-set impact) are left exactly as entered',
      s1[64].l === 2 && s1[64].i === 5 && s1[64].iManual === true && !s1[64].isAuto && s1[24].l === 5 && s1[24].i === 2 && !s1[24].isAuto);
    setup({ 64: { l: 1, i: 3 } });
    ctx.applyResearchScores();
    check('apply: a user likelihood without a hand-set impact is also kept, and its impact is untouched', ev('state.scores[64].l') === 1 && ev('state.scores[64].i') === 3);
    setup({ 64: { l: 3, isAuto: true } });
    ctx.applyResearchScores();
    check('apply: a likelihood from an earlier research run is replaced by the new one', ev('state.scores[64].l') === 4);
    setup({ 64: { na: true } });
    ctx.applyResearchScores();
    check('apply: radon marked Does not apply here is not filled in', !(ev('state.scores[64].l') > 0));
  } finally {
    ctx.showScreen = realShow; ctx.autoSave = realSave;
    ev('state = freshState();');
  }

  // ── Judgment list wording ──
  const mr = ev('MANUAL_REASONS');
  check('judgment list: radon (64) and power (24) keep their reasons and now link to EPA and EIA',
    /Haven't tested: rate it 3\. Tested high: 5\. Tested low: 1\./.test(mr[64]) && mr[64].includes('https://www.epa.gov/radon') &&
    /planned shutoff map \(Xcel publishes one\)/.test(mr[24]) && mr[24].includes('https://www.eia.gov/electricity/data/eia861/'));

  // ── Full run with every host mocked: data files present, then absent ──
  console.log('v3.2.0 Stage C: full research run, data files present and absent');
  {
    const savedRelay = cfg.RELAY_URL;
    cfg.RELAY_URL = '';
    const mkRoute = (files, point) => (url) => {
      const u = String(url);
      if (u.startsWith('https://nominatim.openstreetmap.org/')) return point === 'mn'
        ? json([{ lat: '44.9778', lon: '-93.2650', display_name: 'Nicollet Mall, Minneapolis, Minnesota', address: { postcode: '55401', 'ISO3166-2-lvl4': 'US-MN', county: 'Hennepin County', city: 'Minneapolis' } }])
        : json([{ lat: '40.015', lon: '-105.2705', display_name: 'Pearl Street, Boulder, Colorado', address: { postcode: '80302', 'ISO3166-2-lvl4': 'US-CO', county: 'Boulder County', city: 'Boulder' } }]);
      if (u.startsWith('https://geo.fcc.gov/')) return point === 'mn' ? json({ County: { FIPS: '27053', name: 'Hennepin' }, State: { code: 'MN' } }) : json({ County: { FIPS: '08013', name: 'Boulder' }, State: { code: 'CO' } });
      if (u === 'data/radon-zones.json') return files ? json(radonFile) : Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      if (u === 'data/power-reliability.json') return files ? json(powerFile) : Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      if (u.startsWith(cfg.NRI_TRACT)) return json({ features: [{ attributes: point === 'mn' ? Object.assign({ COUNTY: 'Hennepin' }, NRI_FX.minneapolis) : NRI_FX.downtown }] });
      if (u.startsWith(cfg.NRI_COUNTY)) return json({ features: [{ attributes: point === 'mn' ? { COUNTY: 'Hennepin', AREA: 606, STCOFIPS: '27053' } : NRI_FX.county }] });
      return Promise.reject(new Error('unrouted ' + u));
    };
    const runResearch = async (files, point) => {
      route(mkRoute(files, point));
      const page = [];
      ctx.document.getElementById = id => id === 'research-address-input' ? { value: point === 'mn' ? '1 Nicollet Mall, Minneapolis, MN 55401' : '1234 Pearl St, Boulder, CO 80302' }
        : id === 'research-report-content' ? { set innerHTML(v) { page.push(v); } } : null;
      ev('state = freshState(); _research.isRunning = false; _research.hasResults = false;');
      await ctx.startResearch();
      const fs_ = ev('_research.findings'), st_ = ev('_research.stepStatuses');
      const html = page.join('');
      const sub = ((html.match(/<span class="report-summary-sub">([^<]*)<\/span>/) || [])[1]) || '';
      return { fs_, st_, html, sub };
    };
    const present = await runResearch(true, 'co');
    check('full run, files present (Boulder): radon step and power step succeed', present.st_.radon === 'success' && present.st_.power === 'success', JSON.stringify(present.st_));
    check('full run, files present (Boulder): radon 4 and power 3, both estimated, no longer on the judgment list',
      by(present.fs_, 64) && by(present.fs_, 64).scoreAssigned === 4 && by(present.fs_, 24) && by(present.fs_, 24).scoreAssigned === 3 &&
      by(present.fs_, 64).status === 'estimated' && !/Radon is only known by testing/.test(present.html) && !/Outage history by address is not public/.test(present.html));
    check('full run, files present: the report lists both findings with their sources', present.html.includes('EPA Map of Radon Zones (county), 2024') && present.html.includes('EIA-861 reliability, median 2021 to 2025'));
    check('full run, files present: summary line calls them county-level estimates, not placeholders',
      /2 are county-level estimates from a published table\./.test(present.sub) && (present.sub.match(/rough placeholder/g) || []).length === (present.fs_.filter(f => f.status === 'estimated').length - 2 > 0 ? 1 : 0), present.sub);
    check('full run, files present: the radon and power rows read as "Rough estimate" cards (Low confidence)', present.html.includes('Rough estimate'));

    const absent = await runResearch(false, 'co');
    check('full run, files absent (404): radon and power steps show as skipped (not errors) and nothing else breaks',
      absent.st_.radon === 'skipped' && absent.st_.power === 'skipped' && absent.st_.geocode === 'success' && ev('_research.hasResults') === true);
    check('full run, files absent: no finding for 64 or 24; both appear under "Needs your judgment" with their links',
      !by(absent.fs_, 64) && !by(absent.fs_, 24) && absent.html.includes('Radon is only known by testing the house') && absent.html.includes('https://www.epa.gov/radon') &&
      absent.html.includes('Outage history by address is not public') && absent.html.includes('https://www.eia.gov/electricity/data/eia861/'));
    check('full run, files absent: the summary has no county-estimate clause', !/county-level estimate/.test(absent.sub));

    const mnRun = await runResearch(true, 'mn');
    check('full run, files present (Minneapolis): radon 4 (zone 1) and power 2 (160 minutes), Hennepin County named',
      by(mnRun.fs_, 64) && by(mnRun.fs_, 24) && by(mnRun.fs_, 64).scoreAssigned === 4 && by(mnRun.fs_, 24).scoreAssigned === 2 && /Hennepin County is in EPA radon zone 1/.test(by(mnRun.fs_, 64).finding),
      JSON.stringify([mnRun.st_.radon, mnRun.st_.power, mnRun.st_.geocode, ev('_research.geocoded')]));
    ev('state = freshState(); _research.isRunning = false;');
    ctx.document.getElementById = () => null;
    cfg.RELAY_URL = savedRelay;
    ctx.fetch = () => Promise.reject(new Error('no network in tests'));
  }

  // ── Service worker and wiring ──
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const shell = (sw.match(/const APP_SHELL = \[([\s\S]*?)\n\];/) || [])[1] || '';
  const shellPaths = (shell.match(/'\.\/[^']+'/g) || []).map(s => s.slice(3, -1));
  check('sw: every file in APP_SHELL exists (one 404 fails cache.addAll and with it the whole install)', shellPaths.length > 20 && shellPaths.every(p => p === '' || fs.existsSync(path.join(ROOT, p))),
    shellPaths.filter(p => p !== '' && !fs.existsSync(path.join(ROOT, p))).join());
  const dataShellEntries = shellPaths.filter(p => p.startsWith('data/'));
  check('sw: data files are in APP_SHELL only if they exist in the repo (they are cached on first use otherwise)',
    dataShellEntries.every(p => fs.existsSync(path.join(ROOT, p))) && (fs.existsSync(path.join(ROOT, 'data', 'radon-zones.json')) || dataShellEntries.length === 0));
  check('sw: the fetch handler caches same-origin 200 responses on first use and never caches a 404',
    /if \(!response \|\| response\.status !== 200\) return response;/.test(sw) && /caches\.open\(CACHE_NAME\)\.then\(cache => cache\.put\(event\.request, clone\)\)/.test(sw));
  const src = fs.readFileSync(path.join(ROOT, 'js/research.js'), 'utf8');
  check('runner: radon and power run in the parallel set with the geocoded county, state and FIPS',
    src.includes("_tracked('radon',      _callRadonAPI(county, stateAbbr))") && src.includes("_tracked('power',      _callPowerAPI(fips5, stateAbbr))") &&
    /'airdays','radon','power'\]/.test(src) && /airdays, radon, power \},\s*\n\s*geocoded/.test(src));
  check('data files are read with the same-origin helper, not the relay', /directFetch\(relPath\)/.test(src) && !/relayFetch\(API_CONFIG\.DATA_|proxyFetch\(API_CONFIG\.DATA_/.test(src));
  // Committed data files, when present, must have the shape the app reads
  const dataDir = path.join(ROOT, 'data');
  if (fs.existsSync(path.join(dataDir, 'radon-zones.json'))) {
    const d = JSON.parse(fs.readFileSync(path.join(dataDir, 'radon-zones.json'), 'utf8'));
    check('data/radon-zones.json: built, source and at least 3000 counties with zones 1 to 3 (and Boulder, CO is zone 1)',
      !!d.built && /^https:/.test(d.source) && Object.keys(d.zones).length >= 3000 && Object.values(d.zones).every(z => [1, 2, 3].includes(z)) && d.zones['Boulder, CO'] === 1);
  }
  if (fs.existsSync(path.join(dataDir, 'power-reliability.json'))) {
    const d = JSON.parse(fs.readFileSync(path.join(dataDir, 'power-reliability.json'), 'utf8'));
    check('data/power-reliability.json: built, source, year, utilities per county with minutes, and a state value for CO',
      !!d.built && /^https:/.test(d.source) && d.year >= 2020 && Object.keys(d.byCounty).length >= 1500 && /^\d{5}$/.test(Object.keys(d.byCounty)[0]) &&
      Object.values(d.byCounty).every(L => L.every(u => u.utility && u.saidi > 0 && u.years.length === 2)) && d.byState.CO > 0);
  }

  // ── Version ──
  const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const html3 = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('version 3.2.0 in app.js, sw.js CACHE_NAME and the About line',
    /const APP_VERSION = '3\.2\.0';/.test(appSrc) && /const CACHE_NAME = 'wa-risk-v3\.2\.0';/.test(sw) && html3.includes('World Aware Risk Assessment v3.2.0') && !/v3\.1\.0<\/p>/.test(html3));

  // ── Copy rules ──
  const copy = [rm(1).finding, rm(2).finding, rm(3).finding, rm(1, 'MN').finding, pf.finding, pf.source, pst.finding, fr.source, mr[64], mr[24],
    ctx._researchSummarySub([fr, fp], 0, 3), ctx._sourcesSentence({ findingCount: 10, estimatedCount: 2, countyEstimateCount: 2 }),
    'Looking up your county on the EPA radon zone map', 'Checking utility outage records for your county (EIA)'];
  check('Stage C copy: no em dash, no exclamation point', !copy.some(t => /[—!]/.test(t)), copy.filter(t => /[—!]/.test(t)).join(' | '));
  check('Stage C copy: no "not X but Y" and no AI-style transitions', !copy.some(t => /\bnot (just )?[^.;]{1,40}\bbut\b|moreover|furthermore/i.test(t)));
  check('Stage C copy: no placeholder syntax or bad numbers', !copy.some(t => /\[[A-Z ]+\]|\{\w+\}|undefined|NaN|null|Infinity/.test(t)), copy.filter(t => /undefined|NaN|null/.test(t)).join(' | '));
  ctx.fetch = () => Promise.reject(new Error('no network in tests'));
}

asyncChecks().then(v31Checks).then(v32StageAChecks).then(v32StageBChecks).then(v32StageCChecks).catch(e => { failed++; console.log('  FAIL async checks threw — ' + e.message + '\n' + e.stack); }).then(() => {  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});