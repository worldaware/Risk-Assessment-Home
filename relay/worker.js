/* =============================================================
   WORLD AWARE RISK ASSESSMENT — relay/worker.js
   A Cloudflare Worker that lets the browser app read government
   hazard services that do not send CORS headers.

   GET /?url=<encoded https URL>
     - the target host must be on ALLOWED_HOSTS, otherwise 403
     - only GET (and the OPTIONS preflight) is accepted
     - upstream gets Accept: application/json and no Referer, cookies
       or client headers
     - 10 second upstream timeout
     - the browser gets the upstream body and content type, plus
       Access-Control-Allow-Origin for World Aware origins only

   Privacy: this file logs nothing. It makes no logging calls at all,
   so even `wrangler tail` shows only Cloudflare's own request line.
   Cloudflare does not store request logs for a Worker unless you turn
   them on: leave "Workers Logs" (observability) off, which wrangler.toml
   does, and do not set up Logpush for this Worker. Either would record
   the full request URL, which carries the coordinates of a home.

   No dependencies, no bindings. Deploy with `wrangler deploy`.
   ============================================================= */

/** Hosts the relay will fetch from. Exact hostnames, no wildcards. */
export const ALLOWED_HOSTS = new Set([
  'earthquake.usgs.gov',        // USGS seismic design values
  'hazards.fema.gov',           // FEMA NFHL flood zones, National Risk Index
  'msc.fema.gov',               // FEMA Map Service Center NFHL copy
  'usdmdataservices.unl.edu',   // US Drought Monitor statistics API
  'droughtmonitor.unl.edu',     // US Drought Monitor
  'services.arcgis.com',        // ArcGIS Online hosted layers
  'apps.fs.usda.gov',           // USFS Wildfire Hazard Potential image service
  'geocoding.geo.census.gov',   // Census geocoder (fallback when OpenStreetMap fails)
]);

/** Pages allowed to read relay responses in a browser. */
export const ALLOWED_ORIGINS = [
  'https://worldaware.github.io',
  'https://risk.beworldaware.com',
  'https://illustrious-capybara-0ad110.netlify.app',
];
const NETLIFY_PREVIEW_RE = /^https:\/\/deploy-preview-\d+--illustrious-capybara-0ad110\.netlify\.app$/;

const UPSTREAM_TIMEOUT_MS = 10000;
const MAX_REDIRECTS       = 3;

/**
 * True when `url` is an https URL on an allowed host with no credentials
 * and the default port.
 * @param {string} url
 * @returns {boolean}
 */
export function isAllowedTarget(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '443') return false;
  return ALLOWED_HOSTS.has(u.hostname.toLowerCase());
}

/**
 * True when `origin` may read responses.
 * @param {string|null} origin
 * @returns {boolean}
 */
export function isAllowedOrigin(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin) || NETLIFY_PREVIEW_RE.test(origin);
}

/* ── Soft rate limit: 60 requests a minute per IP ──────────────
   Kept in this Worker instance's memory only, so it needs no KV
   binding. Cloudflare runs many instances, so this is a brake on a
   runaway loop, not a hard guarantee. Entries hold a count and a
   timestamp, never a URL, and are dropped after a minute.          */
const RATE_LIMIT  = 60;
const RATE_WINDOW = 60000;
const _hits = new Map();

export function overRateLimit(ip, now = Date.now()) {
  if (!ip) return false;
  if (_hits.size > 5000) {
    for (const [k, v] of _hits) if (now - v.start >= RATE_WINDOW) _hits.delete(k);
  }
  const rec = _hits.get(ip);
  if (!rec || now - rec.start >= RATE_WINDOW) {
    _hits.set(ip, { start: now, count: 1 });
    return false;
  }
  rec.count += 1;
  return rec.count > RATE_LIMIT;
}

function corsHeaders(origin) {
  const h = new Headers();
  if (isAllowedOrigin(origin)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    h.set('Access-Control-Max-Age', '86400');
  }
  h.set('Vary', 'Origin');
  return h;
}

function plain(status, message, origin) {
  const h = corsHeaders(origin);
  h.set('Content-Type', 'text/plain; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  return new Response(message, { status, headers: h });
}

/** Fetch upstream, following redirects only to allowed hosts. */
async function fetchUpstream(target, signal) {
  let url = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Fresh headers: nothing from the browser (Referer, cookies, IP) is passed on.
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal,
      // Let Cloudflare's edge cache successful answers for an hour.
      cf: { cacheTtlByStatus: { '200-299': 3600, '300-599': 0 }, cacheEverything: true },
    });
    if (resp.status >= 300 && resp.status < 400 && resp.headers.get('Location')) {
      const nextUrl = new URL(resp.headers.get('Location'), url);
      // Some government servers redirect to plain http:// on their own host.
      // Upgrade that to https:// (and drop an explicit :80) for allowed hosts only.
      if (nextUrl.protocol === 'http:' && ALLOWED_HOSTS.has(nextUrl.hostname.toLowerCase())) {
        nextUrl.protocol = 'https:';
        if (nextUrl.port === '80') nextUrl.port = '';
      }
      const next = nextUrl.toString();
      if (!isAllowedTarget(next)) return { blocked: true, host: new URL(next).hostname };
      url = next;
      continue;
    }
    return { resp };
  }
  return { tooMany: true };
}

export async function handleRequest(request) {
  const origin = request.headers.get('Origin');

  // A browser on some other site gets nothing.
  if (origin && !isAllowedOrigin(origin)) return plain(403, 'Origin not allowed', null);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'GET') return plain(405, 'Only GET is supported', origin);

  if (overRateLimit(request.headers.get('CF-Connecting-IP'))) {
    return plain(429, 'Too many requests, try again in a minute', origin);
  }

  const target = new URL(request.url).searchParams.get('url');
  if (!target) return plain(400, 'Missing ?url=', origin);
  if (!isAllowedTarget(target)) return plain(403, 'Target host not allowed', origin);

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  let result;
  try {
    result = await fetchUpstream(target, ctrl.signal);
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return plain(timedOut ? 504 : 502, timedOut ? 'Upstream timed out' : 'Upstream unreachable', origin);
  } finally {
    clearTimeout(timer);
  }
  if (result.blocked) return plain(403, 'Upstream redirected to a host that is not allowed: ' + result.host, origin);
  if (result.tooMany) return plain(502, 'Too many upstream redirects', origin);

  const up = result.resp;
  const h  = corsHeaders(origin);
  h.set('Content-Type', up.headers.get('Content-Type') || 'application/octet-stream');
  h.set('Cache-Control', up.ok ? 'public, max-age=3600' : 'no-store');
  h.set('X-Content-Type-Options', 'nosniff');
  return new Response(up.body, { status: up.status, headers: h });
}

export default {
  fetch: handleRequest,
};
