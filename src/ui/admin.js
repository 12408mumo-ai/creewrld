/**
 * Merchant tools: studio login, product editor, destructive confirmations
 * and the signed-in chrome (merchant strip, per-card overlays).
 */

import { CONDITIONS, PRODUCT_CATEGORIES } from "../config.js";
import { $, $$, esc } from "../lib/format.js";
import {
  deleteProduct,
  getProduct,
  resetCatalogue,
  signIn,
  signOut,
  state,
  upsertProduct
} from "../store.js";
import { selectCategory } from "./grid.js";
import { closeLayer, openLayer, toast } from "./layers.js";

const loginModal = () => $("#loginModal");
const productModal = () => $("#productModal");
const confirmModal = () => $("#confirmModal");

let pendingAction = null;
let confirmAction = null;

/* -------------------------------------------------------------------- chrome */

export function applyAdminChrome() {
  document.body.classList.toggle("is-admin", state.admin);

  const bar = $("#merchantBar");
  if (bar) bar.hidden = !state.admin;

  const label = $("#loginBtnLabel");
  if (label) label.textContent = state.admin ? "Studio · admin" : "Login / Admin";

  const loginBtn = $("#loginBtn");
  if (loginBtn) {
    loginBtn.setAttribute(
      "aria-label",
      state.admin ? "Signed in as admin — sign out" : "Login / Admin"
    );
  }

  $$(".qv__admin").forEach((node) => {
    node.hidden = !state.admin;
  });
}

/* --------------------------------------------------------------------- login */

export function openLogin(pending) {
  pendingAction = typeof pending === "function" ? pending : null;
  $("#loginForm").reset();
  $("#loginError").hidden = true;
  openLayer(loginModal(), $("#lfUser"));
}

function closeLogin() {
  closeLayer(loginModal());
  pendingAction = null;
}

export function requireAdmin(action) {
  if (state.admin) {
    action();
    return;
  }
  openLogin(action);
}

function handleLogin(event) {
  event.preventDefault();
  const username = $("#lfUser").value;
  const password = $("#lfPass").value;

  if (!signIn(username, password)) {
    const error = $("#loginError");
    error.hidden = false;
    error.textContent = "Those details don't match the studio account.";
    $("#lfPass").value = "";
    $("#lfPass").focus();
    return;
  }

  $("#loginError").hidden = true;
  closeLayer(loginModal());
  toast("Merchant mode enabled");

  const next = pendingAction;
  pendingAction = null;
  if (typeof next === "function") window.setTimeout(next, 220);
}

/* ------------------------------------------------------------------- product */

function clearProductErrors() {
  $$(".field__err", productModal()).forEach((node) => {
    node.hidden = true;
    node.textContent = "";
  });
  $$(".field", productModal()).forEach((node) => node.classList.remove("has-error"));
}

function productError(field, message) {
  const node = $('[data-err="' + field + '"]', productModal());
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
  const wrapper = node.closest(".field");
  if (wrapper) wrapper.classList.add("has-error");
}

function updatePreview() {
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

export function openProductForm(product) {
  const editing = Boolean(product);

  $("#productTitle").innerHTML = editing ? "Edit <em>piece</em>" : "Add a <em>piece</em>";
  $("#productSub").textContent = editing
    ? "Changes publish instantly to the live grid and save to this browser."
    : "Published instantly to the live grid and saved to this browser.";
  $("#productSubmit").textContent = editing ? "Save changes" : "Publish piece";

  $("#pfId").value = editing ? product.id : "";
  $("#pfTitle").value = editing ? product.title : "";
  $("#pfCategory").value = editing
    ? product.category
    : state.filter !== "All Items"
      ? state.filter
      : PRODUCT_CATEGORIES[0];
  $("#pfPrice").value = editing ? product.price : "";
  $("#pfCondition").value = editing ? product.condition : "Excellent";
  $("#pfSizes").value = editing ? product.sizes.join(", ") : "";
  $("#pfImage").value = editing ? product.image : "";
  $("#pfDescription").value = editing ? product.description : "";

  clearProductErrors();
  updatePreview();
  openLayer(productModal(), $("#pfTitle"));
}

function handleProductSubmit(event) {
  event.preventDefault();

  if (!state.admin) {
    closeLayer(productModal());
    openLogin();
    return;
  }

  clearProductErrors();

  const id = $("#pfId").value;
  const title = $("#pfTitle").value.trim();
  const price = Number($("#pfPrice").value);
  const sizes = $("#pfSizes").value.split(",").map((size) => size.trim()).filter(Boolean);
  const image = $("#pfImage").value.trim();
  const description = $("#pfDescription").value.trim();

  let valid = true;

  if (title.length < 2) {
    productError("title", "Give the piece a name.");
    valid = false;
  }
  if (!Number.isFinite(price) || price <= 0) {
    productError("price", "Enter a price above zero, in KSh.");
    valid = false;
  }
  if (!sizes.length) {
    productError("sizes", "List at least one size, comma separated.");
    valid = false;
  }
  if (!image) {
    productError("image", "Add an image URL so the piece can be seen.");
    valid = false;
  } else if (/^\s*(javascript|vbscript|file):/i.test(image)) {
    productError("image", "That image link can't be used. Use https:// or a local path.");
    valid = false;
  }
  if (description.length < 4) {
    productError("description", "Add a short description.");
    valid = false;
  }

  if (!valid) {
    const firstInvalid = $(".field.has-error input, .field.has-error textarea", productModal());
    if (firstInvalid) firstInvalid.focus();
    return;
  }

  const saved = upsertProduct({
    id: id || undefined,
    title,
    category: $("#pfCategory").value,
    price: Math.round(price),
    condition: $("#pfCondition").value,
    sizes,
    image,
    description
  });

  if (!saved) return;

  toast((id ? "Saved — " : "Published — ") + saved.title);
  closeLayer(productModal());

  // Show the merchant exactly where the piece landed.
  if (!id) {
    window.setTimeout(() => {
      selectCategory(saved.category, { focus: false, scroll: true });
    }, 180);
  }
}

/* ---------------------------------------------------------------- confirmation */

export function askConfirm({ title, text, confirmLabel = "Delete", danger = true }, action) {
  $("#confirmTitle").innerHTML = title || "Delete <em>piece</em>";
  $("#confirmText").textContent = text || "This cannot be undone.";

  const yes = $("#confirmYes");
  yes.textContent = confirmLabel;
  yes.className = "btn " + (danger ? "btn--danger" : "btn--primary");

  confirmAction = action;
  openLayer(confirmModal(), yes);
}

export function confirmDelete(product) {
  if (!product) return;
  askConfirm(
    {
      title: "Delete <em>piece</em>",
      text: '"' + product.title + '" will be removed from the live grid. This cannot be undone.',
      confirmLabel: "Delete piece"
    },
    () => {
      deleteProduct(product.id);
      toast("Deleted — " + product.title);
    }
  );
}

export function confirmReset() {
  askConfirm(
    {
      title: "Reset <em>catalogue</em>",
      text: "Restore the original ten pieces and discard every edit made in this browser.",
      confirmLabel: "Reset catalogue"
    },
    () => {
      resetCatalogue();
      toast("Catalogue restored");
    }
  );
}

export function confirmSignOut() {
  askConfirm(
    {
      title: "Sign out of <em>merchant mode</em>",
      text: "The storefront returns to shopper view. Your pieces stay saved in this browser.",
      confirmLabel: "Sign out",
      danger: false
    },
    () => {
      signOut();
      toast("Signed out of merchant mode");
    }
  );
}

/* ----------------------------------------------------------------- binding */

const on = (selector, handler) => {
  const node = $(selector);
  if (node) node.addEventListener("click", handler);
};

export function bindAdmin() {
  // Adding a piece is merchant-only: the entry point lives in the signed-in
  // merchant strip (and per-card edit overlays), never in the public header.
  on("#merchantAdd", () => {
    if (state.admin) openProductForm(null);
  });
  on("#merchantReset", () => {
    if (state.admin) confirmReset();
  });
  on("#merchantLogout", () => {
    signOut();
    toast("Signed out of merchant mode");
  });
  on("#footerAdmin", () => {
    if (state.admin) signOut();
    else openLogin();
  });

  on("#loginBtn", () => {
    if (state.admin) confirmSignOut();
    else openLogin();
  });
  on("#mobileLogin", () => {
    if (state.admin) signOut();
    else openLogin();
  });

  $("#loginForm").addEventListener("submit", handleLogin);
  $("#productForm").addEventListener("submit", handleProductSubmit);

  $("#pfImage").addEventListener("input", () => {
    window.clearTimeout(bindAdmin._previewTimer);
    bindAdmin._previewTimer = window.setTimeout(updatePreview, 220);
  });

  $("#confirmYes").addEventListener("click", () => {
    const action = confirmAction;
    confirmAction = null;
    closeLayer(confirmModal());
    if (typeof action === "function") action();
  });

  loginModal().addEventListener("transitionend", () => {
    if (!loginModal().classList.contains("is-open")) pendingAction = null;
  });
  confirmModal().addEventListener("transitionend", () => {
    if (!confirmModal().classList.contains("is-open")) confirmAction = null;
  });

  // Populate the category menu from config so it can never drift from the store.
  const categorySelect = $("#pfCategory");
  if (categorySelect && categorySelect.options.length !== PRODUCT_CATEGORIES.length) {
    categorySelect.innerHTML = PRODUCT_CATEGORIES.map(
      (category) => '<option value="' + esc(category) + '">' + esc(category) + "</option>"
    ).join("");
  }

  // Conditions are configured centrally too.
  const conditionSelect = $("#pfCondition");
  if (conditionSelect && conditionSelect.options.length !== CONDITIONS.length) {
    conditionSelect.innerHTML = CONDITIONS.map(
      (condition) =>
        '<option value="' + esc(condition) + '"' +
        (condition === "Excellent" ? " selected" : "") + ">" + esc(condition) + "</option>"
    ).join("");
  }

  // Card overlays route through here from app.js via these helpers.
  return { openProductForm, confirmDelete, confirmReset };
}

export const isDraftOpen = () => productModal().classList.contains("is-open");

export function closeProductForm() {
  closeLayer(productModal());
}

export function closeConfirm() {
  closeLayer(confirmModal());
}

export const findProduct = getProduct;
