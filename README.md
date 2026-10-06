# Figment Bridge site

Static marketing and pricing site. Plain HTML, CSS and JS, assembled by a zero-dependency Node script. Deploys to Vercel as static output.

## Run it

```bash
npm start          # builds to dist/ and serves http://localhost:4173
npm run build      # build only
```

Needs Node 18+. No packages to install.

## Layout

- `site.config.json`: **the one place for prices, billing period, checkout URLs and product IDs, free download URL, accent colour, contact email, version.**
- `src/pages/`: one folder per URL (`/`, `/pricing/`, `/quickstart/`, `/changelog/`, `/terms/`, `/privacy/`, `/refunds/`, plus `404.html`).
- `src/partials/`: shared head, header, footer, the pricing cards (used on `/` and `/pricing/`).
- `src/css/styles.css`, `src/js/main.js`, `src/assets/` (fonts, compressed videos, posters), `src/static/` (favicons, OG image, copied to the site root).
- `scripts/build.mjs`: fills `{{config.*}}` values, includes partials, minifies CSS, writes `sitemap.xml` and `robots.txt`.

## Edit prices, billing and checkout

All in `site.config.json`, then rebuild (Vercel does this on every deploy).

- **Prices:** `tiers.regular.price`, `tiers.premium.price`. They flow into the cards, the matrix and the SEO structured data.
- **Billing model:** `billing` is `"one-time"` (default) or e.g. `"/ month"`. Every price label follows it. `TODO(owner)`: not decided yet.
- **Checkout:** set `tiers.regular.checkoutUrl` and `tiers.premium.checkoutUrl` (plus `productId`). While a URL is empty, the buttons show a "Checkout is not connected yet" notice. To open a provider overlay instead, define `window.FIGMENT.checkout = (tier, productId) => true` before `main.js` loads.
- **Free download:** `freeDownloadUrl` (currently `/quickstart/`).
- **Accent colour:** `accent`.
- **Secrets:** never put API keys or webhook secrets in this repo. Use Vercel environment variables in a separate backend if you add one.

## Deploy

Import the folder in Vercel. `vercel.json` already sets the build command (`node scripts/build.mjs`), output directory (`dist`), clean URLs and cache headers. Update `url` in `site.config.json` to the final domain so canonical links, the sitemap and social images are correct.

## Media

Videos are in `src/assets/video/` as H.264 MP4 and WebM (1280 wide), a 640 px MP4 for phones, and a WebP poster. Below-the-fold videos load and play only when scrolled near. Reduced-motion users get no autoplay and no animation.

## Analytics

Placeholder only. Set `analytics.enabled` and `analytics.scriptUrl` in the config to load a script. Nothing loads by default and there is no cookie banner.
