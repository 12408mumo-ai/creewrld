/**
 * Minimal static server for the CREE WRLD storefront.
 * No dependencies — Node 18+.
 *
 *   node server.js            → http://0.0.0.0:4173
 *   PORT=8080 node server.js
 *
 * The storefront itself is a static single page; this server only exists so the
 * project can be previewed locally with correct MIME types and no CORS friction.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

const server = http.createServer((req, res) => {
  const started = Date.now();
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch (err) {
    res.writeHead(400).end("Bad request");
    return;
  }

  if (pathname === "/") pathname = "/index.html";

  const filePath = path.join(ROOT, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Single-page style fallback for deep links
      const fallback = path.join(ROOT, "index.html");
      fs.readFile(fallback, (fallbackErr, content) => {
        if (fallbackErr) {
          res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" }).end(content);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    const noCache = ext === ".html" || ext === ".js" || ext === ".css";

    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": stats.size,
      "Cache-Control": noCache ? "no-cache" : "public, max-age=86400",
      "X-Content-Type-Options": "nosniff"
    });

    if (req.method === "HEAD") { res.end(); return; }
    fs.createReadStream(filePath).pipe(res).on("finish", () => {
      if (process.env.LOG) console.log(`${res.statusCode} ${req.method} ${pathname} ${Date.now() - started}ms`);
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`CREE WRLD storefront → http://${HOST}:${PORT}`);
});
