/**
 * Category rail + product grid.
 * Cards are rendered from state and wired through delegated events.
 */

import { CATEGORIES } from "../config.js";
import { $, $$, esc, money } from "../lib/format.js";
import { resolveImage } from "../lib/images.js";
import { countFor, getProduct, setFilter, state, visibleProducts } from "../store.js";

export function renderFilters() {
  const rail = $("#filters");
  if (!rail) return;

  rail.innerHTML = CATEGORIES.map((category) => {
    const selected = state.filter === category;
    return (
      '<button type="button" class="filter" role="tab"' +
      ' id="tab-' + esc(category.toLowerCase().replace(/[^a-z0-9]+/g, "-")) + '"' +
      ' aria-selected="' + (selected ? "true" : "false") + '"' +
      ' aria-controls="productGrid"' +
      ' tabindex="' + (selected ? "0" : "-1") + '"' +
      ' data-filter="' + esc(category) + '">' +
      esc(category) +
      '<span class="filter__sup">' + String(countFor(category)).padStart(2, "0") + "</span>" +
      "</button>"
    );
  }).join("");
}

export function cardMarkup(product, index) {
  const delay = Math.min(index * 45, 360);
  return (
    '<article class="card" data-id="' + esc(product.id) + '" style="animation-delay:' + delay + 'ms">' +
      '<div class="card__media">' +
        '<img src="' + esc(resolveImage(product.image)) + '" alt="' + esc(product.title) + '"' +
          ' loading="lazy" width="900" height="1125" />' +
        '<span class="card__badge">' + esc(product.condition) + "</span>" +
        '<div class="card__admin">' +
          '<button type="button" class="icon-btn" data-edit="' + esc(product.id) + '"' +
            ' aria-label="Edit ' + esc(product.title) + '">' +
            '<svg class="ico" aria-hidden="true"><use href="#i-edit"/></svg></button>' +
          '<button type="button" class="icon-btn icon-btn--del" data-delete="' + esc(product.id) + '"' +
            ' aria-label="Delete ' + esc(product.title) + '">' +
            '<svg class="ico" aria-hidden="true"><use href="#i-trash"/></svg></button>' +
        "</div>" +
        '<button type="button" class="card__quick" data-quick="' + esc(product.id) + '">Quick view</button>' +
      "</div>" +
      '<div class="card__body">' +
        '<div class="card__row">' +
          '<h3 class="card__title">' + esc(product.title) + "</h3>" +
          '<span class="card__price">' + money(product.price) + "</span>" +
        "</div>" +
        '<div class="card__meta">' +
          '<span class="card__sizes">' + esc(product.sizes.join(" · ")) + "</span>" +
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

export function renderGrid() {
  const grid = $("#productGrid");
  if (!grid) return;

  const items = visibleProducts();
  grid.setAttribute("aria-busy", "true");
  grid.innerHTML = items.map(cardMarkup).join("");
  grid.setAttribute("aria-busy", "false");

  const empty = $("#emptyState");
  if (empty) empty.hidden = items.length > 0;

  // restart the staggered entrance animation on every render
  $$(".card", grid).forEach((card, index) => {
    card.style.animation = "none";
    void card.offsetWidth;
    card.style.animation = "";
    card.style.animationDelay = Math.min(index * 45, 360) + "ms";
  });

  const count = $("#resultCount");
  if (count) count.textContent = items.length + (items.length === 1 ? " piece" : " pieces");
}

/** Switch category without rebuilding the rail (keeps focus steady). */
export function selectCategory(category, options = {}) {
  if (!CATEGORIES.includes(category)) return;
  setFilter(category);

  $$(".filter", $("#filters")).forEach((button) => {
    const selected = button.dataset.filter === category;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });

  renderGrid();

  const active = $('.filter[aria-selected="true"]', $("#filters"));
  if (active && options.focus !== false) active.focus({ preventScroll: true });

  if (options.scroll) {
    const grid = $("#productGrid");
    const top = grid.getBoundingClientRect().top + window.scrollY - 140;
    window.scrollTo({ top, behavior: "smooth" });
  }
}

/**
 * handlers: { onOrder(id), onQuick(id), onEdit(product), onDelete(product) }
 */
export function bindGrid(handlers) {
  const filters = $("#filters");
  const grid = $("#productGrid");

  filters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (button) selectCategory(button.dataset.filter);
  });

  filters.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const tabs = $$(".filter", filters);
    const current = tabs.indexOf(document.activeElement);
    if (current === -1) return;

    event.preventDefault();
    const next = event.key === "ArrowRight"
      ? (current + 1) % tabs.length
      : (current - 1 + tabs.length) % tabs.length;
    tabs[next].focus();
    selectCategory(tabs[next].dataset.filter, { focus: false });
  });

  grid.addEventListener("click", (event) => {
    const order = event.target.closest("[data-order]");
    if (order) return handlers.onOrder(order.dataset.order);

    const quick = event.target.closest("[data-quick]");
    if (quick) return handlers.onQuick(quick.dataset.quick);

    const edit = event.target.closest("[data-edit]");
    if (edit) return handlers.onEdit(getProduct(edit.dataset.edit));

    const remove = event.target.closest("[data-delete]");
    if (remove) return handlers.onDelete(getProduct(remove.dataset.delete));
  });
}
