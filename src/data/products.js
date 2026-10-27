/**
 * Live catalogue queries — read-only.
 *
 * Pieces are curated by hand in the Supabase Dashboard, so the browser never
 * writes to the products table or to storage: it only reads what is on sale.
 */

import { assertConfigured, describeError, REALTIME_ENABLED, supabase, withTimeout } from "../lib/supabase.js";
import { PRODUCT_SELECT, rowsToProducts, sortCategories } from "../lib/products.js";

/**
 * Read the pieces that are on sale, newest first, with each piece's category
 * joined in. `in_stock` is the owner's on/off switch in the Dashboard: a piece
 * switched off is not fetched at all, so the grid only ever holds buyable items.
 */
export async function fetchCatalogue() {
  const client = assertConfigured();

  const [products, categories] = await withTimeout(Promise.all([
    client
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("in_stock", true)
      .order("created_at", { ascending: false }),
    client.from("categories").select("id, name, slug, sort_order").order("sort_order", { ascending: true })
  ]));

  if (products.error) throw new Error(describeError(products.error, "Couldn't load the collection."));
  if (categories.error) throw new Error(describeError(categories.error, "Couldn't load the categories."));

  return {
    products: rowsToProducts(products.data),
    categories: sortCategories(categories.data)
  };
}

/**
 * Watch the products table so a Dashboard edit reaches an open storefront
 * without a refresh. Optional: when realtime is disabled or not published for
 * the table, this is a no-op.
 */
export function subscribeToProducts(onChange) {
  const client = supabase;
  if (!client || !REALTIME_ENABLED) return () => {};

  try {
    const channel = client
      .channel("creewrld:products")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => onChange())
      .subscribe();

    return () => {
      try {
        client.removeChannel(channel);
      } catch (err) {
        /* already gone */
      }
    };
  } catch (err) {
    return () => {};
  }
}
