import { describe, expect, it } from "vitest";
import { productToRow, rowToProduct, rowsToProducts, sortCategories } from "../../src/lib/products.js";

const categories = [
  { id: "cat-sneakers", name: "Sneakers", slug: "sneakers" },
  { id: "cat-old-money", name: "Old Money", slug: "old-money" }
];

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

  it("drops unusable rows from a list", () => {
    expect(rowsToProducts([dbRow(), { title: "" }, null])).toHaveLength(1);
    expect(rowsToProducts(null)).toEqual([]);
  });
});

describe("productToRow", () => {
  it("resolves the category name to its foreign key", () => {
    const row = productToRow(
      {
        title: "Camel Overcoat",
        category: "Old Money",
        price: 12500,
        condition: "Excellent",
        sizes: ["M", "L"],
        image: "https://cdn.example.com/b.jpg",
        description: "Camel."
      },
      categories
    );
    expect(row.category_id).toBe("cat-old-money");
    expect(row.price).toBe(12500);
    expect(row.sizes).toEqual(["M", "L"]);
    expect(row.image_url).toBe("https://cdn.example.com/b.jpg");
  });

  it("rounds a price typed as a decimal", () => {
    const row = productToRow({ title: "Tee", category: "Sneakers", price: "1499.6", sizes: ["M"] }, categories);
    expect(row.price).toBe(1500);
  });

  it("leaves category_id null when the name is unknown", () => {
    const row = productToRow({ title: "Tee", category: "Archive", price: 100, sizes: ["M"] }, categories);
    expect(row.category_id).toBeNull();
  });

  it("only ever writes the known condition values", () => {
    const row = productToRow({ title: "Tee", category: "Sneakers", price: 100, condition: "Mint", sizes: ["M"] }, categories);
    expect(row.condition).toBe("Excellent");
  });

  it("round-trips through the database shape", () => {
    const row = productToRow(
      { title: "Runner", category: "Sneakers", price: 5200, condition: "Very Good", sizes: ["40"], image: "x.jpg", description: "d" },
      categories
    );
    const back = rowToProduct({ ...row, id: "abc", created_at: "2026-01-01T00:00:00Z", categories: { name: "Sneakers", slug: "sneakers" } });
    expect(back.title).toBe("Runner");
    expect(back.price).toBe(5200);
    expect(back.category).toBe("Sneakers");
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
