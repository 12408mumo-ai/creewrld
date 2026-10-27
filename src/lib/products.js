/**
 * Row → app-shape mapping for the products table.
 *
 * Pure functions, no network — so the shape the storefront renders is unit
 * tested independently of Supabase. Rows are curated in the Supabase Dashboard;
 * the browser only ever reads them, so there is no matching writer here.
 *
 * products row:
 *   id uuid, title text, category_id uuid, price integer (KSh),
 *   condition text, sizes text[], image_url text, description text,
 *   in_stock boolean (false hides the piece from the grid), created_at
 * joined as: categories: { name, slug } | null
 */

import { normalizeSizes, uid } from "./format.js";
import { PLACEHOLDER } from "./images.js";

export const CONDITIONS = ["New", "Like New", "Excellent", "Very Good", "Good"];

/** The select list every product query uses, so the join never drifts. */
export const PRODUCT_SELECT = "*, categories(name, slug)";

export function rowToProduct(row) {
  if (!row || typeof row !== "object") return null;

  const title = String(row.title || "").trim();
  const price = Math.round(Number(row.price));
  if (!title || !Number.isFinite(price) || price <= 0) return null;

  const sizes = normalizeSizes(row.sizes);
  const category = row.categories && row.categories.name ? String(row.categories.name).trim() : "";

  return {
    id: String(row.id || uid()),
    title,
    category: category || "Uncategorised",
    categoryId: row.category_id ? String(row.category_id) : null,
    price,
    condition: CONDITIONS.includes(row.condition) ? row.condition : "Excellent",
    sizes: sizes.length ? sizes : ["One size"],
    image: String(row.image_url || "").trim() || PLACEHOLDER,
    description: String(row.description || "").trim(),
    // The column is `in_stock`, the owner's on/off switch in the Dashboard.
    // The grid query already filters on it, so what renders is always in stock;
    // a missing value counts as on sale.
    inStock: (row.in_stock ?? row.is_active) !== false,
    addedAt: row.created_at ? Date.parse(row.created_at) || Date.now() : Date.now()
  };
}

export function rowsToProducts(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(rowToProduct).filter(Boolean);
}

/** Categories arrive from the DB; keep the display order stable and sane. */
export function sortCategories(categories) {
  if (!Array.isArray(categories)) return [];
  return categories
    .filter((category) => category && category.name)
    .map((category) => ({
      id: String(category.id),
      name: String(category.name).trim(),
      slug: String(category.slug || category.name).trim().toLowerCase(),
      sortOrder: Number(category.sort_order) || 0
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}
