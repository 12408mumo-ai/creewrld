import { describe, expect, it } from "vitest";
import { CREDENTIALS_ERROR, normalizeEmail } from "../../src/data/auth.js";

describe("normalizeEmail", () => {
  it("trims whitespace from a pasted address", () => {
    expect(normalizeEmail("  owner@gmail.com  ")).toBe("owner@gmail.com");
    expect(normalizeEmail("\nowner@gmail.com\t")).toBe("owner@gmail.com");
  });

  it("lower-cases a mixed-case address", () => {
    expect(normalizeEmail("Owner@Gmail.com")).toBe("owner@gmail.com");
    expect(normalizeEmail("OWNER@GMAIL.COM")).toBe("owner@gmail.com");
  });

  it("trims and lower-cases together, which is the login path", () => {
    expect(normalizeEmail("  Owner@Gmail.COM ")).toBe("owner@gmail.com");
  });

  it("leaves an already-clean address untouched", () => {
    expect(normalizeEmail("creewrld.studio@gmail.com")).toBe("creewrld.studio@gmail.com");
  });

  it("copes with an empty or missing field", () => {
    expect(normalizeEmail("")).toBe("");
    expect(normalizeEmail("   ")).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
    expect(normalizeEmail(null)).toBe("");
  });
});

describe("CREDENTIALS_ERROR", () => {
  it("names Gmail and an authorized studio account", () => {
    expect(CREDENTIALS_ERROR).toBe(
      "That Gmail address or password doesn't match an authorized studio account."
    );
    expect(CREDENTIALS_ERROR).toMatch(/gmail/i);
    expect(CREDENTIALS_ERROR).toMatch(/authorized studio account/i);
  });
});
