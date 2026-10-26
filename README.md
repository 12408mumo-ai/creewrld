# CREE WRLD — Nairobi

A single-page, obsidian-dark storefront for **CREE WRLD**, a Nairobi-based curated thrift house.
Built with **Vite**: editorial Didone typography, the official Gothic **CW** monogram with a
continuous 3D Y-axis spin, a filterable catalogue, and a WhatsApp-direct order flow with a live
Nairobi delivery calculator.

**Live backend: Supabase.** The catalogue, product image uploads and every order live in Supabase —
there is no demo mode and no seeded client-side data. The merchant controls appear once the studio
passphrase is entered. See [Studio access](#studio-access) for what that gate is and is not worth.

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

The database itself is one SQL file: run [`supabase/schema.sql`](supabase/schema.sql) in the
Supabase SQL editor, then optionally [`supabase/seed.sql`](supabase/seed.sql) for the original ten
pieces. See [Supabase setup](#supabase-setup).

**Studio access** is one passphrase (`creewrld.com`), compared in the browser and remembered in
`sessionStorage` for the tab. There is no Supabase Auth, no account and no email field.

Adding a piece is **merchant-only**: there is no `+ New piece` control in the public header.
Click `Login / Admin`, enter the passphrase — the header link then reads `Logout`, a **studio bar**
appears under the header (`● STUDIO ACTIVE`, the piece count, `+ NEW PIECE`, `LOGOUT`) and every card
grows `EDIT` / `DELETE` controls. `+ New piece` opens the studio drawer: title, category, price in
KSh, sizes, condition, description, an `In stock` / `Sold out` switch and an image dropzone.
`Logout` clears the flag and returns the storefront to shopper view.

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

   There is one shape it cannot repair: a legacy table with its own `not null` column that this
   schema knows nothing about (e.g. `categories.code text not null`), because inserts cannot supply a
   value for it. In that case run the destructive
   [`supabase/reset.sql`](supabase/reset.sql) first — it drops only the three tables and the trigger —
   then re-run `schema.sql` (and `seed.sql` if you want the starter pieces). Only do that on a project
   with no real content yet.
2. **Allow anonymous writes.** The studio is unlocked with a passphrase in the browser, so the page
   has no Supabase session to write with. Run
   [`supabase/studio-access.sql`](supabase/studio-access.sql) once to grant the anonymous role the
   catalogue writes it now needs. **Read the warning at the top of that file first** — it trades
   database-enforced access for a browser-side gate. `schema.sql` already contains the same policies
   for a fresh project.
3. **Publish the starter catalogue (optional).** Run [`supabase/seed.sql`](supabase/seed.sql) on a
   fresh database to insert the original ten pieces with their bundled photographs. It is a no-op
   once any product exists. You can also do this from the storefront: sign in with an empty
   catalogue and the studio bar offers **Load starter catalogue**.
4. **Check Realtime (optional).** *Database → Replication* — the `products` table is added to the
   publication by the schema. If Realtime is off the storefront still refreshes when the tab
   regains focus.

### Studio access

The passphrase is `creewrld.com`, compared in the browser (`src/data/studio.js`) after trimming and
folding case, and remembered in `sessionStorage` under the key `isAdmin`.

| Behaviour | Why |
| --- | --- |
| Survives a reload | `sessionStorage` outlives navigation in the same tab |
| Does **not** survive a new tab or a browser restart | `sessionStorage` is per-tab by design — closing the tab ends the studio session |
| `Logout` clears it immediately | `sessionStorage.removeItem("isAdmin")`, controls hidden, header back to `LOGIN / ADMIN` |
| Nothing written to `localStorage` | so a shared device does not keep admin around |

**What this gate is worth.** The expected passphrase is inside the JavaScript bundle, and
administration runs with the public anon key. Anyone who reads the bundle can find it. So:

- it keeps visitors out of the merchant controls, and it is genuinely enough for a shop where the
  catalogue is not a secret;
- it is **not** a security boundary. With `studio-access.sql` applied, anyone holding the anon key
  (which ships in the bundle) can also write the catalogue directly, without the passphrase at all.

If that is unacceptable, do not run `studio-access.sql`: keep the original `to authenticated`
policies from `schema.sql` and use a real Supabase Auth session (the shape this project had before
commit `d821995`). That is the only arrangement where the database itself decides who may write.

The passphrase can be changed in one place — `STUDIO_PASSPHRASE` in `src/data/studio.js` — and the
site must be redeployed for it to take effect.

### When the merchant controls do not appear

`applyAdminState()` reads `sessionStorage.isAdmin` and is the only thing that shows or hides merchant
surfaces. It runs on `DOMContentLoaded`, after the passphrase is accepted, after a logout, and after
every grid render — so the DOM cannot drift from storage. If the controls are still missing, the
browser console answers it in one line:

```js
creewrldStudio()
// { isAdmin: true, sessionFlag: "true", headerLabel: "Logout",
//   studioBarVisible: true, drawerOpen: false, cardControls: 5 }
```

| Reading | Meaning |
| --- | --- |
| `isAdmin: true`, `studioBarVisible: true`, `cardControls: > 0` | The UI is correct — if you cannot see them, you are looking at a **cached or stale deployment**. Hard-reload, and check which commit the deployment was built from. |
| `isAdmin: false` while the modal said it unlocked | `sessionStorage` is blocked (private mode, a locked-down iframe). The unlock lasts until reload; open the site in a normal tab. |
| `sessionFlag: "true"` but `isAdmin: false` | Something cleared session state after boot — reload and check again. |
| `cardControls: 0` | No products rendered, so there are no cards to attach buttons to. See the data notice on the page. |

### When a published piece does not reach the grid

A publish is only half the story — the row has to be readable afterwards. Both halves need the
policies from [`supabase/studio-access.sql`](supabase/studio-access.sql):

1. **The write is refused.** The toast reads *"Failed to publish piece to database. Ensure database
   RLS policies permit public inserts."* → that file has not been run against this project.
2. **The write lands but the grid stays empty.** The follow-up `select` is what repopulates the grid;
   if it fails you get *"Saved, but the grid couldn't refresh."* Check the read policy on `products`.
3. **Other visitors.** The merchant's own tab re-reads the catalogue immediately after a write. A
   different browser picks the piece up through Realtime (the `products` table must be in the
   `supabase_realtime` publication) or when the tab regains focus, whichever happens first.

### Data model

| Table | Purpose | Who can read | Who can write |
| --- | --- | --- | --- |
| `categories` | the four tabs (`Sneakers`, `Streetwear`, `Old Money`, `Y2K`) | everyone | signed-in merchant |
| `products` | the catalogue, with `category_id` FK and `image_url` | everyone | signed-in merchant |
| `orders` | a log of every checkout, plus the WhatsApp hand-off | signed-in merchant | anyone may **insert** |
| `product-images` (bucket) | uploaded product photography | everyone | signed-in merchant |

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
  catalog.js                starter catalogue (seed.sql) + hero lookbook
  store.js                  state + Supabase orchestration (single source of truth)
  data/                     the only modules that talk to the backend
    products.js             fetch / insert / update / delete / realtime
    studio.js               the passphrase check + the sessionStorage flag
    orders.js               order insert
    storage.js              image upload → product-images bucket
  lib/
    supabase.js             client, build-time env, timeout + error translation
    products.js             row ⇄ app-shape mapping (pure, unit-tested)
    format.js               money/esc/slug/uid helpers
    storage.js              injectable JSON localStorage wrapper (cart + zone only)
    order.js                totals, validation, WhatsApp payload (pure)
    images.js               maps stored image paths → hashed Vite URLs
  ui/
    header.js  hero.js  grid.js  cart.js  quickview.js
    order.js   admin.js layers.js reveal.js
  styles/main.css           the full design system
  assets/
    fonts/*.woff2           self-hosted Bodoni Moda, Playfair, Inter, JetBrains Mono
    img/*.jpg               product photography
supabase/
  schema.sql                tables, RLS, bucket, trigger — run this first, safe to re-run
  studio-access.sql         grants anonymous writes for the passphrase gate — read the warning
  reset.sql                 destructive reset, only for a throwaway project
  seed.sql                  the original ten pieces (fresh database only)
tests/
  unit/*.test.js            Vitest (75 assertions)
  e2e.mjs                   Puppeteer + axe-core against the production build (162 checks)
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

**Modules.** `window.CREE_SEED` and the two-script global pattern are gone. `catalog.js` exports
`SEED` (used by `supabase/seed.sql`) and `HERO_SLIDES`; `store.js` owns state; `data/` owns the
backend; `lib/` holds pure functions; `ui/` holds DOM renderers. `app.js` wires them together and
`store.subscribe()` keeps views in sync.

**Environment.** `vite.config.js` resolves the Supabase variables (see
[Configuration](#configuration)) and passes them through `define`, because a Vite bundle cannot read
`process.env` at runtime the way a Next.js bundle does.

---

## How the storefront talks to Supabase

`src/store.js` is the only module that holds state; `src/data/*` is the only code that touches the
network. Views never query the database — they render `state` and subscribe to changes.

| Flow | Call |
| --- | --- |
| Boot | `products.select("*, categories(name, slug)")` + `categories.select(...)` |
| Category tab | filtered in memory from the live catalogue, counts included |
| Studio unlock | passphrase compared in `data/studio.js` → `sessionStorage.isAdmin` |
| Session | `restoreStudio()` on boot reads that flag → `state.admin` |
| Add / edit | `products.insert()` / `products.update().eq("id", …)` |
| After a write | the drawer closes, then `refreshCatalogue()` re-reads `products` + `categories` |
| Delete | `products.delete().eq("id", …)` |
| Image upload | `storage.from("product-images").upload()` → `getPublicUrl()` → `image_url` |
| Checkout | `orders.insert([...])`, then the WhatsApp hand-off |
| Live updates | realtime `postgres_changes` on `products`, plus a refetch on tab focus |

**The merchant gate is server-side.** `state.admin` only hides UI: every write is also checked by
row level security, so a shopper who flips the flag in DevTools gets a `403` from Postgres, not an
edit. The e2e suite asserts exactly that — it forces a rejected write and confirms the piece is not
inserted and the form stays open with a readable message.

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

**Unit (Vitest, 75 assertions)** — row ⇄ app mapping (including `category_id` resolution and
category sorting), currency formatting, HTML escaping, size parsing, delivery zone fees, customer
validation, the exact WhatsApp payload, cart maths and quantity caps, cart reconciliation against a
changed catalogue, the passphrase comparison and its storage flag (including blocked storage), and a
rejected write surfacing instead of "saving".

**E2E (226 checks)** — a real Chromium session against `dist/`:

- *Build integrity*: content-hashed JS/CSS, two font preloads pointing at hashed `.woff2` files
  that return `200 font/woff2`, all three typefaces loaded via `document.fonts`, product photos
  served from hashed URLs and decoded, official brand artwork resolving from `public/`, and **no
  Add Product button in the shopper header**.
- *Live data*: the grid renders exactly what the database returns, tabs and counts come from the
  `categories` table, and no catalogue or session key is written to `localStorage`.
- *Studio access*: a wrong passphrase is refused in red without touching the network and leaves the
  shopper view intact; the correct one — typed with stray spaces and odd case — reveals the studio
  bar, writes `sessionStorage.isAdmin`, and survives a reload; `Logout` reverses all of it. A
  second tab starts locked, and no `/auth/v1/*` request is ever made.
- *Merchant writes*: insert (with the category resolved to its FK, the price as an integer and the
  sizes as an array), a `PATCH` scoped to one row, and a `DELETE` scoped to one row — each asserted
  against the row the fake backend actually stored.
- *Studio drawer*: the four database categories, a stock switch that flips between `In stock` and
  `Sold out`, and a dropzone that accepts a **dragged** file as readily as a browsed one — the drop
  previews the thumbnail before anything is uploaded. A sold-out piece keeps its place on the grid,
  marked and unorderable, and comes back on sale when the switch is flipped again.
- *Storage*: the chosen file is uploaded to `product-images` under a slug + random suffix, and the
  `image_url` saved on the row is the Supabase public URL (not a local file path).
- *Orders*: the row is inserted before WhatsApp opens, with the customer details, the money in KSh,
  the zone, and a JSON snapshot of the lines; the WhatsApp tab is claimed inside the click gesture
  and navigated afterwards, so it survives pop-up blockers.
- *Resilience*: an empty table offers the starter catalogue and seeds ten pieces; a write rejected
  by RLS keeps the form open and inserts nothing; an unreachable backend raises the data notice.
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
- *Accessibility*: axe-core — zero violations on the home page, cart drawer, order modal and login
  modal.
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

1. **Access is a convenience lock, not a security boundary.** The passphrase ships in the bundle and
   the write policies grant the anonymous role. Changing `STUDIO_PASSPHRASE` and redeploying keeps
   casual visitors out; it does not stop anyone who reads the JavaScript. If the catalogue needs real
   protection, put Supabase Auth back and restore the `to authenticated` policies.
2. **The `studio-access.sql` grants are the decision worth revisiting.** Everything else about the
   passphrase is cosmetic; that file is what actually permits writes from an anonymous browser.
3. **The anon key is public by design.** It is in the bundle. Protect data with RLS, and keep the
   `service_role` key out of this repo and out of Vercel's client-side variables.
4. **Images** are stored in the public `product-images` bucket, capped at 6 MB and four MIME types
   by both the bucket and the form. The starter pieces still point at bundled `assets/img/…`
   photography, which the build hashes — both kinds resolve side by side.
5. **Orders are leads, not payments.** Nothing is charged: the row records intent and the WhatsApp
   chat closes the sale. `status` is there for whatever the studio uses to track fulfilment.
6. **WhatsApp number** is defined once: `CONFIG.whatsapp` in `src/config.js`.
7. Prices are integers in KSh, formatted with `toLocaleString("en-KE")`.
