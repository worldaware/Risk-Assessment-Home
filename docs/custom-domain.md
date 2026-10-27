# Move the app to risk.beworldaware.com

Today the app lives at https://worldaware.github.io/Risk-Assessment-Home/. This guide moves it to https://risk.beworldaware.com/. Plan on 30 minutes of work and up to a few hours of waiting.

You do four things in three places: back up your saved assessments, set the domain in GitHub, add one DNS record in Squarespace, then restore your assessments on the new address.

## Before you start

- Merge the branch that contains the `CNAME` file at the top of this repo (it holds one line: `risk.beworldaware.com`). Do this first. GitHub reads that file to know which domain the site belongs to.
- Make a list of the assessments you want to keep. They are saved inside your browser, and a browser keeps them separately for each web address. The new address starts out empty.

## Steps

1. **Export your assessments from the old address.** Open https://worldaware.github.io/Risk-Assessment-Home/ on each device and browser where you saved work. Go to About, then Save and export, and tap Export as JSON for each assessment. Keep the files somewhere you can find them (email them to yourself or put them in a folder).

2. **Set the domain in GitHub.** Open the repo on github.com, then Settings, then Pages. Under Custom domain, type `risk.beworldaware.com` and press Save. GitHub will say it is checking the DNS record. That message is expected until step 3 is done and has had time to spread.

3. **Add the DNS record in Squarespace.** beworldaware.com is managed in Squarespace, so the record goes there.
   1. Sign in to Squarespace and open Domains.
   2. Click beworldaware.com, then DNS, then DNS Settings.
   3. Click Add Record.
   4. Type: `CNAME`. Host: `risk`. Data (the value it points to): `worldaware.github.io`. Leave the TTL at its default.
   5. Save. Do not put the repo name in the value and do not add `https://`. The value is only `worldaware.github.io`.
   6. Leave your other records alone, including the ones for the main website.

4. **Wait for the certificate.** GitHub issues the HTTPS certificate on its own once it can see the DNS record. This often takes under an hour and can take up to a day. To check, go back to Settings, then Pages. When the check next to the domain turns green, the Enforce HTTPS box becomes clickable.

5. **Turn on Enforce HTTPS.** In Settings, then Pages, tick Enforce HTTPS. If the box is grayed out, the certificate is not ready yet. Come back later.

6. **Open https://risk.beworldaware.com/ and look around.** The home screen should load, and the page should show a lock icon in the address bar. Open Results with a test assessment to confirm the PDF button works.

7. **Import your assessments on the new address.** On https://risk.beworldaware.com/ go to About, then Save and export, and use the Import from JSON button. Pick each file you exported in step 1. Check that the saved assessments show up in the list. (The Import button comes with the new-assessment branch, so ship that branch before or together with this one.)

8. **Test the old address.** Open https://worldaware.github.io/Risk-Assessment-Home/ in a fresh private window. GitHub should send you to the new address. If it does, old links and bookmarks keep working. If it does not, leave the old address as it is for a week and tell people the new one.

9. **Tell installed users.** Anyone who added the app to their home screen from the old address has to add it again from the new one. The old icon stays tied to the old address and its saved data.

## If something goes wrong

- GitHub keeps saying the domain is not set up. Check the record in Squarespace: host is `risk` only, value is `worldaware.github.io`. Then wait. DNS changes can take a few hours to spread.
- The site loads but without a lock. Enforce HTTPS is not ticked yet, or the certificate is still being issued.
- The domain setting disappears from GitHub after a deploy. The `CNAME` file is missing from the repo root or has extra text in it. It must contain `risk.beworldaware.com` and nothing else.
- Your saved assessments are missing on the new address. They are still in the old one. Open the old address and run step 1 again.

## What GitHub's rules say

For a subdomain such as `risk`, GitHub wants a CNAME record that points to `<account>.github.io`. For a bare domain such as beworldaware.com (no `risk.` in front), it wants A records instead, which does not apply here. Read the current versions before you change anything, because these requirements are the part most likely to change:

- Managing a custom domain: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
- About custom domains (also covers the redirect from the old address): https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages
- Securing your site with HTTPS: https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https
- Optional but worth doing, verifying the domain so nobody else can claim it: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages

Note on sources: when this guide was written, the GitHub pages above could not be opened from the writing environment, so the record values and the old-address redirect in step 8 come from general knowledge of how GitHub Pages works and have not been checked line by line against those pages. Step 8 is written as a test for that reason. Check the first two links before you start.

## QR code

`assets/qr-risk-beworldaware.svg` is a QR code that opens https://risk.beworldaware.com/. A 1024 pixel PNG copy is at `assets/qr-risk-beworldaware-1024.png`.

- Closing slide: put it at the bottom right, at least 3 cm (about 1.2 inches) wide, on a white background, with the web address typed beside it.
- Handout: print it at 2.5 cm (1 inch) or larger, on a flat white area with a margin of at least 4 squares on all sides.
- Use the SVG for print and slides because it stays sharp at any size. Use the PNG where a program will not take an SVG.
- Scan it with a phone before you print a batch. Both files were tested and open the address above.
- Do not publish the QR code until the site works on the new address (step 6), or the code leads to an error.
