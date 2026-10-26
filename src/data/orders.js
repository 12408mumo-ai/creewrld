/**
 * Order logging.
 *
 * A shopper's checkout is written to `orders` before the WhatsApp hand-off, so
 * the studio keeps a record even if the chat is never sent. Only INSERT is
 * granted to the browser: a row carries a customer's name and phone number, so
 * the list is read in the Supabase table editor rather than on the storefront.
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

  // No `.select()` on purpose: the browser holds no read grant on `orders`
  // (a row carries a customer's name and phone number), and asking for the
  // row back would need one. A plain insert is all the studio needs.
  const { error } = await client.from("orders").insert([payload]);

  if (error) throw new Error(describeError(error, "Couldn't log the order."));
  return true;
}
