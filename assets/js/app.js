/* ==========================================================================
   CREE WRLD — storefront application
   Vanilla JS · no dependencies · localStorage persistence
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------------------------------------------------------------- *
   *  Config
   * ---------------------------------------------------------------------- */
  const CONFIG = {
    whatsapp: "254719526649",
    phoneDisplay: "0719 526 649",
    store: "CREE WRLD",
    storage: {
      products: "creewrld.products.v1",
      cart: "creewrld.cart.v1",
      zone: "creewrld.zone.v1",
      session: "creewrld.session.v1"
    },
    credentials: { username: "admin", password: "creewrld" },
    sessionHours: 12,
    zones: {
      "nairobi-core": {
        id: "nairobi-core",
        label: "Nairobi CBD / Westlands / Kilimani / Karen",
        fee: 0,
        note: "Free delivery within Nairobi."
      },
      "nairobi-outer": {
        id: "nairobi-outer",
        label: "Thika Road / Ruiru / Kiambu",
        fee: 200,
        note: "KSh 200 delivery to Thika Road, Ruiru & Kiambu."
      },
      nationwide: {
        id: "nationwide",
        label: "Rest of Kenya",
        fee: 450,
        note: "KSh 450 nationwide courier — 1–3 business days."
      }
    }
  };

  const CATEGORIES = ["All Items", "Sneakers", "Streetwear", "Old Money", "Y2K"];

  const HERO_SLIDES = [
    { image: "assets/img/sneaker-mocha.jpg", title: "Mocha Suede High-Top" },
    { image: "assets/img/bomber-varsity.jpg", title: "Varsity Wool Bomber" },
    { image: "assets/img/blazer-wool.jpg", title: "Charcoal Wool Blazer" },
    { image: "assets/img/tank-y2k.jpg", title: "Silver Mesh Halter Set" }
  ];

  /* ---------------------------------------------------------------------- *
   *  Tiny helpers
   * ---------------------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (value) =>
    String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch]));

  const money = (n) => "KSh " + Math.round(Number(n) || 0).toLocaleString("en-KE");
  const uid = () => "cw-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const sum = (arr, pick) => arr.reduce((total, item) => total + pick(item), 0);
  const absoluteUrl = (src) => {
    try { return new URL(src, window.location.href).href; } catch (err) { return String(src || ""); }
  };

  const readJSON = (key, fallback) => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  };
  const writeJSON = (key, value) => {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* storage full or blocked */ }
  };
  const removeKey = (key) => {
    try { window.localStorage.removeItem(key); } catch (err) { /* noop */ }
  };

  const PLACEHOLDER =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1125" viewBox="0 0 900 1125">' +
      '<rect width="900" height="1125" fill="#0f0f0f"/>' +
      '<g fill="none" stroke="#2a2a2a" stroke-width="2"><rect x="24" y="24" width="852" height="1077"/></g>' +
      '<text x="450" y="560" fill="#4a4a4a" font-family="Georgia, serif" font-size="40" letter-spacing="14" text-anchor="middle">CREE WRLD</text>' +
      '<text x="450" y="606" fill="#333" font-family="monospace" font-size="18" letter-spacing="6" text-anchor="middle">IMAGE UNAVAILABLE</text>' +
      "</svg>"
    );

  /* ---------------------------------------------------------------------- *
   *  State + persistence
   * ---------------------------------------------------------------------- */
  const SEED = Array.isArray(window.CREE_SEED) ? window.CREE_SEED : [];

  const state = {
    products: [],
    cart: [],
    filter: "All Items",
    zone: "nairobi-core",
    admin: false,
    qv: { id: null, size: null },
    order: null,
    pending: null,
    confirm: null
  };

  function normalizeProduct(raw) {
    if (!raw || typeof raw !== "object") return null;
    const title = String(raw.title || "").trim();
    const price = Math.round(Number(raw.price));
    if (!title || !Number.isFinite(price) || price <= 0) return null;
    const sizes = Array.isArray(raw.sizes)
      ? raw.sizes.map((s) => String(s).trim()).filter(Boolean)
      : String(raw.sizes || "").split(",").map((s) => s.trim()).filter(Boolean);
    return {
      id: String(raw.id || uid()),
      title,
      category: CATEGORIES.slice(1).indexOf(raw.category) > -1 ? raw.category : "Streetwear",
      price,
      condition: String(raw.condition || "Excellent"),
      sizes: sizes.length ? sizes : ["One size"],
      image: String(raw.image || "").trim() || PLACEHOLDER,
      description: String(raw.description || "").trim(),
      addedAt: Number(raw.addedAt) || Date.now()
    };
  }

  function normalizeProducts(list) {
    if (!Array.isArray(list) || !list.length) return SEED.map(normalizeProduct).filter(Boolean);
    return list.map(normalizeProduct).filter(Boolean);
  }

  function loadProducts() {
    return normalizeProducts(readJSON(CONFIG.storage.products, null));
  }

  function saveProducts() {
    writeJSON(CONFIG.storage.products, state.products);
  }

  function loadCart() {
    const raw = readJSON(CONFIG.storage.cart, []);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((line) => {
        const product = state.products.find((p) => p.id === line.id);
        if (!product) return null;
        const size = product.sizes.indexOf(line.size) > -1 ? line.size : product.sizes[0];
        const qty = Math.max(1, Math.min(9, Number(line.qty) || 1));
        return { id: product.id, size, qty };
      })
      .filter(Boolean);
  }

  function saveCart() {
    writeJSON(CONFIG.storage.cart, state.cart);
  }

  function loadZone() {
    const saved = readJSON(CONFIG.storage.zone, null);
    if (saved && CONFIG.zones[saved]) return saved;
    try { return window.localStorage.getItem(CONFIG.storage.zone) || "nairobi-core"; } catch (e) { return "nairobi-core"; }
  }

  function saveZone() {
    try { window.localStorage.setItem(CONFIG.storage.zone, state.zone); } catch (err) { /* noop */ }
  }

  function loadSession() {
    const s = readJSON(CONFIG.storage.session, null);
    if (!s || !s.user || !s.expires) return false;
    if (Date.now() > s.expires) { removeKey(CONFIG.storage.session); return false; }
    return true;
  }

  state.products = loadProducts();
  state.cart = loadCart();
  state.zone = CONFIG.zones[loadZone()] ? loadZone() : "nairobi-core";
  state.admin = loadSession();
  saveProducts();
  saveCart();

  /* ---------------------------------------------------------------------- *
   *  Derived data
   * ---------------------------------------------------------------------- */
  const getProduct = (id) => state.products.find((p) => p.id === id) || null;

  function visibleProducts() {
    if (state.filter === "All Items") return state.products;
    return state.products.filter((p) => p.category === state.filter);
  }

  function cartLines() {
    return state.cart
      .map((line) => {
        const product = getProduct(line.id);
        if (!product) return null;
        return { product, size: line.size, qty: line.qty, lineTotal: product.price * line.qty };
      })
      .filter(Boolean);
  }

  function cartTotals() {
    const lines = cartLines();
    const count = sum(lines, (l) => l.qty);
    const subtotal = sum(lines, (l) => l.lineTotal);
    const zone = CONFIG.zones[state.zone] || CONFIG.zones["nairobi-core"];
    const fee = lines.length ? zone.fee : 0;
    return { lines, count, subtotal, fee, total: subtotal + fee, zone };
  }

  function orderTotals(items, zoneId) {
    const subtotal = sum(items, (it) => it.product.price * it.qty);
    const zone = CONFIG.zones[zoneId] || CONFIG.zones["nairobi-core"];
    return { subtotal, fee: zone.fee, total: subtotal + zone.fee, zone };
  }

  /* ---------------------------------------------------------------------- *
   *  Layers (drawer + modals)
   * ---------------------------------------------------------------------- */
  const layerStack = [];
  const focusMemory = new WeakMap();

  const el = {
    siteTop: $("#siteTop"),
    cartDrawer: $("#cartDrawer"),
    cartBody: $("#cartBody"),
    cartFoot: $("#cartFoot"),
    scrim: $("#scrim"),
    toasts: $("#toasts"),
    grid: $("#productGrid"),
    filters: $("#filters"),
    resultCount: $("#resultCount"),
    empty: $("#emptyState"),
    quickView: $("#quickView"),
    qvBody: $("#qvBody"),
    orderModal: $("#orderModal"),
    orderSummary: $("#orderSummary"),
    orderTotal: $("#orderTotal"),
    orderForm: $("#orderForm"),
    orderSuccess: $("#orderSuccess"),
    orderZone: $("#ofZone"),
    orderZoneHint: $("#ofZoneHint"),
    loginModal: $("#loginModal"),
    loginForm: $("#loginForm"),
    loginError: $("#loginError"),
    productModal: $("#productModal"),
    productForm: $("#productForm"),
    confirmModal: $("#confirmModal"),
    confirmYes: $("#confirmYes"),
    merchantBar: $("#merchantBar"),
    loginBtnLabel: $("#loginBtnLabel"),
    heroSlides: $("#heroSlides")
  };

  function focusables(layer) {
    return $$(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      layer
    ).filter((node) => node.getClientRects().length > 0);
  }

  function showLayer(layer, focusTarget) {
    if (layerStack.indexOf(layer) > -1) return;
    focusMemory.set(layer, document.activeElement);
    layer.classList.add("is-open");
    layer.setAttribute("aria-hidden", "false");
    layerStack.push(layer);
    document.body.classList.add("no-scroll");

    if (layer === el.cartDrawer) {
      el.scrim.hidden = false;
      requestAnimationFrame(() => el.scrim.classList.add("is-open"));
    }

    const target = focusTarget || layer.querySelector(".icon-btn, button, [href], input, select, textarea");
    window.setTimeout(() => {
      if (!layer.classList.contains("is-open")) return;
      if (target && typeof target.focus === "function") {
        target.focus({ preventScroll: true });
      }
      const panel = layer.querySelector(".modal__panel") || layer;
      if (panel && panel.scrollTop) panel.scrollTop = 0;
    }, 90);
  }

  function hideLayer(layer) {
    if (layerStack.indexOf(layer) === -1) return;
    layer.classList.remove("is-open");
    layer.setAttribute("aria-hidden", "true");
    const index = layerStack.indexOf(layer);
    if (index > -1) layerStack.splice(index, 1);
    if (!layerStack.length) document.body.classList.remove("no-scroll");

    if (layer === el.cartDrawer) {
      el.scrim.classList.remove("is-open");
      window.setTimeout(() => { if (!el.scrim.classList.contains("is-open")) el.scrim.hidden = true; }, 480);
    }

    const previous = focusMemory.get(layer);
    if (previous && document.contains(previous) && typeof previous.focus === "function") {
      window.setTimeout(() => previous.focus({ preventScroll: true }), 60);
    }
  }

  function openModal(layer, focusTarget) { showLayer(layer, focusTarget); }
  function closeModal(layer) { hideLayer(layer); }
  const anyModalOpen = () => layerStack.some((layer) => layer.classList.contains("modal"));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!layerStack.length) return;
      const top = layerStack[layerStack.length - 1];
      event.preventDefault();
      hideLayer(top);
      if (top === el.loginModal) state.pending = null;
      return;
    }

    if (event.key !== "Tab" || !layerStack.length) return;
    const top = layerStack[layerStack.length - 1];
    const nodes = focusables(top);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && (document.activeElement === first || !top.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  /* ---------------------------------------------------------------------- *
   *  Toasts
   * ---------------------------------------------------------------------- */
  function toast(message, kind) {
    const node = document.createElement("div");
    node.className = "toast" + (kind === "warn" ? " toast--warn" : "");
    node.innerHTML =
      '<svg class="ico" aria-hidden="true"><use href="#i-' + (kind === "warn" ? "arrow" : "check") + '"/></svg>' +
      "<span>" + esc(message) + "</span>";
    el.toasts.appendChild(node);
    window.setTimeout(() => {
      node.classList.add("is-out");
      window.setTimeout(() => node.remove(), 400);
    }, 3400);
  }

  /* ---------------------------------------------------------------------- *
   *  Filters + product grid
   * ---------------------------------------------------------------------- */
  function renderFilters() {
    el.filters.innerHTML = CATEGORIES.map((category) => {
      const count = category === "All Items"
        ? state.products.length
        : state.products.filter((p) => p.category === category).length;
      const selected = state.filter === category;
      return (
        '<button type="button" class="filter" role="tab" id="tab-' + slug(category) + '"' +
        ' aria-selected="' + (selected ? "true" : "false") + '"' +
        ' aria-controls="productGrid" tabindex="' + (selected ? "0" : "-1") + '"' +
        ' data-filter="' + esc(category) + '">' +
        esc(category) + '<span class="filter__sup">' + String(count).padStart(2, "0") + "</span></button>"
      );
    }).join("");
  }

  const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-");

  function cardMarkup(product, index) {
    const sizes = product.sizes.join(" · ");
    return (
      '<article class="card" data-id="' + esc(product.id) + '" style="animation-delay:' + Math.min(index * 45, 360) + 'ms">' +
        '<div class="card__media">' +
          '<img src="' + esc(product.image) + '" alt="' + esc(product.title) + '" loading="lazy" width="900" height="1125" />' +
          '<span class="card__badge">' + esc(product.condition) + "</span>" +
          '<div class="card__admin">' +
            '<button type="button" class="icon-btn" data-edit="' + esc(product.id) + '" aria-label="Edit ' + esc(product.title) + '">' +
              '<svg class="ico" aria-hidden="true"><use href="#i-edit"/></svg></button>' +
            '<button type="button" class="icon-btn icon-btn--del" data-delete="' + esc(product.id) + '" aria-label="Delete ' + esc(product.title) + '">' +
              '<svg class="ico" aria-hidden="true"><use href="#i-trash"/></svg></button>' +
          "</div>" +
          '<button type="button" class="card__quick" data-quick="' + esc(product.id) + '">Quick view</button>' +
        "</div>" +
        '<div class="card__body">' +
          '<div class="card__row">' +
            "<h3 class=\"card__title\">" + esc(product.title) + "</h3>" +
            '<span class="card__price">' + money(product.price) + "</span>" +
          "</div>" +
          '<div class="card__meta">' +
            '<span class="card__sizes">' + esc(sizes) + "</span>" +
            '<span class="card__cat">' + esc(product.category) + "</span>" +
          "</div>" +
          '<button type="button" class="card__order" data-order="' + esc(product.id) + '">' +
            "<span>Order</span>" +
            '<svg class="ico" aria-hidden="true"><use href="#i-arrow"/></svg>' +
          "</button>" +
        "</div>" +
      "</article>"
    );
  }

  function renderGrid() {
    const items = visibleProducts();
    el.grid.setAttribute("aria-busy", "true");
    el.grid.innerHTML = items.map(cardMarkup).join("");
    el.grid.setAttribute("aria-busy", "false");
    el.empty.hidden = items.length > 0;
    // Re-trigger stagger animation
    $$(".card", el.grid).forEach((card, i) => {
      card.style.animation = "none";
      void card.offsetWidth;
      card.style.animation = "";
      card.style.animationDelay = Math.min(i * 45, 360) + "ms";
    });
    el.resultCount.textContent = items.length + (items.length === 1 ? " piece" : " pieces");
  }

  function renderAll() {
    renderFilters();
    renderGrid();
    renderCart();
    applyAdmin();
  }

  function setFilter(category, options) {
    if (CATEGORIES.indexOf(category) === -1) return;
    state.filter = category;
    $$(".filter", el.filters).forEach((button) => {
      const selected = button.dataset.filter === category;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    renderGrid();
    const active = $('.filter[aria-selected="true"]', el.filters);
    if (active) active.focus({ preventScroll: true });
    if (options && options.scroll) {
      const top = el.grid.getBoundingClientRect().top + window.scrollY - 140;
      window.scrollTo({ top, behavior: "smooth" });
    }
  }

  /* ---------------------------------------------------------------------- *
   *  Cart
   * ---------------------------------------------------------------------- */
  function renderCart() {
    const totals = cartTotals();
    const count = totals.count;

    const badge = $("#cartCount");
    badge.textContent = String(count);
    $("#cartTitleCount").textContent = "(" + count + ")";

    if (!totals.lines.length) {
      el.cartBody.innerHTML =
        '<div class="cart-empty">' +
          '<svg class="ico" aria-hidden="true"><use href="#i-cart"/></svg>' +
          "<p>Your cart is empty</p>" +
          "<small>Add a piece, or order straight from the grid</small>" +
        "</div>";
      el.cartFoot.hidden = true;
      return;
    }

    el.cartFoot.hidden = false;
    el.cartBody.innerHTML = totals.lines.map((line) => {
      const p = line.product;
      return (
        '<article class="cart-item">' +
          '<img class="cart-item__img" src="' + esc(p.image) + '" alt="' + esc(p.title) + '" loading="lazy" />' +
          '<div class="cart-item__main">' +
            '<div class="cart-item__top">' +
              "<p class=\"cart-item__title\">" + esc(p.title) + "</p>" +
              '<span class="cart-item__price">' + money(line.lineTotal) + "</span>" +
            "</div>" +
            '<div class="cart-item__meta">' +
              "<span>Size " + esc(line.size) + "</span>" +
              "<span>" + esc(p.condition) + "</span>" +
              "<span>" + esc(p.category) + "</span>" +
            "</div>" +
            '<div class="cart-item__controls">' +
              '<div class="qty">' +
                '<button type="button" data-qty="-1" data-id="' + esc(p.id) + '" data-size="' + esc(line.size) + '" aria-label="Decrease quantity">−</button>' +
                "<span>" + line.qty + "</span>" +
                '<button type="button" data-qty="1" data-id="' + esc(p.id) + '" data-size="' + esc(line.size) + '" aria-label="Increase quantity">+</button>' +
              "</div>" +
              '<button type="button" class="cart-item__order" data-order-cart="' + esc(p.id) + '" data-size="' + esc(line.size) + '">Order</button>' +
              '<button type="button" class="cart-item__remove" data-remove="' + esc(p.id) + '" data-size="' + esc(line.size) + '" aria-label="Remove ' + esc(p.title) + '">' +
                '<svg class="ico" aria-hidden="true" style="font-size:13px"><use href="#i-close"/></svg>' +
              "</button>" +
            "</div>" +
          "</div>" +
        "</article>"
      );
    }).join("");

    $("#cartSubtotal").textContent = money(totals.subtotal);
    $("#cartDelivery").textContent = totals.fee ? money(totals.fee) : "Free";
    $("#cartTotal").textContent = money(totals.total);
    $("#cartOrderMeta").textContent = money(totals.total);
    $("#cartOrderBtn").disabled = false;

    const zoneSelect = $("#cartZone");
    if (zoneSelect.value !== state.zone) zoneSelect.value = state.zone;
    $("#cartZoneNote").textContent = totals.zone.note;
  }

  function bumpCart() {
    const badge = $("#cartCount");
    badge.classList.remove("is-bumped");
    void badge.offsetWidth;
    badge.classList.add("is-bumped");
    window.setTimeout(() => badge.classList.remove("is-bumped"), 380);
  }

  function addToCart(productId, size, qty) {
    const product = getProduct(productId);
    if (!product) return;
    const chosen = product.sizes.indexOf(size) > -1 ? size : product.sizes[0];
    const amount = Math.max(1, Number(qty) || 1);
    const existing = state.cart.find((line) => line.id === product.id && line.size === chosen);
    if (existing) {
      existing.qty = Math.min(9, existing.qty + amount);
    } else {
      state.cart.push({ id: product.id, size: chosen, qty: Math.min(9, amount) });
    }
    saveCart();
    renderCart();
    bumpCart();
  }

  function changeQty(productId, size, delta) {
    const line = state.cart.find((l) => l.id === productId && l.size === size);
    if (!line) return;
    line.qty += delta;
    if (line.qty < 1) {
      state.cart = state.cart.filter((l) => !(l.id === productId && l.size === size));
    }
    line.qty = Math.min(9, line.qty);
    saveCart();
    renderCart();
  }

  function removeLine(productId, size) {
    const product = getProduct(productId);
    state.cart = state.cart.filter((l) => !(l.id === productId && l.size === size));
    saveCart();
    renderCart();
    if (product) toast("Removed — " + product.title);
  }

  function openCart() {
    renderCart();
    showLayer(el.cartDrawer, $("[data-cart-close]"));
  }
  function closeCart() { hideLayer(el.cartDrawer); }

  /* ---------------------------------------------------------------------- *
   *  Quick view
   * ---------------------------------------------------------------------- */
  function openQuickView(productId) {
    const product = getProduct(productId);
    if (!product) return;
    state.qv = { id: product.id, size: product.sizes[0] };
    renderQuickView();
    openModal(el.quickView, $(".modal__close", el.quickView));
  }

  function renderQuickView() {
    const product = getProduct(state.qv.id);
    if (!product) return;
    const size = state.qv.size || product.sizes[0];
    el.qvBody.innerHTML =
      '<div class="qv__media">' +
        '<img src="' + esc(product.image) + '" alt="' + esc(product.title) + '" />' +
        '<span class="qv__media-badge">' + esc(product.condition) + "</span>" +
      "</div>" +
      '<div class="qv__body">' +
        '<p class="qv__cat">' + esc(product.category) + " · " + esc(product.condition) + "</p>" +
        '<h2 class="qv__title" id="qvTitle">' + esc(product.title) + "</h2>" +
        '<p class="qv__price">' + money(product.price) + "</p>" +
        '<p class="qv__desc">' + esc(product.description || "A one-off CREE WRLD find. Message the studio for extra photos or measurements.") + "</p>" +
        '<div class="qv__specs">' +
          "<span>Category <b>" + esc(product.category) + "</b></span>" +
          "<span>Condition <b>" + esc(product.condition) + "</b></span>" +
          "<span>Dispatch <b>Nairobi, 24h</b></span>" +
        "</div>" +
        '<div class="qv__sizes-wrap">' +
          '<p class="qv__sizes-head">Available sizes</p>' +
          '<div class="qv__sizes" role="group" aria-label="Available sizes">' +
            product.sizes.map((s) =>
              '<button type="button" class="size-chip' + (s === size ? " is-active" : "") + '" data-qv-size="' + esc(s) + '" aria-pressed="' + (s === size) + '">' + esc(s) + "</button>"
            ).join("") +
          "</div>" +
        "</div>" +
        '<div class="qv__foot">' +
          '<p class="qv__note">In stock · ready to dispatch from Nairobi</p>' +
          '<div class="qv__add">' +
            '<button type="button" class="btn btn--primary" data-qv-order><span>Order</span></button>' +
            '<button type="button" class="btn btn--ghost" data-qv-add>Add to cart</button>' +
          "</div>" +
          '<div class="qv__admin"' + (state.admin ? "" : " hidden") + ">" +
            '<button type="button" class="btn btn--ghost" data-qv-edit>Edit</button>' +
            '<button type="button" class="btn btn--ghost" data-qv-delete>Delete</button>' +
          "</div>" +
        "</div>" +
      "</div>";
  }

  /* ---------------------------------------------------------------------- *
   *  Order flow
   * ---------------------------------------------------------------------- */
  function openOrder(items, source) {
    if (!items || !items.length) return;
    state.order = {
      source: source || "product",
      items: items.map((it) => ({ product: it.product, size: it.size || it.product.sizes[0], qty: it.qty || 1 })),
      zone: state.zone
    };
    renderOrderSummary();
    el.orderForm.hidden = false;
    el.orderSuccess.hidden = true;
    el.orderForm.reset();
    clearOrderErrors();
    el.orderZone.value = state.order.zone;
    updateOrderZoneHint();
    updateOrderTotal();
    if (el.cartDrawer.classList.contains("is-open")) closeCart();
    openModal(el.orderModal, $("#ofName"));
  }

  function orderFromProduct(productId, size) {
    const product = getProduct(productId);
    if (!product) return;
    openOrder([{ product, size: size || product.sizes[0], qty: 1 }], "product");
  }

  function orderFromCart() {
    const totals = cartTotals();
    if (!totals.lines.length) return;
    openOrder(totals.lines.map((l) => ({ product: l.product, size: l.size, qty: l.qty })), "cart");
  }

  function orderFromCartLine(productId, size) {
    const product = getProduct(productId);
    if (!product) return;
    const line = state.cart.find((l) => l.id === productId && l.size === size);
    openOrder([{ product, size, qty: line ? line.qty : 1 }], "cart-item");
  }

  function renderOrderSummary() {
    if (!state.order) return;
    el.orderSummary.innerHTML = state.order.items.map((item, index) => {
      const p = item.product;
      const sizes = p.sizes.map((s) =>
        '<option value="' + esc(s) + '"' + (s === item.size ? " selected" : "") + ">" + esc(s) + "</option>"
      ).join("");
      return (
        '<div class="order__line">' +
          '<img src="' + esc(p.image) + '" alt="' + esc(p.title) + '" />' +
          "<div>" +
            '<p class="order__line-title">' + esc(p.title) + (item.qty > 1 ? " × " + item.qty : "") + "</p>" +
            '<p class="order__line-meta">' + esc(p.condition) +
              '<span class="order__line-size">Size <select data-order-size="' + index + '" aria-label="Size for ' + esc(p.title) + '">' + sizes + "</select></span>" +
            "</p>" +
          "</div>" +
          '<span class="order__line-price">' + money(p.price * item.qty) + "</span>" +
        "</div>"
      );
    }).join("");
  }

  function updateOrderTotal() {
    if (!state.order) return;
    const totals = orderTotals(state.order.items, state.order.zone);
    el.orderTotal.textContent = money(totals.total);
  }

  function updateOrderZoneHint() {
    const zone = CONFIG.zones[el.orderZone.value] || CONFIG.zones["nairobi-core"];
    el.orderZoneHint.textContent = zone.note;
  }

  function clearOrderErrors() {
    $$(".field__err", el.orderForm).forEach((node) => { node.hidden = true; node.textContent = ""; });
    $$(".field", el.orderForm).forEach((node) => node.classList.remove("has-error"));
  }

  function showFieldError(name, message) {
    const err = $('[data-err="' + name + '"]', el.orderForm);
    const field = err ? err.closest(".field") : null;
    if (err) { err.textContent = message; err.hidden = false; }
    if (field) field.classList.add("has-error");
  }

  function validateOrder(data) {
    clearOrderErrors();
    let ok = true;
    if (!data.name || data.name.trim().length < 2) {
      showFieldError("name", "Please enter your full name.");
      ok = false;
    }
    if (!data.location || data.location.trim().length < 2) {
      showFieldError("location", "Please add your delivery area or town.");
      ok = false;
    }
    const digits = String(data.phone || "").replace(/\D/g, "");
    const validPhone =
      (digits.length === 10 && digits.charAt(0) === "0") ||
      (digits.length === 12 && digits.indexOf("254") === 0) ||
      (digits.length === 9 && digits.charAt(0) !== "0") ||
      (digits.length >= 11 && digits.length <= 15);
    if (!validPhone) {
      showFieldError("phone", "Enter a valid phone number, e.g. 0712 345 678.");
      ok = false;
    }
    return ok;
  }

  function buildWhatsAppMessage(order, customer) {
    const totals = orderTotals(order.items, order.zone);
    const lines = [];
    const count = sum(order.items, (it) => it.qty);

    lines.push("*CREE WRLD — NEW ORDER*");
    lines.push("");
    lines.push("*ITEMS (" + count + ")*");
    order.items.forEach((item, index) => {
      const p = item.product;
      lines.push(index + 1 + ". *" + p.title + "*");
      lines.push("   Price: " + money(p.price) + (item.qty > 1 ? " × " + item.qty : ""));
      lines.push("   Size: " + item.size);
      lines.push("   Condition: " + p.condition);
      lines.push("   Image: " + absoluteUrl(p.image));
    });

    lines.push("");
    lines.push("*CUSTOMER*");
    lines.push("Name: " + customer.name);
    lines.push("Delivery Location: " + customer.location);
    lines.push("Contact Phone: " + customer.phone);

    lines.push("");
    lines.push("*DELIVERY*");
    lines.push("Zone: " + totals.zone.label);
    lines.push("Fee: " + (totals.fee ? money(totals.fee) : "Free"));
    lines.push("Subtotal: " + money(totals.subtotal));
    lines.push("Order Total: " + money(totals.total));
    lines.push("");
    lines.push("Free delivery within Nairobi.");
    lines.push("Sent from the CREE WRLD storefront.");

    return lines.join("\n");
  }

  function whatsappUrl(message) {
    return "https://wa.me/" + CONFIG.whatsapp + "?text=" + encodeURIComponent(message);
  }

  function handleOrderSubmit(event) {
    event.preventDefault();
    if (!state.order) return;
    const formData = new FormData(el.orderForm);
    const customer = {
      name: String(formData.get("name") || "").trim(),
      location: String(formData.get("location") || "").trim(),
      phone: String(formData.get("phone") || "").trim()
    };
    state.order.zone = el.orderZone.value;

    if (!validateOrder(customer)) {
      const firstError = $(".field.has-error input, .field.has-error textarea", el.orderForm);
      if (firstError) firstError.focus({ preventScroll: false });
      return;
    }

    const message = buildWhatsAppMessage(state.order, customer);
    const url = whatsappUrl(message);

    const win = window.open(url, "_blank", "noopener");
    const link = $("#orderWaLink");
    link.href = url;

    if (state.order.source === "cart") {
      state.cart = [];
      saveCart();
      renderCart();
    } else if (state.order.source === "cart-item") {
      state.cart = state.cart.filter((line) => {
        const ordered = state.order.items.some((it) => it.product.id === line.id);
        return !ordered;
      });
      saveCart();
      renderCart();
    }

    el.orderForm.hidden = true;
    el.orderSuccess.hidden = false;
    const totals = orderTotals(state.order.items, state.order.zone);
    $("#orderSuccessText").innerHTML =
      "Press <strong>send</strong> in the WhatsApp chat to confirm your order of <strong>" +
      money(totals.total) + "</strong>. " +
      (win ? "The chat has opened in a new tab." : "Your browser blocked the tab — use the button below.");
    const doneBtn = $("#orderDone");
    if (doneBtn) window.setTimeout(() => doneBtn.focus({ preventScroll: true }), 80);
    if (!win) toast("Allow pop-ups to open WhatsApp automatically", "warn");
  }

  function closeOrder() {
    closeModal(el.orderModal);
    state.order = null;
    el.orderForm.hidden = false;
    el.orderSuccess.hidden = true;
  }

  /* ---------------------------------------------------------------------- *
   *  Admin — session
   * ---------------------------------------------------------------------- */
  function applyAdmin() {
    document.body.classList.toggle("is-admin", state.admin);
    el.merchantBar.hidden = !state.admin;
    el.loginBtnLabel.textContent = state.admin ? "Studio · admin" : "Login / Admin";
    const loginBtn = $("#loginBtn");
    if (loginBtn) loginBtn.setAttribute("aria-label", state.admin ? "Signed in as admin — sign out" : "Login / Admin");
    $$(".qv__admin").forEach((node) => { node.hidden = !state.admin; });
    window.requestAnimationFrame(updateTopOffset);
  }

  function openLogin(pending) {
    state.pending = typeof pending === "function" ? pending : null;
    el.loginForm.reset();
    el.loginError.hidden = true;
    openModal(el.loginModal, $("#lfUser"));
  }

  function signIn(username, password) {
    if (username.trim().toLowerCase() !== CONFIG.credentials.username || password !== CONFIG.credentials.password) {
      return false;
    }
    state.admin = true;
    writeJSON(CONFIG.storage.session, {
      user: CONFIG.credentials.username,
      expires: Date.now() + CONFIG.sessionHours * 3600 * 1000
    });
    applyAdmin();
    return true;
  }

  function signOut() {
    state.admin = false;
    removeKey(CONFIG.storage.session);
    applyAdmin();
    if (el.productModal.classList.contains("is-open")) closeModal(el.productModal);
    toast("Signed out of merchant mode");
  }

  function requireAdmin(action) {
    if (state.admin) { action(); return; }
    openLogin(action);
  }

  /* ---------------------------------------------------------------------- *
   *  Admin — product form
   * ---------------------------------------------------------------------- */
  function openProductForm(product) {
    const editing = Boolean(product);
    $("#productTitle").innerHTML = editing ? "Edit <em>piece</em>" : "Add a <em>piece</em>";
    $("#productSub").textContent = editing
      ? "Changes publish instantly to the live grid and save to this browser."
      : "Published instantly to the live grid and saved to this browser.";
    $("#productSubmit").textContent = editing ? "Save changes" : "Publish piece";

    $("#pfId").value = editing ? product.id : "";
    $("#pfTitle").value = editing ? product.title : "";
    $("#pfCategory").value = editing ? product.category : state.filter !== "All Items" ? state.filter : "Sneakers";
    $("#pfPrice").value = editing ? product.price : "";
    $("#pfCondition").value = editing ? product.condition : "Excellent";
    $("#pfSizes").value = editing ? product.sizes.join(", ") : "";
    $("#pfImage").value = editing ? product.image : "";
    $("#pfDescription").value = editing ? product.description : "";

    $$(".field__err", el.productForm).forEach((n) => { n.hidden = true; n.textContent = ""; });
    $$(".field", el.productForm).forEach((n) => n.classList.remove("has-error"));
    updateProductPreview();

    openModal(el.productModal, $("#pfTitle"));
  }

  function updateProductPreview() {
    const value = $("#pfImage").value.trim();
    const box = $("#pfPreview");
    if (!value) {
      box.innerHTML = "<span>Paste an image URL to preview</span>";
      return;
    }
    if (/^\s*(javascript|vbscript|file):/i.test(value)) {
      box.innerHTML = "<span>That link can't be used — paste an https:// image URL</span>";
      return;
    }
    box.innerHTML = '<img src="' + esc(value) + '" alt="Preview" />';
  }

  function productFieldError(name, message) {
    const err = $('[data-err="' + name + '"]', el.productForm);
    if (err) { err.textContent = message; err.hidden = false; }
    if (err) {
      const field = err.closest(".field");
      if (field) field.classList.add("has-error");
    }
  }

  function submitProduct(event) {
    event.preventDefault();
    if (!state.admin) { closeModal(el.productModal); openLogin(); return; }

    $$(".field__err", el.productForm).forEach((n) => { n.hidden = true; n.textContent = ""; });
    $$(".field", el.productForm).forEach((n) => n.classList.remove("has-error"));

    const id = $("#pfId").value;
    const title = $("#pfTitle").value.trim();
    const price = Number($("#pfPrice").value);
    const sizes = $("#pfSizes").value.split(",").map((s) => s.trim()).filter(Boolean);
    const image = $("#pfImage").value.trim();
    const description = $("#pfDescription").value.trim();
    let ok = true;

    if (title.length < 2) { productFieldError("title", "Give the piece a name."); ok = false; }
    if (!Number.isFinite(price) || price <= 0) { productFieldError("price", "Enter a price above zero, in KSh."); ok = false; }
    if (!sizes.length) { productFieldError("sizes", "List at least one size, comma separated."); ok = false; }
    if (!image) {
      productFieldError("image", "Add an image URL so the piece can be seen.");
      ok = false;
    } else if (/^\s*(javascript|vbscript|file):/i.test(image)) {
      productFieldError("image", "That image link can't be used. Use https:// or a local path.");
      ok = false;
    }
    if (description.length < 4) { productFieldError("description", "Add a short description."); ok = false; }

    if (!ok) {
      const first = $(".field.has-error input, .field.has-error textarea", el.productForm);
      if (first) first.focus();
      return;
    }

    const data = {
      title,
      category: $("#pfCategory").value,
      price: Math.round(price),
      condition: $("#pfCondition").value,
      sizes,
      image,
      description
    };

    if (id) {
      const existing = getProduct(id);
      if (existing) {
        Object.assign(existing, data);
        toast("Saved — " + title);
      }
    } else {
      const created = normalizeProduct(Object.assign({ id: uid(), addedAt: Date.now() }, data));
      if (created) {
        state.products.unshift(created);
        state.filter = created.category;
        toast("Published — " + created.title);
      }
    }

    saveProducts();
    renderAll();
    closeModal(el.productModal);
    window.setTimeout(() => {
      const top = el.grid.getBoundingClientRect().top + window.scrollY - 150;
      window.scrollTo({ top, behavior: "smooth" });
    }, 180);
  }

  /* ---------------------------------------------------------------------- *
   *  Confirm dialog
   * ---------------------------------------------------------------------- */
  function askConfirm(options, onConfirm) {
    $("#confirmTitle").innerHTML = options.title || "Delete <em>piece</em>";
    $("#confirmText").textContent = options.text || "This cannot be undone.";
    el.confirmYes.textContent = options.confirmLabel || "Delete";
    el.confirmYes.className = "btn " + (options.danger === false ? "btn--primary" : "btn--danger");
    state.confirm = onConfirm;
    openModal(el.confirmModal, el.confirmYes);
  }

  function deleteProduct(id) {
    const product = getProduct(id);
    if (!product) return;
    askConfirm({
      title: "Delete <em>piece</em>",
      text: '"' + product.title + '" will be removed from the live grid. This cannot be undone.',
      confirmLabel: "Delete piece"
    }, () => {
      state.products = state.products.filter((p) => p.id !== id);
      state.cart = state.cart.filter((line) => line.id !== id);
      saveProducts();
      saveCart();
      if (el.quickView.classList.contains("is-open")) closeModal(el.quickView);
      renderAll();
      toast("Deleted — " + product.title);
    });
  }

  function resetCatalogue() {
    askConfirm({
      title: "Reset <em>catalogue</em>",
      text: "Restore the original ten pieces and discard every edit made in this browser.",
      confirmLabel: "Reset catalogue"
    }, () => {
      state.products = SEED.map(normalizeProduct).filter(Boolean);
      state.cart = [];
      saveProducts();
      saveCart();
      renderAll();
      toast("Catalogue restored");
    });
  }

  /* ---------------------------------------------------------------------- *
   *  Hero slideshow
   * ---------------------------------------------------------------------- */
  let heroTimer = null;
  let heroIndex = 0;

  function initHero() {
    if (!el.heroSlides) return;
    el.heroSlides.innerHTML = HERO_SLIDES.map((slide, i) =>
      '<img src="' + esc(slide.image) + '" alt="" class="' + (i === 0 ? "is-active" : "") + '" ' +
      (i === 0 ? 'fetchpriority="high"' : 'loading="lazy"') + " />"
    ).join("");
    updateHeroCaption();
    startHeroTimer();

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopHeroTimer();
      else startHeroTimer();
    });
  }

  function updateHeroCaption() {
    const index = $("#heroCapIndex");
    const title = $("#heroCapTitle");
    if (index) index.textContent = String(heroIndex + 1).padStart(2, "0") + " / " + String(HERO_SLIDES.length).padStart(2, "0");
    if (title) title.textContent = HERO_SLIDES[heroIndex].title;
  }

  function advanceHero() {
    const images = $$("img", el.heroSlides);
    if (images.length < 2) return;
    images[heroIndex].classList.remove("is-active");
    heroIndex = (heroIndex + 1) % images.length;
    images[heroIndex].classList.add("is-active");
    updateHeroCaption();
  }

  function startHeroTimer() {
    stopHeroTimer();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    heroTimer = window.setInterval(advanceHero, 5200);
  }
  function stopHeroTimer() {
    if (heroTimer) window.clearInterval(heroTimer);
    heroTimer = null;
  }

  /* ---------------------------------------------------------------------- *
   *  Header behaviour
   * ---------------------------------------------------------------------- */
  function updateTopOffset() {
    const height = el.siteTop.getBoundingClientRect().height;
    document.documentElement.style.setProperty("--top-h", Math.round(height) + "px");
  }

  function initHeader() {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        el.siteTop.classList.toggle("is-scrolled", window.scrollY > 28);
        updateTopOffset();
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", updateTopOffset);
    onScroll();

    if ("ResizeObserver" in window) {
      new ResizeObserver(updateTopOffset).observe(el.siteTop);
    }

    const menuBtn = $("#menuBtn");
    const mobileNav = $("#mobileNav");
    const setMenu = (open) => {
      menuBtn.setAttribute("aria-expanded", String(open));
      mobileNav.classList.toggle("is-open", open);
      menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      window.setTimeout(updateTopOffset, 60);
    };
    menuBtn.addEventListener("click", () => setMenu(menuBtn.getAttribute("aria-expanded") !== "true"));
    mobileNav.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) setMenu(false);
    });
  }

  /* ---------------------------------------------------------------------- *
   *  Reveal on scroll
   * ---------------------------------------------------------------------- */
  function initReveal() {
    const nodes = $$(".reveal");
    if (!("IntersectionObserver" in window)) {
      nodes.forEach((n) => n.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.16, rootMargin: "0px 0px -8% 0px" });
    nodes.forEach((n) => io.observe(n));
  }

  /* ---------------------------------------------------------------------- *
   *  Event wiring
   * ---------------------------------------------------------------------- */
  function bindEvents() {
    /* Filters */
    el.filters.addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      setFilter(button.dataset.filter, { scroll: false });
    });

    el.filters.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const tabs = $$(".filter", el.filters);
      const current = tabs.indexOf(document.activeElement);
      if (current === -1) return;
      event.preventDefault();
      const next = event.key === "ArrowRight"
        ? (current + 1) % tabs.length
        : (current - 1 + tabs.length) % tabs.length;
      tabs[next].focus();
      setFilter(tabs[next].dataset.filter, { scroll: false });
    });

    /* Grid: order / quick view / admin overlays */
    el.grid.addEventListener("click", (event) => {
      const orderBtn = event.target.closest("[data-order]");
      if (orderBtn) { orderFromProduct(orderBtn.dataset.order); return; }

      const quickBtn = event.target.closest("[data-quick]");
      if (quickBtn) { openQuickView(quickBtn.dataset.quick); return; }

      const editBtn = event.target.closest("[data-edit]");
      if (editBtn) {
        if (!state.admin) { openLogin(); return; }
        const product = getProduct(editBtn.dataset.edit);
        if (product) openProductForm(product);
        return;
      }

      const delBtn = event.target.closest("[data-delete]");
      if (delBtn) {
        if (!state.admin) { openLogin(); return; }
        deleteProduct(delBtn.dataset.delete);
      }
    });

    /* Cart trigger / close */
    document.addEventListener("click", (event) => {
      const opener = event.target.closest("[data-cart-open]");
      if (opener) {
        event.preventDefault();
        openCart();
        return;
      }
      const closer = event.target.closest("[data-cart-close]");
      if (closer) { closeCart(); return; }

      const dismiss = event.target.closest("[data-close]");
      if (dismiss) {
        const layer = dismiss.closest(".modal, .drawer");
        if (layer) {
          hideLayer(layer);
          if (layer === el.loginModal) state.pending = null;
        }
      }
    });

    el.scrim.addEventListener("click", closeCart);

    /* Cart internals */
    el.cartBody.addEventListener("click", (event) => {
      const qtyBtn = event.target.closest("[data-qty]");
      if (qtyBtn) {
        changeQty(qtyBtn.dataset.id, qtyBtn.dataset.size, Number(qtyBtn.dataset.qty));
        return;
      }
      const orderBtn = event.target.closest("[data-order-cart]");
      if (orderBtn) {
        orderFromCartLine(orderBtn.dataset.orderCart, orderBtn.dataset.size);
        return;
      }
      const removeBtn = event.target.closest("[data-remove]");
      if (removeBtn) {
        removeLine(removeBtn.dataset.remove, removeBtn.dataset.size);
      }
    });

    const zoneSelect = $("#cartZone");
    zoneSelect.value = state.zone;
    zoneSelect.addEventListener("change", () => {
      state.zone = CONFIG.zones[zoneSelect.value] ? zoneSelect.value : "nairobi-core";
      saveZone();
      renderCart();
      if (state.order) {
        state.order.zone = state.zone;
        el.orderZone.value = state.zone;
        updateOrderZoneHint();
        updateOrderTotal();
      }
    });

    $("#cartOrderBtn").addEventListener("click", orderFromCart);

    /* Quick view internals */
    el.quickView.addEventListener("click", (event) => {
      const sizeBtn = event.target.closest("[data-qv-size]");
      if (sizeBtn) {
        state.qv.size = sizeBtn.dataset.qvSize;
        $$("[data-qv-size]", el.qvBody).forEach((chip) => {
          const active = chip.dataset.qvSize === state.qv.size;
          chip.classList.toggle("is-active", active);
          chip.setAttribute("aria-pressed", String(active));
        });
        sizeBtn.focus({ preventScroll: true });
        return;
      }
      if (event.target.closest("[data-qv-order]")) {
        orderFromProduct(state.qv.id, state.qv.size);
        return;
      }
      if (event.target.closest("[data-qv-add]")) {
        addToCart(state.qv.id, state.qv.size, 1);
        closeModal(el.quickView);
        openCart();
        toast("Added to cart");
        return;
      }
      if (event.target.closest("[data-qv-edit]")) {
        const product = getProduct(state.qv.id);
        if (product) { closeModal(el.quickView); openProductForm(product); }
        return;
      }
      if (event.target.closest("[data-qv-delete]")) {
        closeModal(el.quickView);
        deleteProduct(state.qv.id);
      }
    });

    /* Order form */
    el.orderForm.addEventListener("submit", handleOrderSubmit);
    el.orderSummary.addEventListener("change", (event) => {
      const select = event.target.closest("[data-order-size]");
      if (!select || !state.order) return;
      const index = Number(select.dataset.orderSize);
      if (state.order.items[index]) state.order.items[index].size = select.value;
    });
    el.orderZone.addEventListener("change", () => {
      if (state.order) {
        state.order.zone = el.orderZone.value;
        state.zone = el.orderZone.value;
        saveZone();
        updateOrderZoneHint();
        updateOrderTotal();
      }
    });
    $("#orderDone").addEventListener("click", closeOrder);

    /* Login */
    $("#loginBtn").addEventListener("click", () => {
      if (state.admin) {
        askConfirm({
          title: "Sign out of <em>merchant mode</em>",
          text: "The storefront returns to shopper view. Your pieces stay saved in this browser.",
          confirmLabel: "Sign out",
          danger: false
        }, signOut);
      } else {
        openLogin();
      }
    });
    $("#mobileLogin").addEventListener("click", () => { if (state.admin) signOut(); else openLogin(); });

    el.loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const username = $("#lfUser").value;
      const password = $("#lfPass").value;
      if (signIn(username, password)) {
        el.loginError.hidden = true;
        closeModal(el.loginModal);
        const pending = state.pending;
        state.pending = null;
        toast("Merchant mode enabled");
        if (typeof pending === "function") window.setTimeout(pending, 220);
      } else {
        el.loginError.hidden = false;
        el.loginError.textContent = "Those details don't match the studio account.";
        $("#lfPass").value = "";
        $("#lfPass").focus();
      }
    });

    /* Add product entry points */
    const addProduct = () => requireAdmin(() => openProductForm(null));
    $("#addProductBtn").addEventListener("click", addProduct);
    $("#mobileAddProduct").addEventListener("click", addProduct);
    $("#merchantAdd").addEventListener("click", () => { if (state.admin) openProductForm(null); });
    $("#merchantReset").addEventListener("click", () => { if (state.admin) resetCatalogue(); });
    $("#merchantLogout").addEventListener("click", signOut);
    $("#footerAdmin").addEventListener("click", () => {
      if (state.admin) signOut(); else openLogin();
    });

    /* Product form */
    el.productForm.addEventListener("submit", submitProduct);
    $("#pfImage").addEventListener("input", () => {
      window.clearTimeout(updateProductPreview._t);
      updateProductPreview._t = window.setTimeout(updateProductPreview, 220);
    });

    /* Confirm */
    el.confirmYes.addEventListener("click", () => {
      const action = state.confirm;
      state.confirm = null;
      closeModal(el.confirmModal);
      if (typeof action === "function") action();
    });
    el.confirmModal.addEventListener("transitionend", () => {
      if (!el.confirmModal.classList.contains("is-open")) state.confirm = null;
    });

    /* Image fallbacks */
    document.addEventListener("error", (event) => {
      const img = event.target;
      if (img && img.tagName === "IMG" && !img.dataset.failed) {
        img.dataset.failed = "1";
        img.src = PLACEHOLDER;
      }
    }, true);

    /* Cross-tab sync */
    window.addEventListener("storage", (event) => {
      if (event.key === CONFIG.storage.products) {
        state.products = loadProducts();
        state.cart = loadCart();
        renderAll();
      }
      if (event.key === CONFIG.storage.cart) {
        state.cart = loadCart();
        renderCart();
      }
      if (event.key === CONFIG.storage.session) {
        state.admin = loadSession();
        applyAdmin();
      }
    });

    /* Footer year */
    const year = $("#year");
    if (year) year.textContent = String(new Date().getFullYear());
  }

  /* ---------------------------------------------------------------------- *
   *  Boot
   * ---------------------------------------------------------------------- */
  function boot() {
    initHeader();
    renderAll();
    initHero();
    initReveal();
    bindEvents();
    updateTopOffset();

    const loginBtn = $("#loginBtn");
    if (loginBtn) loginBtn.classList.toggle("is-auth", state.admin);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
