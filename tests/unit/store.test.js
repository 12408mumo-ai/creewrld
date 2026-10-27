import { beforeEach, describe, expect, it, vi } from "vitest";
import { rowsToProducts } from "../../src/lib/products.js";

/** In-memory localStorage stand-in. */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    key: (index) => Array.from(map.keys())[index] ?? null,
    get length() {
      return map.size;
    },
    _map: map
  };
}

let storage;

/** A catalogue row exactly as PostgREST returns it (with the category join). */
const row = (overrides = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Mocha Suede High-Top",
  category_id: "cat-sneakers",
  price: 6500,
  condition: "Excellent",
  sizes: ["41", "42"],
  image_url: "assets/img/sneaker-mocha.jpg",
  description: "Mocha suede.",
  created_at: "2026-01-05T09:00:00.000Z",
  categories: { name: "Sneakers", slug: "sneakers" },
  ...overrides
});

/**
 * Seed the in-memory store with products without touching the network: the
 * catalogue is loaded by `loadCatalogue()`, so the data layer is mocked here
 * and the store's own logic (cart, totals, filters) is exercised.
 */
async function freshStore({ products = [row()], categories = [{ id: "cat-sneakers", name: "Sneakers", slug: "sneakers", sortOrder: 1 }] } = {}) {
  vi.resetModules();

  // The storefront treats "configured" as a build-time fact; here it is on.
  vi.doMock("../../src/lib/supabase.js", () => ({
    supabaseConfig: { url: "https://unit.test.supabase.co", anonKey: "unit-anon-key", configured: true },
    supabase: null,
    REALTIME_ENABLED: false,
    CONFIG_ERROR: "Supabase is not configured",
    assertConfigured: () => ({}),
    describeError: (error, fallback) => (error && error.message) || fallback
  }));

  vi.doMock("../../src/data/products.js", () => ({
    // Mirror the real query layer: rows go through the same mapper.
    fetchCatalogue: vi.fn(async () => ({ products: rowsToProducts(products), categories })),
    subscribeToProducts: vi.fn(() => () => {})
  }));

  const store = await import("../../src/store.js");
  const storageLib = await import("../../src/lib/storage.js");
  storageLib.setStorageBackend(storage);
  store.initStore();
  await store.loadCatalogue();
  return store;
}

const product = (store) => store.state.products[0];

beforeEach(() => {
  storage = memoryStorage();   // localStorage stand-in — cart and zone only
});

describe("catalogue", () => {
  it("renders rows returned by the database", async () => {
    const store = await freshStore();
    expect(store.state.products).toHaveLength(1);
    expect(product(store).title).toBe("Mocha Suede High-Top");
    expect(product(store).category).toBe("Sneakers");
  });

  it("does not write the catalogue to localStorage", async () => {
    const store = await freshStore();
    expect(store.state.products).toHaveLength(1);
    expect(storage.getItem("creewrld.products.v1")).toBeNull();
    // Nothing merchant-shaped is ever written either.
    expect(storage.getItem("isAdmin")).toBeNull();
  });

  it("builds category tabs from the live categories", async () => {
    const store = await freshStore({
      categories: [
        { id: "1", name: "Sneakers", slug: "sneakers", sortOrder: 1 },
        { id: "2", name: "Y2K", slug: "y2k", sortOrder: 2 }
      ]
    });
    expect(store.categoryTabs()).toEqual(["All Items", "Sneakers", "Y2K"]);
  });

  it("counts pieces per tab", async () => {
    const store = await freshStore({
      products: [
        row(),
        row({ id: "2", category_id: "cat-y2k", categories: { name: "Y2K", slug: "y2k" } })
      ],
      categories: [
        { id: "cat-sneakers", name: "Sneakers", slug: "sneakers", sortOrder: 1 },
        { id: "cat-y2k", name: "Y2K", slug: "y2k", sortOrder: 2 }
      ]
    });
    expect(store.countFor("All Items")).toBe(2);
    expect(store.countFor("Sneakers")).toBe(1);
    expect(store.countFor("Y2K")).toBe(1);
  });

  it("filters the grid by the selected tab", async () => {
    const store = await freshStore({
      products: [row(), row({ id: "2", category_id: "cat-y2k", categories: { name: "Y2K", slug: "y2k" } })]
    });
    store.setFilter("Y2K");
    expect(store.visibleProducts().map((item) => item.category)).toEqual(["Y2K"]);
    store.setFilter("All Items");
    expect(store.visibleProducts()).toHaveLength(2);
  });

  it("loading is finished and no error is set", async () => {
    const store = await freshStore();
    expect(store.state.loading).toBe(false);
    expect(store.state.error).toBeNull();
  });
});

describe("cart", () => {
  it("persists the cart but nothing else", async () => {
    const store = await freshStore();
    store.addToCart(product(store).id, "41", 2);
    store.setZone("nationwide");

    expect(JSON.parse(storage.getItem("creewrld.cart.v1"))).toHaveLength(1);
    expect(storage.getItem("creewrld.zone.v1")).toBe("nationwide");
    expect(storage.getItem("creewrld.products.v1")).toBeNull();
  });

  it("totals the cart with the delivery fee", async () => {
    const store = await freshStore();
    store.setZone("nationwide");
    store.addToCart(product(store).id, "41", 2);
    const totals = store.cartTotals();
    expect(totals.subtotal).toBe(13000);
    expect(totals.fee).toBe(450);
    expect(totals.total).toBe(13450);
    expect(totals.count).toBe(2);
  });

  it("clamps a restored cart to pieces that still exist", async () => {
    storage.setItem(
      "creewrld.cart.v1",
      JSON.stringify([
        { id: "11111111-1111-4111-8111-111111111111", size: "41", qty: 2 },
        { id: "deleted-piece", size: "M", qty: 1 }
      ])
    );

    const store = await freshStore();
    expect(store.cartLines()).toHaveLength(1);
    expect(JSON.parse(storage.getItem("creewrld.cart.v1"))).toHaveLength(1);
  });

  it("repairs an obsolete size on restore", async () => {
    storage.setItem(
      "creewrld.cart.v1",
      JSON.stringify([{ id: "11111111-1111-4111-8111-111111111111", size: "99", qty: 1 }])
    );
    const store = await freshStore();
    expect(store.cartLines()[0].size).toBe("41");
  });

  it("caps quantity at nine", async () => {
    const store = await freshStore();
    store.addToCart(product(store).id, "41", 20);
    expect(store.cartCount()).toBe(9);
  });
});
