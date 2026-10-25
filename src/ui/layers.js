/**
 * Overlay stack: the cart drawer and every modal share one layered,
 * focus-trapped, escape-dismissable system so nesting always behaves.
 */

import { $, $$, esc } from "../lib/format.js";

const stack = [];
const focusMemory = new WeakMap();
const closeHooks = new WeakMap();

const scrim = () => $("#scrim");
const toasts = () => $("#toasts");

const isCartDrawer = (layer) => layer && layer.id === "cartDrawer";

function focusables(layer) {
  return $$(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    layer
  ).filter((node) => node.getClientRects().length > 0);
}

/** Register a callback fired when a layer finishes closing. */
export function onClose(layer, callback) {
  if (layer) closeHooks.set(layer, callback);
}

export function isOpen(layer) {
  return Boolean(layer) && stack.includes(layer);
}

export function topLayer() {
  return stack[stack.length - 1] || null;
}

export function openLayer(layer, focusTarget) {
  if (!layer || stack.includes(layer)) return;

  focusMemory.set(layer, document.activeElement);
  layer.classList.add("is-open");
  layer.setAttribute("aria-hidden", "false");
  stack.push(layer);
  document.body.classList.add("no-scroll");

  if (isCartDrawer(layer)) {
    const backdrop = scrim();
    if (backdrop) {
      backdrop.hidden = false;
      requestAnimationFrame(() => backdrop.classList.add("is-open"));
    }
  }

  const target = focusTarget || layer.querySelector(".icon-btn, button, [href], input, select, textarea");
  window.setTimeout(() => {
    if (!layer.classList.contains("is-open")) return;
    if (target && typeof target.focus === "function") target.focus({ preventScroll: true });
    const panel = layer.querySelector(".modal__panel") || layer;
    if (panel && panel.scrollTop) panel.scrollTop = 0;
  }, 90);
}

export function closeLayer(layer) {
  if (!layer || !stack.includes(layer)) return;

  layer.classList.remove("is-open");
  layer.setAttribute("aria-hidden", "true");
  stack.splice(stack.indexOf(layer), 1);
  if (!stack.length) document.body.classList.remove("no-scroll");

  if (isCartDrawer(layer)) {
    const backdrop = scrim();
    if (backdrop) {
      backdrop.classList.remove("is-open");
      window.setTimeout(() => {
        if (!backdrop.classList.contains("is-open")) backdrop.hidden = true;
      }, 480);
    }
  }

  const previous = focusMemory.get(layer);
  if (previous && document.contains(previous) && typeof previous.focus === "function") {
    window.setTimeout(() => previous.focus({ preventScroll: true }), 60);
  }

  const hook = closeHooks.get(layer);
  if (typeof hook === "function") hook();
}

/** Wire global Escape + focus-trap behaviour. Call once at boot. */
export function installLayerKeyboard() {
  document.addEventListener("keydown", (event) => {
    if (!stack.length) return;
    const layer = topLayer();

    if (event.key === "Escape") {
      event.preventDefault();
      closeLayer(layer);
      return;
    }

    if (event.key !== "Tab") return;
    const nodes = focusables(layer);
    if (!nodes.length) return;

    const first = nodes[0];
    const last = nodes[nodes.length - 1];

    if (event.shiftKey && (document.activeElement === first || !layer.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

export function toast(message, kind) {
  const host = toasts();
  if (!host) return;

  const node = document.createElement("div");
  node.className = "toast" + (kind === "warn" ? " toast--warn" : "");
  node.innerHTML =
    '<svg class="ico" aria-hidden="true"><use href="#i-' + (kind === "warn" ? "arrow" : "check") + '"/></svg>' +
    "<span>" + esc(message) + "</span>";
  host.appendChild(node);

  window.setTimeout(() => {
    node.classList.add("is-out");
    window.setTimeout(() => node.remove(), 400);
  }, 3400);
}

/** Any element with data-close inside a layer dismisses it. */
export function bindDismissibles(root = document) {
  root.addEventListener("click", (event) => {
    const dismiss = event.target.closest("[data-close]");
    if (!dismiss) return;
    const layer = dismiss.closest(".modal, .drawer");
    if (layer) closeLayer(layer);
  });
}
