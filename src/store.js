/**
 * Application state: the catalogue, the cart, the delivery zone and the
 * merchant session. Every mutation persists to localStorage and notifies
 * subscribers so the UI stays a pure function of state.
 */

import { CATEGORIES, CONFIG, DEFAULT_ZONE, PRODUCT_CATEGORIES, STORAGE, ZONES } from "./config.js";
import { SEED } from "./catalog.js";
import { readJSON, readRaw, removeKey, writeJSON, writeRaw } from "./lib/storage.js";
import { normalizeSizes, sum, uid } from "./lib/format.js";
import { cartTotals as computeCartTotals } from "./lib/order.js";
import { PLACEHOLDER } from "./lib/images.js";

export const state = {
  products: [],
  cart: [],
  filter: "All Items",
  zone: DEFAULT_ZONE,
  admin: false
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

/* ------------------------------------------------------------- normalisation */

/** Coerce a stored/merchant product into a valid record (or null). */
export function normalizeProduct(raw) {
  if (!raw || typeof raw !== "object") return null;

  const title = String(raw.title || "").trim();
  const price = Math.round(Number(raw.price));
  if (!title || !Number.isFinite(price) || price <= 0) return null;

  return {
    id: String(raw.id || uid()),
    title,
    category: PRODUCT_CATEGORIES.includes(raw.category) ? raw.category : "Streetwear",
    price,
    condition: String(raw.condition || "Excellent"),
    sizes: normalizeSizes(raw.sizes),
    image: String(raw.image || "").trim() || PLACEHOLDER,
    description: String(raw.description || "").trim(),
    addedAt: Number(raw.addedAt) || Date.now()
  };
}

const seedProducts = () => SEED.map(normalizeProduct).filter(Boolean);

/** Normalise a stored list; if nothing survives, heal to the seed catalogue. */
export function normalizeProducts(list) {
  if (!Array.isArray(list)) return seedProducts();
  const normalized = list.map(normalizeProduct).filter(Boolean);
  return normalized.length ? normalized : seedProducts();
}

/* --------------------------------------------------------------- persistence */

function loadProducts() {
  return normalizeProducts(readJSON(STORAGE.products, null));
}

export function saveProducts() {
  writeJSON(STORAGE.products, state.products);
}

function loadCart() {
  const raw = readJSON(STORAGE.cart, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((line) => {
      const product = state.products.find((p) => p.id === line.id);
      if (!product) return null;
      const size = product.sizes.includes(line.size) ? line.size : product.sizes[0];
      const qty = Math.max(1, Math.min(9, Number(line.qty) || 1));
      return { id: product.id, size, qty };
    })
    .filter(Boolean);
}

export function saveCart() {
  writeJSON(STORAGE.cart, state.cart);
}

function loadZone() {
  const saved = readRaw(STORAGE.zone, null);
  return saved && ZONES[saved] ? saved : DEFAULT_ZONE;
}

export function saveZone() {
  writeRaw(STORAGE.zone, state.zone);
}

function loadSession() {
  const session = readJSON(STORAGE.session, null);
  if (!session || !session.user || !session.expires) return false;
  if (Date.now() > session.expires) {
    removeKey(STORAGE.session);
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------- selectors */

export const getProduct = (id) => state.products.find((product) => product.id === id) || null;

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
  if (!CATEGORIES.includes(category)) return;
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

/** Insert or update a product. Returns the saved record. */
export function upsertProduct(data) {
  const existing = data.id ? getProduct(data.id) : null;

  if (existing) {
    Object.assign(existing, {
      title: data.title,
      category: data.category,
      price: Math.round(Number(data.price)),
      condition: data.condition,
      sizes: normalizeSizes(data.sizes),
      image: data.image,
      description: data.description
    });
    saveProducts();
    emit("products");
    return existing;
  }

  const created = normalizeProduct({ ...data, id: data.id || uid(), addedAt: Date.now() });
  if (!created) return null;
  state.products.unshift(created);
  saveProducts();
  emit("products");
  return created;
}

export function deleteProduct(id) {
  const product = getProduct(id);
  if (!product) return null;

  state.products = state.products.filter((item) => item.id !== id);
  state.cart = state.cart.filter((line) => line.id !== id);
  saveProducts();
  saveCart();
  emit("products");
  emit("cart");
  return product;
}

export function resetCatalogue() {
  state.products = seedProducts();
  state.cart = [];
  saveProducts();
  saveCart();
  emit("products");
  emit("cart");
}

/* ------------------------------------------------------------------- session */

export function signIn(username, password) {
  const user = String(username || "").trim().toLowerCase();
  if (user !== CONFIG.credentials.username || password !== CONFIG.credentials.password) {
    return false;
  }

  state.admin = true;
  writeJSON(STORAGE.session, {
    user: CONFIG.credentials.username,
    expires: Date.now() + CONFIG.sessionHours * 3600 * 1000
  });
  emit("session");
  return true;
}

export function signOut() {
  state.admin = false;
  removeKey(STORAGE.session);
  emit("session");
}

/* ---------------------------------------------------------------------- boot */

export function initStore() {
  state.products = loadProducts();
  state.cart = loadCart();
  state.zone = loadZone();
  state.admin = loadSession();
  saveProducts();
  saveCart();
  return state;
}

/** Re-read from storage (cross-tab sync). */
export function syncFromStorage(topic) {
  if (topic === "products") {
    state.products = loadProducts();
    state.cart = loadCart();
    emit("products");
    emit("cart");
  } else if (topic === "cart") {
    state.cart = loadCart();
    emit("cart");
  } else if (topic === "session") {
    state.admin = loadSession();
    emit("session");
  }
}
