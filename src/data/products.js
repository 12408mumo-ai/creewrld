/**
 * Live catalogue queries.
 *
 * Every read and write against the `products` table goes through here, so the
 * rest of the app never builds SQL or knows about PostgREST.
 */

import { assertConfigured, describeError, REALTIME_ENABLED, supabase, withTimeout } from "../lib/supabase.js";
import { PRODUCT_SELECT, productToRow, rowsToProducts, sortCategories } from "../lib/products.js";

/** Read the full catalogue, newest first, with each piece's category joined in. */
export async function fetchCatalogue() {
  const client = assertConfigured();

  const [products, categories] = await withTimeout(Promise.all([
    client.from("products").select(PRODUCT_SELECT).order("created_at", { ascending: false }),
    client.from("categories").select("id, name, slug, sort_order").order("sort_order", { ascending: true })
  ]));

  if (products.error) throw new Error(describeError(products.error, "Couldn't load the collection."));
  if (categories.error) throw new Error(describeError(categories.error, "Couldn't load the categories."));

  return {
    products: rowsToProducts(products.data),
    categories: sortCategories(categories.data)
  };
}

/** How many rows exist — used to decide whether the starter catalogue applies. */
export async function countProducts() {
  const client = assertConfigured();
  const { count, error } = await client
    .from("products")
    .select("id", { count: "exact", head: true });

  if (error) throw new Error(describeError(error, "Couldn't count the catalogue."));
  return count || 0;
}

export async function insertProduct(product, categories) {
  const client = assertConfigured();
  const { data, error } = await client
    .from("products")
    .insert([productToRow(product, categories)])
    .select(PRODUCT_SELECT)
    .single();

  if (error) throw new Error(describeError(error, "Couldn't publish that piece."));
  return rowsToProducts([data])[0] || null;
}

export async function updateProduct(id, product, categories) {
  const client = assertConfigured();
  const { data, error } = await client
    .from("products")
    .update(productToRow(product, categories))
    .eq("id", id)
    .select(PRODUCT_SELECT)
    .single();

  if (error) throw new Error(describeError(error, "Couldn't save that piece."));
  return rowsToProducts([data])[0] || null;
}

export async function deleteProductRow(id) {
  const client = assertConfigured();
  const { error } = await client.from("products").delete().eq("id", id);
  if (error) throw new Error(describeError(error, "Couldn't delete that piece."));
  return true;
}

/**
 * Bulk insert used once, for a brand new database. Inserting in a single
 * statement keeps it atomic: either the whole starter set lands or nothing does.
 */
export async function insertProducts(products, categories) {
  const client = assertConfigured();
  const rows = products.map((product) => productToRow(product, categories));
  const { data, error } = await client.from("products").insert(rows).select(PRODUCT_SELECT);

  if (error) throw new Error(describeError(error, "Couldn't restore the starter catalogue."));
  return rowsToProducts(data);
}

/**
 * Watch the products table so a second device (or the studio laptop and the
 * owner's phone) sees new pieces without a refresh. Optional: when realtime is
 * disabled or not published for the table, this is a no-op.
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
