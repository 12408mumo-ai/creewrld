# CREE WRLD — Nairobi

A single-page, obsidian-dark storefront for **CREE WRLD**, a Nairobi-based curated thrift house.
Built as a dependency-free static site: editorial Didone typography, a hand-built Gothic **CW**
monogram with a continuous 3D Y-axis spin, a filterable catalogue, and a WhatsApp-direct order
flow with a live Nairobi delivery calculator. The store owner can add, edit and delete pieces from
the browser, persisted to `localStorage`.

---

## Run it

```bash
node server.js          # → http://localhost:4173
PORT=8080 node server.js
```

Any static file server works (`index.html` sits at the root). `server.js` is a zero-dependency
Node static server that only exists for local preview with correct MIME types.

**Merchant demo credentials:** `admin` / `creewrld`
The session persists for 12 hours in `localStorage` (`creewrld.session.v1`).

---

## What's inside

| Path | Purpose |
| --- | --- |
| `index.html` | All markup: marquee, header, hero, shop, service, footer, cart drawer, modals |
| `assets/css/styles.css` | Full design system — tokens, typography, layout, motion, responsive rules |
| `assets/js/catalog.js` | Seed catalogue (10 curated pieces) |
| `assets/js/app.js` | State, rendering, cart, WhatsApp order flow, admin tools, persistence |
| `assets/logo/creewrld-monogram.svg` | Interlocking Gothic **CW** monogram (vector, drawn from glyph outlines) |
| `assets/logo/creewrld-mark.png` | 1024 px transparent export of the mark (social / profile use) |
| `assets/logo/favicon-180.png` | Home-screen / favicon tile |
| `assets/fonts/` | Self-hosted woff2: Bodoni Moda, Playfair Display, Inter, JetBrains Mono, UnifrakturCook |
| `assets/img/` | Product photography (dark editorial set) |
| `server.js` | Local static preview server |

No build step, no framework, no network calls. Everything (fonts included) is served locally, so
the page renders identically offline.

---

## Brand system

| Token | Value |
| --- | --- |
| Background | `#050505` |
| Cards / raised | `#0f0f0f` |
| Primary text | `#ffffff` |
| Secondary text | `#919191` |
| Borders | `#1f1f1f` |

- **Display / headlines** — Bodoni Moda (variable, Didone) with Playfair Display italic for
  editorial emphasis.
- **Body / UI** — Inter.
- **Micro-labels, prices, badges** — JetBrains Mono at `0.15em–0.3em` tracking, uppercase.
- **Wordmark** — UnifrakturCook (Gothic), subset to `A–Z` for a 4 KB payload.

### The monogram

`assets/logo/creewrld-monogram.svg` is not a font render: the `C` and `W` outlines were extracted
from a blackletter source font, scaled to a shared cap height, overlapped so the `W` grows out of
the `C`'s lower bowl, and finished with a hairline rule and diamond terminals. In the header it is
sandwiched between three stacked faces (front, blurred ghost, mirrored back) inside a
`perspective` container and spun with `rotateY(360deg)` — a continuous, smooth 3D rotation.

---

## Features

**Storefront**
- Running marquee: *Based in Kenya · Free delivery within Nairobi · Nationwide shipping*.
- Fixed header that condenses on scroll; mobile drawer navigation under 1024 px.
- Editorial hero with a slow cross-fading product slideshow and index caption.
- Category tabs (All Items, Sneakers, Streetwear, Old Money, Y2K) with live counts, keyboard
  arrow support and `role="tab"` semantics.
- Responsive product grid: 2 columns on phones, 3 on tablet/desktop, 4 from 1400 px.
- Quick view with size selection, "Order", "Add to cart", and admin shortcuts.

**Order flow (WhatsApp direct)**
- Every card, quick view, cart line and cart summary uses a button labelled **Order**.
- The Order modal collects **Full Name**, **Delivery Location**, **Phone Number** (plus zone) and
  opens `https://wa.me/254719526649` with a formatted message containing:
  - item title, price in KSh, size, condition tag and absolute image link;
  - customer name, delivery location and contact phone;
  - delivery zone, fee, subtotal, total and the *Free delivery within Nairobi* note.
- Validation runs before dispatch; the success panel offers a fallback link if the tab is blocked.

**Cart drawer**
- Slide-over with quantity steppers, per-line Order buttons and removal.
- Nairobi delivery selector: `Nairobi CBD / Westlands / Kilimani / Karen — Free`,
  `Thika Road / Ruiru / Kiambu — KSh 200`, `Rest of Kenya — KSh 450`.
- Subtotal, delivery and total recalculate instantly; zone choice persists.

**Merchant tools**
- `Login / Admin` opens the studio login (`admin` / `creewrld`).
- `+ Add Product` opens the full product form (title, category, price in KSh, condition, sizes,
  image URL with live preview, description) — gated behind the login.
- While signed in, every card exposes Edit and Delete overlays, and a merchant strip offers new
  product, catalogue reset and sign out.
- Products, cart, zone and session persist in `localStorage` and sync across tabs.
- The image URL is validated (no `javascript:`/`file:` values); broken URLs fall back to a branded
  placeholder.

---

## Storage keys

| Key | Contents |
| --- | --- |
| `creewrld.products.v1` | Full product array (seeded on first visit) |
| `creewrld.cart.v1` | `[{ id, size, qty }]` |
| `creewrld.zone.v1` | Selected delivery zone id |
| `creewrld.session.v1` | `{ user, expires }` merchant session |

To restore the original ten pieces without signing in: clear those keys and reload.

---

## Production notes

This is a front-end storefront, deliberately backend-free:

1. **Admin auth is client-side.** The gate keeps shoppers out of the merchant UI, but anyone can
   read the credentials in `assets/js/app.js`. Before exposing inventory management publicly, move
   products and auth behind a real backend (e.g. Supabase, Firebase, or a small Node API) and
   server-render the catalogue for SEO.
2. **Inventory lives per-browser.** Edits are saved in `localStorage`, so they are visible on the
   device that made them. A shared backend is required for a catalogue that all customers see.
3. **Images** are local files today. Uploads should go to object storage (S3/Cloudinary) so image
   links in WhatsApp messages resolve publicly.
4. **WhatsApp number** is defined once, in `CONFIG.whatsapp` in `assets/js/app.js`.
5. Prices are integers in KSh and formatted with `toLocaleString("en-KE")`.

Accessibility: semantic landmarks, labelled controls, focus trapping and restoration in the drawer
and modals, visible focus rings, `prefers-reduced-motion` support. Verified with axe-core — zero
violations on the home page, cart drawer and login modal.
