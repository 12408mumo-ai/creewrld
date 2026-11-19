import { afterEach, describe, expect, it, vi } from "vitest";
import { zoneFor } from "../../src/config.js";
import { PLACEHOLDER, resolveImage } from "../../src/lib/images.js";
import * as supabaseMod from "../../src/lib/supabase.js";
import { insertOrder } from "../../src/data/orders.js";

const sampleDraft = (overrides = {}) => ({
  items: [
    {
      product: {
        id: "cw-001",
        title: "Mocha Suede High-Top",
        price: 6500,
        condition: "Excellent",
        image: "assets/img/sneaker-mocha.jpg"
      },
      size: "41",
      qty: 1
    }
  ],
  customer: {
    name: "Amina Otieno",
    phone: "0712 345 678",
    location: "Kilimani, Nairobi"
  },
  source: "product",
  idempotencyKey: "11111111-2222-4333-8444-555555555555",
  ...overrides
});

const sampleTotals = {
  subtotal: 6500,
  fee: 0,
  total: 6500,
  zone: zoneFor("nairobi-core")
};

describe("insertOrder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("includes client_request_id when an idempotencyKey is supplied", async () => {
    let inserted = null;
    vi.spyOn(supabaseMod, "assertConfigured").mockReturnValue({
      from: (table) => {
        expect(table).toBe("orders");
        return {
          insert: async (rows) => {
            inserted = rows[0];
            return { error: null };
          }
        };
      }
    });

    await expect(insertOrder(sampleDraft(), sampleTotals)).resolves.toBe(true);
    expect(inserted.client_request_id).toBe("11111111-2222-4333-8444-555555555555");
    expect(inserted.status).toBe("new");
    expect(inserted.item_count).toBe(1);
  });

  it("treats a duplicate client_request_id (23505) as idempotent success", async () => {
    vi.spyOn(supabaseMod, "assertConfigured").mockReturnValue({
      from: () => ({
        insert: async () => ({
          error: {
            code: "23505",
            message: 'duplicate key value violates unique constraint "orders_client_request_id_uidx"'
          }
        })
      })
    });

    await expect(insertOrder(sampleDraft(), sampleTotals)).resolves.toBe(true);
  });

  it("falls back cleanly when the database lacks client_request_id", async () => {
    const calls = [];
    vi.spyOn(supabaseMod, "assertConfigured").mockReturnValue({
      from: () => ({
        insert: async (rows) => {
          calls.push(rows[0]);
          if ("client_request_id" in rows[0]) {
            return {
              error: {
                code: "PGRST204",
                message: "Could not find the 'client_request_id' column of 'orders' in the schema cache"
              }
            };
          }
          return { error: null };
        }
      })
    });

    await expect(insertOrder(sampleDraft(), sampleTotals)).resolves.toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].client_request_id).toBeDefined();
    expect(calls[1].client_request_id).toBeUndefined();
  });

  it("times out a hung order insert instead of blocking WhatsApp dispatch forever", async () => {
    vi.useFakeTimers();
    vi.spyOn(supabaseMod, "assertConfigured").mockReturnValue({
      from: () => ({
        insert: () => new Promise(() => {})
      })
    });

    const pending = insertOrder(sampleDraft(), sampleTotals);
    const assertion = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(15001);
    await assertion;
  });
});

describe("resolveImage scheme allowlist", () => {
  it("allows https URLs and bundled/relative asset paths", () => {
    expect(resolveImage("https://xyz.supabase.co/storage/v1/object/public/product-images/a.jpg")).toBe(
      "https://xyz.supabase.co/storage/v1/object/public/product-images/a.jpg"
    );
    expect(resolveImage("/assets/logo/icon-512.png")).toBe("/assets/logo/icon-512.png");
    expect(resolveImage("assets/img/sneaker-mocha.jpg")).toContain("sneaker-mocha");
  });

  it("replaces unsafe or non-HTTPS schemes with the placeholder", () => {
    expect(resolveImage("javascript:alert(1)")).toBe(PLACEHOLDER);
    expect(resolveImage("data:text/html,<script>alert(1)</script>")).toBe(PLACEHOLDER);
    expect(resolveImage("http://insecure.example.com/pic.jpg")).toBe(PLACEHOLDER);
    expect(resolveImage("//protocol-relative.example.com/pic.jpg")).toBe(PLACEHOLDER);
    expect(resolveImage("")).toBe(PLACEHOLDER);
  });
});
