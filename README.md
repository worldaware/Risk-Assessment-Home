# World Aware Risk Assessment Home

Household and neighborhood hazard risk assessment. Vanilla JS, no build step, served from GitHub Pages at https://worldaware.github.io/Risk-Assessment-Home/. Everything the user enters stays in their browser (localStorage).

## Files

- `index.html`, `app.js`, `styles.css`, `tokens.css`, `fonts.css`: the app shell.
- `js/research.js`, `js/apiConfig.js`, `js/scoreMapper.js`: the address lookup (geocode, then FEMA, USGS, USFS, NWS, Drought Monitor, EPA) and the pure functions that turn raw values into a 1 to 5 likelihood.
- `js/report.js`, `js/wa-pdf-theme.js`, `js/vendor/jspdf.umd.min.js`: the editable report and PDF.
- `sw.js`: service worker for offline use of the shell. It never caches cross-origin (API) responses.
- `tests/run.js`: unit tests for the mapping functions and a few invariants. `node tests/run.js`.

## Release checklist

1. Bump `APP_VERSION` in `app.js` and `CACHE_NAME` in `sw.js` to the same number, and the version line on the About screen in `index.html`. `tests/run.js` fails if they differ.
2. `for f in app.js sw.js js/*.js; do node --check "$f"; done && node tests/run.js`
3. Run the address lookup on two known addresses in a real browser and read the console: every data source should show "From public data" or an honest "Rough estimate", never a cited source for a placeholder.
4. Merge to `main`; GitHub Pages deploys from there.

## Known limits of the data layer (October 2026)

The hazard lookups go through free public CORS relays (`js/apiConfig.js`). Those relays are unreliable and the USFS wildfire endpoint no longer exists. Until an owned relay replaces them, expect most lookups to fall back to state-level placeholders, which the UI now labels as such.
