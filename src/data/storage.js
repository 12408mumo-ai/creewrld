/**
 * Product imagery → Supabase Storage.
 *
 * Files land in the public `product-images` bucket and the public URL is what
 * gets written to `products.image_url`, so the grid can render it directly.
 */

import { assertConfigured, describeError } from "../lib/supabase.js";

export const BUCKET = "product-images";
export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif"
};

const slugify = (value) =>
  String(value || "piece")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "piece";

const randomId = () => {
  try {
    return crypto.randomUUID();
  } catch (err) {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
};

/** Client-side guard so a 20 MB photo fails instantly instead of mid-upload. */
export function validateImage(file) {
  if (!file) return "Choose an image file to upload.";
  if (!ACCEPTED_TYPES.includes(file.type)) return "Use a JPG, PNG, WebP or AVIF image.";
  if (file.size > MAX_UPLOAD_BYTES) return "That image is over 6 MB — resize it and try again.";
  return null;
}

/**
 * Upload one image and return its public URL.
 * Path: <uuid>-<title-slug>.<ext> — unique per upload, readable in the bucket.
 */
export async function uploadProductImage(file, { title = "piece" } = {}) {
  const client = assertConfigured();

  const invalid = validateImage(file);
  if (invalid) throw new Error(invalid);

  const extension = EXTENSIONS[file.type] || "jpg";
  const path = `${slugify(title)}-${randomId().slice(0, 8)}.${extension}`;

  const { error } = await client.storage.from(BUCKET).upload(path, file, {
    cacheControl: "31536000",
    contentType: file.type,
    upsert: false
  });

  if (error) throw new Error(describeError(error, "Couldn't upload that image."));

  const { data } = client.storage.from(BUCKET).getPublicUrl(path);
  if (!data || !data.publicUrl) throw new Error("Uploaded, but no public URL came back.");
  return data.publicUrl;
}

export { slugify };
