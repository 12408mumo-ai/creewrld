/**
 * Hero lookbook: a slow cross-fade between four pieces with a numbered caption.
 */

import { HERO_SLIDES } from "../catalog.js";
import { $, $$, esc, pad2 } from "../lib/format.js";
import { resolveImage } from "../lib/images.js";

let index = 0;
let timer = null;

const slidesEl = () => $("#heroSlides");
const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function paintCaption() {
  const slide = HERO_SLIDES[index];
  const counter = $("#heroCapIndex");
  const title = $("#heroCapTitle");
  if (counter) counter.textContent = pad2(index + 1) + " / " + pad2(HERO_SLIDES.length);
  if (title && slide) title.textContent = slide.title;
}

function advance() {
  const slides = slidesEl();
  if (!slides) return;
  const images = $$("img", slides);
  if (images.length < 2) return;

  images[index].classList.remove("is-active");
  index = (index + 1) % images.length;
  images[index].classList.add("is-active");
  paintCaption();
}

function start() {
  stop();
  if (reducedMotion()) return;
  timer = window.setInterval(advance, 5200);
}

function stop() {
  if (timer) window.clearInterval(timer);
  timer = null;
}

export function initHero() {
  const slides = slidesEl();
  if (!slides) return;

  slides.innerHTML = HERO_SLIDES.map((slide, position) =>
    '<img src="' + esc(resolveImage(slide.image)) + '" alt="" class="' +
      (position === 0 ? "is-active" : "") + '" ' +
      (position === 0 ? 'fetchpriority="high"' : 'loading="lazy"') + " />"
  ).join("");

  paintCaption();
  start();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });
}

export const heroSlideCount = () => HERO_SLIDES.length;
