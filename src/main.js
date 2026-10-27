/**
 * Entry point. Vite processes the stylesheet (hashed fonts, minified CSS) and
 * the ES module graph from here.
 */

import "./styles/main.css";
import { boot } from "./app.js";
import { supabaseConfig } from "./lib/supabase.js";

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

/**
 * One line in the browser console that explains a broken deployment:
 * `creewrldConfig()` answers which Supabase project this build points at,
 * whether it has a key, and where that key came from. A missing key is the
 * cause of the API error `No API key found in request`.
 */
if (typeof window !== "undefined") {
  window.creewrldConfig = () => ({
    url: supabaseConfig.url || null,
    projectRef: supabaseConfig.projectRef || null,
    configured: supabaseConfig.configured,
    source: supabaseConfig.source || null,
    keyPreview: supabaseConfig.keyPreview || null,
    issues: supabaseConfig.issues
  });
}
