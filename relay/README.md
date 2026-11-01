# World Aware relay

Several government hazard services (USGS, FEMA, the Forest Service, the Drought Monitor) refuse requests that come straight from a web page. This small Cloudflare Worker fetches them for the app and passes the answer back. It only talks to an approved list of government and university sites, only answers World Aware's own web addresses, and keeps no logs.

It also shields the Iowa Environmental Mesonet (IEM), Iowa State University's archive of National Weather Service warnings. IEM answers web pages directly, but asks not to be called from busy sites, so the app asks the relay first and the relay keeps each IEM answer for 30 days (see "Caching" below).

The free Cloudflare plan covers it (100,000 requests a day).

## Deploy it (about 10 minutes, once)

You need a free Cloudflare account and Node.js (nodejs.org, the LTS installer).

1. Open Terminal and install Cloudflare's tool:

   ```
   npm install -g wrangler
   ```

2. Sign in. A browser window opens; click Allow.

   ```
   wrangler login
   ```

3. Go to this folder and publish the Worker:

   ```
   cd Risk-Assessment-Home/relay
   wrangler deploy
   ```

   The last lines print an address ending in `.workers.dev`, for example `https://wa-risk-relay.yourname.workers.dev`. Copy yours.

4. Open `js/apiConfig.js`. Find this line:

   ```
   RELAY_URL: '',
   ```

   Paste your address between the quotes, with no slash at the end. Save, commit, and push to `main`.

5. Test it. In Terminal, type `RELAY=` and paste your address right after it (no spaces), press Enter, then run:

   ```
   curl -s "$RELAY/?url=https%3A%2F%2Fearthquake.usgs.gov%2Fws%2Fdesignmaps%2Fnehrp-2020.json%3Flatitude%3D40.015%26longitude%3D-105.2833%26riskCategory%3DIII%26siteClass%3DD%26title%3Dquery" | head -c 300
   ```

   You should see text starting with `{"request":`. If you see `Target host not allowed` or an error page, the address in step 4 is wrong.

To update the Worker later, run `wrangler deploy` again from this folder.

## Privacy settings to leave alone

- The Worker prints nothing to logs, and `wrangler.toml` keeps Cloudflare's "Workers Logs" switched off. Do not turn it on in the dashboard.
- Do not set up Logpush for this Worker. Both would store request addresses, which contain the location of someone's home.

## What it allows

Target sites: earthquake.usgs.gov, hazards.fema.gov, msc.fema.gov, usdmdataservices.unl.edu, droughtmonitor.unl.edu, services.arcgis.com, apps.fs.usda.gov, geocoding.geo.census.gov, mesonet.agron.iastate.edu. To add one, edit `ALLOWED_HOSTS` in `worker.js` and deploy again.

Web pages that may use it: https://worldaware.github.io, https://risk.beworldaware.com, https://illustrious-capybara-0ad110.netlify.app and its deploy previews. Edit `ALLOWED_ORIGINS` in `worker.js` to change this. Testing the app from your own computer (localhost) is not on the list, so lookups there will fail until you add it.

There is a soft limit of 60 requests a minute per visitor, kept in memory only. Answers served from the cache count toward it too.

## Caching (IEM only)

Answers from mesonet.agron.iastate.edu are stored in Cloudflare's cache for 30 days, keyed by the full IEM address the app asked for. The app rounds the coordinates to 2 decimals (about 1 km) before it asks, so neighbours share one stored answer, and it asks for warnings up to 1 January of the current year, so the answer does not change until the next year. The stored copy holds only the IEM reply; its key holds the rounded coordinates (about 1 km), not the street address, and nothing about the visitor. A response header `X-Relay-Cache` says `HIT` or `MISS`.

Cloudflare only runs this cache for a Worker on a custom domain. On the free `*.workers.dev` address the cache calls do nothing, so every IEM request still goes to Iowa State (and the app still works). To turn the cache on, add a custom domain to the Worker in the Cloudflare dashboard (for example `relay.beworldaware.com`, under the Worker's settings for domains and routes), then put that address in `RELAY_URL` in `js/apiConfig.js`.

If the relay is not set up or does not answer, the app calls IEM directly, which IEM allows.

After any change to `worker.js`, run `wrangler deploy` from this folder again.

To check IEM through the relay after deploying (set `RELAY` as in step 5 first):

```
curl -s -D - -o /dev/null -H "Origin: https://worldaware.github.io" "$RELAY/?url=https%3A%2F%2Fmesonet.agron.iastate.edu%2Fjson%2Fvtec_events_bypoint.py%3Flat%3D40.01%26lon%3D-105.27%26sdate%3D2015-01-01%26edate%3D2026-01-01"
```

The first run shows a 200 status line and, on a custom domain, `x-relay-cache: MISS`; a second run should show `x-relay-cache: HIT`. On workers.dev expect `MISS` every time.

## Open items

- **Landslide.** Fixed in v3.1.0 without the relay. The 2024 USGS map is served as cached tiles (`tiles.arcgis.com/.../US_Landslide_Susceptibility/MapServer`); the app reads the pixel under the address in a canvas and matches it to the legend, and counts USGS inventory landslides and post-fire debris-flow basins within 1 km. If the tile cannot be read, it uses the FEMA National Risk Index tract value, then asks for the user's judgment.
- **Wildfire.** Wired to the Forest Service Wildfire Hazard Potential 2023 image service (`apps.fs.usda.gov/fsgisx01/rest/services/RDW_Wildfire/RMRS_WildfireHazardPotential_Classified_2023/ImageServer`). The service description and class codes were checked on 2026-10-26, but a live point answer could not be checked from the build environment. After deploying, run one Boulder address and confirm the wildfire row says "From public data".
- **Drought Monitor field names.** The Drought Monitor JSON could not be fetched from the build environment, so the code reads several possible field spellings. After deploying, run one address and check the drought row in the browser console. (The National Risk Index now comes direct from FEMA's ArcGIS Online layers, with field names confirmed on 2026-10-31; the hazards.fema.gov API through the relay is only a last-resort flood fallback.)
