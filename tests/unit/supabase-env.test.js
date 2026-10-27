import { describe, expect, it, vi } from "vitest";
import {
  KEY_VARS,
  URL_VARS,
  cleanValue,
  configErrorFor,
  createAuthorizedFetch,
  keyPreview,
  normalizeKey,
  normalizeUrl,
  pickKey,
  pickUrl,
  resolveSupabaseConfig
} from "../../src/lib/supabase-env.js";

const URL_OK = "https://vagnxflwjldokhqvyrqg.supabase.co";
const JWT_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZhZ254Zmx3amxkb2tocXZ5cnFnIn0.HO-h07gjSZJBWrCdegV5BAi17Gg_Kx3N3tm01iWHcy8";
const PUBLISHABLE_KEY = "sb_publishable_fBWK3gZWPrWo8-bNNXI-bg_x9D0y8B4";

describe("cleanValue", () => {
  it("trims whitespace and strips a BOM", () => {
    expect(cleanValue("  https://x.supabase.co \n")).toBe("https://x.supabase.co");
    expect(cleanValue("\uFEFFkey")).toBe("key");
  });

  it("strips the quotes a copy-paste leaves behind", () => {
    expect(cleanValue('"https://x.supabase.co"')).toBe("https://x.supabase.co");
    expect(cleanValue("'key'")).toBe("key");
    // A quote on one side only is not a wrapper — leave it alone.
    expect(cleanValue('"key')).toBe('"key');
  });

  it("treats nothing at all as empty", () => {
    expect(cleanValue(null)).toBe("");
    expect(cleanValue(undefined)).toBe("");
    expect(cleanValue("   ")).toBe("");
  });
});

describe("normalizeUrl", () => {
  it("keeps a real project URL and drops the trailing slash", () => {
    expect(normalizeUrl(URL_OK)).toBe(URL_OK);
    expect(normalizeUrl(URL_OK + "/")).toBe(URL_OK);
    expect(normalizeUrl(URL_OK + "///")).toBe(URL_OK);
  });

  it("rejects a bare host, a blank value and a placeholder", () => {
    // Without a scheme, supabase-js builds relative requests.
    expect(normalizeUrl("vagnxflwjldokhqvyrqg.supabase.co")).toBe("");
    expect(normalizeUrl("")).toBe("");
    expect(normalizeUrl("your-project-url")).toBe("");
  });
});

describe("normalizeKey", () => {
  it("accepts both key shapes", () => {
    expect(normalizeKey(JWT_KEY)).toBe(JWT_KEY);
    expect(normalizeKey(PUBLISHABLE_KEY)).toBe(PUBLISHABLE_KEY);
  });

  it("rejects a blank, whitespace-padded or placeholder key", () => {
    // A key never contains whitespace; one that does would be sent blank.
    expect(normalizeKey("   ")).toBe("");
    expect(normalizeKey("abc def abc def abc def abc")).toBe("");
    expect(normalizeKey("your-anon-key")).toBe("");
    expect(normalizeKey("CHANGEME")).toBe("");
    expect(normalizeKey("short")).toBe("");
  });

  it("accepts a short literal key — the e2e stub uses one", () => {
    // Deliberately no long minimum: the test harness's key is "stub-anon-key",
    // and it has to pass the same gate the production key does.
    expect(normalizeKey("stub-anon-key")).toBe("stub-anon-key");
  });
});

describe("keyPreview", () => {
  it("never returns a whole key", () => {
    const preview = keyPreview(JWT_KEY);
    expect(preview).toBe(JWT_KEY.slice(0, 12) + "…");
    expect(preview.length).toBeLessThan(JWT_KEY.length);
    expect(keyPreview("")).toBe("");
  });
});

describe("pickUrl / pickKey", () => {
  it("reads the Vite names first, then the Next/Vercel ones", () => {
    expect(pickUrl({ VITE_SUPABASE_URL: URL_OK, NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" })).toBe(URL_OK);
    expect(pickUrl({ NEXT_PUBLIC_SUPABASE_URL: URL_OK })).toBe(URL_OK);
    expect(pickUrl({})).toBe("");
  });

  it("accepts the publishable-key spellings as well as the anon ones", () => {
    expect(pickKey({ VITE_SUPABASE_ANON_KEY: JWT_KEY })).toBe(JWT_KEY);
    expect(pickKey({ VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY })).toBe(PUBLISHABLE_KEY);
    expect(pickKey({ NEXT_PUBLIC_SUPABASE_ANON_KEY: JWT_KEY })).toBe(JWT_KEY);
  });

  it("publishes the variable names it will look for", () => {
    expect(URL_VARS).toContain("VITE_SUPABASE_URL");
    expect(URL_VARS).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(KEY_VARS).toContain("VITE_SUPABASE_ANON_KEY");
    expect(KEY_VARS).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });
});

describe("resolveSupabaseConfig", () => {
  it("takes the first complete pair and reports where it came from", () => {
    const config = resolveSupabaseConfig([
      { name: "Vite env", url: "", anonKey: "" },
      { name: "build define", url: URL_OK + "/", anonKey: JWT_KEY }
    ]);
    expect(config).toMatchObject({ url: URL_OK, anonKey: JWT_KEY, configured: true, source: "build define" });
  });

  it("does not pair a URL from one source with a key from another", () => {
    // Half a credential is not a credential — mixing them would hit a project
    // the key does not belong to.
    const config = resolveSupabaseConfig([
      { name: "Vite env", url: URL_OK, anonKey: "" },
      { name: "build define", url: "", anonKey: JWT_KEY }
    ]);
    expect(config.configured).toBe(false);
    expect(config.url).toBe("");
  });

  it("says which half was missing", () => {
    const config = resolveSupabaseConfig([{ name: "Vite env", url: URL_OK, anonKey: "  " }]);
    expect(config.configured).toBe(false);
    expect(config.issues[0]).toBe("Vite env: key is missing");

    const other = resolveSupabaseConfig([{ name: "build define", url: "not-a-url", anonKey: JWT_KEY }]);
    expect(other.issues[0]).toBe("build define: URL is not an http(s) address");
  });

  it("survives an empty list", () => {
    expect(resolveSupabaseConfig([]).configured).toBe(false);
    expect(resolveSupabaseConfig(undefined).configured).toBe(false);
  });
});

describe("configErrorFor", () => {
  it("names the missing variable rather than a catch-all", () => {
    expect(configErrorFor({ issues: ["Vite env: key is missing"] })).toMatch(/VITE_SUPABASE_ANON_KEY/);
    expect(configErrorFor({ issues: ["Vite env: URL is missing"] })).toMatch(/VITE_SUPABASE_URL/);
    expect(configErrorFor({ issues: ["Vite env: URL is missing, key is missing"] })).toMatch(
      /VITE_SUPABASE_URL.*VITE_SUPABASE_ANON_KEY/
    );
  });

  it("still says something useful with no detail at all", () => {
    expect(configErrorFor({})).toMatch(/VITE_SUPABASE_URL/);
    expect(configErrorFor()).toMatch(/VITE_SUPABASE_URL/);
  });
});

describe("createAuthorizedFetch", () => {
  const response = () => ({ ok: true, status: 200 });

  it("adds the apikey header to a request that has none", async () => {
    const base = vi.fn(async () => response());
    const fetchImpl = createAuthorizedFetch(base, () => JWT_KEY);

    await fetchImpl("https://x.supabase.co/rest/v1/products", { method: "GET" });

    const [, init] = base.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("apikey")).toBe(JWT_KEY);
    expect(headers.get("authorization")).toBe("Bearer " + JWT_KEY);
    expect(init.method).toBe("GET");
  });

  it("keeps a header the client already set", async () => {
    const base = vi.fn(async () => response());
    const fetchImpl = createAuthorizedFetch(base, () => JWT_KEY);

    await fetchImpl("https://x.supabase.co/rest/v1/products", {
      headers: { apikey: "already-set", Authorization: "Bearer user-token" }
    });

    const headers = new Headers(base.mock.calls[0][1].headers);
    expect(headers.get("apikey")).toBe("already-set");
    expect(headers.get("authorization")).toBe("Bearer user-token");
  });

  it("picks up a key that arrives later", async () => {
    let key = "";
    const base = vi.fn(async () => response());
    const fetchImpl = createAuthorizedFetch(base, () => key);

    await expect(fetchImpl("https://x.supabase.co/rest/v1/products")).rejects.toThrow(/anon key/i);
    expect(base).not.toHaveBeenCalled();

    key = JWT_KEY;
    await fetchImpl("https://x.supabase.co/rest/v1/products");
    expect(new Headers(base.mock.calls[0][1].headers).get("apikey")).toBe(JWT_KEY);
  });

  it("refuses to send a request that would come back as 'No API key found'", async () => {
    const base = vi.fn(async () => response());
    const fetchImpl = createAuthorizedFetch(base, () => "   ");

    await expect(fetchImpl("https://x.supabase.co/rest/v1/products")).rejects.toMatchObject({
      code: "SUPABASE_NOT_CONFIGURED"
    });
    expect(base).not.toHaveBeenCalled();
  });

  it("leaves the body and credentials untouched", async () => {
    const base = vi.fn(async () => response());
    const fetchImpl = createAuthorizedFetch(base, () => JWT_KEY);

    const body = JSON.stringify([{ title: "Piece" }]);
    await fetchImpl("https://x.supabase.co/rest/v1/products", {
      method: "POST",
      body,
      credentials: "omit"
    });

    const [, init] = base.mock.calls[0];
    expect(init.body).toBe(body);
    expect(init.credentials).toBe("omit");
  });
});
