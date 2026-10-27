/**
 * Supabase client — the single connection to the live backend.
 *
 * Every request the storefront makes (catalogue reads, studio writes, image
 * uploads, order inserts) goes through this one client, which is what
 * guarantees the `apikey` header is on all of them. Nothing in `src/` calls
 * `fetch` against Supabase directly — `grep -rn "fetch(" src/` finds only this
 * module and the wrapper it installs below.
 *
 * Credentials are resolved from the first source that has a usable pair:
 *
 *   1. Vite environment — VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (or the
 *      NEXT_PUBLIC_* names this project already has in Vercel), read straight
 *      from `import.meta.env`;
 *   2. the build-time literals `vite.config.js` injects from the same names;
 *   3. `window.__CREE_WRLD_SUPABASE__ = { url, anonKey }`, set before this
 *      module loads — an escape hatch for a deployment whose environment
 *      variables were missing at build time.
 *
 * The anon key is public by design: every table is protected by row level
 * security (see supabase/schema.sql), never by hiding this key. Only the
 * service_role key is secret, and it is never referenced anywhere in `src/`.
 */

import { createClient } from "@supabase/supabase-js";
import {
  KEY_VARS,
  URL_VARS,
  configErrorFor,
  createAuthorizedFetch,
  keyPreview,
  pickKey,
  pickUrl,
  projectRefOf,
  resolveSupabaseConfig
} from "./supabase-env.js";

const viteEnv = (() => {
  try {
    // Inlined by Vite at build time; present under Vitest too.
    return typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
  } catch (err) {
    return {};
  }
})();

const defines = {
  url: typeof __SUPABASE_URL__ !== "undefined" ? __SUPABASE_URL__ : "",
  anonKey: typeof __SUPABASE_ANON_KEY__ !== "undefined" ? __SUPABASE_ANON_KEY__ : "",
  realtime: typeof __SUPABASE_REALTIME__ !== "undefined" ? __SUPABASE_REALTIME__ : true
};

const runtimeOverride = (() => {
  try {
    const injected = typeof window !== "undefined" ? window.__CREE_WRLD_SUPABASE__ : null;
    return injected && typeof injected === "object" ? injected : {};
  } catch (err) {
    return {};
  }
})();

const resolved = resolveSupabaseConfig([
  { name: "Vite env", url: pickUrl(viteEnv), anonKey: pickKey(viteEnv) },
  { name: "build define", url: defines.url, anonKey: defines.anonKey },
  { name: "window.__CREE_WRLD_SUPABASE__", url: runtimeOverride.url, anonKey: runtimeOverride.anonKey }
]);

export const supabaseConfig = {
  url: resolved.url,
  anonKey: resolved.anonKey,
  configured: resolved.configured,
  /** Where the credentials came from — "Vite env", "build define", … */
  source: resolved.source,
  /** A short, safe fingerprint of the key, for the diagnostics table. */
  keyPreview: keyPreview(resolved.anonKey),
  /** Which Supabase project this build talks to — `xyz` in `xyz.supabase.co`. */
  projectRef: projectRefOf(resolved.url),
  /** Why any earlier source was rejected, e.g. "build define: key is missing". */
  issues: resolved.issues
};

const realtime = String(defines.realtime) !== "false";
export const REALTIME_ENABLED = Boolean(realtime);

export const CONFIG_ERROR = configErrorFor(resolved);

/**
 * The client, or null when the build has no usable credentials. Callers check
 * `assertConfigured()` first, so the failure is a readable sentence rather than
 * a network round-trip against an empty URL.
 */
export const supabase = supabaseConfig.configured
  ? createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      // The storefront does not use Supabase Auth any more: the studio is
      // unlocked with a passphrase in the browser. Leaving session persistence
      // on would make the client hunt for a refresh token on every boot — and
      // fire a doomed request for anyone who signed in before this change.
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      },
      global: {
        headers: {
          apikey: supabaseConfig.anonKey,
          Authorization: "Bearer " + supabaseConfig.anonKey,
          "x-application-name": "cree-wrld-storefront"
        },
        // Belt and braces: even if a future version of supabase-js stopped
        // setting the header, this wrapper puts it back on every request. It
        // also refuses to send a request that would be answered with
        // `No API key found in request`.
        fetch: createAuthorizedFetch(
          (...args) => (typeof fetch === "function" ? fetch(...args) : Promise.reject(new Error("fetch is unavailable"))),
          () => supabaseConfig.anonKey
        )
      },
      realtime: REALTIME_ENABLED ? undefined : { params: { eventsPerSecond: 0 } }
    })
  : null;

// Say out loud what the build decided. A deployment with a URL but no key is
// the exact shape that produces `No API key found in request`, and it is worth
// one console line rather than an afternoon.
if (typeof console !== "undefined") {
  if (supabaseConfig.configured) {
    console.info(
      "[creewrld] Supabase client ready — " +
        supabaseConfig.url +
        " (project " + supabaseConfig.projectRef + ")" +
        " · key " +
        supabaseConfig.keyPreview +
        " (from " +
        supabaseConfig.source +
        ")"
    );
  } else {
    console.error(
      "[creewrld] " +
        CONFIG_ERROR +
        (supabaseConfig.issues.length ? "\n  checked: " + supabaseConfig.issues.join("; ") : "") +
        "\n  set " + URL_VARS[0] + " and " + KEY_VARS[0] + " (or the NEXT_PUBLIC_ equivalents)."
    );
  }
}

/**
 * Tokens left behind by the Supabase Auth era. The app no longer reads them,
 * so they are deleted rather than left to sit in the browser.
 */
try {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.removeItem("creewrld.auth.v2");
  }
} catch (err) {
  /* storage blocked — nothing to clean */
}

export function assertConfigured() {
  if (!supabase) {
    const error = new Error(CONFIG_ERROR);
    error.code = "SUPABASE_NOT_CONFIGURED";
    throw error;
  }
  return supabase;
}

/**
 * Fail a hung request instead of leaving the storefront on "Loading…" forever.
 * Supabase's REST calls have no timeout of their own.
 */
export function withTimeout(promise, ms = 15000, message = "The database took too long to answer.") {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message);
      error.code = "SUPABASE_TIMEOUT";
      reject(error);
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Turn a PostgREST / GoTrue error object into something a merchant can act on. */
export function describeError(error, fallback = "Something went wrong. Please try again.") {
  if (!error) return fallback;
  if (error.code === "SUPABASE_NOT_CONFIGURED") return CONFIG_ERROR;

  const message = String(error.message || error.error_description || error.hint || "").trim();
  if (!message) return fallback;

  // The gateway refusing the request before it reaches the database.
  if (/no api key found|missing api key|invalid api key|jwt.*(invalid|malformed)/i.test(message)) {
    return "The Supabase anon key is missing or wrong in this build. Set " +
      KEY_VARS[0] + " (or NEXT_PUBLIC_SUPABASE_ANON_KEY) and redeploy.";
  }

  // Postgres / PostgREST vocabulary leaked to the storefront.
  // A 404 from PostgREST means "this project has no such table in its schema
  // cache" — almost always the wrong project, or a schema that was never run.
  // Naming the project is what turns that into a one-minute fix.
  if (/relation .* does not exist|schema cache|could not find the table/i.test(message)) {
    return (
      "The tables are missing from this Supabase project (" +
      (supabaseConfig.projectRef || "unknown project") +
      "). Run supabase/schema.sql there — or check that the deployment points at the right project."
    );
  }
  if (/row-level security|row level security/i.test(message)) {
    return "This account is not allowed to change the catalogue. Check the RLS policies.";
  }
  if (/bucket not found|bucket not exist/i.test(message)) {
    return (
      "The product-images storage bucket is missing from this Supabase project (" +
      (supabaseConfig.projectRef || "unknown project") +
      "). Run supabase/schema.sql there first."
    );
  }
  if (/payload too large|exceeded the maximum allowed size/i.test(message)) {
    return "That image is too large. Use a file under 6 MB.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Can't reach the database. Check the connection and try again.";
  }
  return message;
}
