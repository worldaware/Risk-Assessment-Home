# Move the app to risk.beworldaware.com

Today the app lives at https://worldaware.github.io/Risk-Assessment-Home/. This guide moves it to https://risk.beworldaware.com/. Plan on 30 minutes of work and up to a few hours of waiting.

You do four things in three places: back up your saved assessments, set the domain in GitHub, add one DNS record in Squarespace, then restore your assessments on the new address.

## Before you start

- Do the DNS record (step 3) before you set the domain in GitHub (step 2 can wait until the record exists). The moment GitHub knows the custom domain it starts sending visitors there, so if the record is not in place yet the site goes dark until it is. Doing it in the order below keeps the old address working the whole time.
- You do not need to add a `CNAME` file to the repo yourself. When you save the domain in GitHub's Pages settings, GitHub commits that file to the main branch for you.
- Make a list of the assessments you want to keep. They are saved inside your browser, and a browser keeps them separately for each web address. The new address starts out empty.

## Steps

1. **Export your assessments from the old address.** Open https://worldaware.github.io/Risk-Assessment-Home/ on each device and browser where you saved work. Go to About, then Save and export, and tap Export as JSON for each assessment. Keep the files somewhere you can find them (email them to yourself or put them in a folder).

2. **Add the DNS record in Squarespace.** beworldaware.com is managed in Squarespace, so the record goes there.
   1. Sign in to Squarespace and open Domains.
   2. Click beworldaware.com, then DNS, then DNS Settings.
   3. Click Add Record.
   4. Type: `CNAME`. Host: `risk`. Data (the value it points to): `worldaware.github.io`. Leave the TTL at its default.
   5. Save. Do not put the repo name in the value and do not add `https://`. The value is only `worldaware.github.io`.
   6. Leave your other records alone, including the ones for the main website.
   7. Wait an hour or so for the record to spread. You can check it at https://dnschecker.org by looking up `risk.beworldaware.com` as a CNAME; it should show `worldaware.github.io`.

3. **Set the domain in GitHub.** Open the repo on github.com, then Settings, then Pages. Under Custom domain, type `risk.beworldaware.com` and press Save. GitHub checks the DNS record; if it still says it is checking, wait and reload. GitHub commits a `CNAME` file to the main branch at this point.

4. **Wait for the certificate.** GitHub issues the HTTPS certificate on its own once it can see the DNS record. This often takes under an hour and can take up to a day. To check, go back to Settings, then Pages. When the check next to the domain turns green, the Enforce HTTPS box becomes clickable.

5. **Turn on Enforce HTTPS.** In Settings, then Pages, tick Enforce HTTPS. If the box is grayed out, the certificate is not ready yet. Come back later.

6. **Open https://risk.beworldaware.com/ and look around.** The home screen should load, and the page should show a lock icon in the address bar. Open Results with a test assessment to confirm the PDF button works.

7. **Import your assessments on the new address.** On https://risk.beworldaware.com/ go to About, then Save and export, and use the Import from JSON button. Pick each file you exported in step 1. Check that the saved assessments show up in the list. (The Import button comes with the new-assessment branch, so ship that branch before or together with this one.)

8. **Test the old address.** Open https://worldaware.github.io/Risk-Assessment-Home/ in a fresh private window. In practice GitHub usually forwards the old address to the new one once a custom domain is set, but GitHub's documentation does not promise this, so treat it as a test. If it forwards, old links and bookmarks keep working. If it does not, leave the old address as it is for a week and tell people the new one. Either way, put only the new address on handouts and the QR code.

9. **Tell installed users.** Anyone who added the app to their home screen from the old address has to add it again from the new one. The old icon stays tied to the old address and its saved data.

## If something goes wrong

- GitHub keeps saying the domain is not set up. Check the record in Squarespace: host is `risk` only, value is `worldaware.github.io`. Then wait. DNS changes can take a few hours to spread.
- The site loads but without a lock. Enforce HTTPS is not ticked yet, or the certificate is still being issued.
- The domain setting disappears from GitHub after a deploy. The `CNAME` file is missing from the repo root or has extra text in it. It must contain `risk.beworldaware.com` and nothing else.
- Your saved assessments are missing on the new address. They are still in the old one. Open the old address and run step 1 again.

## What GitHub's rules say

For a subdomain such as `risk`, GitHub wants a CNAME record that points to `<account>.github.io`. For a bare domain such as beworldaware.com (no `risk.` in front), it wants A records instead, which does not apply here. Read the current versions before you change anything, because these requirements are the part most likely to change:

- Managing a custom domain: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
- About custom domains: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages
- Securing your site with HTTPS: https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https
- Optional but worth doing, verifying the domain so nobody else can claim it: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages

Note on sources: the record in step 3 (type CNAME, host `risk`, value `worldaware.github.io`, never the repo name and never the `*.pages.github.io` address shown in the repo's Pages settings) and the note that Enforce HTTPS can take up to 24 hours to become available were checked against GitHub's "Managing a custom domain" page on 2026-10-26. GitHub's documentation does not describe forwarding from the old github.io address, which is why step 8 is a test. Check the first two links before you start in case the requirements have changed.

## QR code

`assets/qr-risk-beworldaware.svg` is a QR code that opens https://risk.beworldaware.com/. A 1024 pixel PNG copy is at `assets/qr-risk-beworldaware-1024.png`.

- Closing slide: put it at the bottom right, at least 3 cm (about 1.2 inches) wide, on a white background, with the web address typed beside it.
- Handout: print it at 2.5 cm (1 inch) or larger, on a flat white area with a margin of at least 4 squares on all sides.
- Use the SVG for print and slides because it stays sharp at any size. Use the PNG where a program will not take an SVG.
- Scan it with a phone before you print a batch. Both files were tested and open the address above.
- Do not publish the QR code until the site works on the new address (step 6), or the code leads to an error.
