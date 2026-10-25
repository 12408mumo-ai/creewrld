import { describe, expect, it } from "vitest";
import { absoluteUrl, esc, money, normalizeSizes, slug, sum, uid } from "../../src/lib/format.js";

describe("money", () => {
  it("formats Kenyan Shillings with thousands separators", () => {
    expect(money(6500)).toBe("KSh 6,500");
    expect(money(12500)).toBe("KSh 12,500");
    expect(money(0)).toBe("KSh 0");
  });

  it("rounds and tolerates junk input", () => {
    expect(money(3200.6)).toBe("KSh 3,201");
    expect(money("4800")).toBe("KSh 4,800");
    expect(money(undefined)).toBe("KSh 0");
    expect(money(null)).toBe("KSh 0");
  });
});

describe("esc", () => {
  it("neutralises HTML-significant characters", () => {
    expect(esc('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
    );
    expect(esc("Balenciaga & Co's")).toBe("Balenciaga &amp; Co&#39;s");
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });
});

describe("normalizeSizes", () => {
  it("accepts a comma string or an array", () => {
    expect(normalizeSizes("M, L, XL")).toEqual(["M", "L", "XL"]);
    expect(normalizeSizes(["41", " 42 ", ""])).toEqual(["41", "42"]);
  });

  it("falls back to a single size when empty", () => {
    expect(normalizeSizes("")).toEqual(["One size"]);
    expect(normalizeSizes(null)).toEqual(["One size"]);
  });
});

describe("misc helpers", () => {
  it("sums with a picker", () => {
    expect(sum([{ qty: 1 }, { qty: 3 }], (line) => line.qty)).toBe(4);
    expect(sum([], (line) => line.qty)).toBe(0);
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => uid()));
    expect(ids.size).toBe(50);
    expect([...ids][0]).toMatch(/^cw-/);
  });

  it("resolves absolute urls against a base", () => {
    expect(absoluteUrl("assets/img/a.jpg", "https://creewrld.test/shop")).toBe(
      "https://creewrld.test/assets/img/a.jpg"
    );
    expect(absoluteUrl("https://cdn.test/a.jpg", "https://creewrld.test/")).toBe(
      "https://cdn.test/a.jpg"
    );
    expect(absoluteUrl("", "https://creewrld.test/")).toBe("https://creewrld.test/");
  });

  it("slugifies category labels", () => {
    expect(slug("All Items")).toBe("all-items");
    expect(slug("Old Money")).toBe("old-money");
    expect(slug("Y2K")).toBe("y2k");
  });
});
