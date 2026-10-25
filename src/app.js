/**
 * CREE WRLD — application bootstrap.
 * Wires the modules together; every view is a render of `state`.
 */

import { $ } from "./lib/format.js";
import { PLACEHOLDER } from "./lib/images.js";
import {
  addToCart,
  initStore,
  state,
  subscribe,
  syncFromStorage
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
}

function wireStateToViews() {
  subscribe((topic) => {
    if (topic === "products") {
      renderFilters();
      renderGrid();
      renderCart();
      refreshQuickView();
      updateTopOffset();
    }

    if (topic === "cart") renderCart();

    if (topic === "session") {
      applyAdminChrome();
      refreshQuickView();
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

  // Keep multiple tabs in sync with the same localStorage catalogue.
  window.addEventListener("storage", (event) => {
    if (!event.key) return;
    if (event.key === "creewrld.products.v1") syncFromStorage("products");
    else if (event.key === "creewrld.cart.v1") syncFromStorage("cart");
    else if (event.key === "creewrld.session.v1") syncFromStorage("session");
  });

  const year = $("#year");
  if (year) year.textContent = String(new Date().getFullYear());
}

/* ---------------------------------------------------------------------- boot */

export function boot() {
  initStore();
  wireStateToViews();

  initHeader();
  renderAll();
  initHero();
  initReveal();
  bindGlobalEvents();

  updateTopOffset();

  // Deep links to a category, e.g. /#shop with ?category=Y2K
  const params = new URLSearchParams(window.location.search);
  const category = params.get("category");
  if (category) selectCategory(category, { focus: false, scroll: true });
}

/** Exposed for the smoke tests and the browser console. */
export const app = { state, boot };
