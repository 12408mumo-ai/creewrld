/**
 * Storefront configuration — single source of truth for the studio.
 * Values here are bundled at build time; nothing is fetched at runtime.
 */

export const CONFIG = {
  store: "CREE WRLD",
  whatsapp: "254719526649",
  phoneDisplay: "0719 526 649"
};

/**
 * The cart and the delivery zone are the only things kept on the device: they
 * are per-shopper scratch state. Catalogue, merchant session and orders all
 * live in Supabase (see src/data/).
 */
export const STORAGE = {
  cart: "creewrld.cart.v1",
  zone: "creewrld.zone.v1"
};

export const CATEGORIES = ["All Items", "Sneakers", "Streetwear", "Old Money", "Y2K"];

/** Product categories only (everything except the "All Items" filter). */
export const PRODUCT_CATEGORIES = CATEGORIES.slice(1);

export const ZONES = {
  "nairobi-core": {
    id: "nairobi-core",
    label: "Nairobi CBD / Westlands / Kilimani / Karen",
    fee: 0,
    note: "Free delivery within Nairobi."
  },
  "nairobi-outer": {
    id: "nairobi-outer",
    label: "Thika Road / Ruiru / Kiambu",
    fee: 200,
    note: "KSh 200 delivery to Thika Road, Ruiru & Kiambu."
  },
  nationwide: {
    id: "nationwide",
    label: "Rest of Kenya",
    fee: 450,
    note: "KSh 450 nationwide courier — 1–3 business days."
  }
};

export const DEFAULT_ZONE = "nairobi-core";

export const CONDITIONS = ["New", "Like New", "Excellent", "Very Good", "Good"];

export const zoneFor = (id) => ZONES[id] || ZONES[DEFAULT_ZONE];
