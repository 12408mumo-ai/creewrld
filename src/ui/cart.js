/**
 * Slide-over cart: line items, quantity steppers, the Nairobi delivery
 * selector and live totals.
 */

import { $, esc, money } from "../lib/format.js";
import { resolveImage } from "../lib/images.js";
import {
  cartLines,
  cartTotals,
  changeQty,
  getProduct,
  removeLine,
  setZone,
  state
} from "../store.js";
import { closeLayer, openLayer, toast } from "./layers.js";

const drawer = () => $("#cartDrawer");

function lineMarkup(line) {
  const product = line.product;
  return (
    '<article class="cart-item">' +
      '<img class="cart-item__img" src="' + esc(resolveImage(product.image)) + '"' +
        ' alt="' + esc(product.title) + '" loading="lazy" />' +
      '<div class="cart-item__main">' +
        '<div class="cart-item__top">' +
          '<p class="cart-item__title">' + esc(product.title) + "</p>" +
          '<span class="cart-item__price">' + money(line.lineTotal) + "</span>" +
        "</div>" +
        '<div class="cart-item__meta">' +
          "<span>Size " + esc(line.size) + "</span>" +
          "<span>" + esc(product.condition) + "</span>" +
          "<span>" + esc(product.category) + "</span>" +
        "</div>" +
        '<div class="cart-item__controls">' +
          '<div class="qty">' +
            '<button type="button" data-qty="-1" data-id="' + esc(product.id) + '"' +
              ' data-size="' + esc(line.size) + '" aria-label="Decrease quantity">−</button>' +
            "<span>" + line.qty + "</span>" +
            '<button type="button" data-qty="1" data-id="' + esc(product.id) + '"' +
              ' data-size="' + esc(line.size) + '" aria-label="Increase quantity">+</button>' +
          "</div>" +
          '<button type="button" class="cart-item__order" data-order-cart="' + esc(product.id) + '"' +
            ' data-size="' + esc(line.size) + '">Order</button>' +
          '<button type="button" class="cart-item__remove" data-remove="' + esc(product.id) + '"' +
            ' data-size="' + esc(line.size) + '" aria-label="Remove ' + esc(product.title) + '">' +
            '<svg class="ico" aria-hidden="true" style="font-size:13px"><use href="#i-close"/></svg>' +
          "</button>" +
        "</div>" +
      "</div>" +
    "</article>"
  );
}

export function bumpCartBadge() {
  const badge = $("#cartCount");
  if (!badge) return;
  badge.classList.remove("is-bumped");
  void badge.offsetWidth;
  badge.classList.add("is-bumped");
  window.setTimeout(() => badge.classList.remove("is-bumped"), 380);
}

export function renderCart() {
  const body = $("#cartBody");
  const foot = $("#cartFoot");
  if (!body || !foot) return;

  const totals = cartTotals();

  const badge = $("#cartCount");
  if (badge) badge.textContent = String(totals.count);
  const titleCount = $("#cartTitleCount");
  if (titleCount) titleCount.textContent = "(" + totals.count + ")";

  if (!totals.lines.length) {
    body.innerHTML =
      '<div class="cart-empty">' +
        '<svg class="ico" aria-hidden="true"><use href="#i-cart"/></svg>' +
        "<p>Your cart is empty</p>" +
        "<small>Add a piece, or order straight from the grid</small>" +
      "</div>";
    foot.hidden = true;
    return;
  }

  foot.hidden = false;
  body.innerHTML = totals.lines.map(lineMarkup).join("");

  $("#cartSubtotal").textContent = money(totals.subtotal);
  $("#cartDelivery").textContent = totals.fee ? money(totals.fee) : "Free";
  $("#cartTotal").textContent = money(totals.total);
  $("#cartOrderMeta").textContent = money(totals.total);

  const orderBtn = $("#cartOrderBtn");
  if (orderBtn) orderBtn.disabled = false;

  const zoneSelect = $("#cartZone");
  if (zoneSelect && zoneSelect.value !== state.zone) zoneSelect.value = state.zone;

  const note = $("#cartZoneNote");
  if (note) note.textContent = totals.zone.note;
}

export function openCart() {
  renderCart();
  openLayer(drawer(), $("[data-cart-close]"));
}

export function closeCart() {
  closeLayer(drawer());
}

export const cartLinesSnapshot = () => cartLines();

/** handlers: { onOrderCart(), onOrderLine(id, size) } */
export function bindCart(handlers) {
  const body = $("#cartBody");
  const zoneSelect = $("#cartZone");

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-cart-open]")) {
      event.preventDefault();
      openCart();
      return;
    }
    if (event.target.closest("[data-cart-close]")) {
      closeCart();
    }
  });

  const scrim = $("#scrim");
  if (scrim) scrim.addEventListener("click", closeCart);

  body.addEventListener("click", (event) => {
    const qty = event.target.closest("[data-qty]");
    if (qty) {
      changeQty(qty.dataset.id, qty.dataset.size, Number(qty.dataset.qty));
      return;
    }

    const orderLine = event.target.closest("[data-order-cart]");
    if (orderLine) {
      handlers.onOrderLine(orderLine.dataset.orderCart, orderLine.dataset.size);
      return;
    }

    const remove = event.target.closest("[data-remove]");
    if (remove) {
      const product = getProduct(remove.dataset.remove);
      removeLine(remove.dataset.remove, remove.dataset.size);
      if (product) toast("Removed — " + product.title);
    }
  });

  if (zoneSelect) {
    zoneSelect.value = state.zone;
    zoneSelect.addEventListener("change", () => {
      setZone(zoneSelect.value);
      renderCart();
    });
  }

  const orderBtn = $("#cartOrderBtn");
  if (orderBtn) orderBtn.addEventListener("click", handlers.onOrderCart);
}
