/**
 * Asset resolution for product imagery.
 *
 * A product's image_url may be a bundled path ("assets/img/sneaker-mocha.jpg"),
 * a Supabase Storage public URL, or any external https:// URL. Vite fingerprints
 * the bundled files at build time, so every render resolves a bundled path to
 * the emitted URL — which keeps all three kinds working at once.
 */

const modules = import.meta.glob("../assets/img/*.jpg", {
  eager: true,
  query: "?url",
  import: "default"
});

const byFilename = new Map();
for (const [path, url] of Object.entries(modules)) {
  byFilename.set(path.split("/").pop(), url);
}

export const PLACEHOLDER =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1125" viewBox="0 0 900 1125">' +
      '<rect width="900" height="1125" fill="#0f0f0f"/>' +
      '<g fill="none" stroke="#2a2a2a" stroke-width="2"><rect x="24" y="24" width="852" height="1077"/></g>' +
      '<text x="450" y="560" fill="#4a4a4a" font-family="Georgia, serif" font-size="40" letter-spacing="14" text-anchor="middle">CREE WRLD</text>' +
      '<text x="450" y="606" fill="#333" font-family="monospace" font-size="18" letter-spacing="6" text-anchor="middle">IMAGE UNAVAILABLE</text>' +
      "</svg>"
  );

/** Number of bundled lookbook images — used by the smoke test. */
export const bundledImageCount = byFilename.size;

/** Map a stored image value to the URL the browser should load. */
export function resolveImage(src) {
  const value = String(src == null ? "" : src).trim();
  if (!value) return PLACEHOLDER;

  const filename = value.split("?")[0].split("#")[0].split("/").pop();
  if (byFilename.has(filename)) return byFilename.get(filename);

  return value;
}
