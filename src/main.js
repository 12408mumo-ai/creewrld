/**
 * Entry point. Vite processes the stylesheet (hashed fonts, minified CSS) and
 * the ES module graph from here.
 */

import "./styles/main.css";
import { app, boot } from "./app.js";
import { supabaseConfig } from "./lib/supabase.js";

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

/**
 * One line in the browser console that explains the merchant chrome:
 * `creewrldStudio()`. It reports what the studio lock believes, what
 * sessionStorage holds, and whether the bar and card buttons are showing —
 * the four facts needed when a merchant says the controls did not appear.
 */
if (typeof window !== "undefined") {
  window.creewrldStudio = app.studioState;

  /**
   * `creewrldConfig()` answers the other half of a broken deployment: which
   * Supabase project this build points at, whether it has a key, and where that
   * key came from. A missing key is the cause of the API error
   * `No API key found in request`, so the fact is one console line away.
   */
  window.creewrldConfig = () => ({
    url: supabaseConfig.url || null,
    configured: supabaseConfig.configured,
    source: supabaseConfig.source || null,
    keyPreview: supabaseConfig.keyPreview || null,
    issues: supabaseConfig.issues
  });
}
