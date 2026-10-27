# World Aware Risk Assessment Home

Household and neighborhood hazard risk assessment. Vanilla JS, no build step, served from GitHub Pages at https://worldaware.github.io/Risk-Assessment-Home/. Everything the user enters stays in their browser (localStorage).

## Files

- `index.html`, `app.js`, `styles.css`, `tokens.css`, `fonts.css`: the app shell.
- `js/research.js`, `js/apiConfig.js`, `js/scoreMapper.js`: the address lookup (geocode, then FEMA, USGS, USFS, NWS, Drought Monitor, EPA) and the pure functions that turn raw values into a 1 to 5 likelihood.
- `relay/`: the Cloudflare Worker that relays the government lookups that block browsers, with its deploy steps.
- `js/report.js`, `js/wa-pdf-theme.js`, `js/vendor/jspdf.umd.min.js`: the editable report and PDF.
- `sw.js`: service worker for offline use of the shell. It never caches cross-origin (API) responses.
- `tests/run.js`: unit tests for the mapping functions and a few invariants. `node tests/run.js`.

## Release checklist

1. Bump `APP_VERSION` in `app.js` and `CACHE_NAME` in `sw.js` to the same number, and the version line on the About screen in `index.html`. `tests/run.js` fails if they differ.
2. `for f in app.js sw.js js/*.js; do node --check "$f"; done && node tests/run.js`
3. Run the address lookup on two known addresses in a real browser and read the console: every data source should show "From public data" or an honest "Rough estimate", never a cited source for a placeholder.
4. Merge to `main`; GitHub Pages deploys from there.

## Known limits of the data layer (October 2026)

USGS, FEMA, the Forest Service, the Drought Monitor and the Census geocoder refuse requests straight from a web page, so the app reaches them through one relay World Aware runs on Cloudflare (`relay/worker.js`; deploy steps in `relay/README.md`). It keeps no logs and only forwards to an allow-list of government hosts. Until `RELAY_URL` in `js/apiConfig.js` is set to the deployed Worker address, those lookups are skipped and their rows are labelled "Relay not configured" placeholders. NWS and EPA are called directly. Landslide has no working address-level source yet and stays a labelled placeholder; see "Open items" in `relay/README.md`.
