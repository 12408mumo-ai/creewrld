/**
 * The studio: passphrase prompt, the Studio drawer for creating and editing
 * pieces (image dropzone, stock switch, category, price), destructive
 * confirmations, and the console bar with per-card overlays.
 *
 * Nothing here decides who is an admin on its own — `state.admin` comes from
 * store.js, which compares the passphrase and remembers the answer for the
 * tab. See src/data/studio.js for what that is and is not worth.
 */

import { CONDITIONS } from "../lib/products.js";
import { $, $$, esc } from "../lib/format.js";
import {
  categoryTabs,
  deleteProduct,
  getProduct,
  lockStudioSession,
  refreshCatalogue,
  saveProduct,
  seedStarterCatalogue,
  state,
  syncStudioFromStorage,
  unlockStudioWith
} from "../store.js";
import { selectCategory } from "./grid.js";
import { closeLayer, openLayer, toast } from "./layers.js";
import { uploadProductImage, validateImage } from "../data/storage.js";
import { describeError } from "../lib/supabase.js";

/** Shown when the database refuses a write — almost always a missing policy. */
const PUBLISH_BLOCKED =
  "Failed to publish piece to database. Ensure database RLS policies permit public inserts.";

const loginModal = () => $("#loginModal");
const studioDrawer = () => $("#studioDrawer");
const productModal = studioDrawer; // the drawer is the product form
const confirmModal = () => $("#confirmModal");

let pendingAction = null;
let confirmAction = null;
let selectedFile = null;
let filePreviewUrl = null;

/* -------------------------------------------------------------------- chrome */

/**
 * The single switch for every merchant surface.
 *
 * It reads `sessionStorage.isAdmin` rather than trusting a flag in memory, so
 * the DOM can never disagree with what the tab actually unlocked: a reload, a
 * logout, or a value cleared in another script all resolve the same way. It is
 * safe to call at any time — on boot, after the passphrase, after a logout,
 * and after every grid render — because `syncStudioFromStorage` only emits
 * when the value really changed.
 */
export function applyAdminState() {
  const isAdmin = syncStudioFromStorage();

  // Card overlays and the quick-view admin row are styled from this class.
  document.body.classList.toggle("is-admin", isAdmin);

  // The console bar carries "+ New piece" — the add-product entry point.
  const bar = $("#studioBar");
  if (bar) bar.hidden = !isAdmin;

  // A live count, so the console says what the grid is showing.
  const count = $("#studioCount");
  if (count) {
    const total = state.products.length;
    const live = state.products.filter((product) => product.inStock !== false).length;
    count.textContent = String(total).padStart(2, "0") + " pieces · " +
      String(live).padStart(2, "0") + " in stock";
  }

  // Unlocked, the header action is the way out; locked, it opens the modal.
  const label = $("#loginBtnLabel");
  if (label) label.textContent = isAdmin ? "Logout" : "Login / Admin";

  const mobileLabel = $("#mobileLogin");
  if (mobileLabel) mobileLabel.textContent = isAdmin ? "Logout" : "Login / Admin";

  // The accessible name must contain the visible words, so a screen reader
  // hears the same thing the button says.
  const loginBtn = $("#loginBtn");
  if (loginBtn) {
    loginBtn.setAttribute("aria-label", isAdmin ? "Logout — leave studio mode" : "Login / Admin");
  }

  // Belt and braces: the CSS above already hides these, but a card rendered
  // while unlocked must not leave an invisible-but-focusable button behind.
  $$(".card__admin").forEach((node) => {
    node.setAttribute("aria-hidden", isAdmin ? "false" : "true");
  });

  $$(".qv__admin").forEach((node) => {
    node.hidden = !isAdmin;
  });

  // The starter catalogue is only offered while there is nothing to overwrite.
  const seed = $("#studioSeed");
  if (seed) seed.hidden = !(isAdmin && !state.loading && state.products.length === 0);

  // Unlocking closes the prompt; any other state leaves it alone.
  if (isAdmin) closeLayer(loginModal());

  return isAdmin;
}


/* --------------------------------------------------------------------- login */

/** Blank the passphrase error. */
function clearLoginError() {
  const error = $("#loginError");
  if (!error) return;
  error.textContent = "";
  error.hidden = true;
}

/** Show one line in red under the field. */
function showLoginError(message) {
  const error = $("#loginError");
  if (!error) return;
  error.textContent = message || "";
  error.hidden = !message;
}

export function openLogin(pending) {
  pendingAction = typeof pending === "function" ? pending : null;
  $("#loginForm").reset();
  clearLoginError();

  const submit = $("#loginSubmit");
  if (submit) submit.disabled = false;

  openLayer(loginModal(), $("#lfPass"));
}

export function requireAdmin(action) {
  if (state.admin) {
    action();
    return;
  }
  openLogin(action);
}

async function handleLogin(event) {
  event.preventDefault();

  const field = $("#lfPass");
  const typed = field.value;

  clearLoginError();

  if (!typed.trim()) {
    showLoginError("Enter the studio passphrase.");
    field.focus();
    return;
  }

  const result = unlockStudioWith(typed);

  if (!result.ok) {
    showLoginError("Incorrect studio passphrase. Please try again.");
    field.value = "";
    field.focus();
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

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? mb.toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
};

/**
 * The dropzone thumbnail. It shows the chosen file while there is one, and
 * otherwise the current photograph when editing — so the merchant can see
 * what they are about to replace.
 */
function renderPreview() {
  const box = $("#pfPreview");
  const empty = $("#pfEmpty");
  const img = $("#pfPreviewImg");
  const meta = $("#pfPreviewMeta");
  if (!box || !img) return;

  const value = ($("#pfImage") ? $("#pfImage").value.trim() : "") || "";
  const blocked = /^\s*(javascript|vbscript|file):/i.test(value);
  const source = filePreviewUrl || (blocked ? "" : value);

  if (!source) {
    box.hidden = true;
    if (empty) empty.hidden = false;
    return;
  }

  img.src = source;
  box.hidden = false;
  if (empty) empty.hidden = true;

  if (meta) {
    if (filePreviewUrl && selectedFile) {
      meta.textContent = selectedFile.name + " · " + formatBytes(selectedFile.size) + " · ready to upload";
    } else if (value) {
      meta.textContent = "Current photograph — choose a file to replace it";
    } else {
      meta.textContent = "";
    }
  }
}

/**
 * Category options come from the live `categories` table (via the shared tab
 * list), so the drawer never offers a tab the database does not have.
 */
function fillCategoryOptions() {
  const select = $("#pfCategory");
  if (!select) return;

  const names = categoryTabs().slice(1);
  const signature = names.join("|");
  if (select.dataset.filled === signature && select.options.length === names.length) return;

  const previous = select.value;
  select.innerHTML = names
    .map((category) => '<option value="' + esc(category) + '">' + esc(category) + "</option>")
    .join("");
  select.dataset.filled = signature;

  if (names.includes(previous)) select.value = previous;
}

/** Condition grades are configuration, not database rows. */
function fillConditionOptions() {
  const select = $("#pfCondition");
  if (!select || select.options.length === CONDITIONS.length) return;

  select.innerHTML = CONDITIONS.map(
    (condition) =>
      '<option value="' + esc(condition) + '"' +
      (condition === "Excellent" ? " selected" : "") + ">" + esc(condition) + "</option>"
  ).join("");
}

/** Keep the stock switch's visible label in step with the checkbox. */
function renderStockState() {
  const toggle = $("#pfStock");
  const label = $("#pfStockState");
  if (!toggle || !label) return;
  label.textContent = toggle.checked ? "In stock" : "Sold out";
}

/** A rough shilling total in words, so 6500 reads as "KSh 6,500". */
function renderPriceHint() {
  const input = $("#pfPrice");
  const words = $("#pfPriceWords");
  if (!input || !words) return;
  const value = Number(input.value);
  words.textContent =
    Number.isFinite(value) && value > 0
      ? "KSh " + Math.round(value).toLocaleString("en-KE")
      : "no amount yet";
}

export function openProductForm(product) {
  const editing = Boolean(product);

  clearFilePreview();
  selectedFile = null;

  $("#studioKicker").textContent = editing ? "Studio · editing piece" : "Studio · new piece";
  $("#studioTitle").innerHTML = editing ? "Edit <em>piece</em>" : "New <em>piece</em>";
  $("#studioSub").textContent = editing
    ? "Saving updates this piece on the live grid for every visitor."
    : "Publishing adds this piece to the live grid immediately.";
  $("#studioNote").textContent = selectedFile
    ? ""
    : "Uploads go to the product-images bucket.";

  // Category options come from the live `categories` table, so the drawer can
  // never offer a tab the database does not have.
  fillCategoryOptions();

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
  $("#pfImage").value =
    editing && !String(product.image).startsWith("data:") && !String(product.image).startsWith("assets/")
      ? product.image
      : "";
  $("#pfDescription").value = editing ? product.description : "";
  $("#pfStock").checked = editing ? product.inStock !== false : true;

  setProductBusy(false);
  renderStockState();
  renderPriceHint();
  clearProductErrors();
  renderPreview();

  openLayer(studioDrawer(), $("#pfTitle"));
}

/**
 * The publish button: a disabled state and a spinner while the upload and the
 * insert are in flight, and its resting label otherwise.
 */
const setProductBusy = (busy, label) => {
  const submit = $("#productSubmit");
  if (!submit) return;

  const text = submit.querySelector(".studio__publish-label");
  const editing = Boolean($("#pfId") && $("#pfId").value);
  const resting = editing ? "Save changes" : "Publish to grid";

  submit.disabled = busy;
  submit.classList.toggle("is-busy", busy);
  submit.setAttribute("aria-busy", busy ? "true" : "false");

  const next = busy ? label || "Publishing…" : resting;
  if (text) text.textContent = next;
  else submit.textContent = next;
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

  setProductBusy(true, selectedFile ? "Uploading…" : "Publishing…");

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
      description,
      inStock: $("#pfStock") ? $("#pfStock").checked : true
    });

    // The piece is in the database: get the drawer out of the way first, then
    // re-hydrate the grid from what the server actually holds.
    closeLayer(productModal());
    clearFilePreview();
    selectedFile = null;
    toast((id ? "Saved — " : "Published — ") + saved.title);

    try {
      await refreshCatalogue();
    } catch (refreshError) {
      // The write landed; only the follow-up read failed. The optimistic row
      // is already on the grid, so say so quietly instead of implying loss.
      toast("Saved, but the grid couldn't refresh. Reload to see it.", "warn");
    }

    // Show the merchant exactly where the piece landed.
    if (!id) {
      const landed = getProduct(saved.id) || saved;
      window.setTimeout(() => {
        selectCategory(landed.category, { focus: false, scroll: true });
      }, 180);
    }
  } catch (error) {
    const message = describeError(error, "Couldn't save that piece.");
    // Image problems belong against the image field; a refused write is a
    // database permissions problem and says so, in the terms that fix it.
    if (/image|upload/i.test(message)) {
      productError("image", message);
      toast(message, "warn");
    } else if (/row.?level security|policy|permission|not allowed|42501/i.test(message)) {
      toast(PUBLISH_BLOCKED, "warn");
    } else {
      toast(message, "warn");
    }
  } finally {
    setProductBusy(false);
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
      title: "Delete this piece permanently?",
      text: '"' + product.title + '" will be removed from the live grid for every visitor. This cannot be undone.',
      confirmLabel: "Delete permanently"
    },
    async () => {
      try {
        await deleteProduct(product.id);
      } catch (error) {
        const message = describeError(error, "Couldn't delete that piece.");
        toast(
          /row.?level security|policy|permission|not allowed|42501/i.test(message) ? PUBLISH_BLOCKED : message,
          "warn"
        );
        return;
      }

      toast("Deleted — " + product.title);

      // The row is gone locally; re-read so the grid matches the database.
      try {
        await refreshCatalogue();
      } catch (error) {
        toast("Deleted, but the grid couldn't refresh. Reload to confirm.", "warn");
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

/* ----------------------------------------------------------------- binding */

const on = (selector, handler) => {
  const node = $(selector);
  if (node) node.addEventListener("click", handler);
};

export function bindAdmin() {
  // Adding a piece is merchant-only: the entry point lives in the signed-in
  // merchant strip (and per-card edit overlays), never in the public header.
  on("#studioNew", () => {
    if (state.admin) openProductForm(null);
  });
  on("#studioSeed", () => {
    if (state.admin) confirmSeed();
  });
  const closeStudio = () => {
    lockStudioSession();
    toast("Signed out of merchant mode");
  };

  on("#studioLogout", closeStudio);
  on("#footerAdmin", () => {
    if (state.admin) closeStudio();
    else openLogin();
  });

  // One control, two jobs — exactly as the label says: LOGIN / ADMIN opens the
  // passphrase prompt, LOGOUT forgets it and hides every merchant control.
  on("#loginBtn", () => {
    if (state.admin) closeStudio();
    else openLogin();
  });
  on("#mobileLogin", () => {
    if (state.admin) closeStudio();
    else openLogin();
  });

  $("#loginForm").addEventListener("submit", handleLogin);

  // A refusal belongs to the attempt that caused it: start retyping and the
  // message about the last one gets out of the way.
  const passField = $("#lfPass");
  if (passField) passField.addEventListener("input", clearLoginError);

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

  // Conditions are configured centrally too.
  fillConditionOptions();

  // ---- stock switch + price hint
  const stock = $("#pfStock");
  if (stock) {
    stock.addEventListener("change", renderStockState);
    renderStockState();
  }

  const price = $("#pfPrice");
  if (price) price.addEventListener("input", renderPriceHint);

  // ---- the dropzone: click-to-browse is the file input itself, drag adds drop
  const dropzone = $("#pfDropzone");
  if (dropzone && fileInput) {
    const stop = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    ["dragenter", "dragover"].forEach((type) => {
      dropzone.addEventListener(type, (event) => {
        stop(event);
        dropzone.classList.add("is-dragging");
      });
    });

    ["dragleave", "dragend"].forEach((type) => {
      dropzone.addEventListener(type, (event) => {
        stop(event);
        if (type === "dragleave" && dropzone.contains(event.relatedTarget)) return;
        dropzone.classList.remove("is-dragging");
      });
    });

    dropzone.addEventListener("drop", (event) => {
      stop(event);
      dropzone.classList.remove("is-dragging");

      const files = event.dataTransfer && event.dataTransfer.files;
      const file = files && files[0] ? files[0] : null;
      if (!file) {
        productError("image", "Drop an image file — JPG, PNG, WebP or AVIF.");
        return;
      }

      // The input owns validation and previewing; hand the dropped file over.
      try {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        fileInput.files = transfer.files;
      } catch (error) {
        /* older engines can't build a DataTransfer — fall through to validation */
      }

      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Dropping anywhere else must not navigate away from the studio.
    const swallowDrop = (event) => {
      if (!studioDrawer().classList.contains("is-open")) return;
      if (dropzone.contains(event.target)) return;
      stop(event);
    };
    window.addEventListener("dragover", swallowDrop);
    window.addEventListener("drop", swallowDrop);
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
