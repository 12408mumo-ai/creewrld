/** Small, dependency-free formatting + DOM helpers. */

export const $ = (selector, root = document) => root.querySelector(selector);

export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** Escape a value for safe interpolation into HTML. */
export const esc = (value) =>
  String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[ch]);

/** Format an integer amount as Kenyan Shillings: 6500 → "KSh 6,500". */
export const money = (n) => "KSh " + Math.round(Number(n) || 0).toLocaleString("en-KE");

/** Collision-resistant id, used when a row arrives without one. */
export const uid = () => "cw-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const sum = (list, pick) => list.reduce((total, item) => total + pick(item), 0);

/** Resolve a relative asset path against the current document (for WhatsApp links). */
export const absoluteUrl = (src, base) => {
  try {
    return new URL(src, base || (typeof window !== "undefined" ? window.location.href : undefined)).href;
  } catch (err) {
    return String(src || "");
  }
};

/** Turn "S, M, L" or ["S","M","L"] into a clean size array. */
export const normalizeSizes = (value) => {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  const sizes = list.map((size) => String(size).trim()).filter(Boolean);
  return sizes.length ? sizes : ["One size"];
};

export const pad2 = (n) => String(n).padStart(2, "0");

export const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-");
