/**
 * Fixed header behaviour: condense on scroll, mobile menu, and keeping the
 * layout's top offset in sync with the real header height.
 */

import { $ } from "../lib/format.js";

export function updateTopOffset() {
  const siteTop = $("#siteTop");
  if (!siteTop) return;
  const height = siteTop.getBoundingClientRect().height;
  document.documentElement.style.setProperty("--top-h", Math.round(height) + "px");
}

export function initHeader() {
  const siteTop = $("#siteTop");
  const menuBtn = $("#menuBtn");
  const mobileNav = $("#mobileNav");
  if (!siteTop) return;

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      siteTop.classList.toggle("is-scrolled", window.scrollY > 28);
      updateTopOffset();
      ticking = false;
    });
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", updateTopOffset);
  onScroll();

  if ("ResizeObserver" in window) {
    new ResizeObserver(updateTopOffset).observe(siteTop);
  }

  if (menuBtn && mobileNav) {
    const setMenu = (open) => {
      menuBtn.setAttribute("aria-expanded", String(open));
      menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      mobileNav.classList.toggle("is-open", open);
      window.setTimeout(updateTopOffset, 60);
    };

    menuBtn.addEventListener("click", () => {
      setMenu(menuBtn.getAttribute("aria-expanded") !== "true");
    });

    mobileNav.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) setMenu(false);
    });
  }
}
