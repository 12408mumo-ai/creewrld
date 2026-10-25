# CREE WRLD — Nairobi

A single-page, obsidian-dark storefront for **CREE WRLD**, a Nairobi-based curated thrift house.
Built with **Vite**: editorial Didone typography, a hand-built Gothic **CW** monogram with a
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
  assets/logo/              monogram, favicon, mark — copied verbatim, stable URLs
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
    fonts/*.woff2           self-hosted Bodoni Moda, Playfair, Inter, JetBrains Mono, UnifrakturCook
    img/*.jpg               product photography
tests/
  unit/*.test.js            Vitest (48 assertions)
  e2e.mjs                   Puppeteer + axe-core against the production build (111 checks)
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
`<link rel="preload" as="font" type="font/woff2">` for the three first-paint faces (Bodoni Moda,
Inter, UnifrakturCook) with the correct relative `href`s.

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

| Token | Value |
| --- | --- |
| Background | `#050505` |
| Cards / raised | `#0f0f0f` |
| Primary text | `#ffffff` |
| Secondary text | `#919191` |
| Borders | `#1f1f1f` |

- **Display** — Bodoni Moda (variable Didone); Playfair Display italic for editorial emphasis.
- **Body / UI** — Inter.
- **Micro-labels, prices, badges** — JetBrains Mono, `0.15em`–`0.3em` tracking, uppercase.
- **Wordmark** — UnifrakturCook subset to `A–Z` (4 KB).

### Supplying the real logo

The monogram at `public/assets/logo/creewrld-monogram.svg` is a **reconstruction** drawn from
blackletter glyph outlines (the original brand file was not available). It is referenced from
`index.html` in six places — three stacked faces for the 3D spin, plus the hero watermark and the
footer mark.

To swap in the real artwork, replace that file. Best results:

1. **Vector, transparent background** (SVG preferred) — just overwrite `creewrld-monogram.svg`,
   keeping the filename. Nothing else changes.
2. **Transparent PNG** — save it as `public/assets/logo/creewrld-monogram.png`, then:

   ```bash
   sed -i 's|creewrld-monogram.svg|creewrld-monogram.png|g' index.html
   ```

3. **A logo on a solid black/white background** will look wrong against the storefront. Either
   re-export it with transparency, or ask for the `mix-blend-mode: screen` treatment
   (`.brand__face img` in `src/styles/main.css`) to knock out a black backdrop.

Inverted/white-on-transparent artwork is what the dark UI expects; the header applies a soft
`drop-shadow` glow that assumes a transparent plate.

---

## Verification

`npm test` runs three layers, and the e2e layer targets the **built** output (`vite preview` on
`dist/`), not the dev server:

**Unit (Vitest, 48 assertions)** — currency formatting, HTML escaping, size parsing, delivery zone
fees, customer validation (including the phone formats shoppers actually type), the exact WhatsApp
payload, store CRUD, quantity caps, cart/ordered-line retirement, session expiry, subscriber
notifications, cross-tab sync, and recovery from corrupt storage.

**E2E (111 checks)** — a real Chromium session against `dist/`:

- *Build integrity*: content-hashed JS/CSS, three font preloads pointing at hashed `.woff2` files
  that return `200 font/woff2`, all four typefaces loaded via `document.fonts`, product photos
  served from hashed URLs and decoded.
- *Behaviour*: 10 cards, filters, order modal validation, the decoded `wa.me/254719526649` payload
  (title, price, size, condition, absolute hashed image link, customer, free-delivery note),
  delivery calculator (Free / KSh 200 / KSh 450), quantity steppers, cart-wide dispatch clearing the
  cart, merchant login, add/edit/delete CRUD, persistence across reload.
- *Legacy migration*: a pre-Vite `localStorage` record (plain `assets/img/...` path) still renders
  and resolves to a hashed asset.
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
