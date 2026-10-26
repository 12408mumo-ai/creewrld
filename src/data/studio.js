/**
 * Studio access — one passphrase, held for the tab.
 *
 * There is no Supabase Auth, no account and no server-side session. The
 * passphrase is compared in the browser and the result is kept in
 * sessionStorage, so a reload keeps the merchant in and closing the tab
 * drops them out.
 *
 * Understand what this is: the expected passphrase ships inside the
 * JavaScript bundle, and administration happens with the public anon key.
 * It keeps visitors out of the merchant controls; it is not a security
 * boundary. Anything that needs one lives in Supabase's policies — see
 * supabase/studio-access.sql for the trade-off and how to undo it.
 */

/** The studio passphrase. Changing it means redeploying the site. */
export const STUDIO_PASSPHRASE = "creewrld.com";

/** sessionStorage key, exactly as the brief specified. */
export const STUDIO_KEY = "isAdmin";

let backend = null;

/**
 * Swap in a storage implementation (tests pass a fake; the browser uses
 * window.sessionStorage). Kept injectable because sessionStorage throws in
 * private mode and in Node.
 */
export function setStudioStorage(storage) {
  backend = storage || null;
}

function store() {
  if (backend) return backend;
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch (err) {
    return null; // private mode / blocked storage
  }
}

/** Trimmed and case-insensitive: phone keyboards like to capitalise. */
export function normalizePassphrase(value) {
  return String(value ?? "").trim().toLowerCase();
}

/** True when the passphrase matches. Does not touch storage. */
export function passphraseMatches(value) {
  return normalizePassphrase(value) === STUDIO_PASSPHRASE;
}

/** Compare, and remember on success. Returns true when the studio opened. */
export function unlockStudio(value) {
  if (!passphraseMatches(value)) return false;

  const storage = store();
  if (storage) {
    try {
      storage.setItem(STUDIO_KEY, "true");
    } catch (err) {
      /* storage blocked — the session lasts until reload, which is fine */
    }
  }

  return true;
}

/** True when this tab already unlocked the studio. */
export function isStudioUnlocked() {
  const storage = store();
  if (!storage) return false;
  try {
    return storage.getItem(STUDIO_KEY) === "true";
  } catch (err) {
    return false;
  }
}

/** Forget the unlock, on this tab. */
export function lockStudio() {
  const storage = store();
  if (!storage) return;
  try {
    storage.removeItem(STUDIO_KEY);
  } catch (err) {
    /* nothing to clear */
  }
}
