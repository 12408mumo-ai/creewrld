/**
 * Merchant tools: studio login (Supabase Auth), product editor with image
 * uploads, destructive confirmations and the signed-in chrome (merchant strip,
 * per-card overlays).
 *
 * Nothing here decides who is an admin — `state.admin` is driven by the
 * Supabase session in store.js, and the server re-checks every write through
 * row level security.
 */

import { CONDITIONS } from "../lib/products.js";
import { $, $$, esc } from "../lib/format.js";
import {
  categoryTabs,
  deleteProduct,
  getProduct,
  saveProduct,
  seedStarterCatalogue,
  signIn,
  signOut,
  state
} from "../store.js";
import { selectCategory } from "./grid.js";
import { closeLayer, openLayer, toast } from "./layers.js";
import { uploadProductImage, validateImage } from "../data/storage.js";
import { describeError } from "../lib/supabase.js";

const loginModal = () => $("#loginModal");
const productModal = () => $("#productModal");
const confirmModal = () => $("#confirmModal");

let pendingAction = null;
let confirmAction = null;
let selectedFile = null;
let filePreviewUrl = null;

/* -------------------------------------------------------------------- chrome */

export function applyAdminChrome() {
  document.body.classList.toggle("is-admin", state.admin);

  const bar = $("#merchantBar");
  if (bar) bar.hidden = !state.admin;

  const label = $("#loginBtnLabel");
  if (label) {
    const email = state.user && state.user.email ? state.user.email.split("@")[0] : "";
    label.textContent = state.admin ? (email ? `Studio · ${email}` : "Studio · admin") : "Login / Admin";
  }

  const loginBtn = $("#loginBtn");
  if (loginBtn) {
    loginBtn.setAttribute(
      "aria-label",
      state.admin ? "Signed in to the studio — sign out" : "Login / Admin"
    );
  }

  $$(".qv__admin").forEach((node) => {
    node.hidden = !state.admin;
  });

  // The starter catalogue is only offered while there is nothing to overwrite.
  const seed = $("#merchantSeed");
  if (seed) seed.hidden = !(state.admin && !state.loading && state.products.length === 0);
}

/* --------------------------------------------------------------------- login */

export function openLogin(pending) {
  pendingAction = typeof pending === "function" ? pending : null;
  $("#loginForm").reset();
  $("#loginError").hidden = true;
  $("#loginError").textContent = "";

  const configured = state.configured;
  const email = $("#lfEmail");
  const submit = $("#loginSubmit");
  if (submit) submit.disabled = !configured;
  if (email) email.disabled = !configured;

  if (!configured) {
    const error = $("#loginError");
    error.hidden = false;
    error.textContent =
      "Studio login is unavailable: this build has no Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then redeploy.";
  }

  openLayer(loginModal(), email);
}

export function requireAdmin(action) {
  if (state.admin) {
    action();
    return;
  }
  openLogin(action);
}

const setLoginBusy = (busy) => {
  const submit = $("#loginSubmit");
  if (!submit) return;
  submit.disabled = busy || !state.configured;
  submit.textContent = busy ? "Signing in…" : "Enter studio";
};

async function handleLogin(event) {
  event.preventDefault();

  const email = $("#lfEmail").value.trim();
  const password = $("#lfPass").value;
  const error = $("#loginError");

  if (!email || !password) {
    error.hidden = false;
    error.textContent = "Enter your studio email and password.";
    return;
  }

  setLoginBusy(true);
  error.hidden = true;

  let result;
  try {
    result = await signIn(email, password);
  } catch (err) {
    result = { ok: false, error: describeError(err, "Sign in failed. Please try again.") };
  } finally {
    setLoginBusy(false);
  }

  if (!result.ok) {
    error.hidden = false;
    error.textContent = result.error;
    $("#lfPass").value = "";
    $("#lfPass").focus();
    return;
  }

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

function clearFilePreview() {
  if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
  filePreviewUrl = null;
  const input = $("#pfFile");
  if (input) input.value = "";
}

function renderPreview() {
  const box = $("#pfPreview");
  if (!box) return;

  if (filePreviewUrl) {
    box.innerHTML = '<img src="' + esc(filePreviewUrl) + '" alt="Preview of the image you chose" />';
    return;
  }

  const value = $("#pfImage").value.trim();
  if (!value) {
    box.innerHTML = "<span>Upload an image, or paste an https:// URL</span>";
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

  clearFilePreview();
  selectedFile = null;

  $("#productTitle").innerHTML = editing ? "Edit <em>piece</em>" : "Add a <em>piece</em>";
  $("#productSub").textContent = editing
    ? "Saving updates this piece in the live catalogue for every visitor."
    : "Publishing adds this piece to the live catalogue immediately.";
  $("#productSubmit").textContent = editing ? "Save changes" : "Publish piece";

  $("#pfId").value = editing ? product.id : "";
  $("#pfTitle").value = editing ? product.title : "";
  $("#pfCategory").value = editing
    ? product.category
    : state.filter !== "All Items"
      ? state.filter
      : categoryTabs()[1] || "";
  $("#pfPrice").value = editing ? product.price : "";
  $("#pfCondition").value = editing ? product.condition : "Excellent";
  $("#pfSizes").value = editing ? product.sizes.join(", ") : "";
  $("#pfImage").value = editing && !String(product.image).startsWith("data:") ? product.image : "";
  $("#pfDescription").value = editing ? product.description : "";
  $("#pfFileLabel").textContent = editing ? "Replace image (optional)" : "Upload image";

  clearProductErrors();
  renderPreview();
  openLayer(productModal(), $("#pfTitle"));
}

const setProductBusy = (busy, label) => {
  const submit = $("#productSubmit");
  if (!submit) return;
  submit.disabled = busy;
  if (busy) submit.textContent = label;
};

async function handleProductSubmit(event) {
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
  if (!selectedFile && !image) {
    productError("image", "Upload a photo or paste an image URL.");
    valid = false;
  } else if (image && /^\s*(javascript|vbscript|file):/i.test(image)) {
    productError("image", "That image link can't be used. Use https:// or upload a file.");
    valid = false;
  }
  if (selectedFile) {
    const fileIssue = validateImage(selectedFile);
    if (fileIssue) {
      productError("image", fileIssue);
      valid = false;
    }
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

  setProductBusy(true, selectedFile ? "Uploading…" : "Saving…");

  try {
    // The file goes to Storage first; its public URL is what the row stores.
    let imageUrl = image;
    if (selectedFile) {
      imageUrl = await uploadProductImage(selectedFile, { title });
    }

    const saved = await saveProduct({
      id: id || undefined,
      title,
      category: $("#pfCategory").value,
      price: Math.round(price),
      condition: $("#pfCondition").value,
      sizes,
      image: imageUrl,
      description
    });

    toast((id ? "Saved — " : "Published — ") + saved.title);
    closeLayer(productModal());
    clearFilePreview();
    selectedFile = null;

    // Show the merchant exactly where the piece landed.
    if (!id) {
      window.setTimeout(() => {
        selectCategory(saved.category, { focus: false, scroll: true });
      }, 180);
    }
  } catch (error) {
    const message = describeError(error, "Couldn't save that piece.");
    // Surface image problems against the image field; anything else is a toast.
    if (/image|upload/i.test(message)) productError("image", message);
    toast(message, "warn");
  } finally {
    setProductBusy(false, id ? "Save changes" : "Publish piece");
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
      text: '"' + product.title + '" will be removed from the live catalogue. This cannot be undone.',
      confirmLabel: "Delete piece"
    },
    async () => {
      try {
        await deleteProduct(product.id);
        toast("Deleted — " + product.title);
      } catch (error) {
        toast(error.message || "Couldn't delete that piece", "warn");
      }
    }
  );
}

export function confirmSeed() {
  askConfirm(
    {
      title: "Load <em>starter catalogue</em>",
      text: "Insert the original ten pieces so the collection isn't empty. This only runs when the catalogue has no pieces.",
      confirmLabel: "Insert ten pieces",
      danger: false
    },
    async () => {
      try {
        const count = await seedStarterCatalogue();
        toast("Added " + count + " pieces to the catalogue");
      } catch (error) {
        toast(error.message || "Couldn't load the starter catalogue", "warn");
      }
    }
  );
}

export function confirmSignOut() {
  askConfirm(
    {
      title: "Sign out of <em>merchant mode</em>",
      text: "The storefront returns to shopper view. Your pieces stay in the live catalogue.",
      confirmLabel: "Sign out",
      danger: false
    },
    async () => {
      await signOut();
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
  on("#merchantSeed", () => {
    if (state.admin) confirmSeed();
  });
  on("#merchantLogout", async () => {
    await signOut();
    toast("Signed out of merchant mode");
  });
  on("#footerAdmin", async () => {
    if (state.admin) {
      await signOut();
      toast("Signed out of merchant mode");
    } else {
      openLogin();
    }
  });

  on("#loginBtn", () => {
    if (state.admin) confirmSignOut();
    else openLogin();
  });
  on("#mobileLogin", async () => {
    if (state.admin) {
      await signOut();
      toast("Signed out of merchant mode");
    } else {
      openLogin();
    }
  });

  $("#loginForm").addEventListener("submit", handleLogin);
  $("#productForm").addEventListener("submit", handleProductSubmit);

  $("#pfImage").addEventListener("input", () => {
    if (selectedFile) return; // a chosen file wins over the URL field
    window.clearTimeout(bindAdmin._previewTimer);
    bindAdmin._previewTimer = window.setTimeout(renderPreview, 200);
  });

  const fileInput = $("#pfFile");
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
      clearProductErrors();
      selectedFile = null;

      if (!file) {
        clearFilePreview();
        renderPreview();
        return;
      }

      const issue = validateImage(file);
      if (issue) {
        clearFilePreview();
        productError("image", issue);
        renderPreview();
        return;
      }

      selectedFile = file;
      if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
      filePreviewUrl = URL.createObjectURL(file);
      renderPreview();
    });
  }

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

  // Populate the category menu from the live categories (falling back to config).
  const categorySelect = $("#pfCategory");
  if (categorySelect) {
    const names = categoryTabs().slice(1);
    const current = names.join("|");
    if (categorySelect.dataset.filled !== current) {
      categorySelect.innerHTML = names
        .map((category) => '<option value="' + esc(category) + '">' + esc(category) + "</option>")
        .join("");
      categorySelect.dataset.filled = current;
    }
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

  return { openProductForm, confirmDelete, confirmSeed };
}

export const isDraftOpen = () => productModal().classList.contains("is-open");

export function closeProductForm() {
  closeLayer(productModal());
}

export function closeConfirm() {
  closeLayer(confirmModal());
}

export const findProduct = getProduct;
