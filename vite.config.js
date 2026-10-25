import { defineConfig } from "vite";

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

export default defineConfig({
  // Relative base keeps the build portable: it works at a domain root, in a
  // subdirectory, and behind the sandbox preview host.
  base: "./",

  plugins: [
    fontPreload([
      "bodoni-moda-latin-wght-normal",
      "inter-latin-wght-normal",
      "unifrakturcook-gothic"
    ])
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
});
