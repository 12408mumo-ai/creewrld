/**
 * CREE WRLD — application bootstrap.
 * Wires the modules together; every view is a render of `state`.
 * The catalogue and the merchant session come from Supabase (see store.js).
 */

import { $ } from "./lib/format.js";
import { PLACEHOLDER } from "./lib/images.js";
import { CONFIG_ERROR } from "./lib/supabase.js";
import {
  addToCart,
  initStore,
  loadCatalogue,
  startSession,
  state,
  subscribe,
  watchCatalogue
} from "./store.js";
import {
  applyAdminChrome,
  bindAdmin,
  confirmDelete,
  openProductForm,
  requireAdmin
} from "./ui/admin.js";
import { bindCart, bumpCartBadge, closeCart, openCart, renderCart } from "./ui/cart.js";
import { bindGrid, renderFilters, renderGrid, selectCategory } from "./ui/grid.js";
import { initHeader, updateTopOffset } from "./ui/header.js";
import { initHero } from "./ui/hero.js";
import { bindDismissibles, installLayerKeyboard, toast } from "./ui/layers.js";
import { bindOrder, orderFromCart, orderFromCartLine, orderFromProduct } from "./ui/order.js";
import {
  bindQuickView,
  closeQuickView,
  openQuickView,
  refreshQuickView
} from "./ui/quickview.js";
import { initReveal } from "./ui/reveal.js";

/* ---------------------------------------------------------------- rendering */

function renderAll() {
  renderFilters();
  renderGrid();
  renderCart();
  applyAdminChrome();
  updateTopOffset();
  renderStatus();
}

/**
 * One line of honest status under the filters: configuration problems and
 * connection failures are told to the shopper instead of an empty grid that
 * looks like the shop has nothing to sell.
 */
function renderStatus() {
  const notice = $("#dataNotice");
  if (!notice) return;

  let message = "";
  let kind = "";

  if (!state.configured) {
    message = CONFIG_ERROR;
    kind = "warn";
  } else if (state.error) {
    message = state.error;
    kind = "warn";
  } else if (state.loading && !state.products.length) {
    message = "Loading the collection…";
    kind = "info";
  }

  notice.textContent = message;
  notice.dataset.kind = kind;
  notice.hidden = !message;

  const grid = $("#productGrid");
  if (grid) grid.setAttribute("aria-busy", String(state.loading));
}

function wireStateToViews() {
  subscribe((topic) => {
    if (topic === "products") {
      renderFilters();
      renderGrid();
      renderCart();
      refreshQuickView();
      applyAdminChrome();
      renderStatus();
      updateTopOffset();
    }

    if (topic === "cart") renderCart();

    if (topic === "session") {
      applyAdminChrome();
      refreshQuickView();
      renderStatus();
      updateTopOffset();
    }

    if (topic === "zone") {
      renderCart();
      document.dispatchEvent(new CustomEvent("creewrld:zone", { detail: { zone: state.zone } }));
    }
  });
}

/* -------------------------------------------------------------------- events */

function bindGlobalEvents() {
  // Order straight from a cart line: retire it only after dispatch.
  bindCart({
    onOrderCart: () => {
      closeCart();
      orderFromCart();
    },
    onOrderLine: (id, size) => {
      closeCart();
      orderFromCartLine(id, size);
    }
  });

  bindGrid({
    onOrder: (id) => orderFromProduct(id),
    onQuick: (id) => openQuickView(id),
    onEdit: (product) => requireAdmin(() => openProductForm(product)),
    onDelete: (product) => requireAdmin(() => confirmDelete(product))
  });

  bindQuickView({
    onOrder: (id, size) => orderFromProduct(id, size),
    onAdd: (id, size) => {
      if (!addToCart(id, size, 1)) return;
      bumpCartBadge();
      closeQuickView();
      openCart();
      toast("Added to cart");
    },
    onEdit: (product) => {
      closeQuickView();
      openProductForm(product);
    },
    onDelete: (product) => {
      closeQuickView();
      confirmDelete(product);
    }
  });

  bindOrder();
  bindAdmin();
  bindDismissibles();
  installLayerKeyboard();

  // Broken image URLs fall back to the branded placeholder.
  document.addEventListener(
    "error",
    (event) => {
      const img = event.target;
      if (img && img.tagName === "IMG" && !img.dataset.failed && img.src !== PLACEHOLDER) {
        img.dataset.failed = "1";
        img.src = PLACEHOLDER;
      }
    },
    true
  );

  // The cart is the only device-local state, so it is the only thing that can
  // change in another tab without the database telling us.
  window.addEventListener("storage", (event) => {
    if (event.key === "creewrld.cart.v1") {
      initStore();
      renderCart();
      renderStatus();
    }
  });

  // Coming back to the tab re-reads the catalogue: cheap, and it covers
  // browsers where realtime is blocked or the table isn't published.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.configured) {
      loadCatalogue({ quiet: true });
    }
  });

  const year = $("#year");
  if (year) year.textContent = String(new Date().getFullYear());
}

/* ---------------------------------------------------------------------- boot */

export async function boot() {
  initStore();
  wireStateToViews();

  initHeader();
  renderAll();
  initHero();
  initReveal();
  bindGlobalEvents();

  updateTopOffset();

  // Deep links to a category, e.g. /?category=Y2K
  const params = new URLSearchParams(window.location.search);
  const category = params.get("category");
  if (category) selectCategory(category, { focus: false, scroll: true });

  // Live data. Both calls resolve independently: a signed-out shopper still
  // gets the catalogue even if auth is slow, and vice versa.
  await Promise.all([loadCatalogue(), startSession()]);

  watchCatalogue();

  return state;
}

/** Exposed for the smoke tests and the browser console. */
export const app = { state, boot, loadCatalogue };
