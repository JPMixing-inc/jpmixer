'use strict';

// Station picker: a card for each Home page, from /home-pages.
const ICONS = {
  foh: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-6h6v6M7 10h2m6 0h2"/>',
  propresenter: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M7 9h10M7 12h6"/>',
  lighting: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/>',
  switcher: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3v10l-6-3"/>',
  plugin: '<path d="M9 3h6v4a2 2 0 1 0 0 4v4h-4a2 2 0 1 0-4 0H3V9h4a2 2 0 1 0 0-4V3Z" transform="translate(3 3)"/>',
};
const LOCK = '<svg class="home-lock" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

function card(page) {
  const a = document.createElement('a');
  a.className = 'home-btn';
  a.href = page.href;
  a.dataset.configured = String(page.configured);
  const icon = document.createElement('span');
  icon.className = 'home-btn-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[page.id] || ICONS.foh}</svg>`;
  const meta = document.createElement('span');
  meta.className = 'home-btn-meta';
  meta.textContent = page.label;
  const title = document.createElement('span');
  title.className = 'home-btn-title';
  title.textContent = page.page;
  const person = document.createElement('span');
  person.className = 'home-btn-person';
  person.textContent = page.note || (!page.configured ? 'Not set up yet' : page.person ? `On today: ${page.person}` : page.locked ? 'Needs a code' : 'No one scheduled yet');
  // A code-protected page says so on its bottom line, whatever else it shows
  if (page.locked) { if (!page.configured || page.person) person.textContent += ' · Code'; person.insertAdjacentHTML('afterbegin', LOCK); }
  a.append(icon, meta, title, person);
  a.setAttribute('aria-label', `${page.page}. ${person.textContent.replace('· Code', '· needs a code')}`);
  return a;
}

async function load() {
  const box = document.getElementById('homeButtons');
  const notice = document.getElementById('homeNotice');
  try {
    const res = await fetch('/home-pages', { cache: 'no-store' });
    const data = await res.json();
    box.textContent = '';
    for (const page of data.pages || []) box.appendChild(card(page));
    // Pages from plugins (Settings → Plugins), after the Home pages
    for (const p of data.plugins || []) box.appendChild(card({ id: 'plugin', href: p.href, configured: true, label: 'Plugin', page: p.title, person: null, locked: false, note: `From the ${p.plugin} plugin` }));
    notice.hidden = true;
  } catch (_) {
    if (!box.children.length) { notice.textContent = 'Can’t reach JPMixer right now. Check the connection.'; notice.hidden = false; }
  } finally {
    box.removeAttribute('aria-busy');
    globalThis.jpmSplash?.done();
  }
}
load();
setInterval(load, 30000); // who's on can change

// The wordmark's intro (wordmark-fx.css), once the loading splash has gone,
// and its glare again on hover
(() => {
  const fx = document.getElementById('homeWordmarkFx');
  if (!fx) return;
  const img = fx.querySelector('img');
  let introUntil = 0;
  function syncMask() {
    if (img.classList.contains('jp-custom-logo') && img.getAttribute('src')) fx.style.setProperty('--logo', `url("${img.getAttribute('src')}")`);
    else fx.style.removeProperty('--logo');
  }
  function playIntro() {
    syncMask();
    fx.classList.add('intro');
    introUntil = Date.now() + 6400;
    setTimeout(() => fx.classList.remove('intro'), 6400);
  }
  if (globalThis.jpmSplash && !globalThis.jpmSplash.gone) window.addEventListener('jpm-splash-gone', playIntro, { once: true });
  else playIntro();
  fx.addEventListener('mouseenter', () => {
    if (Date.now() < introUntil || fx.classList.contains('shine')) return;
    syncMask();
    fx.classList.add('shine');
  });
  fx.addEventListener('animationend', (event) => { if (event.animationName === 'wmGlareOnce') fx.classList.remove('shine'); });
})();
