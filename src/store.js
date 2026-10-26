/**
 * Application state: the live catalogue, the cart, the delivery zone and the
 * studio lock.
 *
 * The catalogue lives in Supabase — this module is the only place that talks
 * to it. The studio lock is a passphrase check plus a sessionStorage flag, and
 * the cart and delivery zone are per-shopper scratch state. Nothing about the
 * inventory is stored on the device.
 *
 * Every mutation notifies subscribers, so the UI stays a pure render of state.
 */

import { CATEGORIES, DEFAULT_ZONE, ZONES } from "./config.js";
import { SEED } from "./catalog.js";
import { readJSON, readRaw, writeJSON, writeRaw } from "./lib/storage.js";
import { normalizeSizes, sum } from "./lib/format.js";
import { cartTotals as computeCartTotals } from "./lib/order.js";
import { supabaseConfig } from "./lib/supabase.js";
import { isStudioUnlocked, lockStudio, unlockStudio } from "./data/studio.js";
import {
  countProducts,
  deleteProductRow,
  fetchCatalogue,
  insertProduct,
  insertProducts,
  subscribeToProducts,
  updateProduct
} from "./data/products.js";

export const state = {
  products: [],
  categories: [],
  cart: [],
  filter: "All Items",
  zone: DEFAULT_ZONE,
  admin: false,
  loading: true,
  error: null,
  configured: supabaseConfig.configured
};

/* ------------------------------------------------------------------ events */

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(topic) {
  listeners.forEach((listener) => {
    try {
      listener(topic);
    } catch (err) {
      console.error("[creewrld] subscriber failed", err);
    }
  });
}

/* ------------------------------------------------------------------- cart */

function loadCart() {
  const raw = readJSON("creewrld.cart.v1", []);
  if (!Array.isArray(raw)) return [];
  // Lines are re-validated against the live catalogue once it arrives.
  return raw
    .map((line) => ({
      id: String(line && line.id ? line.id : ""),
      size: String(line && line.size ? line.size : ""),
      qty: Math.max(1, Math.min(9, Number(line && line.qty) || 1))
    }))
    .filter((line) => line.id);
}

export function saveCart() {
  writeJSON("creewrld.cart.v1", state.cart);
}

/** Drop cart lines whose piece is gone, and clamp sizes that no longer exist. */
function reconcileCart() {
  const before = state.cart.length;
  state.cart = state.cart
    .map((line) => {
      const product = state.products.find((item) => item.id === line.id);
      if (!product) return null;
      const size = product.sizes.includes(line.size) ? line.size : product.sizes[0];
      return { id: product.id, size, qty: Math.max(1, Math.min(9, line.qty)) };
    })
    .filter(Boolean);

  if (state.cart.length !== before) saveCart();
}

function loadZone() {
  const saved = readRaw("creewrld.zone.v1", null);
  return saved && ZONES[saved] ? saved : DEFAULT_ZONE;
}

export function saveZone() {
  writeRaw("creewrld.zone.v1", state.zone);
}

/* -------------------------------------------------------------- catalogue */

/**
 * Load the live catalogue. Safe to call any time: it is also the refresh used
 * after a write, when the tab regains focus, and after a failed first attempt.
 */
export async function loadCatalogue({ quiet = false } = {}) {
  if (!state.configured) {
    state.loading = false;
    state.error = "Supabase credentials are missing from this build.";
    emit("products");
    return state;
  }

  if (!quiet) {
    state.loading = true;
    emit("products");
  }

  try {
    const { products, categories } = await fetchCatalogue();
    state.products = products;
    state.categories = categories;
    state.error = null;
    reconcileCart();
  } catch (error) {
    state.error = error.message || "Couldn't load the collection.";
  } finally {
    state.loading = false;
  }

  emit("products");
  emit("cart");
  return state;
}

/** Real-time catalogue updates across devices. Returns an unsubscribe fn. */
export function watchCatalogue() {
  return subscribeToProducts(() => {
    loadCatalogue({ quiet: true });
  });
}

/* ---------------------------------------------------------------- session */

/** Read this tab's stored unlock, so a reload keeps the merchant in. */
export function restoreStudio() {
  state.admin = isStudioUnlocked();
  emit("session");
  return state.admin;
}

/**
 * Compare a typed passphrase against the studio passphrase.
 * Returns { ok } or { ok: false } — no network, no account, no session.
 */
export function unlockStudioWith(passphrase) {
  const ok = unlockStudio(passphrase);
  if (ok) {
    state.admin = true;
    emit("session");
  }
  return { ok };
}

/** Close the studio and forget the flag for this tab. */
export function lockStudioSession() {
  lockStudio();
  state.admin = false;
  emit("session");
  return { ok: true };
}

/* --------------------------------------------------------------- selectors */

export const getProduct = (id) => state.products.find((product) => product.id === id) || null;

/** Category tabs: the DB categories, plus "All Items" in front. */
export function categoryTabs() {
  const names = state.categories.map((category) => category.name);
  const extras = state.products
    .map((product) => product.category)
    .filter((name) => name && !names.includes(name));
  const ordered = [...new Set([...names, ...extras])];
  return ordered.length ? ["All Items", ...ordered] : CATEGORIES;
}

export function visibleProducts() {
  if (state.filter === "All Items") return state.products;
  return state.products.filter((product) => product.category === state.filter);
}

export function countFor(category) {
  if (category === "All Items") return state.products.length;
  return state.products.filter((product) => product.category === category).length;
}

export function cartLines() {
  return state.cart
    .map((line) => {
      const product = getProduct(line.id);
      if (!product) return null;
      return { product, size: line.size, qty: line.qty, lineTotal: product.price * line.qty };
    })
    .filter(Boolean);
}

export const cartTotals = () => computeCartTotals(cartLines(), state.zone);

export const cartCount = () => sum(state.cart, (line) => line.qty);

/* --------------------------------------------------------------------- actions */

export function setFilter(category) {
  if (!categoryTabs().includes(category)) return;
  state.filter = category;
  emit("filter");
}

export function setZone(zoneId) {
  if (!ZONES[zoneId]) return;
  state.zone = zoneId;
  saveZone();
  emit("zone");
}

export function addToCart(productId, size, qty = 1) {
  const product = getProduct(productId);
  if (!product) return false;

  const chosen = product.sizes.includes(size) ? size : product.sizes[0];
  const amount = Math.max(1, Number(qty) || 1);
  const existing = state.cart.find((line) => line.id === product.id && line.size === chosen);

  if (existing) {
    existing.qty = Math.min(9, existing.qty + amount);
  } else {
    state.cart.push({ id: product.id, size: chosen, qty: Math.min(9, amount) });
  }

  saveCart();
  emit("cart");
  return true;
}

export function changeQty(productId, size, delta) {
  const line = state.cart.find((item) => item.id === productId && item.size === size);
  if (!line) return;

  const next = line.qty + delta;
  if (next < 1) {
    state.cart = state.cart.filter((item) => !(item.id === productId && item.size === size));
  } else {
    line.qty = Math.min(9, next);
  }

  saveCart();
  emit("cart");
}

export function removeLine(productId, size) {
  state.cart = state.cart.filter((line) => !(line.id === productId && line.size === size));
  saveCart();
  emit("cart");
}

/** Remove the lines that were just ordered (cart-wide or single-line orders). */
export function clearOrderedLines(items) {
  const ordered = new Set(items.map((item) => `${item.product.id}::${item.size}`));
  state.cart = state.cart.filter((line) => !ordered.has(`${line.id}::${line.size}`));
  saveCart();
  emit("cart");
}

export function clearCart() {
  state.cart = [];
  saveCart();
  emit("cart");
}

/* ------------------------------------------------------- merchant writes */

/**
 * Insert or update a piece. `data.id` present means update.
 * Throws with a readable message on failure so the form can show it.
 */
export async function saveProduct(data) {
  const saved = data.id
    ? await updateProduct(data.id, data, state.categories)
    : await insertProduct(data, state.categories);

  if (!saved) throw new Error("The catalogue did not return the saved piece.");

  const index = state.products.findIndex((product) => product.id === saved.id);
  if (index === -1) state.products.unshift(saved);
  else state.products[index] = saved;

  emit("products");
  return saved;
}

export async function deleteProduct(id) {
  const product = getProduct(id);
  if (!product) return null;

  await deleteProductRow(id);

  state.products = state.products.filter((item) => item.id !== id);
  state.cart = state.cart.filter((line) => line.id !== id);
  saveCart();
  emit("products");
  emit("cart");
  return product;
}

/** Insert the ten starter pieces — only offered while the table is empty. */
export async function seedStarterCatalogue() {
  const existing = await countProducts();
  if (existing > 0) throw new Error("The catalogue already has pieces — nothing was inserted.");

  const created = await insertProducts(SEED, state.categories);
  state.products = created;
  emit("products");
  return created.length;
}

/* ---------------------------------------------------------------------- boot */

export function initStore() {
  state.cart = loadCart();
  state.zone = loadZone();
  return state;
}
