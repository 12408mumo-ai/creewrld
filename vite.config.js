import { defineConfig, loadEnv } from "vite";
import { KEY_VARS, URL_VARS, pickEnv, pickKey, pickUrl, resolveSupabaseConfig } from "./src/lib/supabase-env.js";

/**
 * Inject <link rel="preload"> hints for the fonts that paint the first screen.
 * Vite hashes font filenames, so the URLs can only be known once the bundle is
 * built — this plugin reads the emitted bundle and writes the real hrefs.
 */
function fontPreload(needles) {
  let base = "./";

  return {
    name: "creewrld:font-preload",
    apply: "build",
    configResolved(config) {
      base = config.base || "./";
    },
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (!ctx.bundle) return html;

        const prefix = /^\.?\/$/.test(base) || base === "./" ? "./" : base.endsWith("/") ? base : base + "/";
        const fonts = Object.keys(ctx.bundle).filter(
          (file) => file.endsWith(".woff2") && needles.some((needle) => file.includes(needle))
        );

        if (!fonts.length) return html;

        return {
          html,
          tags: fonts.map((file) => ({
            tag: "link",
            attrs: {
              rel: "preload",
              href: prefix + file,
              as: "font",
              type: "font/woff2",
              crossorigin: ""
            },
            injectTo: "head-prepend"
          }))
        };
      }
    }
  };
}

/**
 * Resolve the Supabase credentials at build time.
 *
 * The project stores its keys as NEXT_PUBLIC_* (the names Vercel already has),
 * but this is a Vite app: `process.env` does not exist in the browser and only
 * `import.meta.env.VITE_*` is inlined. So the values are read here — from .env
 * files or from the build environment — and injected as compile-time literals.
 * Both names work, so no Vercel variable needs renaming.
 *
 * Only the anon key ever reaches the bundle. It is designed to be public; row
 * level security is what protects the data. Never add the service_role key here.
 */
function supabaseEnv(mode) {
  // `.env`, `.env.local`, `.env.[mode]` — every file Vite would read — plus the
  // real process environment, which is where Vercel puts its variables.
  const env = loadEnv(mode, process.cwd(), "");
  const combined = { ...env, ...process.env };

  const resolved = resolveSupabaseConfig([
    { name: "environment", url: pickUrl(combined), anonKey: pickKey(combined) }
  ]);

  const realtimeValue = String(pickEnv(combined, ["VITE_SUPABASE_REALTIME", "SUPABASE_REALTIME"])).toLowerCase();

  return {
    url: resolved.url,
    anonKey: resolved.anonKey,
    configured: resolved.configured,
    realtime: realtimeValue !== "off"
  };
}

/**
 * A build without credentials ships an app that cannot talk to the database —
 * every request comes back `No API key found in request`. That is worth saying
 * out loud at build time, with the exact variable names, rather than leaving it
 * to be discovered in the browser.
 */
function reportSupabase(credentials) {
  if (credentials.configured) {
    const preview = credentials.anonKey.slice(0, 12) + "…";
    const ref = credentials.url.replace(/^https?:\/\//i, "").split(".")[0];
    console.log("\n  Supabase   " + credentials.url + " · project " + ref + " · key " + preview + "\n");
    return;
  }

  const lines = [
    "",
    "  ⚠  Supabase credentials not found — this build cannot reach the database.",
    "     A URL without a key produces \"No API key found in request\" in the browser.",
    "",
    "     Set one of " + URL_VARS.slice(0, 2).join(" / "),
    "     and one of " + KEY_VARS.slice(0, 3).join(" / "),
    "     then rebuild. Locally that means .env.local; on Vercel, Project →",
    "     Settings → Environment Variables (and redeploy afterwards).",
    ""
  ];
  console.warn(lines.join("\n"));

  if (process.env.CI && !process.env.ALLOW_UNCONFIGURED_SUPABASE) {
    console.warn("  (CI build — continuing anyway; set ALLOW_UNCONFIGURED_SUPABASE=1 to silence this.)\n");
  }
}

export default defineConfig(({ command, mode }) => {
  const supabase = supabaseEnv(mode);
  if (command === "build") reportSupabase(supabase);

  return {
  // Relative base keeps the build portable: it works at a domain root, in a
  // subdirectory, and behind the sandbox preview host.
  base: "./",

  define: {
    __SUPABASE_URL__: JSON.stringify(supabase.url),
    __SUPABASE_ANON_KEY__: JSON.stringify(supabase.anonKey),
    __SUPABASE_REALTIME__: JSON.stringify(supabase.realtime)
  },

  plugins: [
    fontPreload(["bodoni-moda-latin-wght-normal", "inter-latin-wght-normal"])
  ],

  server: {
    host: true, // 0.0.0.0 — reachable through the preview proxy
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
    allowedHosts: true,
    cors: true
  },

  preview: {
    host: true,
    port: Number(process.env.PORT) || 4173,
    strictPort: false,
    allowedHosts: true,
    cors: true
  },

  build: {
    target: "es2020",
    outDir: "dist",
    assetsDir: "assets",
    cssCodeSplit: false,
    // Keep every font and image as a hashed file so it can be cached and
    // preloaded; nothing is inlined into the CSS.
    assetsInlineLimit: 0,
    sourcemap: false,
    reportCompressedSize: false
  },

  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.js"],
    reporters: "dot"
  }
  };
});
