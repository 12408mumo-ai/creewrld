import { describe, expect, it } from "vitest";
import {
  CREDENTIALS_ERROR,
  NETWORK_ERROR,
  describeAuthDetail,
  describeAuthError,
  normalizeEmail
} from "../../src/data/auth.js";

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
  it("is the requested sentence, word for word", () => {
    expect(CREDENTIALS_ERROR).toBe(
      "Invalid Gmail or password. Please verify your credentials or confirm the account in the Supabase Dashboard."
    );
  });
});

describe("describeAuthError", () => {
  it("answers a wrong password with the credential sentence", () => {
    expect(describeAuthError({ code: "invalid_grant", message: "Invalid login credentials" })).toBe(
      CREDENTIALS_ERROR
    );
    expect(describeAuthError({ error_code: "invalid_credentials" })).toBe(CREDENTIALS_ERROR);
  });

  it("answers an unconfirmed account with the same sentence", () => {
    expect(describeAuthError({ code: "email_not_confirmed", status: 400 })).toBe(CREDENTIALS_ERROR);
    expect(describeAuthError({ message: "Email not confirmed" })).toBe(CREDENTIALS_ERROR);
  });

  it("treats any bare 400 or 401 as refused credentials", () => {
    expect(describeAuthError({ status: 400 })).toBe(CREDENTIALS_ERROR);
    expect(describeAuthError({ status: 401 })).toBe(CREDENTIALS_ERROR);
  });

  it("does not blame the password when the request never arrived", () => {
    expect(describeAuthError({ message: "TypeError: Failed to fetch" })).toBe(NETWORK_ERROR);
    expect(NETWORK_ERROR).not.toBe(CREDENTIALS_ERROR);
  });

  it("keeps rate limiting distinct, because waiting is the fix", () => {
    expect(describeAuthError({ code: "over_request_rate_limit" })).toMatch(/too many attempts/i);
    expect(describeAuthError({ message: "Too many requests" })).toMatch(/too many attempts/i);
  });

  it("falls back to something readable for an unknown failure", () => {
    expect(describeAuthError({ message: "Something odd happened" })).toMatch(/something odd happened/i);
    expect(describeAuthError(null)).toMatch(/sign in failed/i);
  });
});

describe("describeAuthDetail", () => {
  it("keeps Supabase's own words and the code beside them", () => {
    expect(describeAuthDetail({ message: "Invalid login credentials", code: "invalid_grant", status: 400 })).toBe(
      "Invalid login credentials (invalid_grant, 400)"
    );
  });

  it("works when only a message arrives", () => {
    expect(describeAuthDetail({ message: "Email not confirmed" })).toBe("Email not confirmed");
  });

  it("works when only a code arrives", () => {
    expect(describeAuthDetail({ error_code: "over_email_send_rate_limit" })).toBe("over_email_send_rate_limit");
  });

  it("stays empty rather than printing the word undefined", () => {
    expect(describeAuthDetail(null)).toBe("");
    expect(describeAuthDetail(undefined)).toBe("");
    expect(describeAuthDetail({})).toBe("");
  });
});
