/**
 * Supabase client — the single connection to the live backend.
 *
 * Credentials are injected at build time by `vite.config.js` from the
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY variables that are
 * already configured in Vercel. `typeof` guards mean the module also loads (as
 * "not configured") under Vitest, where the defines do not exist.
 *
 * The anon key is public by design: every table is protected by row level
 * security (see supabase/schema.sql), never by hiding this key.
 */

import { createClient } from "@supabase/supabase-js";

const url = typeof __SUPABASE_URL__ !== "undefined" ? __SUPABASE_URL__ : "";
const anonKey = typeof __SUPABASE_ANON_KEY__ !== "undefined" ? __SUPABASE_ANON_KEY__ : "";
const realtime = typeof __SUPABASE_REALTIME__ !== "undefined" ? __SUPABASE_REALTIME__ : true;

export const supabaseConfig = {
  url: String(url || "").replace(/\/+$/, ""),
  anonKey: String(anonKey || ""),
  configured: Boolean(url && anonKey)
};

export const REALTIME_ENABLED = Boolean(realtime);

export const CONFIG_ERROR =
  "Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.";

/**
 * The client, or null when the build has no credentials. Callers must check
 * `assertConfigured()` before querying so the failure is a readable message
 * rather than a network error against an empty URL.
 */
export const supabase = supabaseConfig.configured
  ? createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "creewrld.auth.v2"
      },
      global: {
        headers: { "x-application-name": "cree-wrld-storefront" }
      },
      realtime: REALTIME_ENABLED ? undefined : { params: { eventsPerSecond: 0 } }
    })
  : null;

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

  // Postgres / PostgREST vocabulary leaked to the storefront.
  if (/relation .* does not exist|schema cache/i.test(message)) {
    return "The database tables are missing — run supabase/schema.sql in the SQL editor.";
  }
  if (/row-level security/i.test(message)) {
    return "This account is not allowed to change the catalogue. Check the RLS policies.";
  }
  if (/row level security/i.test(message)) {
    return "This account is not allowed to change the catalogue. Check the RLS policies.";
  }
  if (/bucket not found/i.test(message)) {
    return "The product-images storage bucket is missing — run supabase/schema.sql first.";
  }
  if (/payload too large|exceeded the maximum allowed size/i.test(message)) {
    return "That image is too large. Use a file under 6 MB.";
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Can't reach the database. Check the connection and try again.";
  }
  return message;
}
