/**
 * Order maths, customer validation and the WhatsApp dispatch payload.
 * Pure functions only — no DOM, no storage — so they are unit-tested directly.
 */

import { CONFIG, zoneFor } from "../config.js";
import { money, sum } from "./format.js";

/** Totals for the cart drawer. `lines` are { product, size, qty }. */
export function cartTotals(lines, zoneId) {
  const zone = zoneFor(zoneId);
  const count = sum(lines, (line) => line.qty);
  const subtotal = sum(lines, (line) => line.product.price * line.qty);
  const fee = lines.length ? zone.fee : 0;
  return { lines, count, subtotal, fee, total: subtotal + fee, zone };
}

/** Totals for an order draft. `items` are { product, size, qty }. */
export function orderTotals(items, zoneId) {
  const zone = zoneFor(zoneId);
  const subtotal = sum(items, (item) => item.product.price * item.qty);
  return { subtotal, fee: zone.fee, total: subtotal + zone.fee, zone };
}

const PHONE_ERROR = "Enter a valid phone number, e.g. 0712 345 678.";

export function isValidPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return (
    (digits.length === 10 && digits.charAt(0) === "0") ||
    (digits.length === 12 && digits.indexOf("254") === 0) ||
    (digits.length === 9 && digits.charAt(0) !== "0") ||
    (digits.length >= 11 && digits.length <= 15)
  );
}

/** Returns { valid, errors } where errors is keyed by field name. */
export function validateCustomer(customer = {}) {
  const errors = {};
  if (!customer.name || String(customer.name).trim().length < 2) {
    errors.name = "Please enter your full name.";
  }
  if (!customer.location || String(customer.location).trim().length < 2) {
    errors.location = "Please add your delivery area or town.";
  }
  if (!isValidPhone(customer.phone)) {
    errors.phone = PHONE_ERROR;
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * The exact text that lands in the WhatsApp composer.
 * `toAbsolute` resolves the (possibly hashed) image path to a public URL.
 */
export function buildWhatsAppMessage({ items, customer, zoneId, toAbsolute = (src) => src }) {
  const totals = orderTotals(items, zoneId);
  const count = sum(items, (item) => item.qty);
  const lines = [];

  lines.push(`*${CONFIG.store} — NEW ORDER*`);
  lines.push("");
  lines.push(`*ITEMS (${count})*`);

  items.forEach((item, index) => {
    const { product } = item;
    lines.push(`${index + 1}. *${product.title}*`);
    lines.push(`   Price: ${money(product.price)}${item.qty > 1 ? ` × ${item.qty}` : ""}`);
    lines.push(`   Size: ${item.size}`);
    lines.push(`   Condition: ${product.condition}`);
    lines.push(`   Image: ${toAbsolute(product.image)}`);
  });

  lines.push("");
  lines.push("*CUSTOMER*");
  lines.push(`Name: ${customer.name}`);
  lines.push(`Delivery Location: ${customer.location}`);
  lines.push(`Contact Phone: ${customer.phone}`);

  lines.push("");
  lines.push("*DELIVERY*");
  lines.push(`Zone: ${totals.zone.label}`);
  lines.push(`Fee: ${totals.fee ? money(totals.fee) : "Free"}`);
  lines.push(`Subtotal: ${money(totals.subtotal)}`);
  lines.push(`Order Total: ${money(totals.total)}`);
  lines.push("");
  lines.push("Free delivery within Nairobi.");
  lines.push("Sent from the CREE WRLD storefront.");

  return lines.join("\n");
}

export function whatsappUrl(message) {
  return `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(message)}`;
}
