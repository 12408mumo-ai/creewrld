/**
 * Entry point. Vite processes the stylesheet (hashed fonts, minified CSS) and
 * the ES module graph from here.
 */

import "./styles/main.css";
import { app, boot } from "./app.js";

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
}
