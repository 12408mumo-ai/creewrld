/**
 * Bundled lookbook — the images the hero figure rotates through.
 *
 * Image paths stay as "assets/img/<file>.jpg"; `resolveImage()` in
 * lib/images.js maps them to the hashed URLs Vite emits at build time.
 *
 * There is no seeded catalogue here: the pieces themselves live in Supabase and
 * are curated by hand in the Dashboard.
 */

/** Lookbook rotation shown in the hero figure. */
export const HERO_SLIDES = [
  { image: "assets/img/sneaker-mocha.jpg", title: "Mocha Suede High-Top" },
  { image: "assets/img/bomber-varsity.jpg", title: "Varsity Wool Bomber" },
  { image: "assets/img/blazer-wool.jpg", title: "Charcoal Wool Blazer" },
  { image: "assets/img/tank-y2k.jpg", title: "Silver Mesh Halter Set" }
];
