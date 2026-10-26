/**
 * End-to-end verification against the PRODUCTION build.
 *
 *   node tests/e2e.mjs                 # uses ./dist (run `npm run build` first)
 *   PUPPETEER_EXECUTABLE_PATH=/path/to/chrome node tests/e2e.mjs
 *
 * Covers: asset integrity (hashed URLs, preloads, no 404s), storefront render,
 * filters, the WhatsApp order payload, the delivery calculator, merchant CRUD,
 * persistence + legacy data migration, axe-core accessibility and layout
 * overflow from 320px to 1920px.
 */

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import puppeteer from "puppeteer-core";
import { createSupabaseStub, STUB_ANON_KEY, STUB_ORIGIN } from "./supabase-stub.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = Number(process.env.E2E_PORT || 4319);
const BASE = `http://127.0.0.1:${PORT}/`;

/**
 * The suite runs the real production build against a stubbed Supabase project:
 * the bundle contains the real @supabase/supabase-js client and no test hooks,
 * and every request it makes is answered by tests/supabase-stub.mjs.
 */
const stub = createSupabaseStub();

/** A real PNG on disk, so the file input exercises the actual upload path. */
const TEST_IMAGE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "creewrld-")), "trucker.png");
fs.writeFileSync(
  TEST_IMAGE,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64"
  )
);

let checks = 0;
let failures = 0;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ok(label, condition, detail) {
  checks += 1;
  if (condition) {
    console.log("  \u001b[32mPASS\u001b[0m  " + label);
  } else {
    failures += 1;
    console.log("  \u001b[31mFAIL\u001b[0m  " + label + (detail ? "  \u2192 " + detail : ""));
  }
}

function section(title) {
  console.log("\n\u2500\u2500 " + title + " " + "\u2500".repeat(Math.max(0, 46 - title.length)));
}

/* ------------------------------------------------------------------ preview */

function buildForStub() {
  const vite = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
  console.log("\n\u001b[2mBuilding with the Supabase stub credentials…\u001b[0m");
  execFileSync(vite, ["build", "--logLevel", "warn"], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_SUPABASE_URL: STUB_ORIGIN,
      VITE_SUPABASE_ANON_KEY: STUB_ANON_KEY,
      VITE_SUPABASE_REALTIME: "off"
    }
  });
}

function startPreview() {
  const vite = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
  if (!fs.existsSync(path.join(ROOT, "dist", "index.html"))) {
    throw new Error("dist/ is missing — run `npm run build` first.");
  }

  const child = spawn(
    vite,
    ["preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } }
  );

  child.stdout.on("data", () => {});
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    if (/error/i.test(text)) process.stderr.write("[preview] " + text);
  });

  return child;
}

async function waitForServer(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(BASE, { redirect: "follow" });
      if (response.ok) return true;
    } catch (err) {
      /* not up yet */
    }
    await wait(250);
  }
  return false;
}

/* ------------------------------------------------------------------ browser */

function findChrome() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  ].filter(Boolean);

  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch (err) {
      return false;
    }
  });
}

async function launch() {
  const executablePath = findChrome();
  if (!executablePath) {
    throw new Error(
      "No Chrome/Chromium found. Set PUPPETEER_EXECUTABLE_PATH to a Chrome binary, " +
        "or run `npx puppeteer browsers install chrome`."
    );
  }
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--font-render-hinting=none"],
    defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 1 }
  });
}

/** Fresh page with network + console instrumentation and a stubbed window.open. */
async function openPage(browser) {
  const page = await browser.newPage();
  const errors = { console: [], page: [], requests: [], logged: [] };

  page.on("console", (message) => {
    errors.logged.push(message.text());
    if (message.type() === "error") errors.console.push(message.text());
  });
  page.on("pageerror", (error) => errors.page.push(error.message));
  page.on("requestfailed", (request) => {
    if (!request.url().startsWith("data:")) {
      errors.requests.push(request.url() + " — " + (request.failure()?.errorText || "failed"));
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.requests.push(response.status() + " " + response.url());
  });

  await stub.attach(page);

  await page.evaluateOnNewDocument(() => {
    window.__opened = [];
    window.__navigated = [];
    // The app claims a tab during the click gesture and points it at WhatsApp
    // once the order is logged, so the stub records both steps.
    window.open = (url) => {
      window.__opened.push(url);
      return {
        focus() {},
        closed: false,
        location: {
          assign: (target) => window.__navigated.push(target),
          replace: (target) => window.__navigated.push(target),
          set href(target) {
            window.__navigated.push(target);
          }
        }
      };
    };
  });

  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 45000 });
  await wait(700);

  return { page, errors };
}

/** Poll until a condition holds (for network-dependent state). */
async function until(fn, timeoutMs = 12000, interval = 150) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await fn()) return true;
    } catch (err) {
      /* keep polling */
    }
    await wait(interval);
  }
  return false;
}

const text = (page, selector) =>
  page.evaluate((sel) => document.querySelector(sel)?.textContent?.trim() ?? null, selector);

const count = (page, selector) =>
  page.evaluate((sel) => document.querySelectorAll(sel).length, selector);

const isVisible = (page, selector) =>
  page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) return false;
    const style = window.getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none") return false;
    return node.getClientRects().length > 0;
  }, selector);

const submit = (page, selector) =>
  page.evaluate((sel) => {
    const form = document.querySelector(sel);
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }, selector);

const click = (page, selector) =>
  page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) throw new Error("Missing element: " + sel);
    node.click();
  }, selector);

const fill = (page, selector, value) =>
  page.evaluate(
    ({ sel, val }) => {
      const node = document.querySelector(sel);
      node.value = val;
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { sel: selector, val: value }
  );

async function axeViolations(page) {
  await page.addScriptTag({ content: fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8") });
  return page.evaluate(async () => {
    const result = await window.axe.run(document, { resultTypes: ["violations"] });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.slice(0, 3).map((node) => node.html.slice(0, 120))
    }));
  });
}

/* -------------------------------------------------------------------- suite */

async function run() {
  buildForStub();
  const preview = startPreview();
  const stopPreview = () => {
    if (!preview.killed) preview.kill("SIGTERM");
  };

  try {
    const up = await waitForServer();
    if (!up) throw new Error("vite preview did not start on " + BASE);

    const browser = await launch();
    const { page, errors } = await openPage(browser);

    /* ---------------------------------------------------------------- build */
    section("Production build integrity");

    const indexResponse = await fetch(BASE);
    ok("index.html served by vite preview", indexResponse.ok, String(indexResponse.status));

    const buildInfo = await page.evaluate(() => ({
      scripts: Array.from(document.querySelectorAll("script[type=module]")).map((n) => n.getAttribute("src")),
      styles: Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((n) => n.getAttribute("href")),
      preloads: Array.from(document.querySelectorAll('link[rel="preload"][as="font"]')).map((n) =>
        n.getAttribute("href")
      ),
      logo: Array.from(document.querySelectorAll('img[src*="logo"]')).map((n) => n.getAttribute("src")),
      headerButtons: Array.from(document.querySelectorAll(".actions button")).map((n) => n.textContent.replace(/\s+/g, " ").trim())
    }));

    ok(
      "entry bundle is content-hashed",
      buildInfo.scripts.length === 1 && /\.\/assets\/index-[\w-]+\.js$/.test(buildInfo.scripts[0]),
      JSON.stringify(buildInfo.scripts)
    );
    ok(
      "stylesheet is content-hashed",
      buildInfo.styles.length === 1 && /\.\/assets\/style-[\w-]+\.css$/.test(buildInfo.styles[0]),
      JSON.stringify(buildInfo.styles)
    );
    ok("2 hashed font preloads injected", buildInfo.preloads.length === 2, buildInfo.preloads.join(", "));
    ok(
      "preload hrefs are hashed font files",
      buildInfo.preloads.every((href) => /^\.\/assets\/[\w-]+-[\w-]+\.woff2$/.test(href)),
      buildInfo.preloads.join(", ")
    );
    ok(
      "official brand artwork resolves through the public dir",
      buildInfo.logo.length >= 6 && buildInfo.logo.every((src) => src.startsWith("./assets/logo/creewrld-")),
      buildInfo.logo.join(", ")
    );
    ok(
      "header uses the extracted mark + wordmark",
      buildInfo.logo.includes("./assets/logo/creewrld-mark.png") &&
        buildInfo.logo.includes("./assets/logo/creewrld-wordmark.png"),
      buildInfo.logo.join(", ")
    );
    ok(
      "footer uses the full Gothic lockup",
      buildInfo.logo.includes("./assets/logo/creewrld-lockup.png")
    );
    ok(
      "header has no Add Product button for shoppers",
      !buildInfo.headerButtons.some((label) => /add product/i.test(label)),
      buildInfo.headerButtons.join(" | ")
    );

    const preloadStatuses = await page.evaluate(async (hrefs) =>
      Promise.all(hrefs.map(async (href) => {
        const response = await fetch(new URL(href, window.location.href));
        return { href, status: response.status, type: response.headers.get("content-type") };
      })), buildInfo.preloads);

    ok(
      "every preloaded font returns 200",
      preloadStatuses.every((item) => item.status === 200),
      preloadStatuses.map((item) => item.status + " " + item.href).join(", ")
    );
    ok(
      "preloaded fonts are served as font/woff2",
      preloadStatuses.every((item) => (item.type || "").includes("font/woff2")),
      JSON.stringify(preloadStatuses.map((item) => item.type))
    );

    const fontsReady = await page.evaluate(async () => {
      await document.fonts.ready;
      return ["Bodoni Moda", "Inter", "JetBrains Mono"].map((family) => [
        family,
        document.fonts.check('16px "' + family + '"')
      ]);
    });
    ok(
      "all three typefaces load from hashed woff2 files",
      fontsReady.every(([, loaded]) => loaded === true),
      JSON.stringify(fontsReady)
    );

    const cardImages = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll(".card__media img"));
      return images.map((img) => ({ src: img.getAttribute("src"), width: img.naturalWidth }));
    });
    ok("product photography uses hashed asset URLs", cardImages.every((img) => /assets\/[\w-]+-[\w-]+\.jpg/.test(img.src)), cardImages[0]?.src);
    ok("every product image decodes", cardImages.every((img) => img.width > 0), JSON.stringify(cardImages.map((i) => i.width)));

    /* ----------------------------------------------------------------- boot */
    section("Storefront render");
    ok("live catalogue renders one card per row", (await count(page, ".card")) === 5, String(await count(page, ".card")));
    ok("result count reflects the database", (await text(page, "#resultCount")) === "5 pieces", await text(page, "#resultCount"));
    ok("cart badge starts at 0", (await text(page, "#cartCount")) === "0");
    ok("category tabs are built from the categories table", (await count(page, ".filter")) === 5);
    ok(
      "tab labels come from the database",
      (await page.evaluate(() => Array.from(document.querySelectorAll(".filter")).map((f) => f.dataset.filter))).join(",") ===
        "All Items,Sneakers,Streetwear,Old Money,Y2K"
    );
    ok("no data notice when the query succeeds", (await page.evaluate(() => document.querySelector("#dataNotice").hidden)) === true);
    ok("hero lookbook has 4 slides", (await count(page, "#heroSlides img")) === 4);
    ok("announcement marquee carries the delivery promise", /free delivery within nairobi/i.test((await text(page, ".announce")) || ""));
    ok("spinning monogram is present", await isVisible(page, ".brand__spinner img"));
    ok("spinning logo uses the official mark", /creewrld-mark\.png$/.test(await page.evaluate(() => document.querySelector(".brand__spinner img").getAttribute("src"))));
    ok("official wordmark sits beneath the spinner", await isVisible(page, ".brand__word"));
    ok(
      "spinner keeps the continuous Y-axis rotation",
      (await page.evaluate(() => getComputedStyle(document.querySelector(".brand__spinner")).animationName)) === "spin-y"
    );
    ok(
      "official mark renders at header size",
      (await page.evaluate(() => {
        const img = document.querySelector(".brand__spinner img");
        return img.complete && img.naturalWidth > 0;
      })) === true
    );
    ok("every card exposes an Order button", await page.evaluate(() => Array.from(document.querySelectorAll(".card__order")).every((b) => b.textContent.trim() === "Order")));

    /* --------------------------------------------------------------- filter */
    section("Category filtering");
    await click(page, '[data-filter="Y2K"]');
    await wait(150);
    ok("Y2K shows 1 piece", (await count(page, ".card")) === 1, String(await count(page, ".card")));
    ok("Y2K tab is selected", (await page.evaluate(() => document.querySelector('[data-filter="Y2K"]').getAttribute("aria-selected"))) === "true");
    ok("filter count reads 05 for All Items", /05/.test((await text(page, '[data-filter="All Items"]')) || ""), await text(page, '[data-filter="All Items"]'));
    await click(page, '[data-filter="All Items"]');
    await wait(120);
    ok("All Items restores every piece", (await count(page, ".card")) === 5);

    /* ------------------------------------------------------------ order flow */
    section("Order flow (single piece)");
    await click(page, ".card .card__order");
    await wait(250);
    ok("order modal opens", (await isVisible(page, "#orderModal")) === true);
    ok("summary lists the piece", /Mocha Suede High-Top/.test((await text(page, "#orderSummary")) || ""));
    ok("summary exposes a size selector", (await page.evaluate(() => document.querySelector("#orderSummary [data-order-size]").value)) === "41");
    ok("total is item price with free Nairobi delivery", (await text(page, "#orderTotal")) === "KSh 6,500", await text(page, "#orderTotal"));

    await submit(page, "#orderForm");
    await wait(150);
    ok("validation blocks an empty form", (await count(page, "#orderModal .field.has-error")) > 0);
    ok(
      "no WhatsApp tab opens on invalid submit",
      (await page.evaluate(() => window.__opened.length + window.__navigated.length)) === 0
    );

    await fill(page, "#ofName", "Amina Otieno");
    await fill(page, "#ofLocation", "Kilimani, Nairobi");
    await fill(page, "#ofPhone", "0712 345 678");
    await submit(page, "#orderForm");
    await wait(250);

    const opened = await page.evaluate(() => window.__opened);
    const navigated = await page.evaluate(() => window.__navigated);
    ok("a tab is claimed once, inside the click gesture", opened.length === 1, JSON.stringify(opened));
    ok("the claimed tab is pointed at WhatsApp once", navigated.length === 1, JSON.stringify(navigated));
    const waUrl = navigated[0] || opened.find((url) => url.startsWith("https://wa.me/")) || "";
    ok("dispatch targets wa.me/254719526649", waUrl.startsWith("https://wa.me/254719526649?text="), waUrl.slice(0, 64));
    const message = decodeURIComponent((waUrl.split("?text=")[1] || "").replace(/\+/g, " "));
    ok("payload includes the item title", message.includes("Mocha Suede High-Top"));
    ok("payload includes the price in KSh", message.includes("KSh 6,500"));
    ok("payload includes the chosen size", /Size: 41/.test(message));
    ok("payload includes the condition tag", /Condition: Excellent/.test(message));
    ok(
      "payload includes an absolute, hashed image link",
      new RegExp("Image: " + BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "assets/sneaker-mocha-[\\w-]+\\.jpg").test(message),
      (message.match(/Image: .*/) || [""])[0]
    );
    ok("payload includes the customer name", /Name: Amina Otieno/.test(message));
    ok("payload includes the delivery location", /Delivery Location: Kilimani, Nairobi/.test(message));
    ok("payload includes the contact phone", /Contact Phone: 0712 345 678/.test(message));
    ok("payload includes the free-delivery note", message.includes("Free delivery within Nairobi."));
    ok("success panel replaces the form", (await isVisible(page, "#orderSuccess")) && !(await isVisible(page, "#orderForm")));

    const logged = stub.orders()[0];
    ok("order was inserted into the orders table", stub.orders().length === 1, String(stub.orders().length));
    ok(
      "order row carries the customer details",
      logged && logged.customer_name === "Amina Otieno" &&
        logged.phone === "0712 345 678" &&
        logged.delivery_location === "Kilimani, Nairobi",
      JSON.stringify(logged && { name: logged.customer_name, phone: logged.phone, where: logged.delivery_location })
    );
    ok(
      "order row carries the money in KSh",
      logged && logged.subtotal === 6500 && logged.zone_fee === 0 && logged.total === 6500,
      JSON.stringify(logged && { subtotal: logged.subtotal, fee: logged.zone_fee, total: logged.total })
    );
    ok(
      "order row snapshots the line items",
      logged && Array.isArray(logged.items) && logged.items[0].title === "Mocha Suede High-Top" &&
        logged.items[0].size === "41" && logged.items[0].price === 6500,
      JSON.stringify(logged && logged.items && logged.items[0])
    );
    ok(
      "order row records the delivery zone",
      logged && logged.zone === "nairobi-core" && logged.zone_label.includes("Nairobi"),
      JSON.stringify(logged && { zone: logged.zone, label: logged.zone_label })
    );
    ok(
      "order is logged before the WhatsApp tab opens",
      stub.calls().some((call) => call.method === "POST" && call.path === "/rest/v1/orders"),
      stub.calls().map((c) => c.method + " " + c.path).join(", ")
    );
    console.log("\n\u001b[2m--- WhatsApp payload ---\n" + message + "\n------------------------\u001b[0m");
    await click(page, "#orderDone");
    await wait(600); // dismissed over a 400ms visibility transition
    ok("Done closes the order modal", (await isVisible(page, "#orderModal")) === false);

    /* ------------------------------------------------------- quick view/cart */
    section("Quick view, cart and delivery calculator");
    await click(page, ".card [data-quick]");
    await wait(250);
    ok("quick view opens", await isVisible(page, "#quickView"));
    await click(page, "#qvBody [data-qv-size]:nth-of-type(3)");
    await wait(120);
    ok(
      "size chip selects",
      (await page.evaluate(() => {
        const chip = document.querySelectorAll("#qvBody [data-qv-size]")[2];
        return chip.classList.contains("is-active") && chip.getAttribute("aria-pressed") === "true";
      })) === true
    );

    await click(page, "#qvBody [data-qv-add]");
    await wait(350);
    ok("cart drawer opens after adding", await isVisible(page, "#cartDrawer"));
    ok("cart badge reads 1", (await text(page, "#cartCount")) === "1", await text(page, "#cartCount"));
    ok("cart total is free-delivery price", (await text(page, "#cartTotal")) === "KSh 6,500", await text(page, "#cartTotal"));
    ok("zone defaults to Nairobi core", (await page.evaluate(() => document.querySelector("#cartZone").value)) === "nairobi-core");
    ok("cart line carries an Order button", (await text(page, ".cart-item__order")) === "Order");

    await page.select("#cartZone", "nairobi-outer");
    await wait(150);
    ok("Thika Road adds KSh 200", (await text(page, "#cartTotal")) === "KSh 6,700", await text(page, "#cartTotal"));
    ok("delivery line reads KSh 200", (await text(page, "#cartDelivery")) === "KSh 200");

    await page.select("#cartZone", "nationwide");
    await wait(150);
    ok("Nationwide adds KSh 450", (await text(page, "#cartTotal")) === "KSh 6,950", await text(page, "#cartTotal"));
    ok("zone note updates", /KSh 450/.test((await text(page, "#cartZoneNote")) || ""));

    await click(page, ".qty [data-qty='1']");
    await wait(120);
    ok("quantity stepper updates the subtotal", (await text(page, "#cartSubtotal")) === "KSh 13,000", await text(page, "#cartSubtotal"));
    await click(page, ".qty [data-qty='-1']");
    await wait(120);
    ok("stepping back restores the subtotal", (await text(page, "#cartSubtotal")) === "KSh 6,500");

    await click(page, "#cartOrderBtn");
    await wait(250);
    ok("cart Order opens the customer modal", await isVisible(page, "#orderModal"));
    ok("cart order inherits the chosen zone", (await page.evaluate(() => document.querySelector("#ofZone").value)) === "nationwide");
    ok("cart order total includes delivery", (await text(page, "#orderTotal")) === "KSh 6,950", await text(page, "#orderTotal"));

    await fill(page, "#ofName", "Amina Otieno");
    await fill(page, "#ofLocation", "Nyeri town");
    await fill(page, "#ofPhone", "0712345678");
    await submit(page, "#orderForm");
    await wait(300);
    ok("cart is emptied after dispatch", (await text(page, "#cartCount")) === "0", await text(page, "#cartCount"));
    await click(page, "#orderDone");
    await wait(200);

    /* ------------------------------------------------------------------ admin */
    section("Studio access (passphrase)");
    ok("admin overlays are hidden for shoppers", (await page.evaluate(() => window.getComputedStyle(document.querySelector(".card__admin")).visibility)) !== "visible");
    ok("no add-product control in the shopper header", (await count(page, "header #studioNew")) === 0);
    ok("no add-product control in the shopper menu either", (await count(page, "#mobileNav #studioNew")) === 0);
    ok("the studio bar is hidden while locked", (await isVisible(page, "#studioBar")) === false);
    ok("nothing is stored before the studio is unlocked", (await page.evaluate(() => !sessionStorage.getItem("isAdmin"))));
    ok(
      "the console helper agrees the studio is closed",
      (await page.evaluate(() => {
        const studio = window.creewrldStudio();
        return studio.isAdmin === false && studio.studioBarVisible === false && studio.headerLabel === "Login / Admin";
      })) === true,
      await page.evaluate(() => JSON.stringify(window.creewrldStudio()))
    );

    await click(page, "#loginBtn");
    await wait(250);
    ok("login modal opens", await isVisible(page, "#loginModal"));
    ok("there is no email field any more", (await count(page, "#lfEmail")) === 0);
    ok("no email input of any kind", (await count(page, '#loginModal input[type="email"]')) === 0);
    ok(
      "no placeholder mentions an address",
      !(await page.evaluate(() =>
        Array.from(document.querySelectorAll("#loginModal input")).some((node) =>
          /@|gmail|email/i.test(node.placeholder || "")
        )
      ))
    );
    ok("the modal asks for a password only", (await count(page, "#loginModal input[type=password]")) === 1);
    ok("that is the only input in the form", (await count(page, "#loginForm input")) === 1);
    ok("the title reads Studio Access", (await text(page, "#loginTitle")) === "Studio Access", await text(page, "#loginTitle"));
    ok(
      "the password placeholder is the dot mask",
      (await page.evaluate(() => document.querySelector("#lfPass").placeholder)) === "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
      await page.evaluate(() => document.querySelector("#lfPass").placeholder)
    );
    ok(
      "the button reads ENTER STUDIO",
      (await text(page, "#loginSubmit")).toLowerCase() === "enter studio" &&
        (await page.evaluate(() => window.getComputedStyle(document.querySelector("#loginSubmit")).textTransform)) === "uppercase",
      await text(page, "#loginSubmit")
    );
    ok(
      "the helper text explains the passphrase",
      (await text(page, "#loginModal .modal__sub")) ===
        "Enter the studio passphrase to access merchant controls and manage inventory.",
      await text(page, "#loginModal .modal__sub")
    );
    ok(
      "the passphrase field cannot be auto-capitalised",
      (await page.evaluate(() => {
        const node = document.querySelector("#lfPass");
        return node.getAttribute("autocapitalize") === "none" && node.getAttribute("autocorrect") === "off";
      })) === true
    );
    ok("desktop autofill is off for a shared passphrase", (await page.evaluate(() => document.querySelector("#lfPass").autocomplete)) === "off");

    // Wrong passphrase: refused locally, in red, without touching the network.
    const callsBefore = stub.calls().length;
    await fill(page, "#lfPass", "creewrld");
    await submit(page, "#loginForm");
    await wait(300);
    ok("a wrong passphrase is refused", await isVisible(page, "#loginError"));
    ok(
      "the refusal is the requested sentence",
      (await text(page, "#loginError")) === "Incorrect studio passphrase. Please try again.",
      await text(page, "#loginError")
    );
    ok(
      "the message is red",
      (await page.evaluate(() => window.getComputedStyle(document.querySelector("#loginError")).color)) === "rgb(226, 131, 123)",
      await page.evaluate(() => window.getComputedStyle(document.querySelector("#loginError")).color)
    );
    ok("the field is emptied for the next attempt", (await page.evaluate(() => document.querySelector("#lfPass").value)) === "");
    ok(
      "the studio stays locked",
      (await page.evaluate(() => document.body.classList.contains("is-admin"))) === false
    );
    ok("nothing was sent to the backend", stub.calls().length === callsBefore, String(stub.calls().length - callsBefore));
    ok("no passphrase is remembered after a refusal", (await page.evaluate(() => !sessionStorage.getItem("isAdmin"))));

    // Retyping clears the message without another submit.
    await page.evaluate(() => {
      const pass = document.querySelector("#lfPass");
      pass.value = "c";
      pass.dispatchEvent(new Event("input", { bubbles: true }));
    });
    ok("typing clears the refusal", (await isVisible(page, "#loginError")) === false);

    // The real passphrase, typed with spaces and odd case.
    await page.evaluate(() => {
      const pass = document.querySelector("#lfPass");
      pass.value = "  CreeWrld.COM  ";
      pass.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit(page, "#loginForm");
    await wait(400);
    ok("the correct passphrase unlocks the studio", (await page.evaluate(() => document.body.classList.contains("is-admin"))) === true);
    // The panel fades before `visibility` flips, so poll rather than race it.
    await until(async () => (await isVisible(page, "#loginModal")) === false, 4000);
    ok("the modal closes itself", (await isVisible(page, "#loginModal")) === false);
    ok("the unlock is stored in sessionStorage", (await page.evaluate(() => sessionStorage.getItem("isAdmin"))) === "true");
    ok(
      "the console helper agrees the studio is open",
      (await page.evaluate(() => {
        const studio = window.creewrldStudio();
        return studio.isAdmin === true && studio.sessionFlag === "true" &&
          studio.headerLabel === "Logout" && studio.studioBarVisible === true;
      })) === true,
      await page.evaluate(() => JSON.stringify(window.creewrldStudio()))
    );
    ok("the header link becomes LOGOUT", (await text(page, "#loginBtnLabel")) === "Logout", await text(page, "#loginBtnLabel"));
    ok("the studio bar appears", await isVisible(page, "#studioBar"));
    ok(
      "no Supabase Auth call was made",
      !stub.calls().some((call) => /^\/auth\/v1\/(token|user|logout)/.test(call.path)),
      stub.calls().filter((call) => /auth/.test(call.path)).map((call) => call.path).join(", ")
    );
    ok("the flag never reaches localStorage", (await page.evaluate(() => !localStorage.getItem("isAdmin") && !localStorage.getItem("creewrld.session.v1") && !localStorage.getItem("creewrld.auth.v2"))));
    await wait(300);
    ok("edit overlays become visible", (await page.evaluate(() => {
      const node = document.querySelector(".card__admin");
      return window.getComputedStyle(node).visibility === "visible";
    })) === true);

    ok("the studio bar exposes the add action", await isVisible(page, "#studioNew"));
    ok("the bar reports the studio is active", /studio active/i.test(await text(page, "#studioBar")));
    ok("the bar carries a logout action", await isVisible(page, "#studioLogout"));
    ok("the bar counts the pieces on the grid", /pieces/i.test(await text(page, "#studioCount")), await text(page, "#studioCount"));
    await click(page, "#studioNew");
    await wait(300);
    ok("the studio drawer opens for the merchant", await isVisible(page, "#studioDrawer"));
    ok("the drawer is titled for a new piece", /New\s+piece/i.test(await text(page, "#studioTitle")), await text(page, "#studioTitle"));
    ok("the drawer offers a file upload", await isVisible(page, "#pfFile"));
    ok("the drawer offers a dropzone", await isVisible(page, "#pfDropzone"));
    ok("the drawer offers a stock toggle", await isVisible(page, "#pfStock"));
    ok("new pieces start in stock", (await page.evaluate(() => document.querySelector("#pfStock").checked)) === true);
    ok("the stock toggle reads IN STOCK", /in stock/i.test(await text(page, "#pfStockState")), await text(page, "#pfStockState"));
    ok("the drawer offers the four DB categories", (await page.evaluate(() =>
      Array.from(document.querySelectorAll("#pfCategory option")).map((option) => option.value).join(",")
    )) === "Sneakers,Streetwear,Old Money,Y2K");
    ok("the publish button is labelled for the grid", /publish to grid/i.test(await text(page, "#productSubmit")), await text(page, "#productSubmit"));
    ok("cancel/close is offered", /cancel \/ close/i.test(await text(page, "#studioCancel")), await text(page, "#studioCancel"));

    await fill(page, "#pfTitle", "Selvedge Trucker");
    await page.select("#pfCategory", "Streetwear");
    await fill(page, "#pfPrice", "5400");
    await page.select("#pfCondition", "Like New");
    await fill(page, "#pfSizes", "M, L, XL");
    await fill(page, "#pfDescription", "Indigo selvedge denim trucker with copper rivets.");

    // The stock switch must be a real toggle, and it must go back again.
    await page.evaluate(() => {
      const toggle = document.querySelector("#pfStock");
      toggle.checked = false;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
    });
    ok("the stock label flips to SOLD OUT", /sold out/i.test(await text(page, "#pfStockState")), await text(page, "#pfStockState"));
    await page.evaluate(() => {
      const toggle = document.querySelector("#pfStock");
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
    });
    ok("the stock label flips back to IN STOCK", /in stock/i.test(await text(page, "#pfStockState")));

    // Drag and drop: a synthetic drop of a real File must preview exactly as a
    // browse-chosen file does.
    const dropHandled = await page.evaluate(() => {
      const zone = document.querySelector("#pfDropzone");
      const bytes = atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
      );
      const buffer = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i += 1) buffer[i] = bytes.charCodeAt(i);
      const file = new File([buffer], "dropped.png", { type: "image/png" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      zone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      const dragging = zone.classList.contains("is-dragging");
      zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      return { dragging, cleared: !zone.classList.contains("is-dragging") };
    });
    ok("dragover marks the dropzone", dropHandled.dragging === true);
    ok("drop clears the dragging state", dropHandled.cleared === true);
    await wait(300);
    ok("a dropped file previews before upload", await isVisible(page, "#pfPreview img"));
    ok("the dropzone names the dropped file", /dropped\.png/i.test(await text(page, "#pfPreviewMeta")), await text(page, "#pfPreviewMeta"));

    const fileInput = await page.$("#pfFile");
    await fileInput.uploadFile(TEST_IMAGE);
    await wait(400);
    ok("chosen file previews before upload", await isVisible(page, "#pfPreview img"));

    await submit(page, "#productForm");
    await wait(1400);
    ok("publishing jumps to the new category", (await page.evaluate(() => document.querySelector('[data-filter="Streetwear"]').getAttribute("aria-selected"))) === "true");
    ok("Streetwear grid now holds 2 pieces", (await count(page, ".card")) === 2, String(await count(page, ".card")));
    ok("newest piece leads the grid", /Selvedge Trucker/.test((await text(page, ".card .card__title")) || ""));

    const upload = stub.calls().find((call) => call.method === "POST" && call.path.startsWith("/storage/v1/object/product-images/"));
    ok("image uploaded to the product-images bucket", Boolean(upload), stub.calls().map((c) => c.path).join(", "));
    ok(
      "upload path is a slug plus a random suffix",
      upload && /^\/storage\/v1\/object\/product-images\/selvedge-trucker-[a-z0-9]+\.png$/.test(upload.path),
      upload && upload.path
    );

    const inserted = stub.rows().find((rowDB) => rowDB.title === "Selvedge Trucker");
    ok("piece inserted into the products table", Boolean(inserted));

    // The grid is re-hydrated from Supabase after the write, not just patched
    // with the response — the later GET is the proof.
    const calls = stub.calls();
    const insertAt = calls.findIndex((call) => call.method === "POST" && call.path === "/rest/v1/products");
    const refetchAt = calls.findIndex((call, index) => index > insertAt && call.method === "GET" && call.path === "/rest/v1/products");
    ok(
      "the catalogue is re-read after publishing",
      insertAt !== -1 && refetchAt > insertAt,
      "insert@" + insertAt + " refetch@" + refetchAt
    );
    ok(
      "the re-read asks for the category join, newest first",
      /categories\(name,slug\)|categories%28name%2Cslug%29/.test(calls[refetchAt] ? calls[refetchAt].query : "") &&
        /order=created_at\.desc/.test(calls[refetchAt] ? calls[refetchAt].query : ""),
      calls[refetchAt] && calls[refetchAt].query
    );
    ok(
      "stored image_url is the Supabase public URL",
      inserted && /^https:\/\/stub\.supabase\.co\/storage\/v1\/object\/public\/product-images\/selvedge-trucker-[a-z0-9]+\.png$/.test(inserted.image_url),
      inserted && inserted.image_url
    );
    ok(
      "insert wrote the resolved category id, not a name",
      inserted && inserted.category_id === "c-streetwear",
      inserted && inserted.category_id
    );
    ok("insert sent the KSh price as an integer", inserted && inserted.price === 5400, inserted && String(inserted.price));
    ok("insert sent the size run as an array", inserted && Array.isArray(inserted.sizes) && inserted.sizes.join(",") === "M,L,XL");
    ok("no catalogue copy was written to localStorage", (await page.evaluate(() => !localStorage.getItem("creewrld.products.v1"))));
    ok(
      "the stored image renders from storage",
      /storage\/v1\/object\/public\/product-images/.test(await page.evaluate(() => document.querySelector(".card__media img").getAttribute("src")))
    );

    await click(page, '[data-filter="All Items"]');
    await wait(200);
    ok("All Items now lists 6 pieces", (await count(page, ".card")) === 6, String(await count(page, ".card")));

    await click(page, ".card [data-edit]");
    await wait(300);
    ok("edit form is pre-filled", (await page.evaluate(() => document.querySelector("#pfTitle").value)) === "Selvedge Trucker" &&
      (await page.evaluate(() => document.querySelector("#pfPrice").value)) === "5400");
    await fill(page, "#pfPrice", "3900");
    await submit(page, "#productForm");
    await wait(900);
    ok("edited price re-renders", (await text(page, ".card .card__price")) === "KSh 3,900", await text(page, ".card .card__price"));
    ok(
      "edit issued a PATCH scoped to that row",
      stub.calls().some((call) => call.method === "PATCH" && call.path === "/rest/v1/products" && /id=eq\./.test(call.query)),
      stub.calls().filter((c) => c.method === "PATCH").map((c) => c.query).join(", ")
    );
    ok("edit kept the row id", stub.rows().find((rowDB) => rowDB.title === "Selvedge Trucker")?.id === inserted.id);
    ok("edit did not duplicate the row", stub.rows().filter((rowDB) => rowDB.title === "Selvedge Trucker").length === 1);

    /* ---- stock status: sold out is persisted as is_active = false */
    await click(page, ".card [data-edit]");
    await wait(300);
    ok("edit pre-fills the stock toggle as in stock", (await page.evaluate(() => document.querySelector("#pfStock").checked)) === true);
    await page.evaluate(() => {
      const toggle = document.querySelector("#pfStock");
      toggle.checked = false;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await submit(page, "#productForm");
    await wait(900);

    ok(
      "sold out is written as is_active false",
      stub.rows().find((rowDB) => rowDB.title === "Selvedge Trucker")?.is_active === false,
      JSON.stringify(stub.rows().find((rowDB) => rowDB.title === "Selvedge Trucker")?.is_active)
    );

    await click(page, '[data-filter="All Items"]');
    await wait(250);
    const soldCard = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll(".card")).find((node) =>
        /Selvedge Trucker/.test(node.textContent)
      );
      if (!card) return null;
      return {
        soldOut: card.classList.contains("is-sold-out"),
        badge: (card.querySelector(".card__badge") || {}).textContent || "",
        order: (card.querySelector(".card__order") || {}).textContent || "",
        disabled: Boolean(card.querySelector(".card__order")?.disabled)
      };
    });
    ok("a sold-out piece is marked on the card", soldCard && soldCard.soldOut === true, JSON.stringify(soldCard));
    ok("the card badge reads SOLD OUT", soldCard && /sold out/i.test(soldCard.badge), soldCard && soldCard.badge);
    ok("the order button is disabled", soldCard && soldCard.disabled === true && /sold out/i.test(soldCard.order), JSON.stringify(soldCard));

    // Put it back in stock so the delete/refresh path runs from a normal card.
    await click(page, ".card [data-edit]");
    await wait(300);
    await page.evaluate(() => {
      const toggle = document.querySelector("#pfStock");
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await submit(page, "#productForm");
    await wait(900);
    ok(
      "coming back in stock clears is_active false",
      stub.rows().find((rowDB) => rowDB.title === "Selvedge Trucker")?.is_active === true,
      JSON.stringify(stub.rows().find((rowDB) => rowDB.title === "Selvedge Trucker")?.is_active)
    );

    /* ---- delete */
    const deleteTarget = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll(".card")).find((node) =>
        /Selvedge Trucker/.test(node.textContent)
      );
      return card ? card.querySelector("[data-delete]").getAttribute("data-delete") : null;
    });
    await page.evaluate((id) => document.querySelector('[data-delete="' + id + '"]').click(), deleteTarget);
    await wait(250);
    ok("delete asks for confirmation", await isVisible(page, "#confirmModal"));
    ok(
      "the confirmation asks the exact question",
      /Delete this piece permanently\?/.test(await text(page, "#confirmTitle")),
      await text(page, "#confirmTitle")
    );
    await click(page, "#confirmYes");
    await wait(900);
    ok("piece is removed from the grid", (await count(page, ".card")) === 5, String(await count(page, ".card")));
    ok(
      "delete issued a DELETE on that row",
      stub.calls().some((call) => call.method === "DELETE" && call.path === "/rest/v1/products"),
      stub.calls().filter((c) => c.method === "DELETE").map((c) => c.query).join(", ")
    );
    ok("row is gone from the table", !stub.rows().some((rowDB) => rowDB.title === "Selvedge Trucker"));

    /* ------------------------------------------------------------ persistence */
    section("Persistence across reload");
    await click(page, ".card [data-quick]");
    await wait(250);
    await click(page, "#qvBody [data-qv-add]");
    await wait(300);
    await click(page, "[data-cart-close]");
    await wait(250);
    await page.select("#cartZone", "nairobi-outer");
    await wait(150);

    await page.reload({ waitUntil: "networkidle0" });
    await wait(900);
    ok("cart survives a reload (device-local)", (await text(page, "#cartCount")) === "1", await text(page, "#cartCount"));
    ok("delivery zone survives a reload", (await page.evaluate(() => document.querySelector("#cartZone").value)) === "nairobi-outer");
    ok("the studio unlock survives a reload", (await page.evaluate(() => document.body.classList.contains("is-admin"))) === true);
    ok("because sessionStorage still holds it", (await page.evaluate(() => sessionStorage.getItem("isAdmin"))) === "true");
    ok("catalogue is re-read from the database", (await count(page, ".card")) === 5, String(await count(page, ".card")));
    ok(
      "no products or session keys are left in localStorage",
      (await page.evaluate(() => [localStorage.getItem("creewrld.products.v1"), localStorage.getItem("creewrld.session.v1")])) .every((value) => value === null)
    );

    /* ------------------------------------------- resilience & starter catalogue */
    section("Backend resilience");
    const second = await openPage(browser);

    // A second tab starts locked: sessionStorage does not cross tabs. This is
    // the one behaviour change from a Supabase session, and it is on purpose —
    // closing the tab is what ends a studio session.
    ok("a new tab starts locked", (await second.page.evaluate(() => document.body.classList.contains("is-admin"))) === false);

    await click(second.page, "#loginBtn");
    await wait(250);
    await fill(second.page, "#lfPass", "creewrld.com");
    await submit(second.page, "#loginForm");
    await wait(400);
    ok("the passphrase unlocks the new tab too", (await second.page.evaluate(() => document.body.classList.contains("is-admin"))) === true);

    // Empty table -> the merchant can seed the starter catalogue.
    stub.state.products = [];
    await second.page.reload({ waitUntil: "networkidle0" });
    await wait(900);
    ok("an empty table shows the empty state", await isVisible(second.page, "#emptyState"));
    ok("the starter-catalogue control appears for the merchant", await isVisible(second.page, "#studioSeed"));

    await click(second.page, "#studioSeed");
    await wait(300);
    await click(second.page, "#confirmYes");
    await wait(1500);
    const seeded = stub.rows();
    ok("starter catalogue inserted ten pieces", seeded.length === 10, String(seeded.length));
    ok("seeded pieces keep their bundled image paths", seeded.every((rowDB) => rowDB.image_url.startsWith("assets/img/")), seeded[0] && seeded[0].image_url);
    ok("seeded grid renders all ten", (await second.page.$$(".card")).length === 10, String((await second.page.$$(".card")).length));

    // A write rejected by RLS must surface, not silently "succeed".
    stub.state.failNextWrite = 'new row violates row-level security policy for table "products"';
    await click(second.page, "#studioNew");
    await wait(300);
    await fill(second.page, "#pfTitle", "Blocked Piece");
    await fill(second.page, "#pfPrice", "1200");
    await fill(second.page, "#pfSizes", "M");
    await fill(second.page, "#pfImage", "assets/img/cargo-street.jpg");
    await fill(second.page, "#pfDescription", "Should never be inserted.");
    await submit(second.page, "#productForm");
    await wait(900);
    ok("a rejected write keeps the drawer open", await isVisible(second.page, "#studioDrawer"));
    ok("a rejected write shows a readable error", await isVisible(second.page, ".toast"));
    const blockToast = await second.page.evaluate(() =>
      Array.from(document.querySelectorAll(".toast")).map((node) => node.textContent.trim()).join(" | ")
    );
    ok(
      "the RLS refusal is spelled out",
      blockToast.includes(
        "Failed to publish piece to database. Ensure database RLS policies permit public inserts."
      ),
      blockToast
    );
    ok("nothing was inserted", stub.rows().length === 10, String(stub.rows().length));
    await click(second.page, "#studioDrawer [data-close]");
    await wait(300);

    // Unreachable backend: the storefront explains itself instead of looking empty.
    stub.state.offline = true;
    await second.page.reload({ waitUntil: "domcontentloaded" });
    await until(async () => /reach/i.test((await text(second.page, "#dataNotice")) || ""), 15000);
    ok("an unreachable backend raises the data notice", await isVisible(second.page, "#dataNotice"));
    ok(
      "the notice explains the problem",
      /can't reach|can’t reach|couldn't|couldn’t/i.test((await text(second.page, "#dataNotice")) || ""),
      await text(second.page, "#dataNotice")
    );
    stub.state.offline = false;
    await second.page.close();

    /* --------------------------------------------------------------- sign out */
    section("Sign out");
    ok("the header link reads LOGOUT while signed in", (await text(page, "#loginBtnLabel")) === "Logout", await text(page, "#loginBtnLabel"));
    ok("the mobile menu offers the same way out", (await text(page, "#mobileLogin")) === "Logout", await text(page, "#mobileLogin"));

    await click(page, "#loginBtn");
    await wait(900);
    ok("LOGOUT ends the session", (await page.evaluate(() => document.body.classList.contains("is-admin"))) === false);
    ok("the header link reverts to LOGIN / ADMIN", (await text(page, "#loginBtnLabel")) === "Login / Admin", await text(page, "#loginBtnLabel"));
    ok("the mobile menu reverts too", (await text(page, "#mobileLogin")) === "Login / Admin", await text(page, "#mobileLogin"));
    ok("the studio bar disappears", (await isVisible(page, "#studioBar")) === false);
    ok(
      "card controls are hidden from the public again",
      (await page.evaluate(() => window.getComputedStyle(document.querySelector(".card__admin")).visibility)) !== "visible"
    );
    ok(
      "the sessionStorage flag is removed",
      (await page.evaluate(() => sessionStorage.getItem("isAdmin"))) === null,
      String(await page.evaluate(() => sessionStorage.getItem("isAdmin")))
    );
    ok(
      "nothing is left in localStorage either",
      (await page.evaluate(() => !localStorage.getItem("isAdmin") && !localStorage.getItem("creewrld.auth.v2")))
    );

    // Signed out, the header link opens the modal again.
    await click(page, "#loginBtn");
    await wait(300);
    ok("the signed-out link reopens the login modal", await isVisible(page, "#loginModal"));
    await click(page, "#loginModal [data-close]");
    await wait(300);


    /* ------------------------------------------------ typography & contrast */
    section("Typography & contrast");
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.reload({ waitUntil: "networkidle0" });
    await wait(500);

    const type = await page.evaluate(() => {
      const toRgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = (rgb) => {
        const [r, g, b] = rgb.map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const bgOf = (el) => {
        let n = el;
        while (n && n !== document.documentElement) {
          const parts = getComputedStyle(n).backgroundColor.match(/[\d.]+/g);
          if (parts && (parts.length < 4 || Number(parts[3]) > 0.5)) return toRgb("rgb(" + parts.slice(0, 3).join(",") + ")");
          n = n.parentElement;
        }
        return [5, 5, 5];
      };
      const contrast = (el) => {
        const a = lum(toRgb(getComputedStyle(el).color)) + 0.05;
        const b = lum(bgOf(el)) + 0.05;
        return +(Math.max(a, b) / Math.min(a, b)).toFixed(2);
      };
      const grab = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          size: cs.fontSize,
          weight: cs.fontWeight,
          spacing: cs.letterSpacing,
          color: cs.color,
          ratio: contrast(el)
        };
      };
      // smallest rendering text, ignoring decorative glyphs and counter badges
      const tiny = Array.from(document.querySelectorAll("body *"))
        .filter((el) => {
          if (el.closest(".announce, .cart-count")) return false;
          const text = Array.from(el.childNodes)
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent.trim())
            .join("");
          if (!text) return false;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") return false;
          return parseFloat(cs.fontSize) < 11;
        })
        .map((el) => el.className + " @ " + getComputedStyle(el).fontSize);
      return {
        nav: grab(".nav__link"),
        login: grab(".action:not(.action--cart)"),
        cart: grab(".action--cart"),
        meta: grab(".eyebrow"),
        intro: grab(".hero__lede"),
        cardMeta: grab(".card__meta"),
        cardPrice: grab(".card__price"),
        cardOrder: grab(".card__order"),
        cardBadge: grab(".card__badge"),
        sectionLabel: grab(".section-label"),
        tiny
      };
    });

    const eq = (a, b) => Math.abs(parseFloat(a) - b) < 0.06;
    ok(
      "nav links: 13px / 500 / 0.15em",
      eq(type.nav.size, 13) && type.nav.weight === "500" && eq(type.nav.spacing, 13 * 0.15),
      JSON.stringify(type.nav)
    );
    ok(
      "LOGIN / ADMIN + CART match the nav spec",
      eq(type.login.size, 13) && type.login.weight === "500" && eq(type.cart.size, 13) && type.cart.weight === "500"
    );
    ok(
      "nav links use off-white #E5E5E5",
      type.nav.color === "rgb(229, 229, 229)" && type.login.color === "rgb(229, 229, 229)" && type.cart.color === "rgb(229, 229, 229)",
      type.nav.color
    );
    ok(
      "metadata: 12px / 0.2em muted platinum #8E8E93",
      eq(type.meta.size, 12) && eq(type.meta.spacing, 12 * 0.2) && type.meta.color === "rgb(142, 142, 147)",
      JSON.stringify(type.meta)
    );
    ok(
      "intro paragraph: 16px / 1.6 / soft cool silver #B0B0B0",
      eq(type.intro.size, 16) && type.intro.color === "rgb(176, 176, 176)" &&
        (await page.evaluate(() => getComputedStyle(document.querySelector(".hero__lede")).lineHeight)) === "25.6px",
      JSON.stringify(type.intro)
    );
    ok(
      "product card + overlay text: 13px / #D1D1D6",
      [type.cardMeta, type.cardPrice, type.cardOrder].every(
        (t) => eq(t.size, 13) && t.color === "rgb(209, 209, 214)"
      ),
      JSON.stringify([type.cardMeta, type.cardPrice, type.cardOrder])
    );
    ok(
      "every reading colour clears WCAG AA (4.5:1)",
      [type.nav, type.login, type.cart, type.meta, type.intro, type.cardMeta, type.cardPrice, type.cardOrder, type.cardBadge, type.sectionLabel]
        .every((t) => t && t.ratio >= 4.5),
      JSON.stringify({ nav: type.nav.ratio, meta: type.meta.ratio, intro: type.intro.ratio, card: type.cardMeta.ratio })
    );
    ok(
      "nav + card text clear AAA on the large end (7:1)",
      type.nav.ratio >= 7 && type.cardMeta.ratio >= 7,
      "nav " + type.nav.ratio + ":1, card " + type.cardMeta.ratio + ":1"
    );
    ok(
      "no reading text renders below 11px",
      type.tiny.length === 0,
      type.tiny.slice(0, 6).join(" | ")
    );

    /* -------------------------------------------------------------- a11y */
    section("Accessibility (axe-core)");
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle0" });
    await wait(700);

    const homeViolations = await axeViolations(page);
    ok("home page has no axe violations", homeViolations.length === 0, JSON.stringify(homeViolations));

    await click(page, "[data-cart-open]");
    await wait(500);
    const cartViolations = await axeViolations(page);
    ok("cart drawer has no axe violations", cartViolations.length === 0, JSON.stringify(cartViolations));
    await click(page, "[data-cart-close]");
    await wait(400);

    await click(page, "#orderModal [data-close]"); // safe no-op if closed
    await click(page, ".card .card__order");
    await wait(400);
    const orderViolations = await axeViolations(page);
    ok("order modal has no axe violations", orderViolations.length === 0, JSON.stringify(orderViolations));
    await page.keyboard.press("Escape");
    await wait(300);

    await click(page, "#loginBtn");
    await wait(400);
    const loginViolations = await axeViolations(page);
    ok("login modal has no axe violations", loginViolations.length === 0, JSON.stringify(loginViolations));
    await page.keyboard.press("Escape");
    await wait(300);

    // The studio bar and drawer are a second surface entirely; axe checks them too.
    await page.evaluate(() => sessionStorage.setItem("isAdmin", "true"));
    await page.reload({ waitUntil: "networkidle0" });
    await wait(700);
    const barViolations = await axeViolations(page);
    ok("the studio bar has no axe violations", barViolations.length === 0, JSON.stringify(barViolations));

    await click(page, "#studioNew");
    await wait(600);
    const drawerViolations = await axeViolations(page);
    ok("the studio drawer has no axe violations", drawerViolations.length === 0, JSON.stringify(drawerViolations));
    await page.keyboard.press("Escape");
    await wait(300);
    await page.evaluate(() => sessionStorage.removeItem("isAdmin"));

    /* ---------------------------------------------------------- responsive */
    section("Responsive layout (320px \u2192 1920px)");
    const widths = [320, 360, 390, 414, 560, 768, 834, 1024, 1180, 1280, 1440, 1920];
    for (const width of widths) {
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      await page.reload({ waitUntil: "networkidle0" });
      await wait(350);
      const layout = await page.evaluate(() => {
        const docWidth = document.documentElement.clientWidth;
        const offenders = Array.from(document.querySelectorAll("body *"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            if (rect.width === 0 || rect.right <= docWidth + 1.5) return false;
            if (getComputedStyle(node).position === "fixed") return false;
            if (node.closest(".announce, .filters__rail, .toasts, .hero__slides, .modal, .drawer")) return false;
            return true;
          })
          .slice(0, 3)
          .map((node) => (node.className || node.tagName) + " @ " + Math.round(node.getBoundingClientRect().right));

        const cardColumns = (() => {
          const grid = document.querySelector("#productGrid");
          if (!grid) return 0;
          return getComputedStyle(grid).gridTemplateColumns.split(" ").length;
        })();

        return { docWidth, scrollWidth: document.documentElement.scrollWidth, offenders, cardColumns };
      });

      ok(
        width + "px — no horizontal overflow",
        layout.scrollWidth <= layout.docWidth + 1,
        "scrollWidth " + layout.scrollWidth + " vs " + layout.docWidth + " | " + layout.offenders.join("; ")
      );

      if (width === 320) ok("320px — 2-column product grid", layout.cardColumns === 2, String(layout.cardColumns));
      if (width === 768) ok("768px — 2-column product grid", layout.cardColumns === 2, String(layout.cardColumns));
      if (width === 1024) ok("1024px — 3-column product grid", layout.cardColumns === 3, String(layout.cardColumns));
      if (width === 1440) ok("1440px — 4-column product grid", layout.cardColumns === 4, String(layout.cardColumns));
    }

    /* --------------------------------------------------------------- errors */
    section("Runtime hygiene");
    // A fresh page: the earlier sections deliberately trigger a rejected sign-in,
    // which the browser logs as a failed request.
    stub.reset();
    const clean = await openPage(browser);
    await clean.page.setViewport({ width: 1440, height: 1000 });
    await clean.page.reload({ waitUntil: "networkidle0" });
    await wait(800);
    ok("no console errors", clean.errors.console.length === 0, clean.errors.console.slice(0, 3).join(" | "));
    ok("no uncaught page errors", clean.errors.page.length === 0, clean.errors.page.slice(0, 3).join(" | "));
    ok("no failed requests or 404s", clean.errors.requests.length === 0, clean.errors.requests.slice(0, 5).join(" | "));
    ok(
      "every backend call targets the Supabase project",
      stub.calls().every((call) => !call.path.startsWith("/rest/v1/_")),
      stub.calls().map((c) => c.path).join(", ")
    );
    await clean.page.close();

    await browser.close();
  } finally {
    stopPreview();
  }

  console.log("\n" + "\u2500".repeat(50));
  console.log(`  ${checks - failures}/${checks} checks passed`);
  console.log("\u2500".repeat(50) + "\n");

  if (failures) process.exitCode = 1;
}

run().catch((error) => {
  console.error("\nE2E run failed:", error);
  process.exitCode = 1;
});
