'use strict';

// Loading splash for the pages JPMixer serves: the logo pops in with a glare
// and a loader bar, like the app's launch splash (src/windows/splash), then
// fades once the page has its data. Load this as the first thing in <body>
// (with splash.css in <head>) so it covers the page from the first paint.
// The page calls jpmSplash.done() when its first data is in: the WebSocket
// pages on the first config message, the schedule pages when their first
// fetch finishes, whatever the result. A custom logo (brand.js) takes the
// JPMixer wordmark's place, and the glare is masked to that logo.
(() => {
  const MIN_MS = 1600;   // long enough for the glare to finish
  const MAX_MS = 6000;   // never left covering a page that can't load

  const el = document.createElement('div');
  el.className = 'jpm-splash';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="jpm-splash-stage"><span class="jpm-splash-logo"><img class="jp-wordmark" src="brand/jpmixer-wordmark.svg" alt="" width="320" height="45" /></span><div class="jpm-splash-loader"></div></div>';
  const logo = getComputedStyle(document.documentElement).getPropertyValue('--jpm-brand-logo').trim().replace(/^["']|["']$/g, '');
  if (logo) el.querySelector('.jpm-splash-logo').style.setProperty('--logo', `url("${logo}")`);
  document.body.prepend(el);

  const shownAt = performance.now();
  let leaving = false;
  function done() {
    if (leaving) return;
    leaving = true;
    setTimeout(() => {
      el.classList.add('out');
      const gone = () => { if (!el.isConnected) return; el.remove(); window.jpmSplash.gone = true; window.dispatchEvent(new Event('jpm-splash-gone')); };
      // Only its own fade: the logo's glare and pop end in here too, and bubble up
      el.addEventListener('animationend', (e) => { if (e.target === el && e.animationName === 'jpmSplashAway') gone(); });
      setTimeout(gone, 1200); // in case the animation never runs
    }, Math.max(0, MIN_MS - (performance.now() - shownAt)));
  }
  setTimeout(done, MAX_MS);
  window.jpmSplash = { done, gone: false };
})();
