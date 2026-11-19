/**
 * Order logging.
 *
 * A shopper's checkout is written to `orders` before the WhatsApp hand-off, so
 * the studio keeps a record even if the chat is never sent. Only INSERT is
 * granted to the browser: a row carries a customer's name and phone number, so
 * the list is read in the Supabase table editor rather than on the storefront.
 */

import { assertConfigured, describeError, withTimeout } from "../lib/supabase.js";

const lineFor = (item) => ({
  product_id: item.product.id,
  title: item.product.title,
  size: item.size,
  qty: item.qty,
  price: item.product.price,
  line_total: item.product.price * item.qty,
  condition: item.product.condition,
  image_url: item.product.image
});

/**
 * @param {object} draft  { items: [{ product, size, qty }], customer, zone, source, idempotencyKey }
 * @param {object} totals { subtotal, fee, total, zone }
 */
export async function insertOrder(draft, totals) {
  const client = assertConfigured();

  const payload = {
    customer_name: draft.customer.name,
    customer_phone: draft.customer.phone,
    delivery_area: draft.customer.location,
    total_price: totals.total,
    zone: totals.zone.id,
    zone_label: totals.zone.label,
    zone_fee: totals.fee,
    subtotal: totals.subtotal,
    item_count: draft.items.reduce((sum, item) => sum + item.qty, 0),
    items: draft.items.map(lineFor),
    source: draft.source || "product",
    status: "new"
  };

  // Idempotency: the caller mints one key per checkout attempt. A retry after
  // a timeout, a double submit, or a network replay hits the unique index on
  // `client_request_id` instead of writing a second row. Older projects that
  // have not run the latest schema.sql have no such column — PostgREST would
  // reject an unknown column, so only send the key when the caller has one
  // and let the unique-violation path below absorb the duplicate.
  if (draft.idempotencyKey) {
    payload.client_request_id = draft.idempotencyKey;
  }

  const send = (row) =>
    withTimeout(
      client.from("orders").insert([row]),
      15000,
      "Order logging timed out — the WhatsApp chat still has your order."
    );

  // No `.select()` on purpose: the browser holds no read grant on `orders`
  // (a row carries a customer's name and phone number), and asking for the
  // row back would need one. A plain insert is all the studio needs.
  //
  // Bounded by withTimeout like the catalogue read: without it a hung request
  // leaves the checkout on "Logging order…" forever and the WhatsApp tab is
  // never navigated.
  let { error } = await send(payload);

  // Backwards compatibility: if the deployed Supabase database has not re-run
  // supabase/schema.sql yet, PostgREST rejects `client_request_id` (PGRST204 /
  // 42703). Retry once without that column so orders keep landing during rollout.
  if (
    error &&
    payload.client_request_id &&
    /client_request_id/i.test(String(error.message || error.details || ""))
  ) {
    const { client_request_id: _omitted, ...legacyPayload } = payload;
    ({ error } = await send(legacyPayload));
  }

  if (error) {
    // 23505 = unique_violation on client_request_id: this exact checkout was
    // already logged (e.g. the first attempt timed out client-side but landed
    // server-side). Treat it as success so the shopper is not asked to pay
    // twice or send a duplicate chat.
    if (error.code === "23505" || /duplicate key|unique constraint/i.test(error.message || "")) {
      return true;
    }
    throw new Error(describeError(error, "Couldn't log the order."));
  }
  return true;
}
