import { defineConfig, loadEnv } from "vite";

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
  const env = loadEnv(mode, process.cwd(), "");
  const pick = (...keys) => {
    for (const key of keys) {
      const value = (env[key] || process.env[key] || "").trim();
      if (value) return value;
    }
    return "";
  };

  return {
    url: pick("VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
    anonKey: pick("VITE_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"),
    realtime: pick("VITE_SUPABASE_REALTIME", "SUPABASE_REALTIME").toLowerCase() !== "off"
  };
}

export default defineConfig(({ mode }) => {
  const supabase = supabaseEnv(mode);

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
