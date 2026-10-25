/**
 * A tiny in-process stand-in for a Supabase project, used by the e2e suite.
 *
 * The app under test is the real production build with the real
 * @supabase/supabase-js client: no mock code ships in the bundle. This module
 * intercepts the HTTP traffic that client would send to Supabase and answers it
 * with a small stateful dataset, so the suite verifies the actual query shapes,
 * payloads and auth flow.
 *
 * Endpoints covered:
 *   POST   /auth/v1/token?grant_type=password|refresh_token
 *   GET    /auth/v1/user            POST /auth/v1/logout
 *   GET    /rest/v1/products        POST /rest/v1/products
 *   PATCH  /rest/v1/products        DELETE /rest/v1/products
 *   GET    /rest/v1/categories
 *   POST   /rest/v1/orders          GET /rest/v1/orders
 *   POST   /storage/v1/object/product-images/<path>
 */

export const STUB_ORIGIN = "https://stub.supabase.co";
export const STUB_ANON_KEY = "stub-anon-key";

export const SEED_ROWS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Mocha Suede High-Top",
    category_id: "c-sneakers",
    price: 6500,
    condition: "Excellent",
    sizes: ["41", "42", "43", "44"],
    image_url: "assets/img/sneaker-mocha.jpg",
    description: "Mocha suede and sail leather high-top, laces replaced.",
    created_at: "2026-01-09T10:00:00.000Z"
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Chrome Runner '03",
    category_id: "c-sneakers",
    price: 5200,
    condition: "Very Good",
    sizes: ["40", "41", "42", "44"],
    image_url: "assets/img/sneaker-silver.jpg",
    description: "Metallic silver technical runner with layered mesh.",
    created_at: "2026-01-08T10:00:00.000Z"
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    title: "Noir Utility Cargo",
    category_id: "c-streetwear",
    price: 3200,
    condition: "Like New",
    sizes: ["S", "M", "L", "XL"],
    image_url: "assets/img/cargo-street.jpg",
    description: "Oversized black ripstop cargos with six pockets.",
    created_at: "2026-01-07T10:00:00.000Z"
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    title: "Charcoal Wool Blazer",
    category_id: "c-old-money",
    price: 8900,
    condition: "Excellent",
    sizes: ["48", "50", "52"],
    image_url: "assets/img/blazer-wool.jpg",
    description: "Double-breasted charcoal wool blazer, half-canvassed.",
    created_at: "2026-01-06T10:00:00.000Z"
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    title: "Silver Mesh Halter Set",
    category_id: "c-y2k",
    price: 4200,
    condition: "Excellent",
    sizes: ["S", "M"],
    image_url: "assets/img/tank-y2k.jpg",
    description: "Metallic silver mesh halter with a matching low-rise skirt.",
    created_at: "2026-01-05T10:00:00.000Z"
  }
];

const CATEGORY_ROWS = [
  { id: "c-sneakers", name: "Sneakers", slug: "sneakers", sort_order: 1 },
  { id: "c-streetwear", name: "Streetwear", slug: "streetwear", sort_order: 2 },
  { id: "c-old-money", name: "Old Money", slug: "old-money", sort_order: 3 },
  { id: "c-y2k", name: "Y2K", slug: "y2k", sort_order: 4 }
];

/** A 1×1 PNG returned for any public object, so uploaded images render. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64"
);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "*"
};

const json = (body, status = 200) => ({
  status,
  headers: { ...CORS, "content-type": "application/json" },
  body: JSON.stringify(body)
});

const uuid = () => crypto.randomUUID();

/**
 * @param {object} options
 * @param {string} options.email     merchant email that exists
 * @param {string} options.password  its password
 */
export function createSupabaseStub({ email = "owner@creewrld.test", password = "creewrld" } = {}) {
  const state = {
    products: SEED_ROWS.map((row) => ({ ...row })),
    orders: [],
    uploads: [],
    /** Every request the client made, for assertions. */
    calls: [],
    /** When set, the next write fails with this message. */
    failNextWrite: null,
    /** When true, pretend the whole backend is unreachable. */
    offline: false,
    token: null,
    signedIn: false
  };

  const withCategory = (row) => ({
    ...row,
    categories: CATEGORY_ROWS.find((c) => c.id === row.category_id) || null
  });

  const user = () => ({ id: "u-owner", aud: "authenticated", role: "authenticated", email });

  const parseFilters = (url) => {
    const filters = [];
    url.searchParams.forEach((value, key) => {
      if (["select", "order", "limit", "offset", "apikey", "columns"].includes(key)) return;
      const match = /^eq\.(.*)$/.exec(value);
      if (match) filters.push([key, match[1]]);
    });
    return filters;
  };

  const applyFilters = (rows, url) =>
    parseFilters(url).reduce(
      (acc, [column, value]) => acc.filter((row) => String(row[column]) === String(value)),
      rows
    );

  function handleAuth(request, url, method, body) {
    if (url.pathname === "/auth/v1/token") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const { email: givenEmail, password: givenPassword } = body || {};
        if (String(givenEmail).trim().toLowerCase() !== email.toLowerCase() || givenPassword !== password) {
          return json({ error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials" }, 400);
        }
        state.signedIn = true;
        state.token = "stub-access-token";
        return json({
          access_token: state.token,
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: "stub-refresh-token",
          user: user()
        });
      }
      if (grant === "refresh_token") {
        return json({
          access_token: "stub-access-token",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: "stub-refresh-token",
          user: user()
        });
      }
    }

    if (url.pathname === "/auth/v1/user" && method === "GET") {
      if (!state.signedIn) return json({ message: "JWT expired" }, 401);
      return json(user());
    }

    if (url.pathname === "/auth/v1/logout") {
      state.signedIn = false;
      state.token = null;
      return { status: 204, headers: CORS, body: "" };
    }

    if (url.pathname === "/auth/v1/settings") {
      return json({ external: {}, disable_signup: true, mailer_autoconfirm: false });
    }

    return null;
  }

  function handleRest(request, url, method, body) {
    const table = url.pathname.replace("/rest/v1/", "");

    if (table === "products") {
      if (method === "HEAD") {
        // PostgREST count query: the count lives in content-range.
        const total = applyFilters(state.products, url).length;
        return {
          status: 200,
          headers: { ...CORS, "content-range": `0-${Math.max(0, total - 1)}/${total}` },
          body: ""
        };
      }

      if (method === "GET") {
        const rows = applyFilters(state.products, url)
          .slice()
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
          .map(withCategory);
        return json(rows);
      }

      const authorised = state.signedIn;
      if (!authorised) {
        return json({ code: "42501", message: "new row violates row-level security policy for table \"products\"" }, 403);
      }
      if (state.failNextWrite) {
        const message = state.failNextWrite;
        state.failNextWrite = null;
        return json({ code: "42501", message }, 403);
      }

      if (method === "POST") {
        const batch = Array.isArray(body) ? body : [body];
        const created = batch.map((row) => ({
          id: uuid(),
          created_at: new Date().toISOString(),
          ...row
        }));
        state.products.unshift(...created);
        return json(created.map(withCategory), 201);
      }

      if (method === "PATCH") {
        const ids = parseFilters(url).filter(([column]) => column === "id").map(([, value]) => value);
        const updated = [];
        state.products = state.products.map((row) => {
          if (!ids.includes(row.id)) return row;
          const next = { ...row, ...body };
          updated.push(next);
          return next;
        });
        return json(updated.map(withCategory));
      }

      if (method === "DELETE") {
        const ids = parseFilters(url).filter(([column]) => column === "id").map(([, value]) => value);
        state.products = state.products.filter((row) => !ids.includes(row.id));
        return { status: 204, headers: CORS, body: "" };
      }
    }

    if (table === "categories" && method === "GET") {
      return json(CATEGORY_ROWS.map((row) => ({ ...row })));
    }

    if (table === "orders") {
      if (method === "POST") {
        const batch = Array.isArray(body) ? body : [body];
        const created = batch.map((row) => ({
          id: uuid(),
          created_at: new Date().toISOString(),
          ...row
        }));
        state.orders.unshift(...created);
        return json(created, 201);
      }
      if (method === "GET") {
        if (!state.signedIn) return json({ message: "permission denied" }, 403);
        return json(state.orders);
      }
    }

    return null;
  }

  function handleStorage(request, url, method) {
    // Public object read — what <img src> hits after a successful upload.
    if (url.pathname.startsWith("/storage/v1/object/public/product-images/")) {
      return {
        status: 200,
        headers: { ...CORS, "content-type": "image/png", "cache-control": "public, max-age=31536000" },
        body: PIXEL
      };
    }

    if (url.pathname.startsWith("/storage/v1/object/product-images/")) {
      const path = url.pathname.replace("/storage/v1/object/product-images/", "");
      if (method === "POST" || method === "PUT") {
        if (!state.signedIn) return json({ statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" }, 403);
        state.uploads.push(path);
        return json({ Key: `product-images/${path}`, Id: uuid() });
      }
      return json({});
    }
    return null;
  }

  /** Wire the stub into a Puppeteer page. Returns the state object. */
  async function attach(page) {
    await page.setRequestInterception(true);

    page.on("request", async (request) => {
      const requestUrl = request.url();
      if (!requestUrl.startsWith(STUB_ORIGIN)) {
        request.continue().catch(() => {});
        return;
      }

      const url = new URL(requestUrl);
      const method = request.method().toUpperCase();

      if (method === "OPTIONS") {
        request.respond({ status: 204, headers: CORS, body: "" }).catch(() => {});
        return;
      }

      let body = null;
      try {
        if (request.postData()) body = JSON.parse(request.postData());
      } catch (err) {
        body = null;
      }

      state.calls.push({
        method,
        path: url.pathname,
        query: url.search,
        body,
        signedIn: state.signedIn
      });

      if (state.offline) {
        request.abort("failed").catch(() => {});
        return;
      }

      let response =
        handleAuth(request, url, method, body) ||
        handleRest(request, url, method, body) ||
        handleStorage(request, url, method) ||
        json({ message: "stub: unhandled " + method + " " + url.pathname }, 404);

      // `.single()` asks for a single object via content negotiation.
      const accept = String((request.headers() && request.headers().accept) || "");
      if (/pgrst\.object/.test(accept) && response.body) {
        try {
          const parsed = JSON.parse(response.body);
          if (Array.isArray(parsed)) {
            response = { ...response, body: JSON.stringify(parsed[0] === undefined ? null : parsed[0]) };
          }
        } catch (err) {
          /* not JSON */
        }
      }

      request.respond(response).catch(() => {});
    });

    return state;
  }

  return {
    state,
    attach,
    rows: () => state.products,
    orders: () => state.orders,
    uploads: () => state.uploads,
    calls: () => state.calls,
    reset() {
      state.products = SEED_ROWS.map((row) => ({ ...row }));
      state.orders = [];
      state.uploads = [];
      state.calls = [];
      state.failNextWrite = null;
      state.offline = false;
      state.signedIn = false;
      state.token = null;
    }
  };
}
