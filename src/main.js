/**
 * Entry point. Vite processes the stylesheet (hashed fonts, minified CSS) and
 * the ES module graph from here.
 */

import "./styles/main.css";
import { boot } from "./app.js";

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
