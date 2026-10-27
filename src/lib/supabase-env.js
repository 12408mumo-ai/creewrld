/**
 * Supabase credentials — reading, cleaning and validating them.
 *
 * Pure functions only: no imports, no globals, no network. `supabase.js` wires
 * them to Vite's build-time values, which keeps the important logic (what
 * counts as a usable URL or key, and which source wins) testable in isolation.
 *
 * Why this exists at all: a URL with no key still produces a perfectly working
 * HTTP client, and PostgREST answers every request with
 * `{"message":"No API key found in request"}`. That failure is silent at build
 * time and confusing at runtime, so the checks live here and are loud.
 */

/**
 * The names an operator can set. The docs use the first of each list; the rest
 * are the aliases this project has picked up along the way, including the
 * newer "publishable key" naming from the Supabase dashboard.
 */
export const URL_VARS = [
  "VITE_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "VITE_SUPABASE_PROJECT_URL",
  "NEXT_PUBLIC_SUPABASE_PROJECT_URL"
];

export const KEY_VARS = [
  "VITE_SUPABASE_ANON_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY"
];

/** First non-empty value among `names` in an env-like object. */
export function pickEnv(env, names) {
  if (!env) return "";
  for (const name of names) {
    const value = cleanValue(env[name]);
    if (value) return value;
  }
  return "";
}

export const pickUrl = (env) => pickEnv(env, URL_VARS);
export const pickKey = (env) => pickEnv(env, KEY_VARS);

/**
 * Environment values arrive with whatever the shell, a `.env` file or a
 * dashboard pasted in: stray spaces, a trailing newline, a BOM, or quotes
 * copied from a JSON snippet. All of those make a key header blank on the wire.
 */
export function cleanValue(value) {
  if (value === null || value === undefined) return "";

  let text = String(value).replace(/^\uFEFF/, "").trim();

  // "https://…" and 'https://…' are common copy-paste artefacts.
  if (text.length > 1) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      text = text.slice(1, -1).trim();
    }
  }

  return text;
}

/**
 * A project URL, or "" if the value could not be one. `supabase-js` happily
 * accepts a bare hostname and then builds requests against a relative path,
 * so the scheme is required here.
 */
export function normalizeUrl(value) {
  const text = cleanValue(value).replace(/\/+$/, "");
  if (!text) return "";
  if (!/^https?:\/\/[^\s/]+/i.test(text)) return "";
  return text;
}

/**
 * Values that look like a key but are a placeholder from a README or a .env
 * template. Sending one produces a 401 that reads like a code fault.
 */
const PLACEHOLDERS = [
  "your-anon-key",
  "your_anon_key",
  "your-anon-public-key",
  "anon-key",
  "anon_key",
  "apikey",
  "api-key",
  "changeme",
  "placeholder",
  "todo"
];

/**
 * An anon/publishable key, or "" if the value could not be one.
 *
 * Both real shapes are accepted: the legacy JWT (`eyJ…`) and the newer
 * `sb_publishable_…` key. What is rejected is what actually breaks requests —
 * an empty or whitespace-containing value (a key never contains whitespace, so
 * one that does would be sent blank) and the placeholder strings that ship in
 * `.env.example`.
 *
 * There is deliberately no minimum length beyond "not obviously truncated":
 * project keys are long, but the e2e stub's key is a short literal and must
 * pass the same validation the real one does.
 */
export function normalizeKey(value) {
  const text = cleanValue(value);
  if (!text || /\s/.test(text)) return "";
  if (text.length < 8) return "";
  if (PLACEHOLDERS.includes(text.toLowerCase())) return "";
  return text;
}

/**
 * The project ref a Supabase URL belongs to — the `xyz` in
 * `https://xyz.supabase.co`. Two projects are told apart by this string and
 * nothing else, so it is the one fact worth printing when a deployment turns
 * out to be talking to the wrong database.
 */
export function projectRefOf(url) {
  const text = normalizeUrl(url);
  if (!text) return "";
  try {
    const host = text.replace(/^https?:\/\//i, "").split("/")[0];
    const [first] = host.split(".");
    return first || "";
  } catch (err) {
    return "";
  }
}

/** Only the first few characters — never log a whole key. */
export function keyPreview(key) {
  const text = cleanValue(key);
  if (!text) return "";
  return text.length <= 12 ? text.slice(0, 4) + "…" : text.slice(0, 12) + "…";
}

/**
 * Pick the first source that has both halves, and explain every source that
 * did not. `sources` is an ordered list of `{ name, url, anonKey }`.
 *
 * Later sources are fallbacks, not overrides: the first complete pair wins, so
 * a deliberate `VITE_*` value always beats the NEXT_PUBLIC_* one.
 */
export function resolveSupabaseConfig(sources = []) {
  const issues = [];

  for (const source of sources) {
    if (!source) continue;

    const url = normalizeUrl(source.url);
    const anonKey = normalizeKey(source.anonKey);

    if (url && anonKey) {
      return { url, anonKey, configured: true, source: source.name || "unknown", issues };
    }

    const missing = [];
    if (!url) missing.push(cleanValue(source.url) ? "URL is not an http(s) address" : "URL is missing");
    if (!anonKey) missing.push(cleanValue(source.anonKey) ? "key is malformed" : "key is missing");
    issues.push((source.name || "unknown") + ": " + missing.join(", "));
  }

  return { url: "", anonKey: "", configured: false, source: "", issues };
}

/**
 * A human answer to "which variable do I set?", chosen from what is actually
 * wrong rather than a catch-all message.
 */
export function configErrorFor({ issues = [] } = {}) {
  const text = issues.join(" | ");
  const noUrl = /URL is missing|URL is not an http/i.test(text);
  const noKey = /key is missing|key is malformed/i.test(text);

  if (noUrl && noKey) {
    return "Supabase is not configured — set " + URL_VARS[0] + " and " + KEY_VARS[0] + " (or the NEXT_PUBLIC_ equivalents) and rebuild.";
  }
  if (noUrl) return "Supabase is not configured — " + URL_VARS[0] + " is missing or is not an https:// address.";
  if (noKey) return "Supabase is not configured — " + KEY_VARS[0] + " is missing or is not a valid anon key.";
  return "Supabase is not configured — set " + URL_VARS[0] + " and " + KEY_VARS[0] + " and rebuild.";
}

/**
 * Wrap `fetch` so every request carries an `apikey` header.
 *
 * `supabase-js` does this itself; the wrapper exists so the guarantee does not
 * depend on that staying true, and so a missing key fails here — with a
 * sentence that says what to fix — instead of leaving as a bare request that
 * comes back as `No API key found in request`.
 *
 * Headers already set by the client are never overwritten.
 */
export function createAuthorizedFetch(baseFetch, getKey) {
  return function authorizedFetch(input, init = {}) {
    const key = normalizeKey(getKey());
    if (!key) {
      const error = new Error("No Supabase anon key is configured, so no request was sent.");
      error.code = "SUPABASE_NOT_CONFIGURED";
      return Promise.reject(error);
    }

    const headers = new Headers(init.headers || (input && input.headers) || undefined);
    if (!headers.has("apikey")) headers.set("apikey", key);
    if (!headers.has("authorization")) headers.set("Authorization", "Bearer " + key);

    return baseFetch(input, { ...init, headers });
  };
}
