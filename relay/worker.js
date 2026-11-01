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
     - answers from hosts in CACHE_TTL_BY_HOST (Iowa Environmental
       Mesonet) are kept in Cloudflare's cache for 30 days, keyed by the
       full target URL. The Cache API only works when the Worker runs on a
       custom domain; on *.workers.dev it does nothing and every request
       goes upstream (see README.md)

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
  'mesonet.agron.iastate.edu',  // Iowa Environmental Mesonet NWS warning archive (cached, see below)
]);

/**
 * Hosts whose successful answers are cached in the Worker, in seconds.
 * IEM asks not to be called from busy sites, and its warning counts change
 * once a year (the app asks up to 1 January), so 30 days is safe. The app
 * rounds coordinates to 2 decimals so neighbours share one entry.
 */
export const CACHE_TTL_BY_HOST = {
  'mesonet.agron.iastate.edu': 30 * 24 * 3600,
};

/** Cache lifetime for a target URL in seconds, or 0 when it is not cached. */
export function cacheTtlFor(target) {
  try {
    return CACHE_TTL_BY_HOST[new URL(target).hostname.toLowerCase()] || 0;
  } catch {
    return 0;
  }
}

/**
 * Cache key: the relay's own origin plus the full target URL, so the key
 * stays on the Worker's hostname and each distinct upstream URL is one entry.
 */
export function cacheKeyFor(requestUrl, target) {
  return new URL(requestUrl).origin + '/?url=' + encodeURIComponent(target);
}

/** caches.default where the runtime has it (Cloudflare), otherwise null (node tests, previews). */
function edgeCache() {
  try {
    const c = globalThis.caches;
    return (c && c.default && typeof c.default.match === 'function' && typeof c.default.put === 'function') ? c.default : null;
  } catch {
    return null;
  }
}

/** Pages allowed to read relay responses in a browser. */
/** Sent on every upstream request. Identifies the relay, never the visitor. */
export const UPSTREAM_USER_AGENT = 'Mozilla/5.0 (compatible; WorldAwareRiskRelay/1.0; +https://beworldaware.com)';

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
async function fetchUpstream(target, signal, ttl) {
  let url = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Fresh headers: nothing from the browser (Referer, cookies, IP) is passed on.
    const resp = await fetch(url, {
      method: 'GET',
      // A named User-Agent: Workers send none by default, and FEMA's and the
      // Forest Service's edges answer 403 to requests without one. Nothing
      // about the visitor is in it.
      headers: {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
        'User-Agent': UPSTREAM_USER_AGENT,
      },
      redirect: 'manual',
      signal,
      // Let Cloudflare's edge cache successful answers for an hour (longer for cached hosts).
      cf: { cacheTtlByStatus: { '200-299': ttl || 3600, '300-599': 0 }, cacheEverything: true },
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

export async function handleRequest(request, env, ctx) {
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

  // Cached hosts: answer from Cloudflare's cache when it holds this URL.
  // Any cache error falls through to a normal upstream call.
  const ttl   = cacheTtlFor(target);
  const cache = ttl ? edgeCache() : null;
  const key   = cache ? new Request(cacheKeyFor(request.url, target), { method: 'GET' }) : null;
  if (cache) {
    let hit = null;
    try { hit = await cache.match(key); } catch { hit = null; }
    if (hit) {
      const h = corsHeaders(origin);
      h.set('Content-Type', hit.headers.get('Content-Type') || 'application/octet-stream');
      h.set('Cache-Control', 'public, max-age=' + ttl);
      h.set('X-Content-Type-Options', 'nosniff');
      h.set('X-Relay-Cache', 'HIT');
      return new Response(hit.body, { status: hit.status, headers: h });
    }
  }

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  let result;
  try {
    result = await fetchUpstream(target, ctrl.signal, ttl);
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return plain(timedOut ? 504 : 502, timedOut ? 'Upstream timed out' : 'Upstream unreachable', origin);
  } finally {
    clearTimeout(timer);
  }
  if (result.blocked) return plain(403, 'Upstream redirected to a host that is not allowed: ' + result.host, origin);
  if (result.tooMany) return plain(502, 'Too many upstream redirects', origin);

  const up = result.resp;
  const contentType = up.headers.get('Content-Type') || 'application/octet-stream';
  const h  = corsHeaders(origin);
  h.set('Content-Type', contentType);
  h.set('Cache-Control', up.ok ? 'public, max-age=' + (ttl || 3600) : 'no-store');
  h.set('X-Content-Type-Options', 'nosniff');

  if (cache && up.status === 200) {
    // Store a clean copy (no CORS or cookie headers) and answer with the same bytes.
    let body;
    try {
      body = await up.arrayBuffer();
    } catch {
      return plain(502, 'Upstream body could not be read', origin);
    }
    const stored = new Response(body, {
      status: 200,
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=' + ttl },
    });
    const put = Promise.resolve().then(() => cache.put(key, stored)).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(put);
    else await put;
    h.set('X-Relay-Cache', 'MISS');
    return new Response(body, { status: 200, headers: h });
  }
  return new Response(up.body, { status: up.status, headers: h });
}

export default {
  fetch: handleRequest,
};
