/**
 * Merchant authentication — Supabase Auth only.
 *
 * There is no demo account and no client-side admin flag: the session comes
 * from Supabase, survives a refresh through the SDK's own token storage, and
 * every merchant write is authorised by row level security on the server.
 */

import { assertConfigured, describeError, supabase } from "../lib/supabase.js";

/**
 * Studio access uses a Gmail account. Normalise once, here, so every caller
 * sends the same address Supabase stored: no leading/trailing whitespace from
 * a paste or a mobile keyboard, and never mixed case.
 */
export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * The one refusal shown to the merchant. A wrong password and an address that
 * has never been confirmed look identical from the login form — both are
 * "that didn't work, check it" — so they share this sentence, which names the
 * Dashboard because that is where an unconfirmed account is fixed.
 */
export const CREDENTIALS_ERROR =
  "Invalid Gmail or password. Please verify your credentials or confirm the account in the Supabase Dashboard.";

/** Shown when the request never reached Supabase — not a credential problem. */
export const NETWORK_ERROR =
  "Couldn't reach Supabase to sign in. Check your connection and try again.";

const AUTH_ERRORS = {
  invalid_credentials: CREDENTIALS_ERROR,
  invalid_grant: CREDENTIALS_ERROR,
  email_not_confirmed: CREDENTIALS_ERROR,
  user_not_found: CREDENTIALS_ERROR,
  over_request_rate_limit: "Too many attempts. Wait a minute and try again.",
  too_many_requests: "Too many attempts. Wait a minute and try again."
};

/** Map a Supabase auth error to the sentence the merchant should read. */
export function describeAuthError(error) {
  if (!error) return "Sign in failed. Please try again.";
  const code = String(error.code || error.error_code || "").toLowerCase();
  if (AUTH_ERRORS[code]) return AUTH_ERRORS[code];

  const status = Number(error.status);
  if (status === 400 || status === 401) return CREDENTIALS_ERROR;

  const message = String(error.message || error.error_description || "").trim();
  if (/invalid login credentials/i.test(message)) return CREDENTIALS_ERROR;
  if (/email not confirmed/i.test(message)) return CREDENTIALS_ERROR;
  if (/rate limit|too many/i.test(message)) return AUTH_ERRORS.too_many_requests;
  if (/failed to fetch|network|load failed/i.test(message)) return NETWORK_ERROR;

  return describeError(error, "Sign in failed. Please try again.");
}

/** Sign a merchant in. Returns { ok, session } or { ok: false, error }. */
export async function signInWithPassword(email, password) {
  const client = assertConfigured();
  const { data, error } = await client.auth.signInWithPassword({
    email: normalizeEmail(email),
    password: String(password || "")
  });

  if (error) {
    // Kept in the console on purpose: the exact Supabase code is the quickest
    // way to tell a wrong password from an address that was never confirmed
    // (Dashboard → Authentication → Users shows the Confirmed column).
    console.warn(
      "[auth] sign-in refused:",
      error.code || error.error_code || error.status || "unknown",
      error.message || ""
    );
    return { ok: false, error: describeAuthError(error) };
  }

  return { ok: true, session: data.session, user: data.user };
}

export async function signOutMerchant() {
  const client = assertConfigured();
  const { error } = await client.auth.signOut();
  return { ok: !error, error: error ? describeAuthError(error) : null };
}

/** The session already on this device, if any (validated against the server). */
export async function getSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session || null;
}

/**
 * Subscribe to sign-in / sign-out / token refresh.
 * Returns an unsubscribe function. Fires once immediately with the current
 * session so callers do not need a separate initial read.
 */
export function onAuthStateChange(handler) {
  if (!supabase) return () => {};

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    handler(session, event);
  });

  return () => {
    try {
      data.subscription.unsubscribe();
    } catch (err) {
      /* already closed */
    }
  };
}
