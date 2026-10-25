/**
 * JSON-safe localStorage wrapper.
 * Storage is injectable so the logic can be unit-tested without a browser.
 */

let backend = null;

/** Swap in a storage implementation (used by tests, or by apps that lazy-init). */
export function setStorageBackend(storage) {
  backend = storage || null;
}

function store() {
  if (backend) return backend;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch (err) {
    return null; // private mode / blocked cookies
  }
}

export function readJSON(key, fallback) {
  const storage = store();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
}

export function writeJSON(key, value) {
  const storage = store();
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    return false; // quota exceeded or blocked
  }
}

export function readRaw(key, fallback) {
  const storage = store();
  if (!storage) return fallback;
  try {
    return storage.getItem(key) || fallback;
  } catch (err) {
    return fallback;
  }
}

export function writeRaw(key, value) {
  const storage = store();
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch (err) {
    return false;
  }
}

export function removeKey(key) {
  const storage = store();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch (err) {
    /* noop */
  }
}
