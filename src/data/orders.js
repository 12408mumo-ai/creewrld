/**
 * Order logging.
 *
 * A shopper's checkout is written to `orders` before the WhatsApp hand-off, so
 * the studio keeps a record even if the chat is never sent. Insert is allowed
 * for anonymous visitors (the shopper is not signed in); reading the table is
 * restricted to the signed-in merchant by RLS.
 */

import { assertConfigured, describeError } from "../lib/supabase.js";

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
 * @param {object} draft  { items: [{ product, size, qty }], customer, zone, source }
 * @param {object} totals { subtotal, fee, total, zone }
 */
export async function insertOrder(draft, totals) {
  const client = assertConfigured();

  const payload = {
    customer_name: draft.customer.name,
    phone: draft.customer.phone,
    delivery_location: draft.customer.location,
    zone: totals.zone.id,
    zone_label: totals.zone.label,
    zone_fee: totals.fee,
    subtotal: totals.subtotal,
    total: totals.total,
    item_count: draft.items.reduce((sum, item) => sum + item.qty, 0),
    items: draft.items.map(lineFor),
    source: draft.source || "product",
    status: "new"
  };

  const { data, error } = await client.from("orders").insert([payload]).select("id, created_at").single();

  if (error) throw new Error(describeError(error, "Couldn't log the order."));
  return data;
}
