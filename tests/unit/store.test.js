import { beforeEach, describe, expect, it, vi } from "vitest";

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

async function freshStore() {
  vi.resetModules();
  const store = await import("../../src/store.js");
  const storageLib = await import("../../src/lib/storage.js");
  storageLib.setStorageBackend(storage);
  store.initStore();
  return store;
}

beforeEach(() => {
  storage = memoryStorage();
});

describe("catalogue loading", () => {
  it("seeds ten pieces on a first visit", async () => {
    const store = await freshStore();
    expect(store.state.products).toHaveLength(10);
    expect(storage.getItem("creewrld.products.v1")).toBeTruthy();
  });

  it("keeps the legacy localStorage keys", async () => {
    const store = await freshStore();
    store.addToCart("cw-001", "41", 1);
    store.setZone("nationwide");
    store.signIn("admin", "creewrld");

    expect(storage.getItem("creewrld.products.v1")).toBeTruthy();
    expect(storage.getItem("creewrld.cart.v1")).toBeTruthy();
    expect(storage.getItem("creewrld.zone.v1")).toBe("nationwide");
    expect(storage.getItem("creewrld.session.v1")).toBeTruthy();
  });

  it("rejects records without a title or price", async () => {
    const store = await freshStore();
    expect(store.normalizeProduct({ title: "", price: 100 })).toBeNull();
    expect(store.normalizeProduct({ title: "Ok", price: 0 })).toBeNull();
    expect(store.normalizeProduct(null)).toBeNull();
  });

  it("repairs partial records", async () => {
    const store = await freshStore();
    const product = store.normalizeProduct({ title: "  Test Raglan  ", price: "3200", category: "Nonsense" });
    expect(product.title).toBe("Test Raglan");
    expect(product.price).toBe(3200);
    expect(product.category).toBe("Streetwear");
    expect(product.sizes).toEqual(["One size"]);
    expect(product.condition).toBe("Excellent");
  });

  it("falls back to the seed when stored data is unusable", async () => {
    storage.setItem("creewrld.products.v1", JSON.stringify([{ nope: true }]));
    const store = await freshStore();
    expect(store.state.products).toHaveLength(10);
  });
});

describe("filtering", () => {
  it("filters by category", async () => {
    const store = await freshStore();
    store.setFilter("Y2K");
    expect(store.visibleProducts()).toHaveLength(2);
    store.setFilter("All Items");
    expect(store.visibleProducts()).toHaveLength(10);
  });

  it("counts per category", async () => {
    const store = await freshStore();
    expect(store.countFor("All Items")).toBe(10);
    expect(store.countFor("Sneakers")).toBe(2);
    expect(store.countFor("Streetwear")).toBe(3);
    expect(store.countFor("Old Money")).toBe(3);
    expect(store.countFor("Y2K")).toBe(2);
  });

  it("ignores unknown categories", async () => {
    const store = await freshStore();
    store.setFilter("Sneakers");
    store.setFilter("Ballgowns");
    expect(store.state.filter).toBe("Sneakers");
  });
});

describe("cart", () => {
  it("adds, merges and persists lines", async () => {
    const store = await freshStore();
    store.addToCart("cw-001", "42", 1);
    store.addToCart("cw-001", "42", 1);
    store.addToCart("cw-001", "41", 1);

    expect(store.state.cart).toHaveLength(2);
    expect(store.cartCount()).toBe(3);
    expect(JSON.parse(storage.getItem("creewrld.cart.v1"))).toHaveLength(2);
  });

  it("caps a line at nine units", async () => {
    const store = await freshStore();
    store.addToCart("cw-001", "41", 1);
    for (let i = 0; i < 12; i += 1) store.changeQty("cw-001", "41", 1);
    expect(store.state.cart[0].qty).toBe(9);
  });

  it("removes a line when the quantity drops below one", async () => {
    const store = await freshStore();
    store.addToCart("cw-001", "41", 1);
    store.changeQty("cw-001", "41", -1);
    expect(store.state.cart).toHaveLength(0);
    expect(store.cartTotals().total).toBe(0);
  });

  it("applies the zone fee to live totals", async () => {
    const store = await freshStore();
    store.addToCart("cw-001", "41", 1);
    expect(store.cartTotals().total).toBe(6500);

    store.setZone("nairobi-outer");
    expect(store.cartTotals().total).toBe(6700);

    store.setZone("nationwide");
    expect(store.cartTotals().total).toBe(6950);
  });

  it("retires only the ordered line", async () => {
    const store = await freshStore();
    store.addToCart("cw-001", "41", 1);
    store.addToCart("cw-002", "40", 1);
    store.clearOrderedLines([{ product: store.getProduct("cw-001"), size: "41" }]);
    expect(store.state.cart).toHaveLength(1);
    expect(store.state.cart[0].id).toBe("cw-002");
  });
});

describe("merchant CRUD", () => {
  it("creates a product and persists it", async () => {
    const store = await freshStore();
    const created = store.upsertProduct({
      title: "Selvedge Trucker",
      category: "Streetwear",
      price: 5400,
      condition: "Like New",
      sizes: ["M", "L"],
      image: "assets/img/bomber-varsity.jpg",
      description: "Indigo selvedge denim trucker."
    });

    expect(created.id).toMatch(/^cw-/);
    expect(store.state.products).toHaveLength(11);
    expect(store.state.products[0].title).toBe("Selvedge Trucker");
    expect(JSON.parse(storage.getItem("creewrld.products.v1"))).toHaveLength(11);
  });

  it("edits in place", async () => {
    const store = await freshStore();
    store.upsertProduct({
      id: "cw-001",
      title: "Mocha Suede High-Top",
      category: "Sneakers",
      price: 6900,
      condition: "Excellent",
      sizes: ["41", "42"],
      image: "assets/img/sneaker-mocha.jpg",
      description: "Re-priced."
    });

    expect(store.state.products).toHaveLength(10);
    expect(store.getProduct("cw-001").price).toBe(6900);
    expect(store.getProduct("cw-001").sizes).toEqual(["41", "42"]);
  });

  it("deletes a product and its cart lines", async () => {
    const store = await freshStore();
    store.addToCart("cw-001", "41", 1);
    store.deleteProduct("cw-001");
    expect(store.state.products).toHaveLength(9);
    expect(store.state.cart).toHaveLength(0);
    expect(store.getProduct("cw-001")).toBeNull();
  });

  it("restores the seed catalogue", async () => {
    const store = await freshStore();
    store.deleteProduct("cw-001");
    store.resetCatalogue();
    expect(store.state.products).toHaveLength(10);
    expect(store.getProduct("cw-001")).not.toBeNull();
  });
});

describe("session", () => {
  it("rejects bad credentials", async () => {
    const store = await freshStore();
    expect(store.signIn("admin", "wrong")).toBe(false);
    expect(store.state.admin).toBe(false);
    expect(storage.getItem("creewrld.session.v1")).toBeNull();
  });

  it("signs in, persists and signs out", async () => {
    const store = await freshStore();
    expect(store.signIn("ADMIN", "creewrld")).toBe(true);
    expect(store.state.admin).toBe(true);

    const session = JSON.parse(storage.getItem("creewrld.session.v1"));
    expect(session.user).toBe("admin");
    expect(session.expires).toBeGreaterThan(Date.now());

    store.signOut();
    expect(store.state.admin).toBe(false);
    expect(storage.getItem("creewrld.session.v1")).toBeNull();
  });

  it("drops an expired session on boot", async () => {
    storage.setItem(
      "creewrld.session.v1",
      JSON.stringify({ user: "admin", expires: Date.now() - 1000 })
    );
    const store = await freshStore();
    expect(store.state.admin).toBe(false);
    expect(storage.getItem("creewrld.session.v1")).toBeNull();
  });

  it("notifies subscribers on change", async () => {
    const store = await freshStore();
    const seen = [];
    const unsubscribe = store.subscribe((topic) => seen.push(topic));

    store.addToCart("cw-001", "41", 1);
    store.upsertProduct({
      title: "Test Piece",
      category: "Y2K",
      price: 1000,
      condition: "Good",
      sizes: ["S"],
      image: "assets/img/tank-y2k.jpg",
      description: "test"
    });
    unsubscribe();
    store.addToCart("cw-002", "40", 1);

    expect(seen).toEqual(["cart", "products"]);
  });
});

describe("cross-tab sync", () => {
  it("re-reads products and cart from storage", async () => {
    const store = await freshStore();
    store.addToCart("cw-001", "41", 1);

    const external = store.state.products.filter((product) => product.id !== "cw-001");
    storage.setItem("creewrld.products.v1", JSON.stringify(external));

    store.syncFromStorage("products");
    expect(store.state.products).toHaveLength(9);
    expect(store.state.cart).toHaveLength(0);
  });
});
