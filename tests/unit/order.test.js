import { describe, expect, it } from "vitest";
import {
  buildWhatsAppMessage,
  cartTotals,
  isValidPhone,
  orderTotals,
  validateCustomer,
  whatsappUrl
} from "../../src/lib/order.js";

const sneaker = {
  id: "cw-001",
  title: "Mocha Suede High-Top",
  category: "Sneakers",
  price: 6500,
  condition: "Excellent",
  sizes: ["41", "42"],
  image: "assets/img/sneaker-mocha.jpg"
};

const runner = {
  id: "cw-002",
  title: "Chrome Runner '03",
  category: "Sneakers",
  price: 5200,
  condition: "Very Good",
  sizes: ["40"],
  image: "assets/img/sneaker-silver.jpg"
};

describe("delivery zones", () => {
  it("is free inside Nairobi", () => {
    const totals = cartTotals([{ product: sneaker, size: "41", qty: 1 }], "nairobi-core");
    expect(totals.fee).toBe(0);
    expect(totals.total).toBe(6500);
    expect(totals.count).toBe(1);
  });

  it("adds KSh 200 for Thika Road / Ruiru / Kiambu", () => {
    const totals = cartTotals([{ product: sneaker, size: "41", qty: 1 }], "nairobi-outer");
    expect(totals.fee).toBe(200);
    expect(totals.total).toBe(6700);
  });

  it("adds KSh 450 nationwide", () => {
    const totals = cartTotals([{ product: sneaker, size: "41", qty: 1 }], "nationwide");
    expect(totals.fee).toBe(450);
    expect(totals.total).toBe(6950);
  });

  it("multiplies by quantity before adding delivery", () => {
    const totals = cartTotals([{ product: sneaker, size: "41", qty: 2 }], "nationwide");
    expect(totals.subtotal).toBe(13000);
    expect(totals.total).toBe(13450);
    expect(totals.count).toBe(2);
  });

  it("charges nothing on an empty cart", () => {
    const totals = cartTotals([], "nationwide");
    expect(totals.fee).toBe(0);
    expect(totals.total).toBe(0);
  });

  it("falls back to the Nairobi zone for unknown ids", () => {
    expect(orderTotals([{ product: sneaker, qty: 1 }], "atlantis").fee).toBe(0);
  });
});

describe("customer validation", () => {
  const valid = { name: "Amina Otieno", location: "Kilimani, Nairobi", phone: "0712 345 678" };

  it("accepts a complete customer", () => {
    expect(validateCustomer(valid)).toEqual({ valid: true, errors: {} });
  });

  it("requires a real name and location", () => {
    const result = validateCustomer({ name: " A ", location: "", phone: valid.phone });
    expect(result.valid).toBe(false);
    expect(result.errors.name).toMatch(/full name/i);
    expect(result.errors.location).toMatch(/delivery area/i);
  });

  it("accepts the phone formats shoppers actually type", () => {
    ["0712345678", "0712 345 678", "+254712345678", "254712345678", "712345678"].forEach(
      (phone) => expect(isValidPhone(phone), phone).toBe(true)
    );
  });

  it("rejects short or empty phone numbers", () => {
    ["", "0712", "12345", "not-a-number"].forEach((phone) =>
      expect(isValidPhone(phone), phone).toBe(false)
    );
  });

  it("reports the phone error against the right field", () => {
    const result = validateCustomer({ ...valid, phone: "12" });
    expect(result.valid).toBe(false);
    expect(result.errors.phone).toMatch(/valid phone number/i);
    expect(result.errors.name).toBeUndefined();
  });
});

describe("WhatsApp payload", () => {
  const customer = { name: "Amina Otieno", location: "Kilimani, Nairobi", phone: "0712 345 678" };
  const message = buildWhatsAppMessage({
    items: [{ product: sneaker, size: "42", qty: 1 }],
    customer,
    zoneId: "nairobi-core",
    toAbsolute: (src) => "https://creewrld.test/" + src
  });

  it("leads with the store name", () => {
    expect(message.startsWith("*CREE WRLD — NEW ORDER*")).toBe(true);
  });

  it("includes the item sheet", () => {
    expect(message).toContain("*Mocha Suede High-Top*");
    expect(message).toContain("Price: KSh 6,500");
    expect(message).toContain("Size: 42");
    expect(message).toContain("Condition: Excellent");
    expect(message).toContain("Image: https://creewrld.test/assets/img/sneaker-mocha.jpg");
  });

  it("includes the customer block", () => {
    expect(message).toContain("Name: Amina Otieno");
    expect(message).toContain("Delivery Location: Kilimani, Nairobi");
    expect(message).toContain("Contact Phone: 0712 345 678");
  });

  it("includes totals and the delivery note", () => {
    expect(message).toContain("Zone: Nairobi CBD / Westlands / Kilimani / Karen");
    expect(message).toContain("Fee: Free");
    expect(message).toContain("Subtotal: KSh 6,500");
    expect(message).toContain("Order Total: KSh 6,500");
    expect(message).toContain("Free delivery within Nairobi.");
  });

  it("numbers multiple items and shows quantities", () => {
    const multi = buildWhatsAppMessage({
      items: [
        { product: sneaker, size: "41", qty: 2 },
        { product: runner, size: "40", qty: 1 }
      ],
      customer,
      zoneId: "nationwide",
      toAbsolute: (src) => src
    });
    expect(multi).toContain("*ITEMS (3)*");
    expect(multi).toContain("1. *Mocha Suede High-Top*");
    expect(multi).toContain("Price: KSh 6,500 × 2");
    expect(multi).toContain("2. *Chrome Runner '03*");
    expect(multi).toContain("Fee: KSh 450");
    expect(multi).toContain("Order Total: KSh 18,650");
  });
});

describe("whatsappUrl", () => {
  it("targets the studio number and encodes the message", () => {
    const url = whatsappUrl("hello & goodbye\nline two");
    expect(url.startsWith("https://wa.me/254719526649?text=")).toBe(true);
    expect(decodeURIComponent(url.split("?text=")[1])).toBe("hello & goodbye\nline two");
  });
});
