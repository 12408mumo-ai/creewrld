# CREE WRLD — Nairobi

A single-page, obsidian-dark storefront for **CREE WRLD**, a Nairobi-based curated thrift house.
Built with **Vite**: editorial Didone typography, the official Gothic **CW** monogram with a
continuous 3D Y-axis spin, a filterable catalogue, and a WhatsApp-direct order flow with a live
Nairobi delivery calculator.

**Live backend: Supabase.** The catalogue and every order live in Supabase — there is no demo mode
and no seeded client-side data. The storefront is **strictly read-only**: the browser holds no
merchant tooling at all and cannot write to the catalogue, because every piece is curated by hand in
the Supabase Dashboard. See [Managing the catalogue](#managing-the-catalogue).

No UI framework. Vite bundles, hashes assets and runs the dev server; Supabase is the only runtime
dependency (`@supabase/supabase-js`). Everything else is hand-written HTML, CSS and ES modules.

---

## Quick start

```bash
cp .env.example .env      # then paste your project URL + anon key
npm install
npm run dev               # http://localhost:5173
npm run build             # → dist/  (hashed assets, minified CSS/JS)
npm run preview           # serves dist/ on http://localhost:4173
npm test                  # unit tests → production build → end-to-end suite
```

The database is one SQL file: run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL
editor, then optionally [`supabase/seed.sql`](supabase/seed.sql) for the original ten pieces. For a
clean slate — wipe and rebuild in one paste —
[`supabase/schema-reset.sql`](supabase/schema-reset.sql). See [Supabase setup](#supabase-setup).

**The shop has no admin panel.** Pieces are added, edited and retired in the Supabase Dashboard
(*Table Editor → `products`*), and photography is dropped into the `product-images` bucket from the
same place. The public page only ever reads: it asks for `in_stock = true` rows, renders them, and
takes orders over WhatsApp.

Requirements: Node **20.19+**. The e2e suite additionally needs a local Chrome/Chromium — see
[Verification](#verification).

---

## Configuration

The project reads the same variable names Vercel already has, so **nothing needs renaming**:

| Variable | Where it is used |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public anon key |

`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are accepted too, if you prefer the Vite spelling.

**Why the env bridge exists.** This is a Vite app, not Next.js: there is no `process.env` in the
browser and Vite only inlines `import.meta.env.VITE_*`. `vite.config.js` therefore reads `.env`
files and the build environment, and injects the two values into the bundle as compile-time
literals (`__SUPABASE_URL__`, `__SUPABASE_ANON_KEY__`). `src/lib/supabase.js` builds the client from
those.

The anon key is **designed to be public** — it ships in every Supabase web app. What protects your
data is row level security in `supabase/schema.sql`, not secrecy. Never put the `service_role` key
in this project: it bypasses RLS and would hand the whole database to anyone who opens DevTools.

`VITE_SUPABASE_REALTIME=off` disables the live catalogue subscription (useful if you have not
published the table for Realtime).

If the variables are missing, the build still succeeds and the storefront says so in plain language
instead of rendering an empty shop:

> *Supabase is not configured — set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.*

---

## Supabase setup

1. **Create the schema.** Paste [`supabase/schema.sql`](supabase/schema.sql) into *SQL Editor → New
   query → Run*. It creates `categories`, `products` and `orders`, the `product-images` bucket, all
   RLS policies and the `updated_at` trigger. It is idempotent, so re-running it is safe.

   It is also **additive**: each table is created if missing and then topped up with `alter table …
   add column if not exists`, plus a `create unique index if not exists` on `categories.slug` for the
   upsert. That means the file repairs a project that already has these tables from an earlier or
   different script — the missing columns are added and existing rows are kept, never dropped.

   Two renames are carried across automatically: a project whose stock column is `is_active` gets it
   copied into `in_stock`, and an order table with `phone` / `delivery_location` / `total` gets those
   values copied into `customer_phone` / `delivery_area` / `total_price`.

   There is one shape it cannot repair: a legacy table with its own `not null` column that this
   schema knows nothing about (e.g. `categories.code text not null`), because inserts cannot supply a
   value for it. In that case run
   [`supabase/schema-reset.sql`](supabase/schema-reset.sql) instead — a single paste that drops the
   three tables and any leftover enum types, rebuilds the schema, re-seeds the four categories and
   re-applies every policy, grant, bucket and the Realtime publication. It deletes every product and
   every order, so only run it when that is what you want (or on a throwaway project), then run
   `seed.sql` if you want the starter pieces back.
2. **Keep the storefront read-only.** The anon key ships in the bundle, so the anonymous role should
   only be able to `select` the catalogue and `insert` an order. `schema.sql` and
   [`supabase/read-only-catalogue.sql`](supabase/read-only-catalogue.sql) revoke everything else on
   `products`, `categories` and the storage bucket; the Dashboard uses the service role, so curating
   pieces by hand is unaffected.
3. **Publish the starter catalogue (optional).** Run [`supabase/seed.sql`](supabase/seed.sql) on a
   fresh database to insert the original ten pieces with their bundled photographs. It is a no-op
   once any product exists.
4. **Check Realtime (optional).** *Database → Replication* — the `products` table is added to the
   publication by the schema. If Realtime is off the storefront still refreshes when the tab
   regains focus.

### What the schema holds

Three tables, no views, no functions beyond the `updated_at` trigger:

| table | columns |
| --- | --- |
| `categories` | `id` uuid, `name` text unique, `slug` text unique, `sort_order` int, `created_at` |
| `products` | `id` uuid, `title` text, `description` text, `price` numeric(12,2) in KSh, `image_url` text, `category_id` uuid → `categories(id) on delete set null`, `in_stock` bool default true, `created_at`, plus `condition`, `sizes` and `updated_at` which the storefront reads |
| `orders` | `id` uuid, `customer_name`, `customer_phone`, `delivery_area`, `items` jsonb (array), `total_price` numeric, `status` text default `pending`, `created_at`, plus the delivery breakdown (`zone`, `zone_label`, `zone_fee`, `subtotal`, `item_count`, `source`) |

`in_stock` is the owner's on/off switch. The grid query asks for `in_stock = true` only, so a piece
switched off in the Dashboard disappears from the shop completely — it is not rendered as a
"sold out" card. `price` is stored in whole Kenyan shillings and formatted as `KSh 6,500` in the UI.

### Managing the catalogue

Everything happens in the Supabase Dashboard. Nothing below needs a redeploy — the page re-reads the
catalogue on load, on tab focus, and through Realtime.

**Add a piece** — *Table Editor → `products` → Insert row*:

| Column | What to put there |
| --- | --- |
| `title` | the name shown on the card |
| `price` | a whole number of KSh (no commas, no `KSh`) |
| `category_id` | pick one of the four `categories` rows (`Sneakers`, `Streetwear`, `Old Money`, `Y2K`) |
| `condition` | one of `New`, `Like New`, `Excellent`, `Very Good`, `Good` — anything else renders as `Excellent` |
| `sizes` | a text array, e.g. `{"41","42","43"}`; empty falls back to `One size` |
| `image_url` | either `assets/img/<file>.jpg` for bundled photography, or the public URL of an object in the `product-images` bucket |
| `description` | optional; the quick view falls back to a stock line when it is empty |
| `in_stock` | `true` to sell it. `false` removes it from the shop entirely |

**Photography.** Upload the file to *Storage → `product-images`* (public bucket, 6 MB cap, JPEG / PNG
/ WebP / AVIF), copy the public URL and paste it into `image_url`. The bucket is write-protected for
the anonymous role, so uploads happen in the Dashboard, never from the browser.

**Retire a piece.** Set `in_stock = false` to hide it without losing the row, or delete the row to
remove it for good. Both take effect on the next page load.

**Change the categories.** Edit the `categories` table; `sort_order` decides the tab order. A tab is
only rendered when the table has a row for it.

### When a piece does not reach the grid

1. **Check `in_stock`.** A row with `in_stock = false` (or `null`) is filtered out of the query on
   purpose — that is the switch that hides it.
2. **Check the read policy.** The storefront reads with the anon key. If `select` on `products` is
   missing, the page shows *"Couldn't load the collection."* under the filters.
3. **Check the deployment's project.** Supabase is baked into the bundle at build time, so a
   deployment pointed at a different project shows that project's catalogue. Run
   `creewrldConfig()` in the console — it prints the project ref the bundle is using.
4. **Give Realtime a moment.** Without the `products` table in the `supabase_realtime` publication
   (or with `VITE_SUPABASE_REALTIME=off`) an open tab picks the change up on its next focus or
   reload.

### Data model

| Table | Purpose | Who can read | Who can write |
| --- | --- | --- | --- |
| `categories` | the four tabs (`Sneakers`, `Streetwear`, `Old Money`, `Y2K`) | everyone | Dashboard (service role) only |
| `products` | the catalogue, with `category_id` FK and `image_url` | everyone, `in_stock = true` is all the shop asks for | Dashboard (service role) only |
| `orders` | a log of every checkout, plus the WhatsApp hand-off | Dashboard (service role) only | anyone may **insert** |
| `product-images` (bucket) | product photography | everyone | Dashboard (service role) only |

`products.price` is an integer in **KSh**, `sizes` is a `text[]`, and `condition` is constrained to
the five tags the UI offers. `orders.items` is a JSON snapshot of the lines at the moment of
checkout, so a later price change never rewrites history.

`orders` is deliberately **insert-only for shoppers**: an anonymous visitor can place an order but
cannot read the list, so one customer can never see another's phone number.

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
  config.js                 store settings, delivery zones, storage keys
  catalog.js                the bundled hero lookbook
  store.js                  state + Supabase orchestration (single source of truth)
  data/                     the only modules that talk to the backend
    products.js             catalogue read + realtime (read-only)
    orders.js               order insert
  lib/
    supabase.js             client, build-time env, timeout + error translation
    products.js             row ⇄ app-shape mapping (pure, unit-tested)
    format.js               money/esc/slug/uid helpers
    storage.js              injectable JSON localStorage wrapper (cart + zone only)
    order.js                totals, validation, WhatsApp payload (pure)
    images.js               maps stored image paths → hashed Vite URLs
  ui/
    header.js  hero.js  grid.js  cart.js  quickview.js
    order.js   layers.js  reveal.js
  styles/main.css           the full design system
  assets/
    fonts/*.woff2           self-hosted Bodoni Moda, Playfair, Inter, JetBrains Mono
    img/*.jpg               product photography
supabase/
  schema.sql                tables, RLS, bucket, trigger — run this first, safe to re-run
  schema-reset.sql          DESTRUCTIVE: wipe + rebuild everything in one paste
  read-only-catalogue.sql   revokes catalogue/bucket writes from the anonymous role
  seed.sql                  the original ten pieces (fresh database only)
tests/
  unit/*.test.js            Vitest (72 assertions)
  e2e.mjs                   Puppeteer + axe-core against the production build (136 checks)
  supabase-stub.mjs         in-process fake Supabase the e2e suite talks to
```

---

## How the Vite migration works

**Entry.** `index.html` is the Vite root and contains only markup; `<script type="module"
src="/src/main.js">` pulls in `styles/main.css` and the module graph. Vite injects the hashed
stylesheet and bundle tags at build time.

**Images.** `src/lib/images.js` uses `import.meta.glob("../assets/img/*.jpg", { eager: true,
query: "?url" })` to build a filename → hashed-URL map. Bundled photography keeps a human-readable
path in `products.image_url` (`assets/img/sneaker-mocha.jpg`), and every render resolves it through
`resolveImage()`. That single indirection keeps three kinds of value working side by side:

- bundled photos referenced by path → hashed build URL,
- images uploaded through the merchant form → Supabase Storage public URL, used as-is,
- any external `https://` URL, also used as-is.

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

**Modules.** `window.CREE_SEED` and the two-script global pattern are gone. `catalog.js` exports the
bundled `HERO_SLIDES` lookbook; `store.js` owns state; `data/` owns the backend; `lib/` holds pure
functions; `ui/` holds DOM renderers. `app.js` wires them together and `store.subscribe()` keeps
views in sync.

**Environment.** `vite.config.js` resolves the Supabase variables (see
[Configuration](#configuration)) and passes them through `define`, because a Vite bundle cannot read
`process.env` at runtime the way a Next.js bundle does.

---

## How the storefront talks to Supabase

`src/store.js` is the only module that holds state; `src/data/*` is the only code that touches the
network. Views never query the database — they render `state` and subscribe to changes.

| Flow | Call |
| --- | --- |
| Boot | `products.select("*, categories(name, slug)").eq("in_stock", true)` + `categories.select(...)` |
| Category tab | filtered in memory from the live catalogue, counts included |
| Checkout | `orders.insert([...])`, then the WhatsApp hand-off |
| Live updates | realtime `postgres_changes` on `products`, plus a refetch on tab focus |

That is the whole surface: two reads and one insert. There is no write, no upload, no session and no
admin state anywhere in `src/` — the e2e suite asserts that every request the shopper session makes
is a `GET` (plus the order `POST`), that no merchant chrome exists in the DOM, and that nothing
`isAdmin`-shaped is written to `sessionStorage` or `localStorage`.

**Ordering is deliberate.** The order is inserted *before* WhatsApp opens, so the studio keeps a
record even if the chat is never sent. A logging failure never blocks the sale: the WhatsApp tab
still opens, and the customer is told the studio will confirm from the chat.

**Cart and delivery zone stay local.** They are per-shopper scratch state, not shop data, so they
live in `localStorage` under the original keys:

| Key | Contents |
| --- | --- |
| `creewrld.cart.v1` | `[{ id, size, qty }]` |
| `creewrld.zone.v1` | selected delivery zone id |

Restored cart lines are validated against the live catalogue on boot: pieces that no longer exist
are dropped, and a size that was removed falls back to the first available one. The old keys
`creewrld.products.v1` and `creewrld.session.v1` are **no longer written or read** — legacy values
sitting in someone's browser are ignored, which is why the first load after this change shows the
live catalogue rather than a stale local copy.

**Failure states are visible.** A missing configuration, an unreachable project or an empty table
each produce a plain-language line under the filters (`#dataNotice`) plus the tailored empty state —
never a silent blank grid. Requests time out after 15s rather than leaving the shop on
"Loading the collection…" indefinitely.

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

**Unit (Vitest, 72 assertions)** — row → app mapping (including the category join and category
sorting), the exact `PRODUCT_SELECT` the grid asks for, currency formatting, HTML escaping, size
parsing, delivery zone fees, customer validation, the exact WhatsApp payload, cart maths and quantity
caps, and cart reconciliation against a changed catalogue.

**E2E (136 checks)** — a real Chromium session against `dist/`:

- *Build integrity*: content-hashed JS/CSS, two font preloads pointing at hashed `.woff2` files
  that return `200 font/woff2`, all three typefaces loaded via `document.fonts`, product photos
  served from hashed URLs and decoded, official brand artwork resolving from `public/`, and **no
  Add Product button in the shopper header**.
- *Live data*: the grid renders exactly what the database returns, tabs and counts come from the
  `categories` table, and no catalogue key is written to `localStorage`.
- *Read-only storefront*: no studio bar, drawer, login modal, passphrase input, `+ NEW PIECE`,
  `EDIT` / `DELETE` control or merchant footer link exists in the document; `window.creewrldStudio`
  is gone; nothing `isAdmin`-shaped sits in `sessionStorage` or `localStorage`; the grid request is
  exactly `select=*, categories(name, slug)` + `in_stock=eq.true`; and the shopper session issues no
  request other than that read and the order insert.
- *Hidden pieces*: a row with `in_stock = false` is not fetched, so it is absent from the grid and
  from the counts — no "sold out" card, no disabled button.
- *Orders*: the row is inserted before WhatsApp opens, with the customer details, the money in KSh,
  the zone, and a JSON snapshot of the lines; the WhatsApp tab is claimed inside the click gesture
  and navigated afterwards, so it survives pop-up blockers.
- *Resilience*: an empty table shows the shopper empty state and offers no seeding control; an
  unreachable backend raises the data notice.
- *Behaviour*: the live grid and its counts, category tabs, order modal validation, the decoded
  `wa.me/254719526649` payload (title, price, size, condition, absolute hashed image link, customer,
  free-delivery note), the delivery calculator (Free / KSh 200 / KSh 450), quantity steppers, a
  cart-wide dispatch clearing the cart, and the cart + zone surviving a reload while the catalogue
  is re-read from the database.
- *Brand lockup*: the spinner uses `creewrld-mark.png`, the wordmark image sits beneath it, the
  `spin-y` animation is still applied, and the mark decodes at header size.
- *Typography & contrast*: the four roles above are asserted against computed styles (exact size,
  weight, tracking and hex), every reading colour is checked for ≥4.5:1 contrast against its actual
  painted background, and no element carrying reading text may render below 11px.
- *Accessibility*: axe-core — zero violations on the home page, cart drawer, order modal and quick
  view.
- *Layout*: no horizontal overflow at 320/360/390/414/560/768/834/1024/1180/1280/1440/1920 px, with
  the 2/3/4-column grid breakpoints asserted.
- *Hygiene*: no console errors, no uncaught page errors, no 404s or failed requests.

**How the e2e suite reaches a backend.** There is no test mode in the bundle: the suite builds
the real production output with throwaway credentials, launches it, and intercepts the HTTP traffic
`@supabase/supabase-js` would send, answering it from `tests/supabase-stub.mjs` — a small stateful
fake covering PostgREST and Storage. So the assertions run against the real client and the
real query shapes, without needing a live project or leaving test hooks in `dist/`.

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

**Vercel.** Framework preset **Vite**, build command `npm run build`, output `dist`. Add
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the project's environment
variables — and **redeploy after adding them**, because the values are baked into the bundle at build
time rather than read at runtime.

The dev server runs with `host: true` on `0.0.0.0`, so it also works behind a preview proxy.

---

## Production notes

1. **The browser cannot write the catalogue.** There is no merchant UI, no upload path and no
   session in the bundle; every piece is curated in the Supabase Dashboard. Keep it that way — an
   anon key ships in the bundle, so the only thing standing between a visitor and your `products`
   table is row level security.
2. **Keep the anon grants minimal.** `schema.sql` grants `select` on `products` / `categories` and
   `insert` on `orders`, and nothing else. If you ever restore wider grants for an experiment, run
   [`supabase/read-only-catalogue.sql`](supabase/read-only-catalogue.sql) to take them back.
3. **The anon key is public by design.** It is in the bundle. Protect data with RLS, and keep the
   `service_role` key out of this repo and out of Vercel's client-side variables.
4. **Images** are stored in the public `product-images` bucket, capped at 6 MB and four MIME types
   by both the bucket and the form. The starter pieces still point at bundled `assets/img/…`
   photography, which the build hashes — both kinds resolve side by side.
5. **Orders are leads, not payments.** Nothing is charged: the row records intent and the WhatsApp
   chat closes the sale. `status` is there for whatever the studio uses to track fulfilment.
6. **WhatsApp number** is defined once: `CONFIG.whatsapp` in `src/config.js`.
7. Prices are integers in KSh, formatted with `toLocaleString("en-KE")`.
