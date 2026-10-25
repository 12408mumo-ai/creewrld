/**
 * Order modal: customer details, delivery zone, and the WhatsApp dispatch.
 */

import { ZONES, zoneFor } from "../config.js";
import { $, $$, absoluteUrl, esc, money } from "../lib/format.js";
import { resolveImage } from "../lib/images.js";
import {
  buildWhatsAppMessage,
  orderTotals,
  validateCustomer,
  whatsappUrl
} from "../lib/order.js";
import { cartLines, clearCart, clearOrderedLines, state } from "../store.js";
import { closeLayer, openLayer, toast } from "./layers.js";

const modal = () => $("#orderModal");
const form = () => $("#orderForm");
const successPanel = () => $("#orderSuccess");

let draft = null;

const draftItems = (items) =>
  items.map((item) => ({
    product: item.product,
    size: item.size || item.product.sizes[0],
    qty: item.qty || 1
  }));

/** items: [{ product, size, qty }], source: "product" | "cart" | "cart-item" */
export function openOrder(items, source = "product") {
  if (!items || !items.length) return;

  draft = { source, items: draftItems(items), zone: state.zone };

  renderSummary();
  clearErrors();

  const orderForm = form();
  orderForm.hidden = false;
  orderForm.reset();
  successPanel().hidden = true;

  const zoneSelect = $("#ofZone");
  zoneSelect.value = draft.zone;
  updateZoneHint();
  updateTotal();

  openLayer(modal(), $("#ofName"));
}

export function orderFromProduct(productId, size) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;
  openOrder([{ product, size: size || product.sizes[0], qty: 1 }], "product");
}

export function orderFromCart() {
  const lines = cartLines();
  if (!lines.length) return;
  openOrder(lines.map((line) => ({ product: line.product, size: line.size, qty: line.qty })), "cart");
}

export function orderFromCartLine(productId, size) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;
  const line = state.cart.find((item) => item.id === productId && item.size === size);
  openOrder([{ product, size, qty: line ? line.qty : 1 }], "cart-item");
}

export function closeOrder() {
  closeLayer(modal());
  draft = null;
  form().hidden = false;
  successPanel().hidden = true;
}

export const orderDraft = () => draft;

/* --------------------------------------------------------------- rendering */

function renderSummary() {
  const summary = $("#orderSummary");
  summary.innerHTML = draft.items.map((item, index) => {
    const product = item.product;
    const options = product.sizes.map((size) =>
      '<option value="' + esc(size) + '"' + (size === item.size ? " selected" : "") + ">" + esc(size) + "</option>"
    ).join("");

    return (
      '<div class="order__line">' +
        '<img src="' + esc(resolveImage(product.image)) + '" alt="' + esc(product.title) + '" />' +
        "<div>" +
          '<p class="order__line-title">' + esc(product.title) + (item.qty > 1 ? " × " + item.qty : "") + "</p>" +
          '<p class="order__line-meta">' + esc(product.condition) +
            '<span class="order__line-size">Size ' +
              '<select data-order-size="' + index + '" aria-label="Size for ' + esc(product.title) + '">' +
                options +
              "</select>" +
            "</span>" +
          "</p>" +
        "</div>" +
        '<span class="order__line-price">' + money(product.price * item.qty) + "</span>" +
      "</div>"
    );
  }).join("");
}

function updateTotal() {
  if (!draft) return;
  $("#orderTotal").textContent = money(orderTotals(draft.items, draft.zone).total);
}

function updateZoneHint() {
  $("#ofZoneHint").textContent = zoneFor($("#ofZone").value).note;
}

function clearErrors() {
  $$(".field__err", form()).forEach((node) => {
    node.hidden = true;
    node.textContent = "";
  });
  $$(".field", form()).forEach((node) => node.classList.remove("has-error"));
}

function showErrors(errors) {
  Object.entries(errors).forEach(([field, message]) => {
    const node = $('[data-err="' + field + '"]', form());
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
    const wrapper = node.closest(".field");
    if (wrapper) wrapper.classList.add("has-error");
  });
}

/* ---------------------------------------------------------------- dispatch */

function submitOrder(event) {
  event.preventDefault();
  if (!draft) return;

  const data = new FormData(form());
  const customer = {
    name: String(data.get("name") || "").trim(),
    location: String(data.get("location") || "").trim(),
    phone: String(data.get("phone") || "").trim()
  };

  draft.zone = $("#ofZone").value;
  clearErrors();

  const { valid, errors } = validateCustomer(customer);
  if (!valid) {
    showErrors(errors);
    const firstInvalid = $(".field.has-error input, .field.has-error textarea", form());
    if (firstInvalid) firstInvalid.focus();
    return;
  }

  const message = buildWhatsAppMessage({
    items: draft.items,
    customer,
    zoneId: draft.zone,
    toAbsolute: (src) => absoluteUrl(resolveImage(src))
  });
  const url = whatsappUrl(message);

  const tab = window.open(url, "_blank", "noopener");
  $("#orderWaLink").href = url;

  const orderedItems = draft.items.slice();
  if (draft.source === "cart") {
    clearCart();
  } else if (draft.source === "cart-item") {
    clearOrderedLines(orderedItems);
  }

  const totals = orderTotals(orderedItems, draft.zone);
  form().hidden = true;
  successPanel().hidden = false;
  $("#orderSuccessText").innerHTML =
    "Press <strong>send</strong> in the WhatsApp chat to confirm your order of <strong>" +
    money(totals.total) +
    "</strong>. " +
    (tab ? "The chat has opened in a new tab." : "Your browser blocked the tab — use the button below.");

  const done = $("#orderDone");
  if (done) window.setTimeout(() => done.focus({ preventScroll: true }), 80);
  if (!tab) toast("Allow pop-ups to open WhatsApp automatically", "warn");
}

export function bindOrder() {
  form().addEventListener("submit", submitOrder);

  $("#orderSummary").addEventListener("change", (event) => {
    const select = event.target.closest("[data-order-size]");
    if (!select || !draft) return;
    const item = draft.items[Number(select.dataset.orderSize)];
    if (item) item.size = select.value;
  });

  const zoneSelect = $("#ofZone");
  zoneSelect.addEventListener("change", () => {
    if (!draft) return;
    draft.zone = zoneSelect.value;
    updateZoneHint();
    updateTotal();
  });

  $("#orderDone").addEventListener("click", closeOrder);

  // Keep an open draft in sync when the cart zone changes elsewhere.
  document.addEventListener("creewrld:zone", (event) => {
    if (!draft) return;
    draft.zone = event.detail.zone;
    zoneSelect.value = draft.zone;
    updateZoneHint();
    updateTotal();
  });
}

export const ZONE_OPTIONS = Object.values(ZONES);
