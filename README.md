# CREE WRLD — Nairobi

A single-page, obsidian-dark storefront for **CREE WRLD**, a Nairobi-based curated thrift house.
Built with **Vite**: editorial Didone typography, the official Gothic **CW** monogram with a
continuous 3D Y-axis spin, a filterable catalogue, and a WhatsApp-direct order flow with a live
Nairobi delivery calculator. The owner can add, edit and delete pieces from the browser, persisted
to `localStorage`.

No UI framework and no runtime dependencies — Vite handles bundling, asset hashing and the dev
server; everything else is hand-written HTML, CSS and ES modules.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # → dist/  (hashed assets, minified CSS/JS)
npm run preview    # serves dist/ on http://localhost:4173
npm test           # unit tests → production build → end-to-end suite
```

**Merchant demo credentials:** `admin` / `creewrld` (session persists for 12 hours).

Adding a product is **merchant-only**: there is no `+ Add Product` control in the public header.
Sign in with `Login / Admin` and the merchant strip exposes `+ New product` (plus per-card edit
overlays and a catalogue reset). Signing out removes them again.

Requirements: Node **20.19+**. The e2e suite additionally needs a local Chrome/Chromium — see
[Verification](#verification).

---

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on `0.0.0.0:5173` (works behind a preview proxy) |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built output on `0.0.0.0:4173` |
| `npm run test:unit` | Vitest — pure logic, store, validation, payload |
| `npm run test:e2e` | Headless Chromium suite against `dist/` |
| `npm test` / `npm run verify` | All of the above, in order |

---

## Project structure

```
index.html                  Vite entry — markup only (scripts/styles injected by Vite)
vite.config.js              base "./", host/allowedHosts, font-preload plugin, build options
public/
  assets/logo/              official brand artwork + favicons — copied verbatim, stable URLs
src/
  main.js                   entry: imports CSS + boots the app
  app.js                    composition root: state → views → events
  config.js                 store settings, zones, categories, storage keys
  catalog.js                seed catalogue + hero lookbook
  store.js                  state, persistence, selectors, actions (single source of truth)
  lib/
    format.js               money/esc/slug/uid helpers
    storage.js              injectable JSON localStorage wrapper
    order.js                totals, validation, WhatsApp payload (pure)
    images.js               maps stored image paths → hashed Vite URLs
  ui/
    header.js  hero.js  grid.js  cart.js  quickview.js
    order.js   admin.js layers.js reveal.js
  styles/main.css           the full design system
  assets/
    fonts/*.woff2           self-hosted Bodoni Moda, Playfair, Inter, JetBrains Mono
    img/*.jpg               product photography
tests/
  unit/*.test.js            Vitest (48 assertions)
  e2e.mjs                   Puppeteer + axe-core against the production build (128 checks)
```

---

## How the Vite migration works

**Entry.** `index.html` is the Vite root and contains only markup; `<script type="module"
src="/src/main.js">` pulls in `styles/main.css` and the module graph. Vite injects the hashed
stylesheet and bundle tags at build time.

**Images.** `src/lib/images.js` uses `import.meta.glob("../assets/img/*.jpg", { eager: true,
query: "?url" })` to build a filename → hashed-URL map. Product records keep human-readable paths
(`assets/img/sneaker-mocha.jpg`), and every render resolves them through `resolveImage()`. That
single indirection keeps three things working at once:

- merchant-entered relative paths and external `https://` URLs,
- **records written by the pre-Vite site** (no migration step needed),
- content-hashed, cache-busted filenames in production.

**Fonts.** `main.css` references `../assets/fonts/*.woff2`, so Vite fingerprints and emits them.
`assetsInlineLimit: 0` keeps every font and photo as a real hashed file instead of a base64 blob.

**Preloads.** The hashed font names only exist after the build, so a small plugin
(`fontPreload` in `vite.config.js`, `apply: "build"`) reads the emitted bundle and injects
`<link rel="preload" as="font" type="font/woff2">` for the two first-paint faces (Bodoni Moda and
Inter) with the correct relative `href`s.

**Base path.** `base: "./"` makes `dist/` portable — it works at a domain root, in a subdirectory,
and behind the sandbox preview host without a rebuild.

**Dev server.** `host: true` binds `0.0.0.0`, and `allowedHosts: true` + `cors: true` let the
proxied preview origin load modules and hot updates.

**Modules.** `window.CREE_SEED` and the two-script global pattern are gone. `catalog.js` exports
`SEED` and `HERO_SLIDES`; `store.js` owns state and persistence; `lib/` holds pure functions; `ui/`
holds DOM renderers. `app.js` wires them together and `store.subscribe()` keeps views in sync.

---

## Data & compatibility

Storage keys are **unchanged** from the pre-Vite build, so an existing catalogue and cart carry over
on first load:

| Key | Contents |
| --- | --- |
| `creewrld.products.v1` | Full product array (seeded on first visit) |
| `creewrld.cart.v1` | `[{ id, size, qty }]` |
| `creewrld.zone.v1` | Selected delivery zone id |
| `creewrld.session.v1` | `{ user, expires }` merchant session |

Corrupt or empty stored data heals back to the seed catalogue rather than rendering an empty shop.

---

## Brand system

Every text colour is defined once, in `:root`, so nothing drifts back toward an unreadable grey.
Each step was measured against the `#050505` background:

| Token | Value | Contrast on `#050505` | Used for |
| --- | --- | --- | --- |
| `--ink` | `#ffffff` | 20.4:1 | headlines, prices, active states |
| `--nav-ink` | `#e5e5e5` | 16.2:1 | navigation links, category tabs, header actions |
| `--card-ink` | `#d1d1d6` | 13.4:1 | product card + quick-view overlay text |
| `--body-ink` | `#b0b0b0` | 9.4:1 | intro paragraphs and descriptive prose |
| `--meta-ink` | `#8e8e93` | 6.3:1 | metadata, sub-tags, field labels, fine print |
| `--bg` | `#050505` | — | page background |
| `--card` | `#0f0f0f` | — | cards / raised surfaces |
| `--line` | `#1f1f1f` | — | rules and borders |

`--muted` and `--muted-dim` are kept as aliases of `--meta-ink` for backwards compatibility, so older
rules inherit the brighter platinum instead of a second, darker grey. All reading text clears WCAG AA
(4.5:1); nav and card text clear AAA (7:1).

### Type scale

| Role | Size | Weight | Tracking | Colour |
| --- | --- | --- | --- | --- |
| Navigation (`HOME`, `SHOP`, `CART`, `LOGIN / ADMIN`) | `13px` | `500` | `0.15em` | `--nav-ink` |
| Metadata and sub-tags (`01 NAIROBI, KENYA`) | `12px` | `400` | `0.2em` | `--meta-ink` |
| Intro / description paragraphs | `16px` | `400` | — | `--body-ink` (line-height `1.6`) |
| Product card + overlay text | `13px` | `400` | `0.14em`–`0.18em` | `--card-ink` |

Micro-labels stay mono and uppercase, but nothing that carries reading text renders below `11px` — the
old 7.5–9px labels were the main legibility problem on obsidian. On phones the card meta wraps to its
own row rather than truncating size runs, and the price drops under the title when it no longer fits
beside it.

- **Display** — Bodoni Moda (variable Didone); Playfair Display italic for editorial emphasis.
- **Body / UI** — Inter.
- **Micro-labels, prices, badges** — JetBrains Mono, `0.15em`–`0.3em` tracking, uppercase.
- **Wordmark** — the official Gothic "CREE WRLD" artwork
  (`public/assets/logo/creewrld-wordmark.png`).

### Brand artwork

The official logo is supplied as three raster assets in `public/assets/logo/`:

| File | Contents | Used by |
| --- | --- | --- |
| `creewrld-mark.png` | the interlocking Gothic **CW** monogram with its sharp flourishes | header spinner (×3 faces), hero watermark |
| `creewrld-wordmark.png` | "CREE WRLD" Gothic wordmark + hairline rule | header, directly beneath the spinner |
| `creewrld-lockup.png` | mark + wordmark + rule as one lockup | footer brand block, `og:image` |
| `favicon-180.png`, `icon-512.png` | the mark on an obsidian tile | favicon / home-screen icon |

They were extracted from the supplied artwork with a white-line key (full-alpha ramp, so the
hairline flourishes keep their anti-aliasing), trimmed, and exported at 2× for retina. The header
mark is keyed slightly *bolder* so a 64px render still reads on a phone.

**To replace them**, drop new files in at the same paths and keep the filenames — that is the only
change required. If you supply a **transparent SVG** instead, save it as
`public/assets/logo/creewrld-mark.svg` and update the three `<img>` tags in `index.html`'s `.brand`
block (plus the hero watermark); everything else is CSS-sized.

Two things to preserve when re-exporting:

1. **Transparency.** The mark is white line-art; a flattened black plate would show as a rectangle
   against the storefront.
2. **Aspect ratio.** `index.html` declares intrinsic `width`/`height` on each image so the header
   does not shift while the heavy PNGs decode. If your artwork has different proportions, update
   those attributes to match, or the image will look stretched.

### Header lockup

The mark sits in a `perspective` container with three stacked faces (front, a blurred ghost pushed
back on Z, and a mirrored back face) and rotates continuously via
`@keyframes spin-y { to { transform: rotateY(360deg) } }` over 12s. The official wordmark image sits
directly beneath it, so the spinner appears to sit above the typography. The whole lockup scales
down when the header condenses on scroll, and again at the mobile breakpoints.
`prefers-reduced-motion` disables the rotation.

## Verification

`npm test` runs three layers, and the e2e layer targets the **built** output (`vite preview` on
`dist/`), not the dev server:

**Unit (Vitest, 48 assertions)** — currency formatting, HTML escaping, size parsing, delivery zone
fees, customer validation (including the phone formats shoppers actually type), the exact WhatsApp
payload, store CRUD, quantity caps, cart/ordered-line retirement, session expiry, subscriber
notifications, cross-tab sync, and recovery from corrupt storage.

**E2E (128 checks)** — a real Chromium session against `dist/`:

- *Build integrity*: content-hashed JS/CSS, two font preloads pointing at hashed `.woff2` files
  that return `200 font/woff2`, all three typefaces loaded via `document.fonts`, product photos
  served from hashed URLs and decoded, official brand artwork resolving from `public/`, and **no
  Add Product button in the shopper header**.
- *Behaviour*: 10 cards, filters, order modal validation, the decoded `wa.me/254719526649` payload
  (title, price, size, condition, absolute hashed image link, customer, free-delivery note),
  delivery calculator (Free / KSh 200 / KSh 450), quantity steppers, cart-wide dispatch clearing the
  cart, merchant login, add/edit/delete CRUD, persistence across reload.
- *Legacy migration*: a pre-Vite `localStorage` record (plain `assets/img/...` path) still renders
  and resolves to a hashed asset.
- *Brand lockup*: the spinner uses `creewrld-mark.png`, the wordmark image sits beneath it, the
  `spin-y` animation is still applied, and the mark decodes at header size.
- *Typography & contrast*: the four roles above are asserted against computed styles (exact size,
  weight, tracking and hex), every reading colour is checked for ≥4.5:1 contrast against its actual
  painted background, and no element carrying reading text may render below 11px.
- *Accessibility*: axe-core — zero violations on the home page, cart drawer, order modal and login
  modal.
- *Layout*: no horizontal overflow at 320/360/390/414/560/768/834/1024/1180/1280/1440/1920 px, with
  the 2/3/4-column grid breakpoints asserted.
- *Hygiene*: no console errors, no uncaught page errors, no 404s or failed requests.

**Running the e2e suite.** It needs a Chrome binary. Defaults are auto-detected; otherwise:

```bash
PUPPETEER_EXECUTABLE_PATH=/path/to/chrome npm run test:e2e
# or install one: npx puppeteer browsers install chrome
```

If Chrome is missing the suite exits with a clear message instead of a false pass. In CI, run
`npm ci && npx puppeteer browsers install chrome && npm test`.

---

## Deployment

The output is a static folder — host `dist/` anywhere (Netlify, Vercel, Cloudflare Pages, GitHub
Pages, S3, nginx). Because there is a single route, no SPA rewrite is required; if you later add
routing, add a fallback to `index.html`.

`server.js` from the pre-Vite version is gone: use `npm run dev` locally and `npm run preview` to
inspect a production build.

---

## Production notes

This is a front-end storefront, deliberately backend-free:

1. **Admin auth is client-side.** The gate keeps shoppers out of the merchant UI, but the
   credentials live in `src/config.js` and are bundled. Move products and auth behind a real backend
   (Supabase, Firebase, or a small Node API) before exposing inventory management publicly.
2. **Inventory is per-browser.** Edits live in `localStorage`, so they are visible on the device that
   made them. A shared backend is required for a catalogue every customer sees.
3. **Images.** Bundled photos are hashed at build time; merchant-entered URLs should point at object
   storage (S3/Cloudinary) so the links inside WhatsApp messages resolve publicly.
4. **WhatsApp number** is defined once: `CONFIG.whatsapp` in `src/config.js`.
5. Prices are integers in KSh, formatted with `toLocaleString("en-KE")`.
