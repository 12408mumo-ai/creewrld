import { describe, expect, it } from "vitest";
import { PRODUCT_SELECT, rowToProduct, rowsToProducts, sortCategories } from "../../src/lib/products.js";

const dbRow = (overrides = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "  Mocha Suede High-Top  ",
  category_id: "cat-sneakers",
  price: "6500",
  condition: "Excellent",
  sizes: ["41", "42"],
  image_url: "https://cdn.example.com/a.jpg",
  description: "Mocha suede.",
  created_at: "2026-01-05T09:00:00.000Z",
  categories: { name: "Sneakers", slug: "sneakers" },
  ...overrides
});

describe("rowToProduct", () => {
  it("maps a joined row into the app shape", () => {
    const product = rowToProduct(dbRow());
    expect(product).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Mocha Suede High-Top",
      category: "Sneakers",
      categoryId: "cat-sneakers",
      price: 6500,
      condition: "Excellent",
      sizes: ["41", "42"],
      image: "https://cdn.example.com/a.jpg"
    });
    expect(product.addedAt).toBe(Date.parse("2026-01-05T09:00:00.000Z"));
  });

  it("rejects rows with no title or a non-positive price", () => {
    expect(rowToProduct(dbRow({ title: "   " }))).toBeNull();
    expect(rowToProduct(dbRow({ price: 0 }))).toBeNull();
    expect(rowToProduct(dbRow({ price: "abc" }))).toBeNull();
    expect(rowToProduct(null)).toBeNull();
  });

  it("survives a piece with no category join", () => {
    const product = rowToProduct(dbRow({ categories: null, category_id: null }));
    expect(product.category).toBe("Uncategorised");
    expect(product.categoryId).toBeNull();
  });

  it("falls back to a usable size run and condition", () => {
    const product = rowToProduct(dbRow({ sizes: [], condition: "Mint" }));
    expect(product.sizes).toEqual(["One size"]);
    expect(product.condition).toBe("Excellent");
  });

  it("reads the stock column, defaulting old rows to in stock", () => {
    expect(rowToProduct(dbRow({ in_stock: true })).inStock).toBe(true);
    expect(rowToProduct(dbRow({ in_stock: false })).inStock).toBe(false);
    // A row written before the column existed has no value at all.
    expect(rowToProduct(dbRow({ in_stock: undefined })).inStock).toBe(true);
    // …and a database still carrying the old `is_active` column keeps working.
    expect(rowToProduct(dbRow({ is_active: false })).inStock).toBe(false);
  });

  it("drops unusable rows from a list", () => {
    expect(rowsToProducts([dbRow(), { title: "" }, null])).toHaveLength(1);
    expect(rowsToProducts(null)).toEqual([]);
  });
});

describe("sortCategories", () => {
  it("orders by sort_order and keeps the display names", () => {
    const sorted = sortCategories([
      { id: "2", name: "Y2K", slug: "y2k", sort_order: 2 },
      { id: "1", name: "Sneakers", slug: "sneakers", sort_order: 1 }
    ]);
    expect(sorted.map((c) => c.name)).toEqual(["Sneakers", "Y2K"]);
  });

  it("ignores empty rows", () => {
    expect(sortCategories([{ id: "1" }, null])).toEqual([]);
    expect(sortCategories(undefined)).toEqual([]);
  });
});

describe("the grid query", () => {
  it("asks for the joined category in one select", () => {
    expect(PRODUCT_SELECT).toBe("*, categories(name, slug)");
  });
});
