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

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import puppeteer from "puppeteer-core";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = Number(process.env.E2E_PORT || 4319);
const BASE = `http://127.0.0.1:${PORT}/`;

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
  const errors = { console: [], page: [], requests: [] };

  page.on("console", (message) => {
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

  await page.evaluateOnNewDocument(() => {
    window.__opened = [];
    window.open = (url) => {
      window.__opened.push(url);
      return { focus() {} };
    };
  });

  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 45000 });
  await wait(700);

  return { page, errors };
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
      monogram: Array.from(document.querySelectorAll('img[src*="logo"]')).map((n) => n.getAttribute("src"))
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
    ok("3 hashed font preloads injected", buildInfo.preloads.length === 3, buildInfo.preloads.join(", "));
    ok(
      "preload hrefs are hashed font files",
      buildInfo.preloads.every((href) => /^\.\/assets\/[\w-]+-[\w-]+\.woff2$/.test(href)),
      buildInfo.preloads.join(", ")
    );
    ok(
      "monogram resolves through the public dir",
      buildInfo.monogram.every((src) => src === "./assets/logo/creewrld-monogram.svg"),
      buildInfo.monogram[0]
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
      return ["Bodoni Moda", "Inter", "JetBrains Mono", "UnifrakturCook"].map((family) => [
        family,
        document.fonts.check('16px "' + family + '"')
      ]);
    });
    ok(
      "all four typefaces load from hashed woff2 files",
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
    ok("10 product cards render", (await count(page, ".card")) === 10, String(await count(page, ".card")));
    ok("cart badge starts at 0", (await text(page, "#cartCount")) === "0");
    ok("5 category tabs render", (await count(page, ".filter")) === 5);
    ok("hero lookbook has 4 slides", (await count(page, "#heroSlides img")) === 4);
    ok("announcement marquee carries the delivery promise", /free delivery within nairobi/i.test((await text(page, ".announce")) || ""));
    ok("spinning monogram is present", await isVisible(page, ".brand__spinner img"));
    ok("every card exposes an Order button", await page.evaluate(() => Array.from(document.querySelectorAll(".card__order")).every((b) => b.textContent.trim() === "Order")));

    /* --------------------------------------------------------------- filter */
    section("Category filtering");
    await click(page, '[data-filter="Y2K"]');
    await wait(150);
    ok("Y2K shows 2 pieces", (await count(page, ".card")) === 2, String(await count(page, ".card")));
    ok("Y2K tab is selected", (await page.evaluate(() => document.querySelector('[data-filter="Y2K"]').getAttribute("aria-selected"))) === "true");
    ok("filter count reads 10 for All Items", /10/.test((await text(page, '[data-filter="All Items"]')) || ""));
    await click(page, '[data-filter="All Items"]');
    await wait(120);
    ok("All Items restores 10 pieces", (await count(page, ".card")) === 10);

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
    ok("no WhatsApp tab opens on invalid submit", (await page.evaluate(() => window.__opened.length)) === 0);

    await fill(page, "#ofName", "Amina Otieno");
    await fill(page, "#ofLocation", "Kilimani, Nairobi");
    await fill(page, "#ofPhone", "0712 345 678");
    await submit(page, "#orderForm");
    await wait(250);

    const opened = await page.evaluate(() => window.__opened);
    ok("WhatsApp tab opened exactly once", opened.length === 1, JSON.stringify(opened));
    const waUrl = opened[0] || "";
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
    section("Merchant mode");
    ok("admin overlays are hidden for shoppers", (await page.evaluate(() => window.getComputedStyle(document.querySelector(".card__admin")).visibility)) !== "visible");

    await click(page, "#loginBtn");
    await wait(250);
    ok("login modal opens", await isVisible(page, "#loginModal"));
    await fill(page, "#lfUser", "admin");
    await fill(page, "#lfPass", "nope");
    await submit(page, "#loginForm");
    await wait(150);
    ok("wrong password is rejected", await isVisible(page, "#loginError"));

    await fill(page, "#lfUser", "admin");
    await fill(page, "#lfPass", "creewrld");
    await submit(page, "#loginForm");
    await wait(400);
    ok("merchant mode enabled", (await page.evaluate(() => document.body.classList.contains("is-admin"))) === true);
    ok("merchant strip appears", await isVisible(page, "#merchantBar"));
    ok("header reflects the session", (await text(page, "#loginBtnLabel")) === "Studio · admin");
    ok("session is persisted", (await page.evaluate(() => Boolean(localStorage.getItem("creewrld.session.v1")))) === true);
    await wait(300);
    ok("edit overlays become visible", (await page.evaluate(() => {
      const node = document.querySelector(".card__admin");
      return window.getComputedStyle(node).visibility === "visible";
    })) === true);

    await click(page, "#addProductBtn");
    await wait(300);
    ok("add-product form opens for the merchant", await isVisible(page, "#productModal"));

    await fill(page, "#pfTitle", "Selvedge Trucker");
    await page.select("#pfCategory", "Streetwear");
    await fill(page, "#pfPrice", "5400");
    await page.select("#pfCondition", "Like New");
    await fill(page, "#pfSizes", "M, L, XL");
    await fill(page, "#pfImage", "assets/img/bomber-varsity.jpg");
    await fill(page, "#pfDescription", "Indigo selvedge denim trucker with copper rivets.");
    await wait(350);
    ok("image preview renders", await isVisible(page, "#pfPreview img"));

    await submit(page, "#productForm");
    await wait(450);
    ok("publishing jumps to the new category", (await page.evaluate(() => document.querySelector('[data-filter="Streetwear"]').getAttribute("aria-selected"))) === "true");
    ok("Streetwear grid now holds 4 pieces", (await count(page, ".card")) === 4, String(await count(page, ".card")));
    ok("newest piece leads the grid", /Selvedge Trucker/.test((await text(page, ".card .card__title")) || ""));
    ok("new piece resolves a hashed image", /assets\/bomber-varsity-[\w-]+\.jpg/.test(await page.evaluate(() => document.querySelector(".card__media img").getAttribute("src"))));
    ok("catalogue persists to localStorage", (await page.evaluate(() => JSON.parse(localStorage.getItem("creewrld.products.v1")).length)) === 11);

    await click(page, '[data-filter="All Items"]');
    await wait(200);
    ok("All Items now lists 11 pieces", (await count(page, ".card")) === 11, String(await count(page, ".card")));

    await click(page, ".card [data-edit]");
    await wait(300);
    ok("edit form is pre-filled", (await page.evaluate(() => document.querySelector("#pfTitle").value)) === "Selvedge Trucker" &&
      (await page.evaluate(() => document.querySelector("#pfPrice").value)) === "5400");
    await fill(page, "#pfPrice", "3900");
    await submit(page, "#productForm");
    await wait(400);
    ok("edited price re-renders", (await text(page, ".card .card__price")) === "KSh 3,900", await text(page, ".card .card__price"));
    ok("edit keeps the original id", (await page.evaluate(() => JSON.parse(localStorage.getItem("creewrld.products.v1")).length)) === 11);

    await click(page, ".card [data-delete]");
    await wait(250);
    ok("delete asks for confirmation", await isVisible(page, "#confirmModal"));
    await click(page, "#confirmYes");
    await wait(400);
    ok("piece is removed from the grid", (await count(page, ".card")) === 10, String(await count(page, ".card")));
    ok("piece is removed from storage", (await page.evaluate(() => JSON.parse(localStorage.getItem("creewrld.products.v1")).length)) === 10);

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
    await wait(700);
    ok("cart survives a reload", (await text(page, "#cartCount")) === "1", await text(page, "#cartCount"));
    ok("delivery zone survives a reload", (await page.evaluate(() => document.querySelector("#cartZone").value)) === "nairobi-outer");
    ok("merchant session survives a reload", (await page.evaluate(() => document.body.classList.contains("is-admin"))) === true);
    ok("catalogue survives a reload", (await count(page, ".card")) === 10);

    /* ------------------------------------------------- legacy data migration */
    section("Legacy data migration (pre-Vite localStorage)");
    await page.evaluate(() => {
      localStorage.setItem(
        "creewrld.products.v1",
        JSON.stringify([
          {
            id: "cw-legacy",
            title: "Legacy Mocha High-Top",
            category: "Sneakers",
            price: 6100,
            condition: "Excellent",
            sizes: ["41", "42"],
            image: "assets/img/sneaker-mocha.jpg",
            description: "Record written by the pre-Vite storefront."
          }
        ])
      );
      localStorage.setItem("creewrld.cart.v1", JSON.stringify([{ id: "cw-legacy", size: "41", qty: 2 }]));
    });
    await page.reload({ waitUntil: "networkidle0" });
    await wait(700);

    const migrated = await page.evaluate(() => {
      const img = document.querySelector(".card__media img");
      return {
        count: document.querySelectorAll(".card").length,
        src: img?.getAttribute("src"),
        width: img?.naturalWidth,
        cart: document.querySelector("#cartCount").textContent
      };
    });
    ok("legacy records still load", migrated.count === 1, String(migrated.count));
    ok("legacy image path resolves to a hashed asset", /assets\/sneaker-mocha-[\w-]+\.jpg/.test(migrated.src || ""), migrated.src);
    ok("legacy product image decodes", migrated.width > 0, String(migrated.width));
    ok("legacy cart lines still resolve", migrated.cart === "2", migrated.cart);

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
    await page.setViewport({ width: 1440, height: 1000 });
    await page.reload({ waitUntil: "networkidle0" });
    await wait(500);
    ok("no console errors", errors.console.length === 0, errors.console.slice(0, 3).join(" | "));
    ok("no uncaught page errors", errors.page.length === 0, errors.page.slice(0, 3).join(" | "));
    ok("no failed requests or 404s", errors.requests.length === 0, errors.requests.slice(0, 5).join(" | "));

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
