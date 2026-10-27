/**
 * Quick view: full-bleed image, size selection, order + add-to-cart.
 */

import { $, $$, esc, money } from "../lib/format.js";
import { resolveImage } from "../lib/images.js";
import { getProduct } from "../store.js";
import { closeLayer, openLayer } from "./layers.js";

const modal = () => $("#quickView");
const body = () => $("#qvBody");

let active = { id: null, size: null };

export function openQuickView(productId) {
  const product = getProduct(productId);
  if (!product) return;

  active = { id: product.id, size: product.sizes[0] };
  renderQuickView();
  openLayer(modal(), $(".modal__close", modal()));
}

export function closeQuickView() {
  closeLayer(modal());
}

export const quickViewState = () => ({ ...active });
export const quickViewProduct = () => getProduct(active.id);

export const isQuickViewOpen = () => Boolean(modal()) && modal().classList.contains("is-open");

/** Re-paint after the catalogue changes; close if the piece is gone. */
export function refreshQuickView() {
  if (!isQuickViewOpen()) return;
  if (!getProduct(active.id)) {
    closeQuickView();
    return;
  }
  renderQuickView();
}

function renderQuickView() {
  const product = getProduct(active.id);
  if (!product) return;

  const size = active.size || product.sizes[0];
  const description =
    product.description ||
    "A one-off CREE WRLD find. Message the studio for extra photos or measurements.";

  body().innerHTML =
    '<div class="qv__media">' +
      '<img src="' + esc(resolveImage(product.image)) + '" alt="' + esc(product.title) + '" />' +
      '<span class="qv__media-badge">' + esc(product.condition) + "</span>" +
    "</div>" +
    '<div class="qv__body">' +
      '<p class="qv__cat">' + esc(product.category) + " · " + esc(product.condition) + "</p>" +
      '<h2 class="qv__title" id="qvTitle">' + esc(product.title) + "</h2>" +
      '<p class="qv__price">' + money(product.price) + "</p>" +
      '<p class="qv__desc">' + esc(description) + "</p>" +
      '<div class="qv__specs">' +
        "<span>Category <b>" + esc(product.category) + "</b></span>" +
        "<span>Condition <b>" + esc(product.condition) + "</b></span>" +
        "<span>Dispatch <b>Nairobi, 24h</b></span>" +
      "</div>" +
      '<div class="qv__sizes-wrap">' +
        '<p class="qv__sizes-head">Available sizes</p>' +
        '<div class="qv__sizes" role="group" aria-label="Available sizes">' +
          product.sizes.map((item) =>
            '<button type="button" class="size-chip' + (item === size ? " is-active" : "") + '"' +
              ' data-qv-size="' + esc(item) + '" aria-pressed="' + (item === size) + '">' +
              esc(item) + "</button>"
          ).join("") +
        "</div>" +
      "</div>" +
      '<div class="qv__foot">' +
        '<p class="qv__note">In stock · ready to dispatch from Nairobi</p>' +
        '<div class="qv__add">' +
          '<button type="button" class="btn btn--primary" data-qv-order><span>Order</span></button>' +
          '<button type="button" class="btn btn--ghost" data-qv-add>Add to cart</button>' +
        "</div>" +
      "</div>" +
    "</div>";
}

/** handlers: { onOrder(id, size), onAdd(id, size) } */
export function bindQuickView(handlers) {
  body().addEventListener("click", (event) => {
    const sizeChip = event.target.closest("[data-qv-size]");
    if (sizeChip) {
      active.size = sizeChip.dataset.qvSize;
      $$("[data-qv-size]", body()).forEach((chip) => {
        const isActive = chip.dataset.qvSize === active.size;
        chip.classList.toggle("is-active", isActive);
        chip.setAttribute("aria-pressed", String(isActive));
      });
      sizeChip.focus({ preventScroll: true });
      return;
    }

    if (event.target.closest("[data-qv-order]")) {
      handlers.onOrder(active.id, active.size);
      return;
    }

    if (event.target.closest("[data-qv-add]")) {
      handlers.onAdd(active.id, active.size);
    }
  });
}
