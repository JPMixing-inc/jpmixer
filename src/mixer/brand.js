'use strict';

// Custom branding on the pages JPMixer serves (see src/server/branding.js).
// /branding.css carries the accent colors and, when a logo is uploaded, its
// address (--jpm-brand-logo) and a rule keeping the JPMixer logos hidden until
// this script swaps them. Logos added later (FOH's photo placeholder) are
// swapped as they appear. Changes made in Settings reach open pages within
// 30 seconds. With no logo uploaded this changes nothing.
(() => {
  const SELECTOR = 'img.jp-wordmark, img.jp-emblem, img.jp-fallback-logo, img.jp-empty-logo';
  const cssLogo = () => getComputedStyle(document.documentElement).getPropertyValue('--jpm-brand-logo').trim().replace(/^["']|["']$/g, '');
  let logo = cssLogo() || null;
  let lastState = null;

  function swap(img) {
    if (logo) {
      if (!img.dataset.jpmDefaultSrc) img.dataset.jpmDefaultSrc = img.getAttribute('src') || '';
      if (img.getAttribute('src') !== logo) img.src = logo;
      if (img.closest('.jp-brand')) img.alt = 'Logo';
      img.classList.add('jp-custom-logo');
    } else if (img.dataset.jpmDefaultSrc !== undefined) {
      img.src = img.dataset.jpmDefaultSrc;
      delete img.dataset.jpmDefaultSrc;
      if (img.closest('.jp-brand')) img.alt = 'JPMixer';
      img.classList.remove('jp-custom-logo');
    }
  }
  const swapAll = () => document.querySelectorAll(SELECTOR).forEach(swap);

  new MutationObserver((mutations) => {
    for (const m of mutations) for (const node of m.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches(SELECTOR)) swap(node);
      node.querySelectorAll?.(SELECTOR).forEach(swap);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  swapAll();

  async function check() {
    try {
      const res = await fetch('/branding.json', { cache: 'no-store' });
      if (!res.ok) return;
      const state = JSON.stringify(await res.json());
      if (lastState !== null && state !== lastState) {
        // Changed in Settings: reload the stylesheet, then swap to match it
        const link = document.querySelector('link[href^="/branding.css"]');
        if (link) {
          const next = link.cloneNode();
          next.href = '/branding.css?v=' + Date.now();
          next.addEventListener('load', () => { link.remove(); logo = cssLogo() || null; swapAll(); });
          link.after(next);
        }
      }
      lastState = state;
    } catch (_) {}
  }
  check();
  setInterval(check, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
})();
