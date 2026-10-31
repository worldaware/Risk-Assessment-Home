# World Aware relay

Several government hazard services (USGS, FEMA, the Forest Service, the Drought Monitor) refuse requests that come straight from a web page. This small Cloudflare Worker fetches them for the app and passes the answer back. It only talks to an approved list of government sites, only answers World Aware's own web addresses, and keeps no logs.

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

Target sites: earthquake.usgs.gov, hazards.fema.gov, msc.fema.gov, usdmdataservices.unl.edu, droughtmonitor.unl.edu, services.arcgis.com, apps.fs.usda.gov, geocoding.geo.census.gov. To add one, edit `ALLOWED_HOSTS` in `worker.js` and deploy again.

Web pages that may use it: https://worldaware.github.io, https://risk.beworldaware.com, https://illustrious-capybara-0ad110.netlify.app and its deploy previews. Edit `ALLOWED_ORIGINS` in `worker.js` to change this. Testing the app from your own computer (localhost) is not on the list, so lookups there will fail until you add it.

There is a soft limit of 60 requests a minute per visitor, kept in memory only.

## Open items

- **Landslide.** No working address-level source. The old layer the app used (`services.arcgis.com/jIL9msH9OI208GCb/.../landslide_susceptibility_US`) answers "Invalid URL". The current USGS national map (Belair and others 2024, https://doi.org/10.5066/P13KAGU3) is published only as large file downloads on ScienceBase, with no map service to query a point. NASA runs a global landslide susceptibility map service (maps.nccs.nasa.gov), but it is about 1 km resolution and its point answers could not be checked, so it is not wired. The landslide row stays a labelled placeholder. Fix options: find a USGS image service for the 2024 map, or host the 90 m raster ourselves.
- **Wildfire.** Wired to the Forest Service Wildfire Hazard Potential 2023 image service (`apps.fs.usda.gov/fsgisx01/rest/services/RDW_Wildfire/RMRS_WildfireHazardPotential_Classified_2023/ImageServer`). The service description and class codes were checked on 2026-10-26, but a live point answer could not be checked from the build environment. After deploying, run one Boulder address and confirm the wildfire row says "From public data".
- **National Risk Index and Drought Monitor field names.** FEMA's NRI county API and the Drought Monitor JSON could not be fetched from the build environment, so the code reads several possible field spellings. After deploying, run one address and check the flood (if no FEMA zone is found) and drought rows in the browser console.
